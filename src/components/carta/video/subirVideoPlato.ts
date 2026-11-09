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
import { toast } from "sonner";
import {
  archivoDesdeOriginal,
  CARPETA_ORIGINALES,
  esOriginalDrive,
  extensionDeRuta,
  extensionOriginal,
  MENSAJE_SIN_ORIGINAL,
  originalesDePlato,
  platoDeOriginalDrive,
  rutaOriginalDrive,
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

/**
 * Pone `video_url` a null y borra el fichero (y el original antiguo del
 * bucket). El original de Google Drive se queda (el panel no borra nada de Drive).
 */
export async function quitarVideoPlato(id: string, urlActual: string | null | undefined): Promise<void> {
  await escribirColumna(id, null);
  const ruta = rutaEnBucket(urlActual, BUCKET_VIDEO);
  const originales = await listarOriginales(id).catch(() => [] as string[]);
  const borrar = [...(ruta ? [ruta] : []), ...originales];
  if (borrar.length) await supabase.storage.from(BUCKET_VIDEO).remove(borrar).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Vídeo ORIGINAL (para poder cambiar el fondo después). Desde el 08/11/2026
// vive SOLO en Google Drive (marketing/carta/<marca>/videos/<id>.<ext>); en el
// panel, `drive:<id>.<ext>`. Los antiguos `videos-originales/<id>.<ext>` del
// bucket se leen mientras no se muevan (scripts/carta/mover-originales-a-drive.mjs).
// ---------------------------------------------------------------------------

export const AVISO_SIN_ORIGINAL_VIDEO = "El vídeo original no se ha podido guardar en Google Drive";

const api = () => import("@/components/marketing/instagram/api");

/** Rutas de los originales ANTIGUOS del bucket de un plato (normalmente 0 o 1). */
async function listarOriginales(platoId: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from(BUCKET_VIDEO).list(CARPETA_ORIGINALES, { search: platoId, limit: 100 });
  if (error) throw error;
  return originalesDePlato((data ?? []).map((f) => f.name), platoId);
}

/**
 * Original del plato: `drive:<id>.<ext>` si está en Drive; si no, el antiguo
 * del bucket; null si no hay (vídeos anteriores a guardar originales).
 */
export async function buscarOriginalVideo(platoId: string): Promise<string | null> {
  try {
    const info = await (await api()).comprobarOriginalCarta({ tabla: "Platos", id: platoId, tipo: "video" });
    if (info) return rutaOriginalDrive(platoId, extensionDeRuta(info.nombre));
  } catch (e) {
    console.warn("[video-plato] no se pudo mirar el original en Drive", e);
  }
  return (await listarOriginales(platoId))[0] ?? null;
}

/**
 * Guarda (sustituye) el original del plato en Google Drive y, ya allí, quita
 * los antiguos del bucket. Devuelve `drive:<id>.<ext>`. Lanza si Drive falla.
 */
export async function guardarOriginalVideo(platoId: string, archivo: Blob & { name?: string }): Promise<string> {
  const ext = extensionOriginal(archivo);
  await (await api()).subirOriginalVideoCarta({ id: platoId, archivo, nombre: `${platoId}.${ext}` });
  const viejos = await listarOriginales(platoId).catch(() => [] as string[]);
  if (viejos.length) await supabase.storage.from(BUCKET_VIDEO).remove(viejos).catch(() => undefined);
  return rutaOriginalDrive(platoId, ext);
}

/**
 * El bruto de `pendientes/` (flujo «dispositivo potente») pasa a ser el
 * original del plato en Google Drive, y se borra del bucket SIEMPRE (también
 * si Drive falla: en Supabase solo se queda el vídeo de la web; se avisa).
 * `bruto`: los bytes si ya están descargados. Nunca lanza.
 */
export async function conservarBrutoComoOriginal(
  rutaBruto: string,
  platoId: string,
  bruto?: Blob,
  avisar: (mensaje: string, detalle: string) => void = (m, d) => toast.warning(m, { description: d, duration: 8000 }),
): Promise<string | null> {
  const almacen = supabase.storage.from(BUCKET_VIDEO);
  try {
    let datos = bruto ?? null;
    if (!datos) {
      const { data, error } = await almacen.download(rutaBruto);
      if (error || !data) throw error ?? new Error("No se pudo descargar el vídeo pendiente");
      datos = data;
    }
    const ext = extensionDeRuta(rutaBruto);
    return await guardarOriginalVideo(platoId, new File([datos], `${platoId}.${ext}`, { type: tipoMimeBruto(ext) }));
  } catch (e) {
    console.warn("[video-plato] no se pudo conservar el original", e);
    try {
      avisar(AVISO_SIN_ORIGINAL_VIDEO, `El vídeo de la web sí está guardado. ${(e as Error)?.message ?? ""}`.trim());
    } catch {
      /* el aviso nunca rompe nada */
    }
    return null;
  } finally {
    await almacen.remove([rutaBruto]).catch(() => undefined);
  }
}

/** Descarga el original (de Drive o, si es antiguo, del bucket) como File con su extensión en el nombre. */
export async function descargarOriginalVideo(ruta: string): Promise<File> {
  if (esOriginalDrive(ruta)) {
    const id = platoDeOriginalDrive(ruta);
    const blob = id ? await (await api()).descargarOriginalCarta({ tabla: "Platos", id, tipo: "video" }) : null;
    if (!blob) throw new Error(MENSAJE_SIN_ORIGINAL);
    return archivoDesdeOriginal(blob, ruta);
  }
  const { data, error } = await supabase.storage.from(BUCKET_VIDEO).download(ruta);
  if (error || !data) throw error ?? new Error("No se pudo descargar el vídeo original");
  return archivoDesdeOriginal(data, ruta);
}
