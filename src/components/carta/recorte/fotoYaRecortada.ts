/**
 * Fotos que YA vienen sin fondo (decisión del dueño, 02-11-2026): el iPhone
 * (iOS 16+) recorta el sujeto solo —en Fotos, mantener pulsado el plato →
 * «Copiar» o «Compartir»— y entrega un PNG con transparencia. Si la foto que
 * se elige o se pega tiene un canal alfa de verdad (bordes casi todos
 * transparentes y una parte relevante de la imagen transparente), NO se pasa
 * el modelo: ese alfa es la máscara. Se encuadra (caja opaca + margen), se
 * reduce a ≤ LADO_RECORTADA y se compone con el fondo elegido como cualquier
 * otro sticker. Instantáneo y en cualquier dispositivo (iPhone incluido, donde
 * el modelo no cabe en memoria).
 *
 * Ojo con iOS: al elegir de la FOTOTECA con <input type="file">, Safari
 * transcodifica a JPEG (o al primer tipo del `accept`) y el alfa se pierde,
 * diga lo que diga `accept`. Lo que sí conserva el PNG: el portapapeles
 * («Copiar» en Fotos → «Pegar foto recortada» en el panel) y los archivos
 * elegidos desde «Archivos» («Guardar en Archivos» → «Explorar»).
 */
import { bitmapReducido } from "../medidasFoto";
import { esHeic, exigirFotoValida, MAX_FOTO_BYTES, tipoPorFirma } from "@/lib/validarFoto";
import { reducirFotoRecorte } from "./reducirFotoRecorte";
import { aceptarFoto } from "@/lib/aceptarFoto";

/** Alfa por debajo de esto cuenta como transparente. */
export const ALFA_TRANSPARENTE = 16;
/** Alfa a partir de esto cuenta como opaco (el producto). */
export const ALFA_OPACO = 200;
/** Fracción mínima del borde de la imagen que debe ser transparente. */
export const MIN_BORDE_TRANSPARENTE = 0.6;
/** Fracción mínima de toda la imagen que debe ser transparente. */
export const MIN_TRANSPARENTE = 0.08;
/** Fracción mínima opaca (si no, la imagen está vacía o es un velo). */
export const MIN_OPACO = 0.01;
/** Lado mayor del sticker resultante (el mismo con el que trabaja el recorte). */
export const LADO_RECORTADA = 1600;
/** Margen alrededor de la caja del producto (fracción del lado mayor de la caja). */
export const MARGEN_CAJA = 0.02;
/** Por encima de este peso ni se intenta (un PNG así no lo decodifica un móvil). */
export const MAX_BYTES_RECORTADA = 30 * 1024 * 1024;

export interface CajaAlfa {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AnalisisAlfa {
  /** Fracción de píxeles del borde (1 px de marco) transparentes. */
  borde: number;
  /** Fracción de píxeles transparentes. */
  transparente: number;
  /** Fracción de píxeles opacos. */
  opaco: number;
  /** Caja de lo que no es transparente (null si todo lo es). */
  caja: CajaAlfa | null;
}

/** Mide el canal alfa de una imagen RGBA. */
export function analizarAlfa(rgba: ArrayLike<number>, ancho: number, alto: number): AnalisisAlfa {
  const n = ancho * alto;
  let transparentes = 0;
  let opacos = 0;
  let bordeT = 0;
  let bordeN = 0;
  let x0 = ancho;
  let y0 = alto;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < alto; y++) {
    const esBordeY = y === 0 || y === alto - 1;
    for (let x = 0; x < ancho; x++) {
      const a = rgba[(y * ancho + x) * 4 + 3];
      const transparente = a < ALFA_TRANSPARENTE;
      if (transparente) transparentes++;
      else {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (a >= ALFA_OPACO) opacos++;
      if (esBordeY || x === 0 || x === ancho - 1) {
        bordeN++;
        if (transparente) bordeT++;
      }
    }
  }
  return {
    borde: bordeN ? bordeT / bordeN : 0,
    transparente: n ? transparentes / n : 0,
    opaco: n ? opacos / n : 0,
    caja: x1 >= 0 ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
  };
}

/**
 * ¿Es una foto ya recortada? Borde mayoritariamente transparente, una parte
 * relevante transparente y algo de producto opaco. Un PNG opaco, un logo con
 * esquinas redondeadas o una foto con cuatro píxeles transparentes NO lo son.
 */
export function pareceRecortada(a: AnalisisAlfa): boolean {
  return a.caja !== null && a.borde >= MIN_BORDE_TRANSPARENTE && a.transparente >= MIN_TRANSPARENTE && a.opaco >= MIN_OPACO;
}

const ascii = (b: Uint8Array, desde: number, hasta: number) => String.fromCharCode(...b.subarray(desde, hasta));

function buscar(b: Uint8Array, texto: string): number {
  const c = [...texto].map((ch) => ch.charCodeAt(0));
  outer: for (let i = 0; i + c.length <= b.length; i++) {
    for (let j = 0; j < c.length; j++) if (b[i + j] !== c[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Mirando solo la cabecera: ¿puede este archivo tener transparencia? JPEG
 * nunca; PNG con canal alfa (tipo de color 4/6) o con chunk tRNS; WebP con la
 * marca de alfa (VP8X) o sin pérdida con alfa (VP8L). Evita decodificar una
 * foto de cámara para nada.
 */
export function cabeceraConAlfa(b: Uint8Array): boolean {
  if (b.length >= 26 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG" && ascii(b, 12, 16) === "IHDR") {
    const tipoColor = b[25];
    if (tipoColor === 4 || tipoColor === 6) return true;
    const idat = buscar(b, "IDAT");
    const trns = buscar(b, "tRNS");
    return trns >= 0 && (idat < 0 || trns < idat);
  }
  if (b.length >= 25 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") {
    const trozo = ascii(b, 12, 16);
    if (trozo === "VP8X") return (b[20] & 0x10) !== 0;
    if (trozo === "VP8L") return ((b[24] >> 4) & 1) === 1;
  }
  return false;
}

async function leerBytes(f: Blob, n: number): Promise<Uint8Array> {
  const trozo = f.slice(0, n);
  const buf = typeof trozo.arrayBuffer === "function" ? await trozo.arrayBuffer() : await new Response(trozo).arrayBuffer();
  return new Uint8Array(buf);
}

/** Stickers que salen de aquí: useFotoCarta los usa sin volver a mirarlos. */
const stickers = new WeakSet<Blob>();

/** true si `f` es un sticker producido por detectarFotoRecortada. */
export function esStickerRecortado(f: Blob | null | undefined): boolean {
  return !!f && stickers.has(f);
}

/** ¿Merece la pena mirar el alfa de este archivo? (sin leerlo: por tipo y peso). */
export function candidataRecortada(f: Blob): boolean {
  return f.size > 0 && f.size <= MAX_BYTES_RECORTADA && (f.type === "image/png" || f.type === "image/webp" || f.type === "");
}

function lienzo(ancho: number, alto: number) {
  const c = document.createElement("canvas");
  c.width = ancho;
  c.height = alto;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D no disponible");
  return { c, ctx };
}

/**
 * Si `foto` ya viene recortada (PNG/WebP con alfa real), devuelve el sticker:
 * PNG encuadrado en el producto, lado mayor ≤ LADO_RECORTADA. Si no, null (y
 * entonces sigue el camino de siempre: modelo en PC/Android o trabajo para un
 * ordenador desde el iPhone). Nunca lanza.
 */
export async function detectarFotoRecortada(foto: Blob): Promise<File | null> {
  if (esStickerRecortado(foto)) return foto as File;
  if (!candidataRecortada(foto) || typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  let bmp: ImageBitmap | null = null;
  try {
    if (!cabeceraConAlfa(await leerBytes(foto, 64 * 1024))) return null;
    bmp = await bitmapReducido(foto, LADO_RECORTADA);
    const escala = Math.min(1, LADO_RECORTADA / Math.max(bmp.width, bmp.height));
    const ancho = Math.max(1, Math.round(bmp.width * escala));
    const alto = Math.max(1, Math.round(bmp.height * escala));
    const lec = lienzo(ancho, alto);
    lec.ctx.imageSmoothingQuality = "high";
    lec.ctx.drawImage(bmp, 0, 0, ancho, alto);
    bmp.close();
    bmp = null;
    const datos = lec.ctx.getImageData(0, 0, ancho, alto);
    const analisis = analizarAlfa(datos.data, ancho, alto);
    if (!pareceRecortada(analisis) || !analisis.caja) {
      lec.c.width = lec.c.height = 0;
      return null;
    }
    const { x, y, w, h } = analisis.caja;
    const m = Math.round(Math.max(w, h) * MARGEN_CAJA);
    const cx = Math.max(0, x - m);
    const cy = Math.max(0, y - m);
    const cw = Math.min(ancho, x + w + m) - cx;
    const ch = Math.min(alto, y + h + m) - cy;
    const sal = lienzo(cw, ch);
    sal.ctx.putImageData(datos, -cx, -cy);
    lec.c.width = lec.c.height = 0;
    const png = await new Promise<Blob | null>((r) => sal.c.toBlob(r, "image/png"));
    sal.c.width = sal.c.height = 0;
    if (!png) return null;
    const archivo = new File([png], "foto-recortada.png", { type: "image/png" });
    stickers.add(archivo);
    console.info("[recorte] foto ya recortada: se usa su transparencia", { ancho, alto, ...analisis });
    return archivo;
  } catch (e) {
    console.warn("[recorte] no se pudo mirar la transparencia", e);
    return null;
  } finally {
    bmp?.close();
  }
}

/**
 * Lo que hacen los formularios de la carta al elegir o pegar una foto: si ya
 * viene recortada, el sticker (pequeño: vale aunque el PNG original pase de
 * 5 MB); si no, la validación de siempre (aceptarFoto). null si no vale.
 */
export async function aceptarFotoCarta(file: File, input?: HTMLInputElement | null): Promise<File | null> {
  const recortada = await detectarFotoRecortada(file);
  if (recortada) {
    try {
      await exigirFotoValida(recortada);
      return recortada;
    } catch {
      /* que lo diga aceptarFoto con el archivo original */
    }
  }
  const ligera = await aligerarFotoGrande(file);
  return (await aceptarFoto(ligera, input)) ? ligera : null;
}

/** Lado mayor al que se reduce una foto de cámara que pasa de 5 MB (o una HEIC) al elegirla. */
export const LADO_FOTO_GRANDE = 2400;
/** Por encima de esto ni se intenta (no es una foto normal de móvil). */
const BYTES_MAXIMOS_ELEGIR = 60 * 1024 * 1024;

/**
 * Foto de cámara de más de 5 MB (iPhone de 48 MP) o HEIC que el navegador sabe
 * abrir (Safari) → JPEG de 2400 px, hecho en el propio móvil y sin decodificar
 * la foto entera si se puede (14/11/2026: antes salía «La foto pesa demasiado»
 * o «Las fotos HEIC no se pueden subir»). Si no se puede, la foto tal cual: la
 * validación dirá el motivo.
 */
export async function aligerarFotoGrande(file: File): Promise<File> {
  if (file.size === 0 || file.size > BYTES_MAXIMOS_ELEGIR) return file;
  let cabecera: Uint8Array;
  try {
    cabecera = new Uint8Array(await new Response(file.slice(0, 16)).arrayBuffer());
  } catch {
    return file;
  }
  const tipo = tipoPorFirma(cabecera);
  const heic = !tipo && esHeic(cabecera);
  if (!heic && !(tipo && file.size > MAX_FOTO_BYTES)) return file;
  try {
    const reducida = await reducirFotoRecorte(file, LADO_FOTO_GRANDE);
    if (reducida === file || reducida.size === 0 || reducida.size > MAX_FOTO_BYTES) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "foto";
    console.info("[foto] reducida al elegirla", { antes: file.size, despues: reducida.size, heic });
    return new File([reducida], `${base}.jpg`, { type: "image/jpeg" });
  } catch (e) {
    console.warn("[foto] no se pudo reducir al elegirla", e);
    return file;
  }
}
