/**
 * Edge Function instagram-programador — publica las piezas programadas que ya
 * han vencido. La API de Instagram no programa publicaciones: lo hace esto.
 * Ver docs/instagram-programar.md.
 *
 *   La llama SOLO pg_cron cada 5 minutos (job «instagram-programador»,
 *   migración 20261106110000_instagram_programacion.sql) con net.http_post,
 *   sin usuario ni JWT: verify_jwt = false. Autenticación real: cabecera
 *   x-webhook-secret == INSTAGRAM_PROGRAMADOR_SECRET, comparada en tiempo
 *   constante y FALLANDO CERRADO (500) si el secreto falta. El mismo valor
 *   vive en Vault como 'instagram_programador_secret'.
 *
 *   POST {} → 200 { ok, procesadas, resultados: [{ id, piezaId, resultado, … }] }
 *   POST { "accion": "limpiar" } → 200 { ok, accion: "limpiar", jpegMarcados,
 *        jpegBorrados, tmpBorrados, avisos }: limpieza diaria del bucket (ver
 *        limpieza.ts; cron «instagram-limpieza-bucket», migración 20261107010000).
 *   401 sin cabecera o incorrecta · 405 método · 500 falta configuración.
 *
 *   Cada pieza se publica con la cuenta de SU marca (ver entorno.ts:
 *   IG_USER_ID_TOUZA… o los generales) y con el cerrojo de publicación
 *   (409 «publicacion_en_curso» si alguien la está probando o publicando a
 *   mano: se reintenta en la siguiente pasada).
 *
 *   TIEMPO (A4 de la evaluación): límite GLOBAL de LIMITE_PASADA_MS desde que
 *   entra la petición. No se reclama otra programación sin MIN_PARA_PUBLICAR_MS
 *   por delante; el núcleo de publicación recibe el límite (menos
 *   MARGEN_CIERRE_MS) y no empieza ni llama a media_publish si no le da tiempo
 *   («sin_tiempo» → aplazar sin contar intento); los reels «procesando» se
 *   cierran solo si quedan MIN_PARA_PROCESANDO_MS.
 *
 *   Cada pasada, mientras quede tiempo (≤ MAX_POR_PASADA):
 *     1. instagram_programador_reclamar → UNA vencida con FOR UPDATE SKIP
 *        LOCKED y bloqueo con caducidad (dos pasadas nunca cogen la misma; un
 *        bloqueo caducado NO se vuelve a publicar: lo cierra la propia RPC).
 *     2. Idempotencia: si la pieza ya tiene media_id (o está «publicada»), se
 *        cierra como publicada SIN llamar a Meta.
 *     3. Publica con el MISMO núcleo que instagram-publicar
 *        (publicarConSesion: caption, HEAD del JPEG, cuota, contenedor creado
 *        AHORA —caduca a las 24 h—, FINISHED, media_publish, borrado del JPEG)
 *        con una sesión de servicio (service_role; la RLS no aplica).
 *     4. instagram_programador_cerrar según la respuesta:
 *          200 publicada               → publicada (media_id, permalink)
 *          202 Meta aún procesa        → reintentar con ESE contenedor
 *          429 cuota / límites de Meta → aplazar (no cuenta intento) y se
 *                                         termina la pasada
 *          400/404/409/422             → error definitivo (nada que reintentar)
 *          5xx, red, excepción         → reintentar con espera creciente
 *                                         (ESPERAS_REINTENTO); al 3.er intento, error
 *
 *   REELS (docs/instagram-video.md): Meta tarda minutos en procesar un vídeo.
 *     - Una programación de reel que recibe 202 se APLAZA (sin contar intento)
 *       con el mismo contenedor mientras no pase ESPERA_MAX_REEL_MS desde su
 *       hora; después cuenta como reintento normal.
 *     - Al final de cada pasada se cierran los reels que el panel dejó
 *       «procesando» (prueba o publicación): cerrarProcesando() repite la
 *       misma petición con su contenedor (prueba_ok / publicada / error). A
 *       las 24 h (el contenedor caduca) quedan en error.
 *
 *   Escrituras con service_role: la auditoría exige la cabecera
 *   x-audit-source (fn_identificar_actor_auditoria); se pone en TODAS las
 *   llamadas a Supabase.
 */
import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";
import { NOMBRES_ENTORNO } from "../_shared/instagram/entorno.ts";
import { json, leerJson, opciones } from "../_shared/instagram/http.ts";
import { registrarSecreto, registro, sanear } from "../_shared/instagram/secretos.ts";
import { leerPieza, type FilaPieza, type Sesion } from "../_shared/instagram/supabase.ts";
import { publicarConSesion, type DependenciasPublicar } from "../instagram-publicar/publicar.ts";
import { DIAS_VIDEO_PUBLICADO, limpiarBucket } from "./limpieza.ts";
import { cerrarProcesando, MIN_PARA_PROCESANDO_MS } from "./procesando.ts";

/** Días que un reel publicado conserva su MP4 en el cubo (INSTAGRAM_DIAS_VIDEO_PUBLICADO, 1-365). */
export function diasVideoPublicado(env: Record<string, string | undefined>): number {
  const n = Math.floor(Number(env.INSTAGRAM_DIAS_VIDEO_PUBLICADO));
  return Number.isFinite(n) && n >= 1 && n <= 365 ? n : DIAS_VIDEO_PUBLICADO;
}

export const ETIQUETA = "instagram-programador";
export const CABECERA_SECRETO = "x-webhook-secret";
/** Esperas tras el 1.er y el 2.º fallo (el 3.º deja la programación en error). */
export const ESPERAS_REINTENTO_SEG = [5 * 60, 15 * 60] as const;
/** Aplazamiento por cuota agotada o límites de Meta (la siguiente pasada del cron). */
export const ESPERA_CUOTA_SEG = 5 * 60;
/**
 * Espera mínima de un reintento «inmediato» (Meta aún procesa, contenedor
 * caducado o cambiado): lo deja para la siguiente pasada del cron y evita que
 * la misma pasada lo vuelva a reclamar al momento.
 */
export const ESPERA_SIGUIENTE_PASADA_SEG = 60;
/** Bloqueo de cada programación reclamada (de sobra para una publicación). */
export const BLOQUEO_SEG = 600;
/** Tiempo de sondeo de FINISHED por pieza (la función tiene ~150 s de reloj). */
export const PRESUPUESTO_SONDEO_MS = 40_000;
/** No se empieza otra pieza pasado este tiempo de la pasada. */
export const PRESUPUESTO_PASADA_MS = 60_000;
export const MAX_POR_PASADA = 3;
/**
 * Límite GLOBAL de la pasada (A4 de la evaluación), desde que entra la
 * petición: la Edge Function tiene 150 s de reloj en el plan gratuito (400 s
 * en el de pago); se deja margen. Ninguna llamada a Meta pasa de aquí
 * (ClienteGraph `limite`) y nada se empieza si no da tiempo a terminarlo.
 */
export const LIMITE_PASADA_MS = 110_000;
/** Lo que se guarda al final del límite para cerrar la programación (RPC). */
export const MARGEN_CIERRE_MS = 10_000;
/** No se reclama otra programación con menos de esto por delante (una publicación completa). */
export const MIN_PARA_PUBLICAR_MS = 75_000;
/** Reels: cuánto se aplaza sin contar intento mientras Meta procesa el vídeo (desde la hora programada). */
export const ESPERA_MAX_REEL_MS = 60 * 60_000;

export type Resultado = "publicada" | "reintentar" | "aplazar" | "error";

export interface Programacion {
  id: string;
  pieza_id: string;
  marca: string;
  programada_para: string;
  estado: string;
  intentos: number;
  contenedor_id: string | null;
  bloqueo_id: string;
}

export interface Cierre {
  resultado: Resultado;
  mensaje?: string | null;
  mediaId?: string | null;
  permalink?: string | null;
  contenedorId?: string | null;
  esperaSeg?: number;
}

export interface ResultadoPasada {
  id: string;
  piezaId: string;
  resultado: Resultado;
  estado: string | null;
  intentos: number | null;
  mensaje: string | null;
}

export type FuncionPublicar = (s: Sesion, request: Request, deps: DependenciasPublicar) => Promise<Response>;

export interface DependenciasProgramador {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
  ahora?: () => number;
  /** Núcleo de publicación (por defecto, el de instagram-publicar). */
  publicar?: FuncionPublicar;
  presupuestoPasadaMs?: number;
  presupuestoSondeoMs?: number;
  intervaloMs?: number;
  /** Límite global de la pasada en ms desde el inicio (por defecto LIMITE_PASADA_MS). */
  limitePasadaMs?: number;
  /** Instante (ms) en el que termina la pasada; si no, inicio + limitePasadaMs. */
  limite?: number;
}

/** Nombres que lee esta función: los de Instagram + service role + su secreto. */
export const NOMBRES_ENTORNO_PROGRAMADOR = [...NOMBRES_ENTORNO, "SUPABASE_SERVICE_ROLE_KEY", "INSTAGRAM_PROGRAMADOR_SECRET", "INSTAGRAM_DIAS_VIDEO_PUBLICADO"] as const;

export function entornoProgramador(): Record<string, string | undefined> {
  const deno = (globalThis as unknown as { Deno?: { env: { get(n: string): string | undefined } } }).Deno;
  const salida: Record<string, string | undefined> = {};
  for (const n of NOMBRES_ENTORNO_PROGRAMADOR) salida[n] = deno?.env.get(n);
  return salida;
}

/** Espera tras el fallo número `intentosPrevios + 1` (0 → 5 min, 1 → 15 min…). */
export function esperaReintento(intentosPrevios: number): number {
  return ESPERAS_REINTENTO_SEG[Math.min(Math.max(0, intentosPrevios), ESPERAS_REINTENTO_SEG.length - 1)];
}

/** Sesión de servicio para el núcleo de publicación (service_role + x-audit-source). */
export function sesionServicio(url: string, claveServicio: string, f: typeof fetch): Sesion {
  const base = url.replace(/\/+$/, "");
  const fetchAuditado: typeof fetch = (entrada, init = {}) => {
    const destino = String(entrada instanceof Request ? entrada.url : entrada);
    if (!destino.startsWith(base)) return f(entrada, init);
    const cabeceras = new Headers(init.headers);
    cabeceras.set("x-audit-source", ETIQUETA);
    return f(entrada, { ...init, headers: cabeceras });
  };
  return { usuario: ETIQUETA, token: claveServicio, sb: { url: base, clave: claveServicio }, fetch: fetchAuditado };
}

function cabecerasServicio(s: Sesion): Record<string, string> {
  return { apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, "Content-Type": "application/json", Accept: "application/json" };
}

async function rpc<T>(s: Sesion, nombre: string, cuerpo: Record<string, unknown>): Promise<T> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/rpc/${nombre}`, {
    method: "POST",
    headers: cabecerasServicio(s),
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(15_000),
  });
  const texto = await r.text().catch(() => "");
  if (!r.ok) throw new Error(sanear(`${nombre} respondió ${r.status}: ${texto.slice(0, 300)}`));
  return (texto ? JSON.parse(texto) : null) as T;
}

export async function reclamar(s: Sesion): Promise<Programacion | null> {
  const filas = await rpc<Programacion[] | Programacion | null>(s, "instagram_programador_reclamar", { p_lease_seg: BLOQUEO_SEG });
  if (Array.isArray(filas)) return filas[0] ?? null;
  return filas && (filas as Programacion).id ? (filas as Programacion) : null;
}

export async function cerrar(s: Sesion, p: Programacion, c: Cierre): Promise<{ estado: string; intentos: number } | null> {
  return await rpc(s, "instagram_programador_cerrar", {
    p_id: p.id,
    p_bloqueo: p.bloqueo_id,
    p_resultado: c.resultado,
    p_mensaje: c.mensaje ? sanear(c.mensaje).slice(0, 1000) : null,
    p_media_id: c.mediaId ?? null,
    p_permalink: c.permalink ?? null,
    p_contenedor_id: c.contenedorId ?? null,
    p_espera_seg: c.esperaSeg ?? 0,
  });
}

interface CuerpoPublicar {
  ok?: boolean;
  publicado?: boolean;
  error?: string;
  tipo?: string;
  problemas?: string[];
  comoArreglarlo?: string;
  mediaId?: string | null;
  permalink?: string | null;
  avisos?: string[];
  contenedor?: { id?: string | null } | null;
  reintentar?: { contenedorId?: string } | null;
  cuota?: { usadas?: number; total?: number | null } | null;
  tipoMedio?: string;
}

function textoError(c: CuerpoPublicar, estado: number): string {
  const partes = [c.error ?? `La publicación respondió ${estado}`];
  if (c.problemas?.length) partes.push(c.problemas.join(" · "));
  if (c.comoArreglarlo) partes.push(c.comoArreglarlo);
  return partes.join(". ");
}

/**
 * Decide cómo cerrar la programación a partir de la respuesta del núcleo.
 * Pura (se prueba sola). `contenedorEnviado`: el que se pidió reutilizar.
 */
export function clasificar(
  estado: number,
  c: CuerpoPublicar,
  p: Pick<Programacion, "intentos"> & { programada_para?: string },
  contenedorEnviado: string | null,
  ahora: number = Date.now(),
): Cierre {
  const espera = esperaReintento(p.intentos);
  // Sin tiempo en esta pasada (A4): a la siguiente, sin contar intento y con
  // el contenedor si ya lo había.
  if (c.tipo === "sin_tiempo") {
    return {
      resultado: "aplazar",
      esperaSeg: ESPERA_SIGUIENTE_PASADA_SEG,
      contenedorId: c.reintentar?.contenedorId ?? c.contenedor?.id ?? contenedorEnviado ?? null,
      mensaje: "No quedaba tiempo en la pasada para publicar sin riesgo; se publica en la siguiente.",
    };
  }
  // Instagram ya la tenía publicada pero no se encontró el medio (A1): no se
  // reintenta jamás; la pieza ya está «publicada» en el panel.
  if (estado === 200 && c.publicado && !c.mediaId) {
    return {
      resultado: "error",
      mensaje: "Instagram indica que ya se publicó, pero no se encontró la publicación: compruébala en la cuenta. No se ha vuelto a publicar.",
    };
  }
  // Reel: Meta sigue procesando el vídeo. No es un fallo: se aplaza sin contar
  // intento (con el mismo contenedor) durante la primera hora.
  if (estado === 202 && c.tipoMedio === "reel") {
    const desde = p.programada_para ? Date.parse(p.programada_para) : NaN;
    const contenedor = c.reintentar?.contenedorId ?? c.contenedor?.id ?? contenedorEnviado;
    if (Number.isFinite(desde) && ahora - desde < ESPERA_MAX_REEL_MS) {
      return {
        resultado: "aplazar",
        contenedorId: contenedor ?? null,
        esperaSeg: ESPERA_SIGUIENTE_PASADA_SEG,
        mensaje: "Instagram todavía está procesando el vídeo; se publica en la siguiente pasada con el mismo contenedor.",
      };
    }
  }
  if (estado === 200 && c.publicado && c.mediaId) {
    const avisos = (c.avisos ?? []).filter(Boolean);
    return { resultado: "publicada", mediaId: c.mediaId, permalink: c.permalink ?? null, mensaje: avisos.length ? avisos.join(" · ") : null };
  }
  if (estado === 202) {
    const contenedor = c.reintentar?.contenedorId ?? c.contenedor?.id ?? contenedorEnviado;
    return {
      resultado: "reintentar",
      contenedorId: contenedor ?? null,
      esperaSeg: ESPERA_SIGUIENTE_PASADA_SEG,
      mensaje: "Instagram todavía estaba procesando la imagen; se reintenta en la siguiente pasada con el mismo contenedor.",
    };
  }
  if (estado === 429) return { resultado: "aplazar", esperaSeg: ESPERA_CUOTA_SEG, contenedorId: contenedorEnviado, mensaje: textoError(c, estado) };
  // Alguien la está probando o publicando a mano ahora mismo: a la siguiente
  // pasada (no cuenta como fallo de Meta; si salió, la idempotencia la cierra).
  if (estado === 409 && c.tipo === "publicacion_en_curso") {
    return { resultado: "aplazar", esperaSeg: ESPERA_SIGUIENTE_PASADA_SEG, contenedorId: contenedorEnviado, mensaje: textoError(c, estado) };
  }
  if (c.tipo === "contenedor_ya_publicado") {
    return {
      resultado: "error",
      mensaje: "Instagram indica que ese contenedor ya se publicó. Comprueba la cuenta antes de volver a programarla (no se ha reintentado para no duplicarla).",
    };
  }
  if (c.tipo === "contenedor_caducado") return { resultado: "reintentar", contenedorId: null, esperaSeg: ESPERA_SIGUIENTE_PASADA_SEG, mensaje: textoError(c, estado) };
  // El contenedor pedido ya no es el de la pieza (alguien hizo una prueba entre medias): otro intento sin él.
  if (estado === 409 && contenedorEnviado && /contenedor/i.test(c.error ?? "")) {
    return { resultado: "reintentar", contenedorId: null, esperaSeg: ESPERA_SIGUIENTE_PASADA_SEG, mensaje: textoError(c, estado) };
  }
  if (estado === 400 || estado === 404 || estado === 409 || estado === 422) return { resultado: "error", mensaje: textoError(c, estado) };
  // 5xx / 503 (secretos que faltan o Meta caída): reintento. Si ya había
  // contenedor, se reutiliza: si media_publish llegó a salir, Meta dirá
  // PUBLISHED y no se duplicará.
  const contenedor = c.contenedor?.id ?? contenedorEnviado;
  return { resultado: "reintentar", esperaSeg: espera, contenedorId: c.tipo === "contenedor_error" ? null : contenedor ?? null, mensaje: textoError(c, estado) };
}

/** Publica (o cierra sin publicar) UNA programación reclamada. */
export async function procesar(s: Sesion, p: Programacion, env: Record<string, string | undefined>, deps: DependenciasProgramador): Promise<Cierre> {
  let fila: FilaPieza | null;
  try {
    fila = await leerPieza(s, p.pieza_id);
  } catch (e) {
    return { resultado: "reintentar", esperaSeg: esperaReintento(p.intentos), contenedorId: p.contenedor_id, mensaje: `No se pudo leer la pieza: ${(e as Error).message}` };
  }
  if (!fila) return { resultado: "error", mensaje: "La pieza ya no existe" };
  // Idempotencia: ya publicada (a mano, o por una pasada anterior que no llegó a cerrar).
  if (fila.media_id) return { resultado: "publicada", mediaId: fila.media_id, permalink: fila.permalink, mensaje: "Ya estaba publicada; no se ha vuelto a publicar." };
  if (fila.estado === "publicada") return { resultado: "error", mensaje: "La pieza figura como publicada pero sin media_id; compruébalo en Instagram." };

  const contenedor = p.contenedor_id && fila.contenedor_id === p.contenedor_id ? p.contenedor_id : null;
  const cuerpo: Record<string, unknown> = { id: p.pieza_id, dryRun: false };
  if (contenedor) cuerpo.contenedorId = contenedor;
  const peticion = new Request(`${s.sb.url}/functions/v1/${ETIQUETA}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const publicar = deps.publicar ?? publicarConSesion;
  try {
    const r = await publicar(s, peticion, {
      origen: "programador",
      env,
      fetch: deps.fetch,
      dormir: deps.dormir,
      ahora: deps.ahora,
      presupuestoMs: deps.presupuestoSondeoMs ?? PRESUPUESTO_SONDEO_MS,
      intervaloMs: deps.intervaloMs,
      // El núcleo no pasa de aquí: queda MARGEN_CIERRE_MS para cerrar la programación.
      limite: deps.limite === undefined ? undefined : deps.limite - MARGEN_CIERRE_MS,
    });
    const c = ((await r.json().catch(() => ({}))) ?? {}) as CuerpoPublicar;
    return clasificar(r.status, c, p, contenedor, (deps.ahora ?? Date.now)());
  } catch (e) {
    registro("error", ETIQUETA, "fallo al publicar", { id: p.id, error: (e as Error)?.message ?? String(e) });
    return { resultado: "reintentar", esperaSeg: esperaReintento(p.intentos), contenedorId: contenedor, mensaje: `No se pudo publicar: ${(e as Error)?.message ?? e}` };
  }
}

/** Una pasada: reclama y publica hasta agotar las vencidas, el tiempo o la cuota. */
export async function ejecutarPasada(s: Sesion, env: Record<string, string | undefined>, deps: DependenciasProgramador = {}): Promise<ResultadoPasada[]> {
  const ahora = deps.ahora ?? Date.now;
  const inicio = ahora();
  const presupuesto = deps.presupuestoPasadaMs ?? PRESUPUESTO_PASADA_MS;
  const limite = deps.limite ?? inicio + (deps.limitePasadaMs ?? LIMITE_PASADA_MS);
  const resultados: ResultadoPasada[] = [];
  // Solo se reclama otra si da tiempo a una publicación completa (A4).
  while (resultados.length < MAX_POR_PASADA && ahora() - inicio < presupuesto && limite - ahora() >= MIN_PARA_PUBLICAR_MS) {
    const p = await reclamar(s);
    if (!p) break;
    const c = await procesar(s, p, env, { ...deps, limite });
    let tras: { estado: string; intentos: number } | null = null;
    try {
      tras = await cerrar(s, p, c);
    } catch (e) {
      // Sin cerrar, el bloqueo caduca y la RPC la deja en error (o publicada) SIN republicar.
      registro("error", ETIQUETA, "no se pudo cerrar la programación", { id: p.id, resultado: c.resultado, error: (e as Error)?.message });
    }
    registro("info", ETIQUETA, "programación procesada", { id: p.id, pieza: p.pieza_id, resultado: c.resultado, estado: tras?.estado ?? null });
    resultados.push({
      id: p.id,
      piezaId: p.pieza_id,
      resultado: c.resultado,
      estado: tras?.estado ?? null,
      intentos: tras?.intentos ?? null,
      mensaje: c.mensaje ?? null,
    });
    if (c.resultado === "aplazar") break; // cuota agotada: el resto, a la siguiente pasada
  }
  return resultados;
}

export async function manejarProgramador(request: Request, deps: DependenciasProgramador = {}): Promise<Response> {
  if (request.method === "OPTIONS") return opciones();
  if (request.method !== "POST") return json(405, { ok: false, error: "Método no permitido: usa POST" });
  const env = deps.env ?? entornoProgramador();
  const esperado = env.INSTAGRAM_PROGRAMADOR_SECRET ?? "";
  if (!esperado) {
    registro("error", ETIQUETA, "falta el secreto INSTAGRAM_PROGRAMADOR_SECRET");
    return json(500, { ok: false, error: "Falta configurar INSTAGRAM_PROGRAMADOR_SECRET en los secretos de Supabase" });
  }
  registrarSecreto(esperado);
  const recibido = request.headers.get(CABECERA_SECRETO) ?? "";
  if (!recibido || !compararTiempoConstante(recibido, esperado)) return json(401, { ok: false, error: "No autorizado" });

  const url = env.SUPABASE_URL ?? "";
  const claveServicio = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !claveServicio) return json(500, { ok: false, error: "Falta la configuración de Supabase (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" });
  registrarSecreto(claveServicio);

  // El reloj de la pasada empieza aquí (A4): todo lo que sigue cabe en el límite.
  const ahora = deps.ahora ?? Date.now;
  const limite = deps.limite ?? ahora() + (deps.limitePasadaMs ?? LIMITE_PASADA_MS);
  const s = sesionServicio(url, claveServicio, deps.fetch ?? fetch);
  const cuerpo = await leerJson(request, 4096);
  const accion = cuerpo.ok && cuerpo.valor && typeof cuerpo.valor === "object" ? (cuerpo.valor as { accion?: unknown }).accion : undefined;
  if (accion === "limpiar") {
    try {
      const r = await limpiarBucket(s, deps.ahora, { diasVideoPublicado: diasVideoPublicado(env) });
      registro("info", ETIQUETA, "limpieza del bucket", { ...r, avisos: r.avisos.length });
      return json(200, { ok: true, accion: "limpiar", ...r });
    } catch (e) {
      registro("error", ETIQUETA, "limpieza", e);
      return json(500, { ok: false, error: "No se pudo limpiar el bucket", detalle: sanear((e as Error)?.message ?? e) });
    }
  }
  if (accion !== undefined && accion !== "publicar") return json(400, { ok: false, error: "Acción no válida: usa «publicar» (o nada) o «limpiar»" });
  try {
    const resultados = await ejecutarPasada(s, env, { ...deps, limite });
    // Los reels «procesando», solo con tiempo de sobra (si no, a la siguiente pasada).
    const conTiempo = limite - ahora() >= MIN_PARA_PROCESANDO_MS;
    const procesando = conTiempo
      ? await cerrarProcesando(s, env, {
          etiqueta: ETIQUETA,
          publicar: deps.publicar,
          fetch: deps.fetch,
          dormir: deps.dormir,
          ahora: deps.ahora,
          presupuestoSondeoMs: deps.presupuestoSondeoMs ?? PRESUPUESTO_SONDEO_MS,
          intervaloMs: deps.intervaloMs,
          limite: limite - MARGEN_CIERRE_MS,
        })
      : [];
    return json(200, {
      ok: true,
      procesadas: resultados.length,
      resultados,
      ...(procesando.length ? { procesando } : {}),
      ...(conTiempo ? {} : { procesandoAplazado: true }),
    });
  } catch (e) {
    registro("error", ETIQUETA, "pasada", e);
    return json(500, { ok: false, error: "No se pudo completar la pasada", detalle: sanear((e as Error)?.message ?? e) });
  }
}
