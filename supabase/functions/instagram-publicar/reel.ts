/**
 * Publicación de REELS (fase 6, docs/instagram-video.md). Mismo núcleo que las
 * imágenes (publicar.ts: sesión, cerrojo, caption, cuota, estados), con estas
 * diferencias:
 *
 *  - El medio es el MP4 del cubo PÚBLICO «instagram-video» (video_ruta) y su
 *    portada JPEG (portada_ruta → cover_url; sin portada, thumb_offset = 0).
 *    Antes de crear el contenedor se comprueba por HEAD que Meta los podrá
 *    descargar: 200, video/mp4 ≤ 300 MB (≤ 50 MB en el cubo) e image/jpeg ≤ 8 MB.
 *  - Contenedor: media_type=REELS, video_url, caption, share_to_feed=true y
 *    cover_url. Sin alt_text: Meta lo admite solo en imágenes («Images only.
 *    Reels and stories are not supported»).
 *  - Meta tarda más en procesar un vídeo que una imagen (la doc recomienda
 *    consultar status_code una vez por minuto, como mucho 5 minutos). La
 *    función solo espera PRESUPUESTO_SONDEO_REEL_MS; si no ha terminado, la
 *    pieza queda en «procesando» con procesando_accion (prueba | publicar |
 *    programador) y responde 202. La cierra después, sin bloquear nada:
 *      · el cron (instagram-programador, cada 5 min) para «prueba» y «publicar»;
 *      · la propia programación para «programador»;
 *      · o el panel, con «Comprobar ahora» (misma petición + contenedorId).
 *  - Publicar tras una prueba correcta reutiliza el contenedor de la prueba
 *    (ya está FINISHED) si el texto no ha cambiado y no han pasado 23 h.
 *  - Archivo: el MP4 NO se copia a Google Drive todavía (la subida simple de
 *    Drive es para ficheros pequeños; falta la subida reanudable «por
 *    trozos»). Se queda en el cubo y la respuesta lo dice (videoEnCubo).
 */
import { ClienteGraph, type FuncionFetch, type InfoContenedor } from "../_shared/instagram/cliente.ts";
import { cuotaDe, type CuotaPublicacion } from "../_shared/instagram/comprobacion.ts";
import { ErrorInstagram, errorInstagramAJson, estadoHttpDeError } from "../_shared/instagram/errores.ts";
import { json } from "../_shared/instagram/http.ts";
import { registro, sanear } from "../_shared/instagram/secretos.ts";
import { actualizarPieza, anotarError, ErrorSupabase, type EntornoSupabase, type FilaPieza } from "../_shared/instagram/supabase.ts";
import type { ContextoPublicacion } from "./publicar.ts";

const ETIQUETA = "instagram-publicar";

export const BUCKET_VIDEO = "instagram-video";
/** Lo que la función espera a que Meta procese el vídeo antes de dejarlo «procesando». */
export const PRESUPUESTO_SONDEO_REEL_MS = 20_000;
export const INTERVALO_SONDEO_REEL_MS = 5_000;
/** Límites de Meta para reels (MP4 ≤ 300 MB) y portadas (JPEG ≤ 8 MB); el cubo admite 50 MB. */
export const MAX_BYTES_VIDEO = 50 * 1024 * 1024;
export const MAX_BYTES_PORTADA = 8 * 1024 * 1024;
/** Un «procesando» más joven que esto bloquea crear otro contenedor (hay que esperar o «Comprobar ahora»). */
export const PROCESANDO_VIGENTE_MS = 30 * 60_000;
/** Un contenedor de prueba se reutiliza al publicar si tiene menos de esto (caducan a las 24 h). */
export const VIDA_CONTENEDOR_PRUEBA_MS = 23 * 60 * 60_000;

export type AccionProcesando = "prueba" | "publicar" | "programador";

export const esReel = (fila: Pick<FilaPieza, "tipo_medio" | "formato">): boolean => fila.tipo_medio === "reel" || fila.formato === "reel";

/** URL pública de un objeto del cubo «instagram-video». */
export function urlPublicaVideo(sb: EntornoSupabase, ruta: string): string {
  return `${sb.url}/storage/v1/object/public/${BUCKET_VIDEO}/${ruta.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * ¿Se puede probar o publicar este reel ahora? null si sí; si no, el cuerpo
 * del 409. Con contenedorPedido (reintento, «Comprobar ahora», el cron) no se
 * bloquea por «procesando»: es justo lo que lo cierra.
 */
export function problemaReel(fila: FilaPieza, contenedorPedido: string | null, ahora: number): Record<string, unknown> | null {
  if (!fila.video_ruta) {
    return { ok: false, tipo: "sin_video", error: "El reel no tiene vídeo: pulsa «Generar vídeo» y espera a que esté listo" };
  }
  if (fila.estado === "procesando" && !contenedorPedido) {
    const desde = fila.procesando_desde ? Date.parse(fila.procesando_desde) : NaN;
    if (!Number.isFinite(desde) || ahora - desde < PROCESANDO_VIGENTE_MS) {
      return {
        ok: false,
        tipo: "procesando",
        error: "Instagram todavía está procesando el vídeo de este reel. Se cerrará solo en unos minutos (o pulsa «Comprobar ahora»).",
        contenedorId: fila.contenedor_id,
      };
    }
  }
  return null;
}

/** Contenedor de una prueba correcta que se puede publicar tal cual (mismo texto, < 23 h). */
export function contenedorReutilizable(fila: FilaPieza, caption: string, ahora: number): string | null {
  if (fila.estado !== "prueba_ok" || !fila.contenedor_id || !/^\d+$/.test(fila.contenedor_id)) return null;
  if ((fila.caption ?? "") !== caption) return null;
  const cuando = fila.updated_at ? Date.parse(fila.updated_at) : NaN;
  if (!Number.isFinite(cuando) || ahora - cuando > VIDA_CONTENEDOR_PRUEBA_MS) return null;
  return fila.contenedor_id;
}

/** HEAD de una URL pública: problemas para que Meta la descargue (vacío si vale). */
export async function comprobarUrlPublica(
  f: FuncionFetch,
  url: string,
  o: { nombre: string; tipos: readonly string[]; maxBytes: number },
): Promise<string[]> {
  const r = await f(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
  const tipo = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const largo = Number(r.headers.get("content-length") ?? "0");
  const problemas: string[] = [];
  if (r.status !== 200) problemas.push(`La URL pública ${o.nombre} responde ${r.status}`);
  else if (!o.tipos.includes(tipo)) problemas.push(`La URL pública ${o.nombre} no sirve ${o.tipos.join(" / ")} (Content-Type: ${tipo || "vacío"})`);
  if (largo > o.maxBytes) problemas.push(`${o.nombre} pesa ${(largo / 1048576).toFixed(1)} MB (máximo ${Math.round(o.maxBytes / 1048576)} MB)`);
  return problemas;
}

function errorMeta(e: ErrorInstagram, extra: Record<string, unknown> = {}): Response {
  return json(estadoHttpDeError(e), { ok: false, ...errorInstagramAJson(e), ...extra });
}

/** Pasos con Meta para un reel, con la pieza ya reservada (cerrojo de publicar.ts). */
export async function publicarReelReservado(c: ContextoPublicacion): Promise<Response> {
  const { s, sw, deps, id, dryRun, fila, cfg, cuenta, contenedorPedido, caption, avisos, resumenCaption } = c;
  const fetchMeta: FuncionFetch = (url, init) => (deps.fetch ?? fetch)(url, init);
  const ahora = deps.ahora ?? Date.now;
  const urlVideo = urlPublicaVideo(s.sb, fila.video_ruta as string);
  let urlPortada = fila.portada_ruta ? urlPublicaVideo(s.sb, fila.portada_ruta) : null;
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
  if (c.altText) avisos.push("Los reels no admiten texto alternativo por la API de Instagram: se ha ignorado.");

  // Contenedor que ya existe: el pedido (reintento) o el de una prueba correcta.
  const reutilizado = !contenedorPedido && !dryRun ? contenedorReutilizable(fila, caption, ahora()) : null;
  let contenedorId = contenedorPedido ?? reutilizado;

  // 1. El vídeo y la portada se descargan sin sesión (es lo que hará Meta).
  if (!contenedorId) {
    try {
      const problemas = await comprobarUrlPublica(fetchMeta, urlVideo, { nombre: "del vídeo", tipos: ["video/mp4"], maxBytes: MAX_BYTES_VIDEO });
      if (problemas.length) {
        await anotarError(sw, id, problemas.join(" · "));
        return json(422, {
          ok: false,
          error: "Meta no podría descargar el vídeo",
          problemas,
          comoArreglarlo: "Vuelve a generar el vídeo. Si sigue igual, comprueba que el cubo «instagram-video» de Supabase es público.",
          urlVideo,
        });
      }
      if (urlPortada) {
        const pPortada = await comprobarUrlPublica(fetchMeta, urlPortada, { nombre: "de la portada", tipos: ["image/jpeg"], maxBytes: MAX_BYTES_PORTADA });
        if (pPortada.length) {
          avisos.push(`La portada no se puede usar (${pPortada.join(" · ")}): Instagram usará el primer fotograma.`);
          urlPortada = null;
        }
      }
    } catch (e) {
      registro("warn", ETIQUETA, "HEAD del vídeo", e);
      return json(502, { ok: false, error: "No se pudo comprobar la URL pública del vídeo", urlVideo });
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

  const inicio = ahora();
  let info: InfoContenedor;
  try {
    // 3. Contenedor REELS.
    if (!contenedorId) {
      contenedorId = await cliente.crearContenedor({
        tipo: "reel",
        videoUrl: urlVideo,
        coverUrl: urlPortada ?? undefined,
        thumbOffsetMs: urlPortada ? undefined : 0,
        caption: caption || undefined,
        shareToFeed: true,
      });
      await actualizarPieza(sw, id, { contenedor_id: contenedorId, caption, error: null });
    }
    // 4. Espera corta: si Meta no ha terminado, la pieza queda «procesando».
    const presupuesto = Math.min(deps.presupuestoMs ?? PRESUPUESTO_SONDEO_REEL_MS, PRESUPUESTO_SONDEO_REEL_MS);
    try {
      info = await cliente.esperarFinished(contenedorId, {
        intervaloMs: deps.intervaloMs ?? INTERVALO_SONDEO_REEL_MS,
        maxMs: Math.max(1_000, presupuesto - (ahora() - inicio)),
      });
    } catch (e) {
      if (e instanceof ErrorInstagram && e.tipo === "contenedor_tiempo_agotado") {
        const ultimo = /último estado: ([A-Z_]+)/.exec(e.message)?.[1] ?? "IN_PROGRESS";
        const accion: AccionProcesando = deps.origen === "programador" ? "programador" : dryRun ? "prueba" : "publicar";
        await actualizarPieza(sw, id, { estado: "procesando", procesando_accion: accion, contenedor_id: contenedorId, caption, error: null });
        return json(202, {
          ok: true,
          estado: "en_proceso",
          procesando: true,
          tipoMedio: "reel",
          id,
          dryRun,
          publicado: false,
          contenedor: { id: contenedorId, estado: ultimo },
          urlVideo,
          cuota,
          cuenta,
          avisos,
          mensaje:
            accion === "programador"
              ? "Instagram está procesando el vídeo; la programación lo publicará en la siguiente pasada."
              : `Instagram está procesando el vídeo. ${dryRun ? "La prueba" : "La publicación"} se cerrará sola en unos minutos (o pulsa «Comprobar ahora»).`,
          reintentar: { id, contenedorId, dryRun },
        });
      }
      throw e;
    }

    // 5. Prueba: termina aquí, SIN media_publish.
    if (dryRun) {
      await actualizarPieza(sw, id, { estado: "prueba_ok", contenedor_id: contenedorId, caption, error: null });
      registro("info", ETIQUETA, "prueba de reel ok", { id, contenedorId, usuario: s.usuario });
      return json(200, {
        ok: true,
        id,
        dryRun: true,
        publicado: false,
        estado: "prueba_ok",
        tipoMedio: "reel",
        contenedor: { id: contenedorId, estado: info.estado },
        urlVideo,
        mediaId: null,
        permalink: null,
        cuota,
        cuenta,
        caption: resumenCaption,
        avisos: [...avisos, "Prueba correcta: no se ha publicado nada. El contenedor caduca en 24 h."],
      });
    }

    // 6. Publicación real.
    if (info.estado !== "FINISHED") throw new ErrorInstagram({ tipo: "contenedor_no_listo" });
    const mediaId = await cliente.publicar(contenedorId);
    let permalink: string | null = null;
    try {
      permalink = await cliente.permalink(mediaId);
    } catch {
      avisos.push("Publicado, pero no se pudo obtener el enlace (permalink).");
    }
    const cuotaDespues = { ...cuota, usadas: cuota.usadas + 1, restantes: cuota.restantes === null ? null : Math.max(0, cuota.restantes - 1) };
    avisos.push("El MP4 se queda en el cubo «instagram-video»: el archivo en Google Drive de los vídeos está pendiente (docs/instagram-video.md).");
    try {
      await actualizarPieza(sw, id, { estado: "publicada", contenedor_id: contenedorId, media_id: mediaId, permalink, caption, error: null });
    } catch (e) {
      registro("error", ETIQUETA, "reel publicado pero no se pudo anotar", e);
      avisos.push("Publicado en Instagram, pero no se pudo guardar el estado en el panel.");
    }
    registro("info", ETIQUETA, "reel publicado", { id, mediaId, usuario: s.usuario });
    return json(200, {
      ok: true,
      id,
      dryRun: false,
      publicado: true,
      estado: "publicada",
      tipoMedio: "reel",
      contenedor: { id: contenedorId, estado: info.estado },
      contenedorReutilizado: !!reutilizado,
      urlVideo,
      videoEnCubo: true,
      driveId: null,
      mediaId,
      permalink,
      cuota: cuotaDespues,
      cuenta,
      caption: resumenCaption,
      avisos,
    });
  } catch (e) {
    if (e instanceof ErrorInstagram) {
      registro("warn", ETIQUETA, "error de Meta (reel)", { id, tipo: e.tipo, codigo: e.codigo, subcodigo: e.subcodigo, mensaje: e.message });
      await anotarError(sw, id, `${e.message}. ${e.comoArreglarlo}`);
      return errorMeta(e, { contenedor: contenedorId ? { id: contenedorId } : null, cuota });
    }
    if (e instanceof ErrorSupabase) {
      registro("error", ETIQUETA, "base de datos (reel)", e);
      return json(500, { ok: false, error: e.message, contenedor: contenedorId ? { id: contenedorId } : null });
    }
    registro("error", ETIQUETA, "fallo (reel)", e);
    await anotarError(sw, id, (e as Error)?.message ?? String(e));
    return json(500, { ok: false, error: "No se pudo publicar el reel", detalle: sanear((e as Error)?.message ?? e) });
  }
}
