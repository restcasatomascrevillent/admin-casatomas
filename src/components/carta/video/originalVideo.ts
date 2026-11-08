/**
 * «Cambiar el fondo del vídeo» (lógica PURA, sin Supabase ni React).
 *
 * El fondo va pintado dentro de los fotogramas del vídeo generado, así que
 * para cambiarlo hay que volver a procesar el vídeo ORIGINAL. Desde el
 * 08/11/2026 (en Supabase solo la versión web) el original vive en Google
 * Drive, uno por plato: marketing/carta/<marca>/videos/<platoId>.<ext>
 * (instagram-drive · subir_original_video / descargar_original). En el panel
 * se identifica con `drive:<platoId>.<ext>`. Los antiguos del bucket `platos`
 * (`videos-originales/<platoId>.<ext>`) se siguen leyendo mientras
 * scripts/carta/mover-originales-a-drive.mjs no los mueva. El fondo con el
 * que se hizo el vídeo se apunta en su `video_url` (`&fondo=<tema>`), sin
 * columnas nuevas.
 */
import { TEMAS, type NombreTema } from "../composicionCarta";
import { extensionBruto } from "../potente/colaPendientes";

/** Carpeta ANTIGUA de los originales en el bucket `platos` (solo lectura y limpieza). */
export const CARPETA_ORIGINALES = "videos-originales";
export const PREFIJO_ORIGINAL_DRIVE = "drive:";

/** `drive:<platoId>.<ext>`: el original del plato está en Google Drive. */
export function rutaOriginalDrive(platoId: string, ext: ExtensionOriginal): string {
  return `${PREFIJO_ORIGINAL_DRIVE}${platoId}.${ext}`;
}

export function esOriginalDrive(ruta: string | null | undefined): ruta is string {
  return typeof ruta === "string" && ruta.startsWith(PREFIJO_ORIGINAL_DRIVE);
}

/** platoId de `drive:<platoId>.<ext>` (null si no lo es). */
export function platoDeOriginalDrive(ruta: string): string | null {
  if (!esOriginalDrive(ruta)) return null;
  const resto = ruta.slice(PREFIJO_ORIGINAL_DRIVE.length);
  const punto = resto.lastIndexOf(".");
  const id = punto > 0 ? resto.slice(0, punto) : resto;
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : null;
}

export const MENSAJE_SIN_ORIGINAL =
  "Este vídeo se hizo antes de guardar el original: elige el vídeo otra vez para cambiarle el fondo.";

export type ExtensionOriginal = ReturnType<typeof extensionBruto>;

/** Extensión del original según nombre o tipo (mismas que admite el flujo «dispositivo potente»). */
export const extensionOriginal = (archivo: { name?: string; type?: string }): ExtensionOriginal => extensionBruto(archivo);

/** `videos-originales/<platoId>.<ext>` */
export function rutaOriginalVideo(platoId: string, ext: ExtensionOriginal): string {
  return `${CARPETA_ORIGINALES}/${platoId}.${ext}`;
}

/** Nombres (dentro de la carpeta, como los devuelve `list`) que son originales de ese plato. */
export function originalesDePlato(nombres: readonly string[], platoId: string): string[] {
  const re = new RegExp(`^${platoId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[a-z0-9]+$`, "i");
  return nombres.filter((n) => re.test(n)).map((n) => `${CARPETA_ORIGINALES}/${n}`);
}

/** Extensión a partir de una ruta (`pendientes/abc.mov` → `mov`). */
export function extensionDeRuta(ruta: string): ExtensionOriginal {
  return extensionBruto({ name: ruta });
}

/** File para la cola a partir del original descargado (el nombre lleva la extensión, que usa la conversión). */
export function archivoDesdeOriginal(blob: Blob, ruta: string): File {
  const nombre = ruta.replace(PREFIJO_ORIGINAL_DRIVE, "").split("/").pop() || "original.mp4";
  return new File([blob], nombre, { type: blob.type || "video/mp4" });
}

const esTema = (t: string | null | undefined): t is NombreTema => !!t && Object.prototype.hasOwnProperty.call(TEMAS, t);

/** Añade (o sustituye) `fondo=<tema>` en la URL del vídeo. */
export function urlConFondo(url: string, tema: NombreTema): string {
  const [base, hash] = url.split("#");
  const [ruta, query = ""] = base.split("?");
  const params = query.split("&").filter((p) => p && !p.startsWith("fondo="));
  params.push(`fondo=${encodeURIComponent(tema)}`);
  return `${ruta}?${params.join("&")}${hash !== undefined ? `#${hash}` : ""}`;
}

/** Fondo con el que se hizo el vídeo guardado (null si no se sabe: vídeos anteriores a este cambio). */
export function temaDeVideoUrl(url: string | null | undefined): NombreTema | null {
  if (!url) return null;
  const m = /[?&]fondo=([^&#]+)/.exec(url);
  const t = m ? decodeURIComponent(m[1]) : null;
  return esTema(t) ? t : null;
}

/** Círculo marcado: lo que haya tocado el usuario; si no, el fondo real del vídeo; si no, el de la foto. */
export function temaMarcado(elegido: NombreTema | null, real: NombreTema | null, foto: NombreTema): NombreTema {
  return elegido ?? real ?? foto;
}

/** null = buscando; string = ruta del original; false = no hay original guardado. */
export type EstadoOriginal = string | false | null;

export type AccionCambioFondo = "nada" | "buscando" | "boton" | "sin-original";

/**
 * Qué enseñar bajo los círculos cuando ya hay vídeo:
 *   - "nada": no hay vídeo, o no se ha elegido un fondo distinto del actual;
 *   - "boton": «Cambiar fondo del vídeo a …» (hay archivo en memoria u original guardado);
 *   - "buscando": aún se está mirando si hay original;
 *   - "sin-original": vídeo hecho antes de guardar el original (MENSAJE_SIN_ORIGINAL).
 */
export function accionCambioFondo(o: {
  hayVideo: boolean;
  elegido: NombreTema | null;
  real: NombreTema | null;
  /** El vídeo de esta sesión aún tiene el archivo en memoria. */
  tieneArchivo: boolean;
  original: EstadoOriginal;
}): AccionCambioFondo {
  if (!o.hayVideo || !o.elegido || o.elegido === o.real) return "nada";
  if (o.tieneArchivo || typeof o.original === "string") return "boton";
  if (o.original === null) return "buscando";
  return "sin-original";
}
