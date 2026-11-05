/**
 * Edge Function instagram-publicar — publica (o prueba) una pieza ya generada
 * en Instagram con la Content Publishing API de Meta. Ver docs/instagram.md.
 * Antes era la función de Vercel api/instagram-publicar.ts; se movió aquí para
 * que los secretos de Meta vivan SOLO en Supabase (Edge Functions → Secrets).
 *
 *   Petición: POST `${SUPABASE_URL}/functions/v1/instagram-publicar` con
 *             `Authorization: Bearer <JWT de Supabase>` + `apikey` y JSON
 *             { "id": "<uuid>", "caption"?: "…", "altText"?: "…" (texto alternativo, ≤ 1000; solo posts),
 *               "altTexts"?: ["…", …] (carrusel: uno por imagen, en orden),
 *               "dryRun"?: true|false (por defecto false: se publica SIN prueba previa),
 *               "contenedorId"?: "<id para reintentar>",
 *               "fotoTmp"?: "tmp/<uuid>.jpg" (copia temporal de la foto de Drive usada; se borra al publicar),
 *               "fotosTmp"?: ["tmp/<uuid>.jpg", …] (carrusel: las copias de sus fotos),
 *               "programarPara"?: "<ISO>", "confirmarConflicto"?: bool (PROGRAMAR en vez de publicar) }
 *
 *   SIN PASO DE PRUEBA (05/11/2026): publicar o programar ya no exigen «Prueba
 *   sin publicar». Publicar valida el texto y la imagen y crea el contenedor
 *   por dentro; `dryRun: true` queda como opción interna. Con
 *   `programarPara`, valida igual (texto, textos alternativos, imágenes
 *   accesibles) y llama a la RPC instagram_programar con el JWT del usuario,
 *   pasándole el texto y los textos alternativos (migración 20261112000000):
 *   200 { ok, programado: true, programacion, conflictos } ·
 *   409 { ok: false, requiereConfirmacion: true, conflictos } (repetir con confirmarConflicto).
 *
 *   CARRUSEL (tipo_medio = 'carrusel', migración 20261112000000): un
 *   contenedor hijo por imagen (is_carousel_item, image_url, alt_text) y el
 *   contenedor CAROUSEL con children y caption; mismas reglas de doble
 *   publicación, cerrojo, 202 y Drive (las N imágenes). Detalle en carrusel.ts.
 *
 *   Cuenta: la de la MARCA de la pieza (IG_USER_ID_TOUZA / IG_ACCESS_TOKEN_TOUZA,
 *   IG_USER_ID_CASA_TOMAS / …) y, si no existen, la general (IG_USER_ID /
 *   IG_ACCESS_TOKEN). La respuesta lleva `cuenta: { marca, igUserId, propia }`.
 *
 *   Cerrojo (migración 20261107000000): antes de llamar a Meta se reserva la
 *   pieza (RPC instagram_pieza_reservar_publicacion, service_role). Si otra
 *   petición la está probando o publicando → 409 tipo «publicacion_en_curso».
 *   Publicar A MANO una pieza con una programación activa → 409 tipo
 *   «programada» (hay que cancelarla antes). El programador no pasa por esa
 *   comprobación (la programación es suya).
 *
 *   Flujo: pieza (RLS) → caption (2200 caracteres, 30 #, 20 @) → HEAD de la
 *   URL pública del JPEG (200 + image/jpeg) → cuota (se aborta si usadas ≥
 *   total) → contenedor (STORIES si es story) → sondeo hasta FINISHED → SOLO
 *   si dryRun es false: media_publish + permalink.
 *
 *   200: { ok: true, id, dryRun, publicado, estado: "prueba_ok"|"publicada",
 *          contenedor: { id, estado }, urlJpeg, mediaId, permalink,
 *          imagenEnBucket (solo al publicar: false = JPEG borrado del bucket),
 *          driveId (solo al publicar: id del JPEG en Drive, o null si no se pudo guardar),
 *          cuota: { usadas, total, restantes, ventanaHoras }, caption: { caracteres, hashtags, menciones }, avisos }
 *   202: { ok: true, estado: "en_proceso", id, dryRun, publicado: false, contenedor: { id, estado }, cuota, reintentar: { id, contenedorId, dryRun } }
 *        → Meta aún procesa la imagen: repetir la petición con ese contenedorId.
 *   Errores (JSON { ok: false, error, comoArreglarlo?, tipo?, problemas?, cuota? }):
 *     400 cuerpo · 401 sesión · 403 sin Marketing · 404 pieza · 405 método ·
 *     409 sin JPEG, ya publicada o contenedor que no es el de la pieza · 422
 *     caption o imagen no válida · 429 cuota agotada / límites de Meta ·
 *     502/503 error de Meta · 503 faltan secretos de Meta en Supabase.
 *
 *   La fila se actualiza: dryRun → «prueba_ok» + contenedor_id; real →
 *   «publicada» + media_id + permalink; error de Meta → «error» + mensaje saneado.
 *   Esas columnas solo las puede escribir el servidor: se escriben con la
 *   clave de servicio (sesionEscritura), nunca con el JWT del usuario.
 *
 *   SIN DUPLICADOS (A1 de la evaluación, 05/11/2026):
 *     · media_publish NUNCA se reintenta; si falla o se agota el tiempo se
 *       mira el contenedor (ClienteGraph.publicarSinDuplicar): PUBLISHED → la
 *       pieza se cierra como publicada con el medio que se encuentre.
 *     · media_id y estado «publicada» se guardan EN CUANTO Meta lo confirma,
 *       antes del permalink, de Drive y de borrar nada.
 *     · Antes de crear OTRO contenedor se mira el que la pieza ya tenía: si
 *       está PUBLISHED no se publica otra vez, se recupera el media_id.
 *     · Si un contenedor pedido (reintento, prueba reutilizada) resulta estar
 *       PUBLISHED, lo mismo. Sin medio encontrado, la pieza queda «publicada»
 *       con AVISO_PUBLICADA_SIN_ID (eso bloquea volver a publicarla).
 *   TIEMPO (A4): con `deps.limite` (el programador) no se empieza si no da
 *   tiempo (503 tipo «sin_tiempo», sin contenedor) y no se llama a
 *   media_publish sin RESERVA_PUBLICAR_MS por delante (202 tipo «sin_tiempo»
 *   con el contenedor listo, para la siguiente pasada).
 *
 *   Tras una publicación REAL el JPEG se archiva en Google Drive
 *   (marketing/instagram/publicadas/AAAA-MM, ver _shared/instagram/drive.ts) y
 *   su id se guarda en instagram_piezas.drive_id. SOLO si Drive lo tiene se
 *   borra el JPEG del bucket (es solo una escala) con el JWT del usuario, y
 *   también la copia tmp/ de la foto usada (`fotoTmp`). Si Drive falla o no
 *   está configurado, el JPEG se queda en el bucket y `error` empieza por
 *   AVISO_SIN_DRIVE. imagen_ruta se conserva: «publicada» = el fichero ya no
 *   está en el bucket, salvo que `error` empiece por AVISO_SIN_DRIVE o por
 *   AVISO_JPEG_NO_BORRADO. La respuesta lleva `imagenEnBucket` y `driveId`.
 *   En prueba (dryRun) NO se borra nada: el contenedor necesita la URL hasta
 *   que se publique.
 *
 *   Lectura de la pieza, Storage y Drive como el usuario (clave pública + su
 *   JWT); el estado de publicación y el cerrojo, con service_role.
 *
 *   REELS (tipo_medio = 'reel', migración 20261109100000): mismo cuerpo y
 *   mismas reglas; el medio es el MP4 del cubo «instagram-video» y, si Meta no
 *   termina de procesarlo enseguida, la pieza queda «procesando» y responde
 *   202 (lo cierra el cron o «Comprobar ahora»). Detalle en reel.ts.
 */
import { carpetaPublicadas, leerConfigDrive } from "../_shared/instagram/drive.ts";
import { ClienteGraph, type FuncionFetch, type InfoContenedor } from "../_shared/instagram/cliente.ts";
import { cuotaDe, type CuotaPublicacion } from "../_shared/instagram/comprobacion.ts";
import { entornoDeno, esMarcaCuenta, leerConfigMetaMarca } from "../_shared/instagram/entorno.ts";
import { ErrorInstagram, errorInstagramAJson, estadoHttpDeError } from "../_shared/instagram/errores.ts";
import { json, jsonAuth, leerJson, opciones } from "../_shared/instagram/http.ts";
import { registro, sanear } from "../_shared/instagram/secretos.ts";
import {
  actualizarPieza,
  anotarAltText,
  anotarDrivePieza,
  anotarError,
  autorizarMarketing,
  borrarJpeg,
  borrarObjetos,
  ErrorSupabase,
  esRutaTmp,
  leerPiezaCompleta,
  liberarPublicacion,
  reservarPublicacion,
  sesionEscritura,
  urlPublica,
  type FilaPieza,
  type Sesion,
} from "../_shared/instagram/supabase.ts";
import { esUuid, MAX_BYTES_IMAGEN, validarAltText, validarCaption, type TipoPublicacion } from "../_shared/instagram/validacion.ts";
import { esReel, problemaReel, publicarReelReservado } from "./reel.ts";
import { esCarrusel, problemaCarrusel, programarConSesion, publicarCarruselReservado } from "./carrusel.ts";

const ETIQUETA = "instagram-publicar";

/**
 * Tiempo que la función dedica a esperar FINISHED. La Edge Function tiene
 * ~150 s de reloj; se deja margen y, si no llega, responde 202 «en_proceso».
 */
export const PRESUPUESTO_SONDEO_MS = 55_000;
export const INTERVALO_SONDEO_MS = 3_000;
/** Prefijo de `error` en una pieza publicada cuyo JPEG no se pudo borrar del bucket. */
export const AVISO_JPEG_NO_BORRADO = "Publicada, pero el JPEG no se pudo borrar del bucket «instagram»:";
/** Prefijo de `error` en una pieza publicada que no se pudo archivar en Drive (el JPEG sigue en el bucket). */
export const AVISO_SIN_DRIVE = "Publicada, pero no se pudo guardar en Google Drive (el JPEG sigue en el bucket «instagram»):";

/** Prefijo de `error` de una pieza que Instagram da por publicada pero cuyo medio no se encontró. */
export const AVISO_PUBLICADA_SIN_ID =
  "Instagram indica que ya se publicó (un intento anterior sí salió), pero no se encontró la publicación: compruébala en la cuenta. No se ha vuelto a publicar.";

/** Lo que dura el cerrojo de publicación (la función tiene ~150 s de reloj). */
export const CERROJO_SEG = 180;
/** Con límite (programador): tiempo mínimo por delante para llamar a media_publish y guardar el resultado. */
export const RESERVA_PUBLICAR_MS = 30_000;
/** Con límite: tiempo mínimo para empezar (contenedor + algo de sondeo + RESERVA_PUBLICAR_MS). */
export const MIN_PARA_EMPEZAR_MS = 45_000;
/** Un contenedor de Meta caduca a las 24 h: la búsqueda del medio recuperado mira 25 h atrás. */
export const VIDA_CONTENEDOR_MS = 25 * 60 * 60_000;

export interface DependenciasPublicar {
  /** «programador»: no comprueba si hay una programación activa (es la suya). */
  origen?: "panel" | "programador";
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
  ahora?: () => number;
  presupuestoMs?: number;
  intervaloMs?: number;
  /** Instante (ms, reloj de `ahora`) a partir del cual no se hace nada más (programador, A4). */
  limite?: number;
}

/** ms hasta el límite (Infinity si no hay). */
export function quedaMs(deps: DependenciasPublicar): number {
  return deps.limite === undefined ? Infinity : deps.limite - (deps.ahora ?? Date.now)();
}

function errorMeta(e: ErrorInstagram, extra: Record<string, unknown> = {}): Response {
  return json(estadoHttpDeError(e), { ok: false, ...errorInstagramAJson(e), ...extra });
}

export async function manejarPublicar(request: Request, deps: DependenciasPublicar = {}): Promise<Response> {
  if (request.method === "OPTIONS") return opciones();
  if (request.method !== "POST") return json(405, { ok: false, error: "Método no permitido: usa POST" });
  const env = deps.env ?? entornoDeno();
  const auth = await autorizarMarketing(request.headers.get("authorization"), { env, fetch: deps.fetch });
  if ("motivo" in auth) {
    if (auth.estado >= 500) registro("error", ETIQUETA, "autorización", { motivo: auth.motivo });
    return jsonAuth(auth.estado, auth.motivo);
  }
  const s: Sesion = auth.sesion;
  return publicarConSesion(s, request, deps);
}

/**
 * Núcleo de la publicación con una sesión YA autorizada (lee el cuerpo de la
 * petición). manejarPublicar lo usa con la sesión del usuario;
 * instagram-programador (pg_cron, sin usuario), con una sesión de servicio.
 */
export async function publicarConSesion(s: Sesion, request: Request, deps: DependenciasPublicar = {}): Promise<Response> {
  const env = deps.env ?? entornoDeno();

  const cuerpo = await leerJson(request, 64 * 1024);
  if ("error" in cuerpo) return json(cuerpo.estado, { ok: false, error: cuerpo.error });
  const entrada = cuerpo.valor as {
    id?: unknown;
    caption?: unknown;
    altText?: unknown;
    altTexts?: unknown;
    dryRun?: unknown;
    contenedorId?: unknown;
    fotoTmp?: unknown;
    fotosTmp?: unknown;
    programarPara?: unknown;
    confirmarConflicto?: unknown;
  } | null;
  if (!entrada || typeof entrada !== "object" || !esUuid(entrada.id)) return json(400, { ok: false, error: "Falta «id» (UUID de la pieza)" });
  // Sin paso de prueba: dryRun es opcional (por defecto, publicar).
  if (entrada.dryRun !== undefined && entrada.dryRun !== null && typeof entrada.dryRun !== "boolean") return json(400, { ok: false, error: "«dryRun» tiene que ser true o false" });
  if (entrada.altTexts !== undefined && entrada.altTexts !== null
      && (!Array.isArray(entrada.altTexts) || entrada.altTexts.length > 10 || entrada.altTexts.some((a) => a !== null && typeof a !== "string"))) {
    return json(400, { ok: false, error: "«altTexts» tiene que ser una lista de textos (uno por imagen del carrusel)" });
  }
  if (entrada.fotosTmp !== undefined && entrada.fotosTmp !== null && (!Array.isArray(entrada.fotosTmp) || entrada.fotosTmp.length > 10 || !entrada.fotosTmp.every(esRutaTmp))) {
    return json(400, { ok: false, error: "«fotosTmp» tiene que ser una lista de rutas tmp/<uuid>.jpg del bucket" });
  }
  const programarPara = entrada.programarPara;
  if (programarPara !== undefined && programarPara !== null && (typeof programarPara !== "string" || Number.isNaN(Date.parse(programarPara)))) {
    return json(400, { ok: false, error: "«programarPara» tiene que ser una fecha ISO" });
  }
  if (entrada.caption !== undefined && entrada.caption !== null && typeof entrada.caption !== "string") return json(400, { ok: false, error: "«caption» tiene que ser texto" });
  if (entrada.altText !== undefined && entrada.altText !== null && typeof entrada.altText !== "string") return json(400, { ok: false, error: "«altText» tiene que ser texto" });
  if (entrada.contenedorId !== undefined && (typeof entrada.contenedorId !== "string" || !/^\d+$/.test(entrada.contenedorId))) {
    return json(400, { ok: false, error: "«contenedorId» no es válido" });
  }
  if (entrada.fotoTmp !== undefined && entrada.fotoTmp !== null && !esRutaTmp(entrada.fotoTmp)) {
    return json(400, { ok: false, error: "«fotoTmp» tiene que ser una ruta tmp/<uuid>.jpg del bucket" });
  }
  const id = entrada.id;
  const dryRun = entrada.dryRun === true;
  const fotoTmp = typeof entrada.fotoTmp === "string" ? entrada.fotoTmp : null;
  const fotosTmp = Array.isArray(entrada.fotosTmp) ? (entrada.fotosTmp as string[]) : [];

  let leida: FilaPieza | null;
  try {
    leida = await leerPiezaCompleta(s, id);
  } catch (e) {
    registro("error", ETIQUETA, "leer pieza", e);
    return json(500, { ok: false, error: sanear((e as Error).message) });
  }
  if (!leida) return json(404, { ok: false, error: "No existe esa pieza (o no tienes acceso)" });
  const fila: FilaPieza = leida;

  // Cuenta de la marca de la pieza (o la general si la marca no tiene la suya).
  if (!esMarcaCuenta(fila.marca)) return json(422, { ok: false, error: `Marca desconocida: ${fila.marca}` });
  const meta = leerConfigMetaMarca(env, fila.marca);
  if ("problemas" in meta) {
    return json(503, {
      ok: false,
      error: `Falta configurar Instagram en los secretos de Supabase: ${meta.problemas.map((p) => `${p.variable} (${p.problema})`).join(", ")}`,
      faltan: meta.problemas.map((p) => p.variable),
      comoArreglarlo: meta.problemas.map((p) => p.comoArreglarlo).join(" "),
    });
  }
  const cfg = meta.config;
  const cuenta = { marca: fila.marca, igUserId: cfg.igUserId, propia: cfg.origen.propia };
  // El estado de publicación solo lo escribe el servidor (service_role).
  const sw = sesionEscritura(s, env, ETIQUETA);
  if (fila.estado === "publicada") return json(409, { ok: false, error: "Esa pieza ya está publicada", permalink: fila.permalink, mediaId: fila.media_id });
  const reel = esReel(fila);
  const carrusel = esCarrusel(fila);
  const contenedorPedido = typeof entrada.contenedorId === "string" ? entrada.contenedorId : null;
  if (reel) {
    const problema = problemaReel(fila, contenedorPedido, (deps.ahora ?? Date.now)());
    if (problema) return json(409, problema);
  } else if (carrusel) {
    const problema = problemaCarrusel(fila);
    if (problema) return json(409, problema);
  } else {
    if (!fila.imagen_ruta) return json(409, { ok: false, error: "La pieza no tiene imagen: genérala antes de publicar" });
    if (fila.imagen_borrada_at) {
      return json(409, { ok: false, tipo: "imagen_borrada", error: "La imagen de esta pieza se borró del bucket por llevar días sin publicarse: vuelve a generarla" });
    }
  }
  if (contenedorPedido && fila.contenedor_id !== contenedorPedido) {
    return json(409, { ok: false, error: "Ese contenedor no es el de esta pieza; vuelve a lanzar la publicación sin contenedorId" });
  }

  // Los reels llevan texto como los posts.
  const tipo: TipoPublicacion = !reel && fila.formato === "story" ? "story" : "post";
  const caption = typeof entrada.caption === "string" ? entrada.caption : (fila.caption ?? "");
  const vCaption = validarCaption(caption, tipo);
  if (!vCaption.ok) return json(422, { ok: false, error: "El texto no es válido", problemas: vCaption.errores });
  const avisos = [...vCaption.avisos];
  const resumenCaption = { caracteres: vCaption.caracteres, hashtags: vCaption.hashtags, menciones: vCaption.menciones };
  // Texto alternativo: el que llega o el guardado. Las stories no lo llevan.
  const altText = typeof entrada.altText === "string" ? entrada.altText.trim() : typeof fila.alt_text === "string" ? fila.alt_text : "";
  const vAlt = validarAltText(altText, tipo);
  if (!vAlt.ok) return json(422, { ok: false, error: "El texto alternativo no es válido", problemas: vAlt.errores });
  avisos.push(...vAlt.avisos);
  const altEnvio = !reel && !carrusel && tipo === "post" && altText ? altText : undefined;
  // Carrusel: un texto alternativo por imagen (los que llegan o los guardados).
  let altTexts: string[] | null = null;
  if (carrusel) {
    const ds = fila.diapositivas ?? [];
    const llegan = Array.isArray(entrada.altTexts) ? (entrada.altTexts as Array<string | null>) : null;
    if (llegan && llegan.length !== ds.length) {
      return json(422, { ok: false, error: `Hacen falta ${ds.length} textos alternativos (uno por imagen) y llegan ${llegan.length}` });
    }
    altTexts = ds.map((d, i) => (llegan ? (llegan[i] ?? "") : (d.alt_text ?? "")).trim());
    for (let i = 0; i < altTexts.length; i++) {
      const v = validarAltText(altTexts[i], "post");
      if (!v.ok) return json(422, { ok: false, error: `El texto alternativo de la imagen ${i + 1} no es válido`, problemas: v.errores });
    }
  } else if (entrada.altTexts !== undefined && entrada.altTexts !== null) {
    return json(400, { ok: false, error: "«altTexts» es solo para carruseles (usa «altText»)" });
  }

  // PROGRAMAR directamente (sin prueba previa): valida y deja la programación.
  if (typeof programarPara === "string") {
    return await programarConSesion(
      { s, env, deps, id, fila, cuenta, caption, altText, altTexts, avisos, resumenCaption },
      {
        para: programarPara,
        confirmarConflicto: entrada.confirmarConflicto === true,
        captionLlega: typeof entrada.caption === "string",
        altTextLlega: typeof entrada.altText === "string",
        altTextsLlegan: Array.isArray(entrada.altTexts),
      },
    );
  }

  // Cerrojo: nadie más prueba ni publica esta pieza mientras tanto.
  let reserva: Awaited<ReturnType<typeof reservarPublicacion>>;
  try {
    reserva = await reservarPublicacion(sw, id, { segundos: CERROJO_SEG, comprobarProgramacion: !dryRun && deps.origen !== "programador" });
  } catch (e) {
    registro("error", ETIQUETA, "cerrojo", e);
    return json(500, { ok: false, error: sanear((e as Error).message) });
  }
  if (!reserva.ok) {
    if (reserva.motivo === "programada") {
      return json(409, {
        ok: false,
        tipo: "programada",
        error: "Esta pieza tiene una publicación programada: cancélala en el calendario antes de publicarla a mano (así no sale dos veces).",
        programadaPara: reserva.programadaPara ?? null,
      });
    }
    if (reserva.motivo === "publicada") return json(409, { ok: false, tipo: "publicada", error: "Esa pieza ya está publicada", permalink: reserva.permalink ?? null });
    if (reserva.motivo === "no_existe") return json(404, { ok: false, error: "No existe esa pieza (o no tienes acceso)" });
    return json(409, {
      ok: false,
      tipo: "publicacion_en_curso",
      error: "Esta pieza se está probando o publicando ahora mismo (en otra pestaña, otra persona o el programador). Espera un par de minutos.",
    });
  }
  if (reserva.sinCerrojo) registro("warn", ETIQUETA, "sin cerrojo de publicación (falta la migración 20261107000000)", { id });
  const bloqueo = reserva.bloqueo;
  try {
    const contexto: ContextoPublicacion = { s, sw, env, deps, id, dryRun, fotoTmp, fotosTmp, fila, cfg, cuenta, contenedorPedido, tipo, caption, altText, altEnvio, altTexts, avisos, resumenCaption };
    return await (reel ? publicarReelReservado(contexto) : carrusel ? publicarCarruselReservado(contexto) : publicarReservado(contexto));
  } finally {
    await liberarPublicacion(sw, id, bloqueo);
  }
}

export interface ContextoPublicacion {
  s: Sesion;
  /** Sesión con la que se escribe el estado (service_role). */
  sw: Sesion;
  env: Record<string, string | undefined>;
  deps: DependenciasPublicar;
  id: string;
  dryRun: boolean;
  fotoTmp: string | null;
  /** Carrusel: copias tmp/ de sus fotos (se borran al publicar, si Drive tiene las imágenes). */
  fotosTmp: string[];
  fila: FilaPieza;
  cfg: { token: string; versionApi: string; igUserId: string; appId: string; appSecret: string | undefined };
  cuenta: { marca: string; igUserId: string; propia: boolean };
  contenedorPedido: string | null;
  tipo: TipoPublicacion;
  caption: string;
  altText: string;
  altEnvio: string | undefined;
  /** Carrusel: texto alternativo de cada imagen, en orden ("" = sin texto). null si no es carrusel. */
  altTexts: string[] | null;
  avisos: string[];
  resumenCaption: { caracteres: number; hashtags: number; menciones: number };
}

/** Respuesta cuando no queda tiempo en la pasada (el programador la aplaza sin contar intento). */
export function respuestaSinTiempo(c: ContextoPublicacion, contenedorId: string | null): Response {
  return json(contenedorId ? 202 : 503, {
    ok: !!contenedorId,
    tipo: "sin_tiempo",
    ...(contenedorId ? { estado: "en_proceso" } : { error: "No queda tiempo en esta pasada para publicar sin riesgo: se hará en la siguiente." }),
    id: c.id,
    dryRun: c.dryRun,
    publicado: false,
    contenedor: contenedorId ? { id: contenedorId } : null,
    reintentar: contenedorId ? { id: c.id, contenedorId, dryRun: c.dryRun } : null,
    avisos: c.avisos,
  });
}

/**
 * Guarda que la pieza YA está en Instagram (estado, media_id, contenedor…).
 * Es lo primero que se hace tras media_publish: dos intentos. Nunca lanza:
 * devuelve un aviso si no se pudo.
 */
export async function guardarPublicada(c: ContextoPublicacion, cambios: Partial<FilaPieza>): Promise<string | null> {
  for (let i = 0; i < 2; i++) {
    try {
      await actualizarPieza(c.sw, c.id, { estado: "publicada", caption: c.caption, ...cambios });
      return null;
    } catch (e) {
      registro("error", ETIQUETA, `publicada pero no se pudo anotar (intento ${i + 1})`, e);
    }
  }
  return "Publicado en Instagram, pero no se pudo guardar el estado en el panel. NO la vuelvas a publicar: compruébala en Instagram.";
}

/**
 * El contenedor ya estaba PUBLISHED (un intento anterior sí salió): se cierra
 * la pieza como publicada SIN volver a publicar, con el medio que se
 * encuentre (o sin él y con AVISO_PUBLICADA_SIN_ID).
 */
export async function recuperarPublicada(
  c: ContextoPublicacion,
  cliente: ClienteGraph,
  contenedorId: string,
  o: { encontrado?: { mediaId: string | null; permalink: string | null } | null; desdeMs: number },
): Promise<Response> {
  const reel = esReel(c.fila);
  let medio = o.encontrado ? { ...o.encontrado } : null;
  if (!medio || !medio.mediaId) {
    const m = await cliente.buscarMedioPublicado({ caption: c.caption, tipo: reel ? "reel" : c.tipo, desdeMs: o.desdeMs }).catch(() => null);
    medio = { mediaId: m?.id ?? null, permalink: m?.permalink ?? null };
  }
  if (medio.mediaId && !medio.permalink) medio.permalink = await cliente.permalink(medio.mediaId).catch(() => null);
  const error = !medio.mediaId ? AVISO_PUBLICADA_SIN_ID : reel ? null : `${AVISO_SIN_DRIVE} se recuperó de un intento anterior que sí salió.`;
  const aviso = await guardarPublicada(c, { contenedor_id: contenedorId, media_id: medio.mediaId, permalink: medio.permalink, error });
  const avisos = [...c.avisos, "Instagram ya la tenía publicada (un intento anterior sí salió): no se ha vuelto a publicar."];
  if (!medio.mediaId) avisos.push("No se encontró la publicación en la cuenta: compruébala en Instagram.");
  if (aviso) avisos.push(aviso);
  registro("warn", ETIQUETA, "ya estaba publicada: recuperada sin volver a publicar", { id: c.id, contenedorId, mediaId: medio.mediaId });
  return json(200, {
    ok: true,
    id: c.id,
    dryRun: false,
    publicado: true,
    recuperada: true,
    estado: "publicada",
    ...(reel ? { tipoMedio: "reel" } : {}),
    contenedor: { id: contenedorId, estado: "PUBLISHED" },
    mediaId: medio.mediaId,
    permalink: medio.permalink,
    cuenta: c.cuenta,
    caption: c.resumenCaption,
    avisos,
  });
}

/**
 * Antes de crear OTRO contenedor: ¿el que ya tenía la pieza salió? PUBLISHED
 * → se recupera (Response). Si no se puede saber por la red, no se arriesga
 * (502). En cualquier otro caso (FINISHED de una prueba, caducado, no
 * existe…) null: se sigue.
 */
export async function comprobarContenedorAnterior(c: ContextoPublicacion, cliente: ClienteGraph, excepto: string | null): Promise<Response | null> {
  const anterior = c.fila.contenedor_id;
  if (!anterior || !/^\d+$/.test(anterior) || anterior === excepto) return null;
  try {
    const info = await cliente.estadoContenedor(anterior);
    if (info.estado !== "PUBLISHED") return null;
  } catch (e) {
    if (e instanceof ErrorInstagram && ["red", "tiempo_agotado", "transitorio"].includes(e.tipo)) {
      return json(502, {
        ok: false,
        tipo: e.tipo,
        error: "No se pudo comprobar si el intento anterior ya se publicó en Instagram: no se crea otro para no duplicarla. Vuelve a intentarlo en un momento.",
      });
    }
    return null;
  }
  return await recuperarPublicada(c, cliente, anterior, { desdeMs: (c.deps.ahora ?? Date.now)() - VIDA_CONTENEDOR_MS });
}

/** Pasos con Meta, con la pieza ya reservada. */
async function publicarReservado(c: ContextoPublicacion): Promise<Response> {
  const { s, sw, env, deps, id, dryRun, fotoTmp, fila, cfg, cuenta, contenedorPedido, tipo, caption, altText, altEnvio, avisos, resumenCaption } = c;
  const urlJpeg = urlPublica(s.sb, fila.imagen_ruta as string);
  const fetchMeta: FuncionFetch = (url, init) => (deps.fetch ?? fetch)(url, init);
  const cliente = new ClienteGraph({
    token: cfg.token,
    versionApi: cfg.versionApi,
    igUserId: cfg.igUserId,
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    fetch: fetchMeta,
    dormir: deps.dormir,
    ahora: deps.ahora,
    timeoutMs: 15_000,
    reintentos: 2,
    registro: (l) => registro("info", ETIQUETA, l),
    limite: deps.limite,
  });

  // 0. Sin tiempo para terminar (programador): ni se empieza.
  if (!contenedorPedido && quedaMs(deps) < MIN_PARA_EMPEZAR_MS) return respuestaSinTiempo(c, null);
  // 0 bis. ¿El contenedor que ya tenía la pieza salió? Entonces no se publica otra vez.
  const previo = await comprobarContenedorAnterior(c, cliente, contenedorPedido);
  if (previo) return previo;

  // 1. La imagen pública se descarga sin sesión (es lo que hará Meta).
  if (!contenedorPedido) {
    try {
      const r = await fetchMeta(urlJpeg, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
      const tipoMime = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const largo = Number(r.headers.get("content-length") ?? "0");
      const problemas: string[] = [];
      if (r.status !== 200) problemas.push(`La URL pública del JPEG responde ${r.status}`);
      else if (tipoMime !== "image/jpeg") problemas.push(`La URL pública no sirve un JPEG (Content-Type: ${tipoMime || "vacío"})`);
      if (largo > MAX_BYTES_IMAGEN) problemas.push(`El JPEG pesa ${(largo / 1048576).toFixed(1)} MB (máximo 8 MB)`);
      if (problemas.length) {
        await anotarError(sw, id, problemas.join(" · "));
        return json(422, {
          ok: false,
          error: "Meta no podría descargar la imagen",
          problemas,
          comoArreglarlo: "Vuelve a generar la pieza. Si sigue igual, comprueba que el bucket «instagram» de Supabase es público (Storage → instagram → Public).",
          urlJpeg,
        });
      }
    } catch (e) {
      registro("warn", ETIQUETA, "HEAD de la imagen", e);
      return json(502, { ok: false, error: "No se pudo comprobar la URL pública del JPEG", urlJpeg });
    }
  }

  // 2. Cuota (se aborta si está agotada: no se gasta nada).
  let cuota: CuotaPublicacion;
  try {
    cuota = cuotaDe(await cliente.limitePublicacion());
  } catch (e) {
    if (e instanceof ErrorInstagram) {
      await anotarError(sw, id, `${e.message}. ${e.comoArreglarlo}`);
      return errorMeta(e);
    }
    throw e;
  }
  if (cuota.total === null) avisos.push("Meta no devolvió config.quota_total; no se puede comprobar la cuota antes de publicar.");
  else if (cuota.usadas >= cuota.total) {
    return json(429, {
      ok: false,
      error: `Cuota de publicación agotada: ${cuota.usadas}/${cuota.total} en las últimas ${cuota.ventanaHoras ?? 24} h`,
      comoArreglarlo: "Espera a que pase la ventana de 24 h. No se ha creado ni publicado nada.",
      cuota,
    });
  }

  const ahora = deps.ahora ?? Date.now;
  const inicio = ahora();
  let contenedorId = contenedorPedido;
  let info: InfoContenedor;
  let publicadaYa = false;
  try {
    // 3. Contenedor.
    if (!contenedorId) {
      contenedorId = await cliente.crearContenedor({ imageUrl: urlJpeg, caption: tipo === "post" ? caption : undefined, altText: altEnvio, tipo });
      await actualizarPieza(sw, id, { contenedor_id: contenedorId, caption, error: null });
      // Se guarda el texto alternativo enviado (el programador lo reutiliza).
      if ((fila.alt_text ?? "") !== altText) {
        const aviso = await anotarAltText(sw, id, altText || null);
        if (aviso) avisos.push(aviso);
      }
    }
    // 4. Hasta FINISHED, dentro del tiempo de la función.
    const presupuesto = deps.presupuestoMs ?? PRESUPUESTO_SONDEO_MS;
    try {
      info = await cliente.esperarFinished(contenedorId, {
        intervaloMs: deps.intervaloMs ?? INTERVALO_SONDEO_MS,
        maxMs: Math.max(1_000, Math.min(presupuesto - (ahora() - inicio), quedaMs(deps) - RESERVA_PUBLICAR_MS)),
      });
    } catch (e) {
      if (e instanceof ErrorInstagram && e.tipo === "contenedor_tiempo_agotado" && quedaMs(deps) < RESERVA_PUBLICAR_MS) {
        return respuestaSinTiempo(c, contenedorId);
      }
      if (e instanceof ErrorInstagram && e.tipo === "contenedor_tiempo_agotado") {
        const ultimo = /último estado: ([A-Z_]+)/.exec(e.message)?.[1] ?? "IN_PROGRESS";
        return json(202, {
          ok: true,
          estado: "en_proceso",
          id,
          dryRun,
          publicado: false,
          contenedor: { id: contenedorId, estado: ultimo },
          urlJpeg,
          cuota,
          cuenta,
          avisos,
          mensaje: "Instagram todavía está procesando la imagen. Vuelve a intentarlo en unos segundos con el mismo contenedor.",
          reintentar: { id, contenedorId, dryRun },
        });
      }
      throw e;
    }

    // 5. Prueba: termina aquí, SIN media_publish.
    if (dryRun) {
      await actualizarPieza(sw, id, { estado: "prueba_ok", contenedor_id: contenedorId, caption, error: null });
      registro("info", ETIQUETA, "prueba ok", { id, contenedorId, usuario: s.usuario });
      return json(200, {
        ok: true,
        id,
        dryRun: true,
        publicado: false,
        estado: "prueba_ok",
        contenedor: { id: contenedorId, estado: info.estado },
        urlJpeg,
        mediaId: null,
        permalink: null,
        cuota,
        cuenta,
        caption: resumenCaption,
        avisos: [...avisos, "Prueba correcta: no se ha publicado nada. El contenedor caduca en 24 h."],
      });
    }

    // 6. Publicación real (esperarFinished garantiza FINISHED; doble cerrojo).
    if (info.estado !== "FINISHED") throw new ErrorInstagram({ tipo: "contenedor_no_listo" });
    if (quedaMs(deps) < RESERVA_PUBLICAR_MS) return respuestaSinTiempo(c, contenedorId);
    const pub = await cliente.publicarSinDuplicar(contenedorId, { caption, tipo, desdeMs: inicio });
    if (pub.recuperado) return await recuperarPublicada(c, cliente, contenedorId, { encontrado: pub, desdeMs: inicio });
    const mediaId = pub.mediaId as string;
    // LO PRIMERO: que conste que ya está en Instagram (antes de Drive o de borrar nada).
    publicadaYa = true;
    const avisoGuardar = await guardarPublicada(c, { contenedor_id: contenedorId, media_id: mediaId, error: null });
    if (avisoGuardar) avisos.push(avisoGuardar);
    let permalink: string | null = null;
    try {
      permalink = await cliente.permalink(mediaId);
    } catch {
      avisos.push("Publicado, pero no se pudo obtener el enlace (permalink).");
    }
    const cuotaDespues = { ...cuota, usadas: cuota.usadas + 1, restantes: cuota.restantes === null ? null : Math.max(0, cuota.restantes - 1) };
    // El bucket es solo una escala: el archivo definitivo va a Drive. Solo si
    // Drive lo tiene se borra el JPEG del bucket (y la copia tmp/ de la foto).
    // En prueba NO se llega aquí.
    const archivo = await archivarEnDrive(s, env, { ...fila, caption }, urlJpeg, deps);
    let borrado: { borrado: boolean; motivo?: string } = { borrado: false };
    let errorFila: string | null = null;
    if (archivo.driveId) {
      borrado = await borrarJpeg(s, fila.imagen_ruta as string);
      if (!borrado.borrado) {
        registro("warn", ETIQUETA, "publicada, pero el JPEG sigue en el bucket", { id, motivo: borrado.motivo });
        avisos.push(`Publicado y guardado en Drive, pero no se pudo borrar el JPEG del bucket: ${borrado.motivo}`);
        errorFila = `${AVISO_JPEG_NO_BORRADO} ${borrado.motivo ?? ""}`.trim();
      }
      if (fotoTmp) await borrarObjetos(s, [fotoTmp]);
    } else {
      registro("warn", ETIQUETA, "publicada, pero sin archivar en Drive", { id, motivo: archivo.motivo });
      avisos.push(`Publicado, pero no se pudo guardar en Google Drive: ${archivo.motivo}. El JPEG se queda en el bucket «instagram» (no se ha borrado).`);
      errorFila = `${AVISO_SIN_DRIVE} ${archivo.motivo}`.trim();
    }
    // Segunda escritura: enlace y avisos de Drive (media_id ya está guardado).
    const avisoFinal = await guardarPublicada(c, { contenedor_id: contenedorId, media_id: mediaId, permalink, error: errorFila });
    if (avisoFinal && !avisoGuardar) avisos.push("Publicado y anotado, pero no se pudo guardar el enlace ni los avisos de Drive.");
    if (archivo.driveId) {
      try {
        await anotarDrivePieza(sw, id, archivo.driveId);
      } catch (e) {
        registro("warn", ETIQUETA, "no se pudo anotar drive_id", e);
        avisos.push("El JPEG está en Drive, pero no se pudo anotar en la pieza (¿falta la migración 20261105150000_instagram_drive?).");
      }
    }
    registro("info", ETIQUETA, "publicada", { id, mediaId, usuario: s.usuario });
    return json(200, {
      ok: true,
      id,
      dryRun: false,
      publicado: true,
      estado: "publicada",
      contenedor: { id: contenedorId, estado: info.estado },
      urlJpeg,
      imagenEnBucket: !borrado.borrado,
      driveId: archivo.driveId,
      mediaId,
      permalink,
      cuota: cuotaDespues,
      cuenta,
      caption: resumenCaption,
      avisos,
    });
  } catch (e) {
    // Ya en Instagram (media_id guardado): nunca se pasa a «error».
    if (publicadaYa) {
      registro("error", ETIQUETA, "fallo después de publicar (la pieza sigue publicada)", e);
      return json(500, { ok: false, publicado: true, error: "Publicado en Instagram, pero algo falló después (enlace o archivo). No la vuelvas a publicar.", detalle: sanear((e as Error)?.message ?? e) });
    }
    if (e instanceof ErrorInstagram && e.tipo === "contenedor_ya_publicado" && contenedorId) {
      return await recuperarPublicada(c, cliente, contenedorId, { desdeMs: inicio - VIDA_CONTENEDOR_MS });
    }
    if (e instanceof ErrorInstagram) {
      registro("warn", ETIQUETA, "error de Meta", { id, tipo: e.tipo, codigo: e.codigo, subcodigo: e.subcodigo, mensaje: e.message });
      await anotarError(sw, id, `${e.message}. ${e.comoArreglarlo}`);
      return errorMeta(e, { contenedor: contenedorId ? { id: contenedorId } : null, cuota });
    }
    if (e instanceof ErrorSupabase) {
      registro("error", ETIQUETA, "base de datos", e);
      return json(500, { ok: false, error: e.message, contenedor: contenedorId ? { id: contenedorId } : null });
    }
    registro("error", ETIQUETA, "fallo", e);
    await anotarError(sw, id, (e as Error)?.message ?? String(e));
    return json(500, { ok: false, error: "No se pudo publicar", detalle: sanear((e as Error)?.message ?? e) });
  }
}

/**
 * Guarda el JPEG publicado en Drive (marketing/instagram/publicadas/AAAA-MM).
 * Nunca lanza: devuelve el id de Drive o el motivo por el que no se pudo.
 */
export async function archivarEnDrive(
  s: Sesion,
  env: Record<string, string | undefined>,
  fila: FilaPieza,
  urlJpeg: string,
  deps: DependenciasPublicar,
): Promise<{ driveId: string | null; motivo: string }> {
  const cfg = leerConfigDrive(env, { fetch: deps.fetch });
  if ("faltan" in cfg) return { driveId: null, motivo: cfg.problema };
  try {
    const r = await (deps.fetch ?? fetch)(urlJpeg, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return { driveId: null, motivo: `no se pudo leer el JPEG del bucket (${r.status})` };
    const bytes = new Uint8Array(await r.arrayBuffer());
    const fecha = new Date((deps.ahora ?? Date.now)());
    const carpeta = await carpetaPublicadas(cfg.config, fecha);
    const nombre = `${fecha.toISOString().slice(0, 10)}_${fila.marca}_${fila.formato}_${fila.id.slice(0, 8)}.jpg`;
    const subido = await cfg.config.cliente.subir(carpeta, nombre, "image/jpeg", bytes, fila.caption ? fila.caption.slice(0, 500) : undefined);
    return { driveId: subido.id, motivo: "" };
  } catch (e) {
    return { driveId: null, motivo: sanear((e as Error)?.message ?? String(e)) };
  }
}
