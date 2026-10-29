/**
 * «Foto de carta» de una botella: recibe la botella YA SIN FONDO (PNG con
 * transparencia) y la coloca sobre el fondo fijo de la carta, igual para
 * todos los vinos, para que la carta sea homogénea:
 *
 *   - Fondo fijo: uno de los TEMAS de abajo (un solo color mate, sin mesa ni
 *     línea de horizonte), elegido en FONDO_ACTIVO (ÚNICO sitio que hay que
 *     tocar para cambiarlo). Referencia de marca (casa-tomas-story): oro
 *     hsl(38 59% 45%), pizarra hsl(206 11% 25%).
 *   - La botella se recorta a sus píxeles opacos, se escala a la misma altura
 *     (ALTURA_BOTELLA del alto del lienzo) y se apoya en la misma línea de base.
 *   - Brillo de contorno suave (que ningún vidrio se pierda en el fondo) y
 *     sombra de contacto en la base para que no flote. Sin reflejo, sin
 *     halo, sin borde de sticker.
 *
 * El dibujo no depende del DOM: recibe una fábrica de lienzos, así el mismo
 * código sirve en el navegador (componerFotoVino) y en Node con
 * @napi-rs/canvas (scripts/fotos-vino/) para las fotos ya subidas.
 */

export const LIENZO_ANCHO = 900;
export const LIENZO_ALTO = 1200;
/** Alto de la botella respecto al alto del lienzo. */
export const ALTURA_BOTELLA = 0.8;
/** Ancho máximo de la botella (magnums muy anchas, cajas…). */
export const ANCHO_MAX_BOTELLA = 0.78;
/** Línea de base (donde apoya la botella), fracción del alto. */
export const LINEA_BASE = 0.89;
/** Alfa (0-255) a partir del cual un píxel cuenta como botella. */
export const UMBRAL_ALFA = 24;

export interface TemaFondo {
  nombre: string;
  /** Fondo liso: degradado radial MUY sutil desde detrás de la botella al borde. Sin mesa ni horizonte. */
  fondo: [centro: string, borde: string];
  /** Viñeta en las esquinas (casi imperceptible). */
  vineta: string;
  /** Intensidad del grano (0-255): textura mate de cartulina. */
  ruido: number;
  /** Brillo alrededor de la silueta (sombra difusa sin desplazamiento), suave. */
  contorno: string;
  radioContorno: number;
  /** Sombra de contacto bajo la botella (para que no flote): r, g, b, alfa. */
  sombra: [r: number, g: number, b: number, alfa: number];
}

/**
 * Fondos de un solo color, mates y relajados (pedido del dueño 28/10/2026:
 * sin la raya de la mesa, sin reflejo, sin halos fuertes). El dorado parte
 * del oro de marca de casa-tomas-story (hsl(38 59% 45%) ≈ #b6852f), aclarado
 * y desaturado hacia una cartulina kraft dorada.
 */
export const TEMAS = {
  /** Dorado cartulina: kraft dorado mate, cálido, no metálico. */
  cartulina: {
    nombre: "Dorado cartulina",
    fondo: ["#d3b47e", "#c4a46d"],
    vineta: "rgba(90, 62, 20, 0.12)",
    ruido: 5,
    contorno: "rgba(255, 244, 218, 0.32)",
    radioContorno: 22,
    sombra: [74, 50, 16, 0.5],
  },
  /** Arena: beige cálido claro. */
  arena: {
    nombre: "Arena",
    fondo: ["#e6d8be", "#d8c7a8"],
    vineta: "rgba(90, 70, 40, 0.1)",
    ruido: 4,
    contorno: "rgba(255, 250, 238, 0.3)",
    radioContorno: 20,
    sombra: [80, 60, 30, 0.42],
  },
  /** Crema / marfil: casi blanco cálido. */
  marfil: {
    nombre: "Crema marfil",
    fondo: ["#f5efe3", "#e9e0ce"],
    vineta: "rgba(90, 75, 50, 0.08)",
    ruido: 3,
    contorno: "rgba(70, 55, 30, 0.16)",
    radioContorno: 16,
    sombra: [80, 65, 40, 0.38],
  },
  /** Piedra cálida: gris topo claro. */
  piedra: {
    nombre: "Piedra cálida",
    fondo: ["#cbc4b9", "#bab2a6"],
    vineta: "rgba(50, 45, 38, 0.1)",
    ruido: 4,
    contorno: "rgba(255, 252, 245, 0.3)",
    radioContorno: 22,
    sombra: [50, 44, 36, 0.45],
  },
  /** Crema champán: dorado pálido, más claro y luminoso que la cartulina. */
  champan: {
    nombre: "Champán",
    fondo: ["#ece0c4", "#dccdab"],
    vineta: "rgba(100, 78, 36, 0.1)",
    ruido: 4,
    contorno: "rgba(255, 250, 232, 0.3)",
    radioContorno: 20,
    sombra: [92, 70, 30, 0.42],
  },
  /** Negro cálido carbón: hace destacar botellas y platos claros. */
  carbon: {
    nombre: "Carbón cálido",
    fondo: ["#3b3835", "#2a2826"],
    vineta: "rgba(0, 0, 0, 0.22)",
    ruido: 3,
    contorno: "rgba(255, 244, 226, 0.26)",
    radioContorno: 20,
    sombra: [0, 0, 0, 0.6],
  },
} satisfies Record<string, TemaFondo>;

export type NombreTema = keyof typeof TEMAS;

/** Fondo de la carta. Cambiar AQUÍ para cambiarlo en todas las fotos nuevas. */
export const FONDO_ACTIVO: NombreTema = "cartulina";

const SEMILLA_RUIDO = 20261026;

export interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlanComposicion {
  /** Zona opaca de la imagen de entrada (px de entrada). */
  origen: Caja;
  /** Dónde se pinta en el lienzo final (px del lienzo). */
  destino: Caja;
  escala: number;
  /** Y de la línea de base en el lienzo. */
  base: number;
  /** Ancho de la base de la botella en el lienzo (para la sombra). */
  anchoBase: number;
}

/**
 * Caja de los píxeles con alfa ≥ umbral en un buffer RGBA. null si no hay
 * ninguno (imagen vacía). Recorre todo el buffer: imágenes de ~1-2 MP, va bien.
 */
export function cajaOpaca(rgba: ArrayLike<number>, ancho: number, alto: number, umbral = UMBRAL_ALFA): Caja | null {
  let x0 = ancho;
  let y0 = alto;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < alto; y++) {
    const fila = y * ancho * 4;
    for (let x = 0; x < ancho; x++) {
      if (rgba[fila + x * 4 + 3] >= umbral) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Ancho de la base de la botella: mediana del ancho opaco de las últimas
 * filas de la caja (el último 4 %), en px de entrada. Si no se puede medir,
 * el ancho de la caja.
 */
export function anchoBaseOpaca(rgba: ArrayLike<number>, ancho: number, caja: Caja, umbral = UMBRAL_ALFA): number {
  const filas = Math.max(1, Math.round(caja.h * 0.04));
  const anchos: number[] = [];
  for (let y = caja.y + caja.h - filas; y < caja.y + caja.h; y++) {
    let a = -1;
    let b = -1;
    for (let x = caja.x; x < caja.x + caja.w; x++) {
      if (rgba[(y * ancho + x) * 4 + 3] >= umbral) {
        if (a < 0) a = x;
        b = x;
      }
    }
    if (a >= 0) anchos.push(b - a + 1);
  }
  if (!anchos.length) return caja.w;
  anchos.sort((p, q) => p - q);
  return anchos[Math.floor(anchos.length / 2)];
}

/** Escala y posición de la botella en el lienzo: misma altura y misma línea de base para todas. */
export function planComposicion(
  origen: Caja,
  anchoBaseEntrada: number,
  lienzoAncho = LIENZO_ANCHO,
  lienzoAlto = LIENZO_ALTO,
): PlanComposicion {
  const escala = Math.min((lienzoAlto * ALTURA_BOTELLA) / origen.h, (lienzoAncho * ANCHO_MAX_BOTELLA) / origen.w);
  const w = Math.round(origen.w * escala);
  const h = Math.round(origen.h * escala);
  const base = Math.round(lienzoAlto * LINEA_BASE);
  return {
    origen,
    escala,
    base,
    destino: { x: Math.round((lienzoAncho - w) / 2), y: base - h, w, h },
    anchoBase: Math.max(1, Math.round(anchoBaseEntrada * escala)),
  };
}

// ---------------------------------------------------------------------------
// Dibujo (sirve con canvas del navegador y con @napi-rs/canvas)
// ---------------------------------------------------------------------------

/** Lo mínimo que se usa de un lienzo: el del DOM y el de @napi-rs/canvas lo cumplen. */
export interface Lienzo {
  width: number;
  height: number;
  getContext(tipo: "2d"): CanvasRenderingContext2D | null;
}
export type CrearLienzo = (ancho: number, alto: number) => Lienzo;

function ctx2d(l: Lienzo): CanvasRenderingContext2D {
  const c = l.getContext("2d");
  if (!c) throw new Error("Canvas 2D no disponible");
  return c;
}

/** PRNG determinista (mulberry32): el grano es idéntico en todas las fotos. */
function mulberry32(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `rgba(r, g, b, a)` → mismo color con la mitad de alfa (halo sin borde visible). */
export function conAlfaMitad(rgba: string): string {
  const m = /^rgba\(([^,]+),([^,]+),([^,]+),\s*([\d.]+)\s*\)$/.exec(rgba.trim());
  return m ? `rgba(${m[1].trim()}, ${m[2].trim()}, ${m[3].trim()}, ${Number(m[4]) / 2})` : rgba;
}

/** Pinta el fondo liso del tema en todo el lienzo; el centro del degradado en (ancho/2, centroY·alto). */
export function pintarFondo(ctx: CanvasRenderingContext2D, ancho: number, alto: number, tema: TemaFondo, centroY = 0.45) {
  const cx = ancho / 2;
  const fondo = ctx.createRadialGradient(cx, alto * centroY, 0, cx, alto * centroY, Math.hypot(ancho, alto) * 0.65);
  fondo.addColorStop(0, tema.fondo[0]);
  fondo.addColorStop(1, tema.fondo[1]);
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, ancho, alto);

  // Viñeta.
  const v = ctx.createRadialGradient(cx, alto * 0.48, Math.min(ancho, alto) * 0.38, cx, alto * 0.48, Math.hypot(ancho, alto) * 0.6);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, tema.vineta);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, ancho, alto);

  // Grano: ruido gris determinista sobre los píxeles.
  if (tema.ruido > 0) {
    const img = ctx.getImageData(0, 0, ancho, alto);
    const d = img.data;
    const rnd = mulberry32(SEMILLA_RUIDO);
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 2 * tema.ruido;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    ctx.putImageData(img, 0, 0);
  }
}

/** Sombra de contacto: dos elipses difusas bajo la base de la botella. */
function pintarSombra(ctx: CanvasRenderingContext2D, cx: number, base: number, anchoBase: number, tema: TemaFondo) {
  const [r, g, b, a] = tema.sombra;
  const capas: Array<[number, number, number]> = [
    // [radio x (× ancho base), radio y (px), opacidad relativa]
    [1.3, 30, 0.45],
    [0.62, 9, 1],
  ];
  for (const [fx, ry, op] of capas) {
    const rx = (anchoBase / 2) * fx + ry;
    ctx.save();
    ctx.translate(cx, base);
    ctx.scale(rx / ry, 1);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${a * op})`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, ry, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Compone la botella (imagen con transparencia) sobre el fondo de la carta.
 * Devuelve el lienzo final (LIENZO_ANCHO × LIENZO_ALTO) o null si la imagen
 * no tiene ningún píxel opaco (recorte fallido).
 */
export function componerEnLienzo(
  crear: CrearLienzo,
  imagen: CanvasImageSource,
  ancho: number,
  alto: number,
  tema: TemaFondo = TEMAS[FONDO_ACTIVO],
): Lienzo | null {
  // 1. Leer alfa y recortar márgenes transparentes.
  const lectura = crear(ancho, alto);
  const lctx = ctx2d(lectura);
  lctx.drawImage(imagen, 0, 0, ancho, alto);
  const rgba = lctx.getImageData(0, 0, ancho, alto).data;
  const caja = cajaOpaca(rgba, ancho, alto);
  if (!caja) return null;
  const plan = planComposicion(caja, anchoBaseOpaca(rgba, ancho, caja));
  const { destino: d } = plan;
  const fuente = lectura as unknown as CanvasImageSource;

  const final = crear(LIENZO_ANCHO, LIENZO_ALTO);
  const fctx = ctx2d(final);
  fctx.imageSmoothingEnabled = true;
  fctx.imageSmoothingQuality = "high";
  pintarFondo(fctx, LIENZO_ANCHO, LIENZO_ALTO, tema, (d.y + d.h * 0.42) / LIENZO_ALTO);

  // 2. Sombra de contacto y botella con brillo de contorno.
  pintarSombra(fctx, LIENZO_ANCHO / 2, plan.base, plan.anchoBase, tema);
  fctx.save();
  fctx.shadowColor = tema.contorno;
  fctx.shadowBlur = tema.radioContorno;
  fctx.shadowOffsetX = 0;
  fctx.shadowOffsetY = 0;
  fctx.drawImage(fuente, caja.x, caja.y, caja.w, caja.h, d.x, d.y, d.w, d.h);
  fctx.restore();
  return final;
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

/**
 * Botella sin fondo (PNG) → foto de carta WebP 900×1200. Safari no codifica
 * WebP desde canvas (devuelve PNG): en ese caso se usa JPEG 0.9.
 * Lanza error si la imagen no tiene botella (todo transparente).
 */
export async function componerFotoVino(pngSinFondo: Blob): Promise<Blob> {
  const fuente = await decodificar(pngSinFondo);
  try {
    const lienzo = componerEnLienzo(crearLienzoDom, fuente.img, fuente.ancho, fuente.alto) as HTMLCanvasElement | null;
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

/** Extensión de archivo según el tipo devuelto por componerFotoVino. */
export function extensionFoto(blob: Blob): "webp" | "jpg" {
  return blob.type === "image/webp" ? "webp" : "jpg";
}
