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
import { esErrorColumnaVideo, extensionVideo, rutaVideoPlato } from "./videoPlato";

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

/** Sube el vídeo, guarda la URL y borra el fichero anterior si tenía otra extensión. Devuelve la URL. */
export async function guardarVideoPlato(id: string, video: Blob, urlAnterior?: string | null): Promise<string> {
  const ext = extensionVideo(video.type);
  const ruta = rutaVideoPlato(id, ext);
  const almacen = supabase.storage.from(BUCKET_VIDEO);
  const { error: eSubida } = await almacen.upload(ruta, video, {
    upsert: true,
    contentType: ext === "mp4" ? "video/mp4" : "video/webm",
  });
  if (eSubida) throw eSubida;
  const url = `${almacen.getPublicUrl(ruta).data.publicUrl}?t=${Date.now()}`;
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

/** Pone `video_url` a null y borra el fichero. */
export async function quitarVideoPlato(id: string, urlActual: string | null | undefined): Promise<void> {
  await escribirColumna(id, null);
  const ruta = rutaEnBucket(urlActual, BUCKET_VIDEO);
  if (ruta) await supabase.storage.from(BUCKET_VIDEO).remove([ruta]).catch(() => undefined);
}
