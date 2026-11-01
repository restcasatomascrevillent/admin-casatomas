/**
 * Guardar / quitar el vídeo del plato: fichero `<id>-video.<mp4|webm>` en el
 * bucket `platos` (upsert) y su URL pública (con `?t=` para la caché) en
 * `Platos.video_url`.
 *
 * Va APARTE del guardado del plato (después de él): si la columna
 * `video_url` aún no existe (migración sin aplicar), el plato se guarda igual
 * y aquí se lanza ErrorMigracionVideo para avisar, borrando el fichero subido.
 */
import { supabase } from "@/integrations/supabase/client";
import { rutaEnBucket } from "../subirFotoCarta";
import type { NombreTema } from "../composicionCarta";
import { esErrorColumnaVideo, extensionVideo, rutaVideoPlato } from "./videoPlato";
import { tipoMimeBruto } from "../potente/colaPendientes";
import {
  archivoDesdeOriginal,
  CARPETA_ORIGINALES,
  extensionDeRuta,
  extensionOriginal,
  originalesDePlato,
  rutaOriginalVideo,
  urlConFondo,
} from "./originalVideo";

export const BUCKET_VIDEO = "platos";
export const MENSAJE_FALTA_MIGRACION_VIDEO =
  "Falta aplicar la migración de vídeo (columna video_url). El plato se ha guardado, pero sin el vídeo.";

export class ErrorMigracionVideo extends Error {
  constructor() {
    super(MENSAJE_FALTA_MIGRACION_VIDEO);
    this.name = "ErrorMigracionVideo";
  }
}

async function escribirColumna(id: string, url: string | null) {
  const { error } = await supabase.from("Platos").update({ video_url: url }).eq("id", id);
  if (error) {
    if (esErrorColumnaVideo(error)) throw new ErrorMigracionVideo();
    throw error;
  }
}

/**
 * Sube el vídeo, guarda la URL y borra el fichero anterior si tenía otra
 * extensión. Devuelve la URL. Con `tema`, la URL lleva `&fondo=<tema>` para
 * saber después con qué fondo se hizo.
 */
export async function guardarVideoPlato(id: string, video: Blob, urlAnterior?: string | null, tema?: NombreTema): Promise<string> {
  const ext = extensionVideo(video.type);
  const ruta = rutaVideoPlato(id, ext);
  const almacen = supabase.storage.from(BUCKET_VIDEO);
  const { error: eSubida } = await almacen.upload(ruta, video, {
    upsert: true,
    contentType: ext === "mp4" ? "video/mp4" : "video/webm",
  });
  if (eSubida) throw eSubida;
  const base = `${almacen.getPublicUrl(ruta).data.publicUrl}?t=${Date.now()}`;
  const url = tema ? urlConFondo(base, tema) : base;
  const anterior = rutaEnBucket(urlAnterior, BUCKET_VIDEO);
  try {
    await escribirColumna(id, url);
  } catch (e) {
    // Sin columna (o fallo al guardar): no dejar el fichero huérfano, salvo
    // que sea el mismo que ya usaba la ficha (el upsert lo ha sobrescrito).
    if (anterior !== ruta) await almacen.remove([ruta]).catch(() => undefined);
    throw e;
  }
  if (anterior && anterior !== ruta) await almacen.remove([anterior]).catch(() => undefined);
  return url;
}

/** Pone `video_url` a null y borra el fichero (y el original guardado). */
export async function quitarVideoPlato(id: string, urlActual: string | null | undefined): Promise<void> {
  await escribirColumna(id, null);
  const ruta = rutaEnBucket(urlActual, BUCKET_VIDEO);
  const originales = await listarOriginales(id).catch(() => [] as string[]);
  const borrar = [...(ruta ? [ruta] : []), ...originales];
  if (borrar.length) await supabase.storage.from(BUCKET_VIDEO).remove(borrar).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Vídeo ORIGINAL (para poder cambiar el fondo después): videos-originales/<id>.<ext>
// ---------------------------------------------------------------------------

/** Rutas de los originales guardados de un plato (normalmente 0 o 1). */
async function listarOriginales(platoId: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from(BUCKET_VIDEO).list(CARPETA_ORIGINALES, { search: platoId, limit: 100 });
  if (error) throw error;
  return originalesDePlato((data ?? []).map((f) => f.name), platoId);
}

/** Ruta del original guardado del plato, o null si no hay (vídeos anteriores a guardarlo). */
export async function buscarOriginalVideo(platoId: string): Promise<string | null> {
  return (await listarOriginales(platoId))[0] ?? null;
}

/** Guarda (sustituye) el original del plato. Borra los de otra extensión. Devuelve la ruta. */
export async function guardarOriginalVideo(platoId: string, archivo: Blob & { name?: string }): Promise<string> {
  const ext = extensionOriginal(archivo);
  const ruta = rutaOriginalVideo(platoId, ext);
  const almacen = supabase.storage.from(BUCKET_VIDEO);
  const { error } = await almacen.upload(ruta, archivo, { upsert: true, contentType: tipoMimeBruto(ext) });
  if (error) throw error;
  const viejos = (await listarOriginales(platoId).catch(() => [] as string[])).filter((r) => r !== ruta);
  if (viejos.length) await almacen.remove(viejos).catch(() => undefined);
  return ruta;
}

/**
 * Convierte el bruto de `pendientes/` (flujo «dispositivo potente») en el
 * original del plato, moviéndolo en el servidor (sin volver a subirlo). Si
 * no se puede mover, lo borra como antes. Nunca lanza.
 */
export async function conservarBrutoComoOriginal(rutaBruto: string, platoId: string): Promise<string | null> {
  const almacen = supabase.storage.from(BUCKET_VIDEO);
  const destino = rutaOriginalVideo(platoId, extensionDeRuta(rutaBruto));
  try {
    // `move` falla si el destino existe: se quitan antes los originales anteriores.
    const viejos = await listarOriginales(platoId).catch(() => [] as string[]);
    if (viejos.length) await almacen.remove(viejos);
    const { error } = await almacen.move(rutaBruto, destino);
    if (error) throw error;
    return destino;
  } catch (e) {
    console.warn("[video-plato] no se pudo conservar el original", e);
    await almacen.remove([rutaBruto]).catch(() => undefined);
    return null;
  }
}

/** Descarga el original como File (con su extensión en el nombre). */
export async function descargarOriginalVideo(ruta: string): Promise<File> {
  const { data, error } = await supabase.storage.from(BUCKET_VIDEO).download(ruta);
  if (error || !data) throw error ?? new Error("No se pudo descargar el vídeo original");
  return archivoDesdeOriginal(data, ruta);
}
