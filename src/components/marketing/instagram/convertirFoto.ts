/**
 * Conversión EN EL NAVEGADOR de una foto antes de subirla a la biblioteca de
 * Instagram (nada pesado en el servidor):
 *   1. createImageBitmap con imageOrientation: "from-image" (aplica la
 *      orientación EXIF: las fotos del móvil salen derechas).
 *   2. Lado mayor ≤ 2560 px (LADO_MAXIMO_FOTO), sin ampliar nunca.
 *   3. Canvas (OffscreenCanvas si hay; si no, <canvas>) en sRGB con fondo
 *      blanco (las transparencias de un PNG no salen negras) → JPEG calidad 0,9.
 *      Al recodificar se pierden los metadatos EXIF (incluida la ubicación GPS).
 *   4. ≤ 8 MB (MAX_BYTES_FOTO): si pasa, se baja la calidad hasta 0,7; si aun
 *      así no cabe, error.
 * HEIC/HEIF: solo si el navegador sabe decodificarlo (Safari sí; Chrome y
 * Firefox, no): si no, MENSAJE_FORMATO_ILEGIBLE.
 */
import { FORMATOS, LADO_MAXIMO_FOTO, MAX_BYTES_FOTO, esAptaPara, escalaParaCubrir, type FormatoId } from "@/lib/instagram";

export const CALIDAD_JPEG = 0.9;
const CALIDAD_MINIMA = 0.7;

/** Lo que acepta el selector de ficheros. */
export const ACEPTA_FOTO = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";
export const MENSAJE_FORMATO_ILEGIBLE = "Este formato no se puede leer en este navegador; expórtala como JPEG";
export const MENSAJE_FORMATO_NO_ADMITIDO = "Formato no admitido: sube una foto JPEG, PNG o WebP.";
export const MENSAJE_PEQUENA_PARA_TODO = "Es pequeña: no sirve a sangre en post ni story";

export class ErrorFoto extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorFoto";
  }
}

const TIPOS_NORMALES = ["image/jpeg", "image/png", "image/webp"];
const TIPOS_HEIC = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

function extension(nombre: string): string {
  return nombre.toLowerCase().split(".").pop() ?? "";
}

/** "normal" (JPEG/PNG/WebP), "heic" o null si no se admite. Por tipo MIME o, si el navegador no lo da, por extensión. */
export function claseDeFichero(f: Pick<File, "type" | "name">): "normal" | "heic" | null {
  const tipo = (f.type || "").toLowerCase();
  if (TIPOS_NORMALES.includes(tipo)) return "normal";
  if (TIPOS_HEIC.includes(tipo)) return "heic";
  const ext = extension(f.name);
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "normal";
  if (["heic", "heif"].includes(ext)) return "heic";
  return null;
}

/** Medidas tras reducir el lado mayor a `max` (nunca amplía). */
export function medidasReducidas(ancho: number, alto: number, max = LADO_MAXIMO_FOTO): { ancho: number; alto: number } {
  const escala = Math.min(1, max / Math.max(ancho, alto));
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

export interface Aptitud {
  post: boolean;
  story: boolean;
  /** Explicación para la UI (null si sirve para los dos). */
  mensaje: string | null;
}

const NOMBRE: Record<FormatoId, string> = { post: "post", story: "story" };

/** ¿Para qué formatos sirve? Misma regla que esAptaPara/validarPieza (cubrir ampliando ≤ 5 %). */
export function aptitudFoto(ancho: number, alto: number): Aptitud {
  const post = esAptaPara({ ancho, alto }, "post");
  const story = esAptaPara({ ancho, alto }, "story");
  if (post && story) return { post, story, mensaje: null };
  if (!post && !story) return { post, story, mensaje: `${MENSAJE_PEQUENA_PARA_TODO} (${ancho}×${alto}). Puedes subirla igualmente.` };
  const falla: FormatoId = post ? "story" : "post";
  const f = FORMATOS[falla];
  const ampliar = Math.round((escalaParaCubrir(ancho, alto, f.ancho, f.alto) - 1) * 100);
  return { post, story, mensaje: `Sirve para ${NOMBRE[post ? "post" : "story"]}, no para ${NOMBRE[falla]} (habría que ampliarla un ${ampliar} %).` };
}

export interface FotoConvertida {
  blob: Blob;
  ancho: number;
  alto: number;
  anchoOriginal: number;
  altoOriginal: number;
  calidad: number;
}

type Lienzo2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

async function aJpeg(bitmap: ImageBitmap, ancho: number, alto: number, calidad: number): Promise<Blob> {
  const opciones = { colorSpace: "srgb" as const, alpha: false };
  const pintar = (ctx: Lienzo2D | null) => {
    if (!ctx) throw new ErrorFoto("Este navegador no deja preparar la foto (sin canvas 2D).");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ancho, alto);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
  };
  if (typeof OffscreenCanvas !== "undefined") {
    const lienzo = new OffscreenCanvas(ancho, alto);
    pintar(lienzo.getContext("2d", opciones) as OffscreenCanvasRenderingContext2D | null);
    return lienzo.convertToBlob({ type: "image/jpeg", quality: calidad });
  }
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  pintar(lienzo.getContext("2d", opciones) as CanvasRenderingContext2D | null);
  return new Promise((ok, ko) =>
    lienzo.toBlob((b) => (b ? ok(b) : ko(new ErrorFoto("No se ha podido convertir la foto a JPEG."))), "image/jpeg", calidad),
  );
}

/** Convierte el fichero elegido a un JPEG listo para la biblioteca. Lanza ErrorFoto con un mensaje para el usuario. */
export async function convertirFoto(fichero: File): Promise<FotoConvertida> {
  const clase = claseDeFichero(fichero);
  if (!clase) throw new ErrorFoto(MENSAJE_FORMATO_NO_ADMITIDO);
  if (typeof createImageBitmap !== "function") throw new ErrorFoto("Este navegador no puede preparar fotos; usa uno más reciente.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(fichero, { imageOrientation: "from-image" });
  } catch {
    throw new ErrorFoto(clase === "heic" ? MENSAJE_FORMATO_ILEGIBLE : "No se ha podido leer la foto (¿está dañada?). Prueba a exportarla como JPEG.");
  }
  try {
    const anchoOriginal = bitmap.width;
    const altoOriginal = bitmap.height;
    if (!anchoOriginal || !altoOriginal) throw new ErrorFoto("La foto no tiene tamaño: no se puede usar.");
    const { ancho, alto } = medidasReducidas(anchoOriginal, altoOriginal);
    let calidad = CALIDAD_JPEG;
    for (;;) {
      const blob = await aJpeg(bitmap, ancho, alto, calidad);
      if (blob.size <= MAX_BYTES_FOTO) return { blob, ancho, alto, anchoOriginal, altoOriginal, calidad };
      if (calidad <= CALIDAD_MINIMA + 1e-9) {
        throw new ErrorFoto(`La foto pesa ${(blob.size / 1048576).toFixed(1)} MB incluso comprimida; el máximo es 8 MB.`);
      }
      calidad = Math.round((calidad - 0.1) * 10) / 10;
    }
  } finally {
    bitmap.close?.();
  }
}
