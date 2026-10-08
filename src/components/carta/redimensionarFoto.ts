/**
 * Redimensionado de fotos de cámara (móvil/tablet) antes de mandarlas a la IA.
 *
 * En Android las fotos de cámara son de 12-50 MP. Si la decodificación o el
 * canvas fallan por memoria, el navegador NO lanza error: devuelve un lienzo
 * negro/transparente que se envía tan tranquilo a la IA (misma resolución,
 * mismos tokens) y la IA no lee nada. Por eso aquí se comprueba que la imagen
 * resultante no está vacía y, si lo está, se reintenta con otro decodificador.
 */

/** Lado mayor de la foto enviada. ~1400px cabe en el máximo de gpt-4.1-mini y deja leer letra pequeña. */
export const LADO_MAX = 1400;

export function medidasDestino(ancho: number, alto: number, ladoMax = LADO_MAX) {
  const escala = Math.min(1, ladoMax / Math.max(ancho, alto));
  return {
    ancho: Math.max(1, Math.round(ancho * escala)),
    alto: Math.max(1, Math.round(alto * escala)),
  };
}

/**
 * true si los píxeles (RGBA) son todos negros o transparentes: imagen vacía.
 * Muestrea ~2000 píxeles repartidos para no recorrer millones.
 */
export function pareceVacia(pixeles: ArrayLike<number>): boolean {
  const total = Math.floor(pixeles.length / 4);
  if (total === 0) return true;
  const paso = Math.max(1, Math.floor(total / 2000));
  for (let i = 0; i < total; i += paso) {
    const o = i * 4;
    if (pixeles[o + 3] > 10 && pixeles[o] + pixeles[o + 1] + pixeles[o + 2] > 24) return false;
  }
  return true;
}

interface Fuente {
  imagen: CanvasImageSource;
  ancho: number;
  alto: number;
  liberar: () => void;
}

async function conBitmap(file: Blob): Promise<Fuente> {
  // from-image: respeta la orientación EXIF (foto vertical del móvil).
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  return { imagen: bmp, ancho: bmp.width, alto: bmp.height, liberar: () => bmp.close() };
}

async function conImg(file: Blob): Promise<Fuente> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { imagen: img, ancho: img.naturalWidth, alto: img.naturalHeight, liberar: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

export interface FotoRedimensionada {
  blob: Blob;
  original: { ancho: number; alto: number };
  final: { ancho: number; alto: number };
  metodo: "bitmap" | "img";
}

async function dibujar(fuente: Fuente): Promise<{ blob: Blob; final: { ancho: number; alto: number } } | null> {
  const final = medidasDestino(fuente.ancho, fuente.alto);
  const canvas = document.createElement("canvas");
  canvas.width = final.ancho;
  canvas.height = final.alto;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas no disponible");
  ctx.fillStyle = "#fff"; // fondo blanco: un PNG transparente no sale negro en JPEG
  ctx.fillRect(0, 0, final.ancho, final.alto);
  ctx.drawImage(fuente.imagen, 0, 0, final.ancho, final.alto);
  // Fondo blanco + imagen vacía = todo blanco: comprobar también ese caso
  // dibujando sin fondo en un lienzo pequeño de control.
  const control = document.createElement("canvas");
  control.width = 64;
  control.height = 64;
  const cctx = control.getContext("2d");
  if (cctx) {
    cctx.drawImage(fuente.imagen, 0, 0, 64, 64);
    if (pareceVacia(cctx.getImageData(0, 0, 64, 64).data)) return null;
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  return blob && blob.size > 0 ? { blob, final } : null;
}

/** Redimensiona a LADO_MAX y pasa a JPEG 0.8. Lanza error si no consigue una imagen con contenido. */
export async function redimensionarFoto(file: Blob): Promise<FotoRedimensionada> {
  const decodificadores: Array<[FotoRedimensionada["metodo"], (f: Blob) => Promise<Fuente>]> = [
    ["bitmap", conBitmap],
    ["img", conImg],
  ];
  let ultimoError: unknown = null;
  for (const [metodo, decodificar] of decodificadores) {
    let fuente: Fuente | null = null;
    try {
      fuente = await decodificar(file);
      const r = await dibujar(fuente);
      if (r) return { blob: r.blob, final: r.final, original: { ancho: fuente.ancho, alto: fuente.alto }, metodo };
      console.warn(`[extraer-vino-foto] imagen vacía con ${metodo}, reintentando`);
    } catch (e) {
      ultimoError = e;
      console.warn(`[extraer-vino-foto] fallo al decodificar con ${metodo}`, e);
    } finally {
      fuente?.liberar();
    }
  }
  throw new Error(
    `No se pudo procesar la foto (${(file as File).type || "tipo desconocido"})${ultimoError instanceof Error ? `: ${ultimoError.message}` : ""}`,
  );
}
