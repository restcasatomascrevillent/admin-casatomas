/**
 * Medidas de una foto SIN decodificarla (cabecera JPEG / PNG / WebP) y
 * decodificación ya REDUCIDA (`createImageBitmap(foto, { resizeWidth })`).
 *
 * iPhone (03-11-2026): Safari limita los lienzos a ~16,7 Mpx (4096×4096) y
 * las fotos de cámara son de 12, 24 o 48 Mpx. Decodificar la foto entera para
 * luego dibujarla pequeña gasta 50-200 MB y, por encima del límite, el lienzo
 * o el bitmap pueden salir vacíos sin avisar. Por eso toda foto de cámara se
 * decodifica ya a la medida que se va a usar.
 */

export interface Medidas {
  ancho: number;
  alto: number;
}

function u16be(b: Uint8Array, i: number) {
  return (b[i] << 8) | b[i + 1];
}
function u32be(b: Uint8Array, i: number) {
  return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
}
function u24le(b: Uint8Array, i: number) {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}

/** Medidas de la imagen según su cabecera (sin decodificar). null si no se reconoce. */
export function medidasCabecera(b: Uint8Array): Medidas | null {
  // PNG: firma + IHDR.
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { ancho: u32be(b, 16), alto: u32be(b, 20) };
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X.
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const tipo = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tipo === "VP8X") return { ancho: u24le(b, 24) + 1, alto: u24le(b, 27) + 1 };
    if (tipo === "VP8 ") return { ancho: (b[26] | (b[27] << 8)) & 0x3fff, alto: (b[28] | (b[29] << 8)) & 0x3fff };
    if (tipo === "VP8L") {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { ancho: (v & 0x3fff) + 1, alto: ((v >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  // JPEG: recorrer los segmentos hasta un SOFn.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marca = b[i + 1];
      if (marca === 0xff) {
        i++;
        continue;
      }
      if (marca === 0xd8 || (marca >= 0xd0 && marca <= 0xd7) || marca === 0x01) {
        i += 2;
        continue;
      }
      const largo = u16be(b, i + 2);
      const esSof = marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc;
      if (esSof) return { alto: u16be(b, i + 5), ancho: u16be(b, i + 7) };
      if (largo < 2) return null;
      i += 2 + largo;
    }
  }
  return null;
}

/** Bytes que se leen para buscar la cabecera (la miniatura EXIF va antes del SOF). */
const BYTES_CABECERA = 512 * 1024;

async function leerCabecera(foto: Blob): Promise<Uint8Array> {
  const trozo = foto.slice(0, BYTES_CABECERA);
  if (typeof trozo.arrayBuffer === "function") return new Uint8Array(await trozo.arrayBuffer());
  return new Uint8Array(
    await new Promise<ArrayBuffer>((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(r.result as ArrayBuffer);
      r.onerror = () => ko(r.error);
      r.readAsArrayBuffer(trozo);
    }),
  );
}

/** Ancho a pedir al decodificador para que el lado mayor quede en `lado`. */
export function anchoReducido(m: Medidas, lado: number): number | null {
  const mayor = Math.max(m.ancho, m.alto);
  if (!(mayor > lado)) return null;
  return Math.max(1, Math.round((m.ancho * lado) / mayor));
}

/**
 * Foto lista para el recorte con el lado mayor ≈ `lado` (JPEG 0,9), o la
 * propia foto si ya es pequeña. Nunca decodifica a tamaño completo si el
 * navegador sabe reducir al decodificar.

/** Límite de lienzo de Safari en iOS (px): por encima, el canvas sale vacío o falla. */
export const MAX_PIXELES_LIENZO_IOS = 16_777_216;

/** Medidas según la cabecera (null si no se reconocen o no se pueden leer). */
export async function medidasFoto(foto: Blob): Promise<Medidas | null> {
  try {
    return medidasCabecera(await leerCabecera(foto));
  } catch {
    return null;
  }
}

/**
 * ImageBitmap de la foto con el lado mayor ≈ `lado` (como mucho ~1,4 × `lado`
 * si el giro EXIF se aplica después de reducir), respetando la orientación
 * EXIF. Si la cabecera no dice las medidas o el navegador no sabe reducir al
 * decodificar, la decodifica entera (como antes).
 */
export async function bitmapReducido(foto: Blob, lado: number): Promise<ImageBitmap> {
  const medidas = await medidasFoto(foto);
  const ancho = medidas ? anchoReducido(medidas, lado) : null;
  if (ancho) {
    try {
      const bmp = await createImageBitmap(foto, { imageOrientation: "from-image", resizeWidth: ancho, resizeQuality: "high" });
      return bmp;
    } catch {
      /* el navegador no reduce al decodificar: se decodifica entera abajo */
    }
  }
  const bmp = await createImageBitmap(foto, { imageOrientation: "from-image" });
  return bmp;
}
