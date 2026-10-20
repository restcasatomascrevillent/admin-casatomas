/**
 * «Foto bonita» de la botella: recorta la foto enviada a la IA al rectángulo
 * `recorte` que devuelve `extraer-vino-foto` (normalizado 0-1 sobre esa misma
 * imagen ya redimensionada), con un margen, y la centra en un lienzo vertical
 * 3:4 de fondo claro neutro. Sin librerías de quitar fondo.
 */

export interface RecorteNormalizado {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlanRecorte {
  /** Zona de la imagen original a copiar (px). */
  origen: Rect;
  /** Tamaño del lienzo final (px). */
  lienzo: { ancho: number; alto: number };
  /** Dónde se pinta la zona dentro del lienzo (px). */
  destino: Rect;
}

export const MARGEN_RECORTE = 0.08;
export const PROPORCION_LIENZO = 3 / 4; // ancho / alto
export const AREA_MINIMA = 0.05;
export const LADO_MAX_LIENZO = 1200;
export const FONDO_LIENZO = "#f4f3f1";
const TOLERANCIA = 0.02;

/** Valida y ajusta el recorte de la IA. null si falta o es raro (fuera de rango, área < 5 %). */
export function recorteValido(r: unknown): RecorteNormalizado | null {
  if (!r || typeof r !== "object") return null;
  const { x, y, w, h } = r as Record<string, unknown>;
  if (![x, y, w, h].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [nx, ny, nw, nh] = [x, y, w, h] as number[];
  if (nw <= 0 || nh <= 0) return null;
  if (nx < -TOLERANCIA || ny < -TOLERANCIA || nx + nw > 1 + TOLERANCIA || ny + nh > 1 + TOLERANCIA) return null;
  const x0 = Math.max(0, nx);
  const y0 = Math.max(0, ny);
  const x1 = Math.min(1, nx + nw);
  const y1 = Math.min(1, ny + nh);
  const recorte = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  if (recorte.w * recorte.h < AREA_MINIMA) return null;
  return recorte;
}

/**
 * Calcula qué copiar y dónde pintarlo. null si el recorte no vale (se usará la foto entera).
 * El margen es un % del tamaño del recorte por cada lado, limitado a los bordes de la foto.
 */
export function planRecorte(
  recorte: unknown,
  ancho: number,
  alto: number,
  margen = MARGEN_RECORTE,
  proporcion = PROPORCION_LIENZO,
  ladoMax = LADO_MAX_LIENZO,
): PlanRecorte | null {
  const r = recorteValido(recorte);
  if (!r || ancho <= 0 || alto <= 0) return null;
  const mx = r.w * margen;
  const my = r.h * margen;
  const x0 = Math.max(0, r.x - mx) * ancho;
  const y0 = Math.max(0, r.y - my) * alto;
  const x1 = Math.min(1, r.x + r.w + mx) * ancho;
  const y1 = Math.min(1, r.y + r.h + my) * alto;
  const origen = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
  if (origen.w < 1 || origen.h < 1) return null;

  // Lienzo con la proporción pedida que contiene la zona entera.
  let lAncho: number;
  let lAlto: number;
  if (origen.w / origen.h < proporcion) {
    lAlto = origen.h;
    lAncho = origen.h * proporcion;
  } else {
    lAncho = origen.w;
    lAlto = origen.w / proporcion;
  }
  const escala = Math.min(1, ladoMax / Math.max(lAncho, lAlto));
  const lienzo = { ancho: Math.round(lAncho * escala), alto: Math.round(lAlto * escala) };
  const dw = Math.round(origen.w * escala);
  const dh = Math.round(origen.h * escala);
  const destino = {
    x: Math.round((lienzo.ancho - dw) / 2),
    y: Math.round((lienzo.alto - dh) / 2),
    w: dw,
    h: dh,
  };
  return { origen, lienzo, destino };
}

async function decodificar(blob: Blob): Promise<{ img: CanvasImageSource; ancho: number; alto: number; liberar: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      return { img: bmp, ancho: bmp.width, alto: bmp.height, liberar: () => bmp.close() };
    } catch {
      /* se intenta con <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { img, ancho: img.naturalWidth, alto: img.naturalHeight, liberar: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Devuelve la foto recortada y encuadrada, o la original si el recorte no vale o algo falla. */
export async function recortarFoto(blob: Blob, recorte: unknown): Promise<Blob> {
  if (!recorteValido(recorte)) return blob;
  let fuente: Awaited<ReturnType<typeof decodificar>> | null = null;
  try {
    fuente = await decodificar(blob);
    const plan = planRecorte(recorte, fuente.ancho, fuente.alto);
    if (!plan) return blob;
    const canvas = document.createElement("canvas");
    canvas.width = plan.lienzo.ancho;
    canvas.height = plan.lienzo.alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.fillStyle = FONDO_LIENZO;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    const { origen: o, destino: d } = plan;
    ctx.drawImage(fuente.img, o.x, o.y, o.w, o.h, d.x, d.y, d.w, d.h);
    const salida = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return salida && salida.size > 0 ? salida : blob;
  } catch (e) {
    console.warn("[extraer-vino-foto] no se pudo recortar, se usa la foto entera", e);
    return blob;
  } finally {
    fuente?.liberar();
  }
}
