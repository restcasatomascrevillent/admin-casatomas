/**
 * Reduce una foto ANTES de decodificarla a tamaño completo (móvil: una foto
 * de cámara de 12-48 MP ocupa 50-200 MB descomprimida, memoria que el iPhone
 * no tiene si además va a cargar el modelo del recorte).
 *
 *   1. Lee las medidas de la CABECERA del fichero (JPEG / PNG / WebP), sin
 *      decodificar píxeles.
 *   2. Si es grande, pide al navegador el bitmap YA reducido
 *      (`createImageBitmap(foto, { resizeWidth })`: Safari y Chrome decodifican
 *      a la medida pedida). Solo se da el ancho: el alto sale proporcional y
 *      no se deforma aunque la orientación EXIF gire la foto.
 *   3. Si no se conocen las medidas o el navegador no admite la reducción,
 *      cae al redimensionado de siempre (redimensionarFoto).
 */
import { redimensionarFoto } from "../redimensionarFoto";

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
 */
export async function reducirFotoRecorte(foto: Blob, lado: number): Promise<Blob> {
  let medidas: Medidas | null = null;
  try {
    medidas = medidasCabecera(await leerCabecera(foto));
  } catch {
    medidas = null;
  }
  if (medidas && Math.max(medidas.ancho, medidas.alto) <= lado) return foto;
  const ancho = medidas ? anchoReducido(medidas, lado) : null;
  if (ancho && typeof createImageBitmap === "function") {
    let bmp: ImageBitmap | null = null;
    try {
      bmp = await createImageBitmap(foto, { imageOrientation: "from-image", resizeWidth: ancho, resizeQuality: "high" });
      // Lado mayor ≤ ~1,4 × lado aunque el giro EXIF se aplique después de reducir.
      const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * escala));
      const h = Math.max(1, Math.round(bmp.height * escala));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("Canvas no disponible");
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      bmp = null;
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.9));
      c.width = c.height = 0;
      if (blob && blob.size > 0) return blob;
    } catch (e) {
      console.info("[recorte] el navegador no reduce al decodificar; se usa el redimensionado normal", e);
    } finally {
      bmp?.close();
    }
  }
  return (await redimensionarFoto(foto)).blob;
}
