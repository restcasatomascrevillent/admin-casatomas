/**
 * Limpieza diaria de los cubos de Instagram (acción «limpiar» de
 * instagram-programador; la llama el cron «instagram-limpieza-bucket» de la
 * migración 20261107010000_instagram_limpieza_bucket con el mismo secreto).
 *
 *  1. JPEG de piezas que llevan DIAS_JPEG_SIN_PUBLICAR días sin publicarse:
 *     la RPC instagram_piezas_reclamar_jpeg_caducados los marca
 *     (imagen_borrada_at) y devuelve sus rutas; luego se borran por la API de
 *     Storage (borrar filas de storage.objects dejaría el fichero huérfano).
 *     La RPC NUNCA devuelve una pieza con una programación activa
 *     (programada o publicando): una programación puede ir a 75 días vista y
 *     publica justo ese JPEG. Tampoco una publicada ni una que se está
 *     publicando (cerrojo). Un carrusel devuelve TODAS sus imágenes (una fila
 *     por imagen, 20261112000000). Al volver a generar la pieza, imagen_borrada_at
 *     vuelve a null.
 *  2. Copias tmp/ de fotos de Drive y de la carta de más de 24 h (las mismas
 *     que ya borra instagram-drive al preparar otra). Ninguna programación
 *     depende de tmp/: el JPEG de la pieza ya lleva la foto dentro.
 *  3. Cubo «instagram-video» (A5 de la evaluación, migración 20261111000000):
 *     la RPC instagram_video_reclamar_caducados devuelve
 *       · «huerfano»: MP4 y portadas de reels/ que ya no usa ninguna pieza ni
 *         entrega de encargo (regenerados, sustituidos, piezas borradas,
 *         subidas a medias) y tienen más de GRACIA_VIDEO_HORAS;
 *       · «publicada»: los de reels publicados hace más de N días
 *         (INSTAGRAM_DIAS_VIDEO_PUBLICADO, 30 por defecto; marca
 *         video_borrado_at). Instagram ya tiene su copia.
 *     y se borran por la API de Storage. Sin la migración, se avisa y sigue.
 *
 * Con la clave de servicio (sin usuario). Nunca lanza por un fichero suelto:
 * lo cuenta en `avisos`.
 */
import { limpiarTmp } from "../instagram-drive/drive.ts";
import { borrarObjetos, type Sesion } from "../_shared/instagram/supabase.ts";
import { sanear } from "../_shared/instagram/secretos.ts";

/** Días sin publicar tras los que se borra el JPEG de una pieza (sin programación activa). */
export const DIAS_JPEG_SIN_PUBLICAR = 7;
/** Piezas por pasada (la siguiente noche sigue con el resto). */
export const MAX_JPEG_POR_PASADA = 100;
/** Días que un reel publicado conserva su MP4 en el cubo (configurable con INSTAGRAM_DIAS_VIDEO_PUBLICADO). */
export const DIAS_VIDEO_PUBLICADO = 30;
/** Un vídeo sin pieza se respeta estas horas (un render o una subida a medias). */
export const GRACIA_VIDEO_HORAS = 24;
/** Ficheros de vídeo por pasada y motivo. */
export const MAX_VIDEO_POR_PASADA = 200;
export const CUBO_VIDEO = "instagram-video";

export interface ResultadoLimpieza {
  jpegMarcados: number;
  jpegBorrados: number;
  tmpBorrados: number;
  /** Ficheros del cubo de vídeo a borrar (huérfanos + de reels publicados hace más de N días). */
  videoMarcados: number;
  videoBorrados: number;
  avisos: string[];
}

export interface OpcionesLimpieza {
  diasVideoPublicado?: number;
}

function cabeceras(s: Sesion): Record<string, string> {
  return { apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, "Content-Type": "application/json", Accept: "application/json" };
}

async function borrarEnTandas(s: Sesion, rutas: string[], cubo: string): Promise<number> {
  let n = 0;
  for (let i = 0; i < rutas.length; i += 50) n += await borrarObjetos(s, rutas.slice(i, i + 50), cubo);
  return n;
}

/** MP4 y portadas sin pieza viva y los de reels publicados hace más de N días. Nunca lanza. */
export async function limpiarVideo(s: Sesion, o: OpcionesLimpieza = {}): Promise<{ marcados: number; borrados: number; avisos: string[] }> {
  const avisos: string[] = [];
  let filas: Array<{ ruta: string; motivo: string }> = [];
  try {
    const r = await s.fetch(`${s.sb.url}/rest/v1/rpc/instagram_video_reclamar_caducados`, {
      method: "POST",
      headers: cabeceras(s),
      body: JSON.stringify({ p_dias: o.diasVideoPublicado ?? DIAS_VIDEO_PUBLICADO, p_gracia_horas: GRACIA_VIDEO_HORAS, p_limite: MAX_VIDEO_POR_PASADA }),
      signal: AbortSignal.timeout(15_000),
    });
    const texto = await r.text().catch(() => "");
    if (!r.ok) {
      avisos.push(
        r.status === 404 || /PGRST202|42883/.test(texto)
          ? "Falta aplicar la migración 20261111000000_instagram_seguridad: el cubo de vídeo no se limpia."
          : sanear(`No se pudieron buscar los vídeos caducados (${r.status}): ${texto.slice(0, 200)}`),
      );
      return { marcados: 0, borrados: 0, avisos };
    }
    const v = texto ? (JSON.parse(texto) as unknown) : [];
    filas = Array.isArray(v) ? (v as Array<{ ruta: string; motivo: string }>).filter((f) => typeof f?.ruta === "string") : [];
  } catch (e) {
    avisos.push(sanear(`No se pudieron buscar los vídeos caducados: ${(e as Error)?.message ?? e}`));
    return { marcados: 0, borrados: 0, avisos };
  }
  // Solo reels/ (nunca audio/ ni nada fuera de ese prefijo), sin repetidos.
  const rutas = [...new Set(filas.map((f) => f.ruta).filter((ruta) => /^reels\/[^/]+\/[^/]+\.(mp4|jpg)$/.test(ruta) && !ruta.includes("..")))];
  const borrados = await borrarEnTandas(s, rutas, CUBO_VIDEO);
  if (borrados < rutas.length) avisos.push(`${rutas.length - borrados} vídeos o portadas no estaban en el cubo (o no se pudieron borrar).`);
  return { marcados: rutas.length, borrados, avisos };
}

export async function limpiarBucket(s: Sesion, ahora: () => number = Date.now, o: OpcionesLimpieza = {}): Promise<ResultadoLimpieza> {
  const avisos: string[] = [];
  let filas: Array<{ id: string; imagen_ruta: string }> = [];
  const r = await s.fetch(`${s.sb.url}/rest/v1/rpc/instagram_piezas_reclamar_jpeg_caducados`, {
    method: "POST",
    headers: cabeceras(s),
    body: JSON.stringify({ p_dias: DIAS_JPEG_SIN_PUBLICAR, p_limite: MAX_JPEG_POR_PASADA }),
    signal: AbortSignal.timeout(15_000),
  });
  const texto = await r.text().catch(() => "");
  if (r.ok) {
    const v = texto ? (JSON.parse(texto) as unknown) : [];
    filas = Array.isArray(v) ? (v as Array<{ id: string; imagen_ruta: string }>).filter((f) => typeof f?.imagen_ruta === "string") : [];
  } else {
    avisos.push(sanear(`No se pudieron buscar los JPEG caducados (${r.status}): ${texto.slice(0, 200)}`));
  }
  // Solo rutas de piezas/ (nunca fotos/ ni tmp/ por esta vía).
  const rutas = filas.map((f) => f.imagen_ruta).filter((ruta) => /^piezas\//.test(ruta));
  const jpegBorrados = await borrarEnTandas(s, rutas, "instagram");
  if (jpegBorrados < rutas.length) avisos.push(`${rutas.length - jpegBorrados} JPEG marcados como borrados no estaban en el bucket (o no se pudieron borrar).`);
  const tmpBorrados = await limpiarTmp(s, ahora);
  const video = await limpiarVideo(s, o);
  avisos.push(...video.avisos);
  // Un carrusel devuelve una fila por imagen (20261112000000): se cuentan piezas.
  return { jpegMarcados: new Set(filas.map((f) => f.id)).size, jpegBorrados, tmpBorrados, videoMarcados: video.marcados, videoBorrados: video.borrados, avisos };
}
