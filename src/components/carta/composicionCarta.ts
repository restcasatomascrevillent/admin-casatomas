/**
 * «Foto de carta» de cualquier producto: recibe el producto YA SIN FONDO
 * (PNG con transparencia, el «sticker») y lo pone sobre uno de los fondos de
 * la carta (TEMAS de composicionVino.ts, que NO se redefinen aquí).
 *
 *   - vino / bebida: layout de botella (composicionVino.ts): 3:4 900×1200,
 *     80 % del alto, todas apoyadas en la misma línea de base.
 *   - plato: 4:3 1200×900 (la web pinta las fotos de platos apaisadas), el
 *     plato centrado y escalado para que su caja ocupe ~78 % del lado que
 *     limita (en un plato redondo, el 78 % del alto), sombra de contacto suave
 *     debajo y SIN línea de mesa.
 *
 * Igual que composicionVino, el dibujo no depende del DOM (fábrica de lienzos).
 */
import {
  FONDO_ACTIVO,
  TEMAS,
  cajaOpaca,
  componerEnLienzo,
  pintarFondo,
  type Caja,
  type CrearLienzo,
  type Lienzo,
  type NombreTema,
  type TemaFondo,
} from "./composicionVino";

export { FONDO_ACTIVO, TEMAS, type NombreTema, type TemaFondo } from "./composicionVino";

export type TipoFotoCarta = "vino" | "plato" | "bebida";

export const PLATO_ANCHO = 1200;
export const PLATO_ALTO = 900;
/** Fracción de cada lado del lienzo que puede ocupar la caja del plato. */
export const OCUPACION_PLATO = 0.78;
/** Centro vertical del plato (un pelín por encima del centro: deja sitio a la sombra). */
export const CENTRO_Y_PLATO = 0.48;

export interface PlanPlato {
  origen: Caja;
  destino: Caja;
  escala: number;
}

/** Escala y posición del plato: cabe en OCUPACION_PLATO de cada lado, centrado. */
export function planPlato(origen: Caja, lienzoAncho = PLATO_ANCHO, lienzoAlto = PLATO_ALTO): PlanPlato {
  const escala = Math.min((lienzoAncho * OCUPACION_PLATO) / origen.w, (lienzoAlto * OCUPACION_PLATO) / origen.h);
  const w = Math.round(origen.w * escala);
  const h = Math.round(origen.h * escala);
  return {
    origen,
    escala,
    destino: { x: Math.round((lienzoAncho - w) / 2), y: Math.round(lienzoAlto * CENTRO_Y_PLATO - h / 2), w, h },
  };
}

/** Lista de temas para el selector de fondo (clave, nombre y color de muestra). */
export function temasDisponibles(): Array<{ clave: NombreTema; nombre: string; color: string }> {
  return (Object.keys(TEMAS) as NombreTema[]).map((clave) => ({
    clave,
    nombre: TEMAS[clave].nombre,
    color: TEMAS[clave].fondo[0],
  }));
}

function ctx2d(l: Lienzo): CanvasRenderingContext2D {
  const c = l.getContext("2d");
  if (!c) throw new Error("Canvas 2D no disponible");
  return c;
}

/** Plato sin fondo → lienzo 4:3 con el fondo del tema. null si la imagen está vacía. */
export function componerPlatoEnLienzo(
  crear: CrearLienzo,
  imagen: CanvasImageSource,
  ancho: number,
  alto: number,
  tema: TemaFondo = TEMAS[FONDO_ACTIVO],
): Lienzo | null {
  const lectura = crear(ancho, alto);
  const lctx = ctx2d(lectura);
  lctx.drawImage(imagen, 0, 0, ancho, alto);
  const caja = cajaOpaca(lctx.getImageData(0, 0, ancho, alto).data, ancho, alto);
  if (!caja) return null;
  const { destino: d } = planPlato(caja);
  const fuente = lectura as unknown as CanvasImageSource;

  const final = crear(PLATO_ANCHO, PLATO_ALTO);
  const f = ctx2d(final);
  f.imageSmoothingEnabled = true;
  f.imageSmoothingQuality = "high";
  pintarFondo(f, PLATO_ANCHO, PLATO_ALTO, tema, (d.y + d.h / 2) / PLATO_ALTO);

  // Sombra de contacto: elipse difusa bajo la mitad inferior del plato.
  const [r, g, b, a] = tema.sombra;
  const cx = d.x + d.w / 2;
  const cy = d.y + d.h * 0.86;
  const rx = d.w * 0.5;
  const ry = Math.max(12, d.h * 0.16);
  f.save();
  f.translate(cx, cy);
  f.scale(rx / ry, 1);
  const grad = f.createRadialGradient(0, 0, 0, 0, 0, ry);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${a * 0.55})`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  f.fillStyle = grad;
  f.beginPath();
  f.arc(0, 0, ry, 0, Math.PI * 2);
  f.fill();
  f.restore();

  // Plato con una sombra suave proyectada hacia abajo (luz cenital).
  f.save();
  f.shadowColor = `rgba(${r}, ${g}, ${b}, ${a * 0.45})`;
  f.shadowBlur = 36;
  f.shadowOffsetX = 0;
  f.shadowOffsetY = 14;
  f.drawImage(fuente, caja.x, caja.y, caja.w, caja.h, d.x, d.y, d.w, d.h);
  f.restore();
  return final;
}

/** Compone según el tipo (vino/bebida = botella; plato = 4:3 centrado). */
export function componerCartaEnLienzo(
  crear: CrearLienzo,
  imagen: CanvasImageSource,
  ancho: number,
  alto: number,
  tipo: TipoFotoCarta,
  tema: TemaFondo,
): Lienzo | null {
  return tipo === "plato"
    ? componerPlatoEnLienzo(crear, imagen, ancho, alto, tema)
    : componerEnLienzo(crear, imagen, ancho, alto, tema);
}

// ---------------------------------------------------------------------------
// Navegador
// ---------------------------------------------------------------------------

const crearLienzoDom: CrearLienzo = (ancho, alto) => {
  const c = document.createElement("canvas");
  c.width = ancho;
  c.height = alto;
  return c;
};

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

function aBlob(c: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob(resolve, tipo, calidad));
}

export interface OpcionesFotoCarta {
  tipo: TipoFotoCarta;
  tema?: NombreTema;
}

/**
 * Sticker (PNG sin fondo) → foto de carta WebP (JPEG 0.9 en Safari, que no
 * codifica WebP). Lanza error si el sticker está vacío.
 */
export async function componerFotoCarta(sticker: Blob, { tipo, tema = FONDO_ACTIVO }: OpcionesFotoCarta): Promise<Blob> {
  const fuente = await decodificar(sticker);
  try {
    const lienzo = componerCartaEnLienzo(crearLienzoDom, fuente.img, fuente.ancho, fuente.alto, tipo, TEMAS[tema] ?? TEMAS[FONDO_ACTIVO]) as
      | HTMLCanvasElement
      | null;
    if (!lienzo) throw new Error("La imagen sin fondo está vacía");
    const webp = await aBlob(lienzo, "image/webp", 0.88);
    if (webp && webp.type === "image/webp" && webp.size > 0) return webp;
    const jpeg = await aBlob(lienzo, "image/jpeg", 0.9);
    if (!jpeg || jpeg.size === 0) throw new Error("No se pudo codificar la foto");
    return jpeg;
  } finally {
    fuente.liberar();
  }
}
