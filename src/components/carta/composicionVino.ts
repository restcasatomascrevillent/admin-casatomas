/**
 * «Foto de carta» de una botella: recibe la botella YA SIN FONDO (PNG con
 * transparencia) y la coloca sobre el fondo fijo de la carta, igual para
 * todos los vinos, para que la carta sea homogénea:
 *
 *   - Fondo fijo: uno de los TEMAS de abajo, elegido en FONDO_ACTIVO (ÚNICO
 *     sitio que hay que tocar para cambiarlo). Paleta de casa-tomas-story:
 *     oro hsl(38 59% 45%), oro oscuro hsl(38 62% 32%), papel hsl(36 50% 97%),
 *     pizarra hsl(206 11% 25%).
 *   - La botella se recorta a sus píxeles opacos, se escala a la misma altura
 *     (ALTURA_BOTELLA del alto del lienzo) y se apoya en la misma línea de base.
 *   - Halo de luz detrás, brillo de contorno (que los tintos oscuros no se
 *     pierdan en fondos oscuros ni el vidrio claro en los claros), sombra de
 *     contacto en la base y reflejo tenue en la mesa. Sin borde de sticker.
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
  /** Pared: degradado radial desde detrás de la botella hacia las esquinas. */
  pared: [centro: string, medio: string, borde: string];
  /** Fracción del alto donde empieza la mesa. */
  horizonte: number;
  /** Mesa: arriba → abajo. */
  mesa: [arriba: string, abajo: string];
  /** Línea de luz en el canto de la mesa. */
  cantoMesa: string;
  /** Halo de luz detrás de la botella (color con alfa) y radio (× ancho del lienzo). */
  halo: string;
  radioHalo: number;
  /** Viñeta en las esquinas. */
  vineta: string;
  /** Intensidad del grano (0-255). */
  ruido: number;
  /** Brillo alrededor de la silueta (sombra difusa sin desplazamiento). */
  contorno: string;
  radioContorno: number;
  /** Sombra de contacto: r, g, b, alfa. */
  sombra: [r: number, g: number, b: number, alfa: number];
  /** Opacidad del reflejo en la mesa (0 = sin reflejo). */
  reflejo: number;
}

export const TEMAS = {
  /** A) Oscuro elegante: carbón cálido, halo ámbar, canto de mesa dorado. */
  oscuro: {
    nombre: "Oscuro elegante",
    pared: ["#4a3a28", "#211a14", "#0b0908"],
    horizonte: 0.8,
    mesa: ["#1c1611", "#070605"],
    cantoMesa: "rgba(214, 168, 88, 0.75)",
    halo: "rgba(222, 170, 80, 0.42)",
    radioHalo: 0.62,
    vineta: "rgba(0, 0, 0, 0.55)",
    ruido: 6,
    contorno: "rgba(236, 188, 104, 0.38)",
    radioContorno: 34,
    sombra: [0, 0, 0, 0.75],
    reflejo: 0.2,
  },
  /** B) Burdeos de bodega: vino profundo a negro con foco dorado cálido. */
  burdeos: {
    nombre: "Burdeos de bodega",
    pared: ["#7a2a32", "#35111a", "#0e0407"],
    horizonte: 0.8,
    mesa: ["#220b10", "#080304"],
    cantoMesa: "rgba(222, 172, 96, 0.7)",
    halo: "rgba(246, 196, 120, 0.38)",
    radioHalo: 0.58,
    vineta: "rgba(0, 0, 0, 0.55)",
    ruido: 6,
    contorno: "rgba(250, 200, 128, 0.34)",
    radioContorno: 34,
    sombra: [0, 0, 0, 0.75],
    reflejo: 0.2,
  },
  /** C) Champán: crema y oro claro satinado, viñeta suave. */
  champan: {
    nombre: "Champán",
    pared: ["#fdf7ea", "#f0dfbd", "#d2b37c"],
    horizonte: 0.8,
    mesa: ["#e3c896", "#c9a76b"],
    cantoMesa: "rgba(255, 250, 236, 0.85)",
    halo: "rgba(255, 252, 242, 0.75)",
    radioHalo: 0.8,
    vineta: "rgba(110, 76, 30, 0.28)",
    ruido: 5,
    contorno: "rgba(92, 62, 24, 0.38)",
    radioContorno: 18,
    sombra: [70, 46, 16, 0.5],
    reflejo: 0.16,
  },
} satisfies Record<string, TemaFondo>;

export type NombreTema = keyof typeof TEMAS;

/** Fondo de la carta. Cambiar AQUÍ para cambiarlo en todas las fotos nuevas. */
export const FONDO_ACTIVO: NombreTema = "oscuro";

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

/** Pinta el fondo del tema en todo el lienzo; el halo se centra en (ancho/2, haloY·alto). */
export function pintarFondo(ctx: CanvasRenderingContext2D, ancho: number, alto: number, tema: TemaFondo, haloY = 0.45) {
  const yh = Math.round(alto * tema.horizonte);
  const cx = ancho / 2;
  const cy = alto * haloY;
  const lejos = Math.hypot(ancho, alto) * 0.7;

  const pared = ctx.createRadialGradient(cx, cy, 0, cx, cy, lejos);
  pared.addColorStop(0, tema.pared[0]);
  pared.addColorStop(0.45, tema.pared[1]);
  pared.addColorStop(1, tema.pared[2]);
  ctx.fillStyle = pared;
  ctx.fillRect(0, 0, ancho, yh);

  const mesa = ctx.createLinearGradient(0, yh, 0, alto);
  mesa.addColorStop(0, tema.mesa[0]);
  mesa.addColorStop(1, tema.mesa[1]);
  ctx.fillStyle = mesa;
  ctx.fillRect(0, yh, ancho, alto - yh);

  // Halo de luz detrás de la botella (solo en la pared).
  const r = ancho * tema.radioHalo;
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  halo.addColorStop(0, tema.halo);
  halo.addColorStop(0.55, conAlfaMitad(tema.halo));
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, ancho, yh);

  // Luz del halo derramada sobre la mesa, más tenue y aplastada.
  ctx.save();
  ctx.translate(cx, yh);
  ctx.scale(1, 0.22);
  const charco = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.1);
  charco.addColorStop(0, tema.halo);
  charco.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = charco;
  ctx.fillRect(-ancho, 0, ancho * 2, (alto - yh) / 0.22);
  ctx.restore();

  // Canto de la mesa: línea de luz que se apaga hacia los lados.
  const canto = ctx.createLinearGradient(0, 0, ancho, 0);
  canto.addColorStop(0, "rgba(0,0,0,0)");
  canto.addColorStop(0.5, tema.cantoMesa);
  canto.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = canto;
  ctx.fillRect(0, yh, ancho, 2);

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

  // 2. Reflejo tenue en la mesa: botella volteada que se desvanece hacia abajo.
  const altoReflejo = Math.round(Math.min(d.h * 0.28, LIENZO_ALTO - plan.base));
  if (tema.reflejo > 0 && altoReflejo > 4) {
    const refl = crear(d.w, altoReflejo);
    const rctx = ctx2d(refl);
    rctx.save();
    rctx.translate(0, d.h);
    rctx.scale(1, -1);
    rctx.drawImage(fuente, caja.x, caja.y, caja.w, caja.h, 0, 0, d.w, d.h);
    rctx.restore();
    rctx.globalCompositeOperation = "destination-in";
    const fade = rctx.createLinearGradient(0, 0, 0, altoReflejo);
    fade.addColorStop(0, "rgba(0,0,0,1)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    rctx.fillStyle = fade;
    rctx.fillRect(0, 0, d.w, altoReflejo);
    fctx.save();
    fctx.globalAlpha = tema.reflejo;
    fctx.drawImage(refl as unknown as CanvasImageSource, d.x, plan.base + 1);
    fctx.restore();
  }

  // 3. Sombra de contacto y botella con brillo de contorno.
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
