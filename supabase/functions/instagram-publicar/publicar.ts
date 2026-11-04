/**
 * Edge Function instagram-publicar — publica (o prueba) una pieza ya generada
 * en Instagram con la Content Publishing API de Meta. Ver docs/instagram.md.
 * Antes era la función de Vercel api/instagram-publicar.ts; se movió aquí para
 * que los secretos de Meta vivan SOLO en Supabase (Edge Functions → Secrets).
 *
 *   Petición: POST `${SUPABASE_URL}/functions/v1/instagram-publicar` con
 *             `Authorization: Bearer <JWT de Supabase>` + `apikey` y JSON
 *             { "id": "<uuid>", "caption"?: "…", "dryRun": true|false, "contenedorId"?: "<id para reintentar>",
 *               "fotoTmp"?: "tmp/<uuid>.jpg" (copia temporal de la foto de Drive usada; se borra al publicar) }
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
 *   Todo como el usuario (clave pública + su JWT): nunca service_role.
 */
import { carpetaPublicadas, leerConfigDrive } from "../_shared/instagram/drive.ts";
import { ClienteGraph, type FuncionFetch, type InfoContenedor } from "../_shared/instagram/cliente.ts";
import { cuotaDe, type CuotaPublicacion } from "../_shared/instagram/comprobacion.ts";
import { entornoDeno, leerConfigMeta } from "../_shared/instagram/entorno.ts";
import { ErrorInstagram, errorInstagramAJson, estadoHttpDeError } from "../_shared/instagram/errores.ts";
import { json, jsonAuth, leerJson, opciones } from "../_shared/instagram/http.ts";
import { registro, sanear } from "../_shared/instagram/secretos.ts";
import {
  actualizarPieza,
  anotarDrivePieza,
  anotarError,
  autorizarMarketing,
  borrarJpeg,
  borrarObjetos,
  ErrorSupabase,
  esRutaTmp,
  leerPieza,
  urlPublica,
  type FilaPieza,
  type Sesion,
} from "../_shared/instagram/supabase.ts";
import { esUuid, MAX_BYTES_IMAGEN, validarCaption, type TipoPublicacion } from "../_shared/instagram/validacion.ts";

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

export interface DependenciasPublicar {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
  ahora?: () => number;
  presupuestoMs?: number;
  intervaloMs?: number;
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
  const entrada = cuerpo.valor as { id?: unknown; caption?: unknown; dryRun?: unknown; contenedorId?: unknown; fotoTmp?: unknown } | null;
  if (!entrada || typeof entrada !== "object" || !esUuid(entrada.id)) return json(400, { ok: false, error: "Falta «id» (UUID de la pieza)" });
  if (typeof entrada.dryRun !== "boolean") return json(400, { ok: false, error: "«dryRun» tiene que ser true o false" });
  if (entrada.caption !== undefined && entrada.caption !== null && typeof entrada.caption !== "string") return json(400, { ok: false, error: "«caption» tiene que ser texto" });
  if (entrada.contenedorId !== undefined && (typeof entrada.contenedorId !== "string" || !/^\d+$/.test(entrada.contenedorId))) {
    return json(400, { ok: false, error: "«contenedorId» no es válido" });
  }
  if (entrada.fotoTmp !== undefined && entrada.fotoTmp !== null && !esRutaTmp(entrada.fotoTmp)) {
    return json(400, { ok: false, error: "«fotoTmp» tiene que ser una ruta tmp/<uuid>.jpg del bucket" });
  }
  const id = entrada.id;
  const dryRun = entrada.dryRun;
  const fotoTmp = typeof entrada.fotoTmp === "string" ? entrada.fotoTmp : null;

  const meta = leerConfigMeta(env);
  if ("problemas" in meta) {
    return json(503, {
      ok: false,
      error: `Falta configurar Instagram en los secretos de Supabase: ${meta.problemas.map((p) => `${p.variable} (${p.problema})`).join(", ")}`,
      faltan: meta.problemas.map((p) => p.variable),
      comoArreglarlo: meta.problemas.map((p) => p.comoArreglarlo).join(" "),
    });
  }
  const cfg = meta.config;

  let fila: FilaPieza | null;
  try {
    fila = await leerPieza(s, id);
  } catch (e) {
    registro("error", ETIQUETA, "leer pieza", e);
    return json(500, { ok: false, error: sanear((e as Error).message) });
  }
  if (!fila) return json(404, { ok: false, error: "No existe esa pieza (o no tienes acceso)" });
  if (fila.estado === "publicada") return json(409, { ok: false, error: "Esa pieza ya está publicada", permalink: fila.permalink, mediaId: fila.media_id });
  if (!fila.imagen_ruta) return json(409, { ok: false, error: "La pieza no tiene imagen: genérala antes de publicar" });
  const contenedorPedido = typeof entrada.contenedorId === "string" ? entrada.contenedorId : null;
  if (contenedorPedido && fila.contenedor_id !== contenedorPedido) {
    return json(409, { ok: false, error: "Ese contenedor no es el de esta pieza; vuelve a lanzar la publicación sin contenedorId" });
  }

  const tipo: TipoPublicacion = fila.formato === "story" ? "story" : "post";
  const caption = typeof entrada.caption === "string" ? entrada.caption : (fila.caption ?? "");
  const vCaption = validarCaption(caption, tipo);
  if (!vCaption.ok) return json(422, { ok: false, error: "El texto no es válido", problemas: vCaption.errores });
  const avisos = [...vCaption.avisos];
  const resumenCaption = { caracteres: vCaption.caracteres, hashtags: vCaption.hashtags, menciones: vCaption.menciones };

  const urlJpeg = urlPublica(s.sb, fila.imagen_ruta);
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
  });

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
        await anotarError(s, id, problemas.join(" · "));
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
      await anotarError(s, id, `${e.message}. ${e.comoArreglarlo}`);
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
  try {
    // 3. Contenedor.
    if (!contenedorId) {
      contenedorId = await cliente.crearContenedor({ imageUrl: urlJpeg, caption: tipo === "post" ? caption : undefined, tipo });
      await actualizarPieza(s, id, { contenedor_id: contenedorId, caption, error: null });
    }
    // 4. Hasta FINISHED, dentro del tiempo de la función.
    const presupuesto = deps.presupuestoMs ?? PRESUPUESTO_SONDEO_MS;
    try {
      info = await cliente.esperarFinished(contenedorId, {
        intervaloMs: deps.intervaloMs ?? INTERVALO_SONDEO_MS,
        maxMs: Math.max(1_000, presupuesto - (ahora() - inicio)),
      });
    } catch (e) {
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
          avisos,
          mensaje: "Instagram todavía está procesando la imagen. Vuelve a intentarlo en unos segundos con el mismo contenedor.",
          reintentar: { id, contenedorId, dryRun },
        });
      }
      throw e;
    }

    // 5. Prueba: termina aquí, SIN media_publish.
    if (dryRun) {
      await actualizarPieza(s, id, { estado: "prueba_ok", contenedor_id: contenedorId, caption, error: null });
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
        caption: resumenCaption,
        avisos: [...avisos, "Prueba correcta: no se ha publicado nada. El contenedor caduca en 24 h."],
      });
    }

    // 6. Publicación real (esperarFinished garantiza FINISHED; doble cerrojo).
    if (info.estado !== "FINISHED") throw new ErrorInstagram({ tipo: "contenedor_no_listo" });
    const mediaId = await cliente.publicar(contenedorId);
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
      borrado = await borrarJpeg(s, fila.imagen_ruta);
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
    try {
      await actualizarPieza(s, id, {
        estado: "publicada",
        contenedor_id: contenedorId,
        media_id: mediaId,
        permalink,
        caption,
        error: errorFila,
      });
    } catch (e) {
      registro("error", ETIQUETA, "publicada pero no se pudo anotar", e);
      avisos.push("Publicado en Instagram, pero no se pudo guardar el estado en el panel.");
    }
    if (archivo.driveId) {
      try {
        await anotarDrivePieza(s, id, archivo.driveId);
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
      caption: resumenCaption,
      avisos,
    });
  } catch (e) {
    if (e instanceof ErrorInstagram) {
      registro("warn", ETIQUETA, "error de Meta", { id, tipo: e.tipo, codigo: e.codigo, subcodigo: e.subcodigo, mensaje: e.message });
      await anotarError(s, id, `${e.message}. ${e.comoArreglarlo}`);
      return errorMeta(e, { contenedor: contenedorId ? { id: contenedorId } : null, cuota });
    }
    if (e instanceof ErrorSupabase) {
      registro("error", ETIQUETA, "base de datos", e);
      return json(500, { ok: false, error: e.message, contenedor: contenedorId ? { id: contenedorId } : null });
    }
    registro("error", ETIQUETA, "fallo", e);
    await anotarError(s, id, (e as Error)?.message ?? String(e));
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
