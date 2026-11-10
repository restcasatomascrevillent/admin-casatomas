/**
 * RRSS · motor de FOTOS (sharp). Transforma de verdad el archivo original
 * según la receta: no describe la edición, la hace.
 *
 *   original ──► orientación (EXIF) ──► niveles automáticos (opcional)
 *            ──► encuadre al formato (centro + zoom del plan)
 *            ──► [creativo, solo si se permitió: desenfocar o cambiar el fondo con la máscara del producto]
 *            ──► corrección + tratamiento del estilo (luz, contraste, color, mate, nitidez)
 *            ──► viñeta y composición del estilo (degradado, banda, bloque, cartel, mínimo, marco)
 *            ──► rótulos con las fuentes de marca, píldora del CTA y logo
 *            ──► JPEG sRGB (calidad 90, 4:4:4, sin metadatos: se quitan GPS y datos del móvil)
 *
 * El original nunca se toca (llega como bytes y se devuelve otro fichero).
 */
import type sharpTipo from "sharp";
import { ESTILOS, sumarTratamientos, factoresFoto, type ComposicionMarca, type EstiloId, type Tratamiento } from "../../../src/lib/rrss/estilos.js";
import type { FormatoSalida, ZonaSegura } from "../../../src/lib/rrss/formatos.js";
import { rectanguloRecorte, seAmpliaDemasiado, type Rect } from "../../../src/lib/rrss/geometria.js";
import type { Creativo, Encuadre, PiezaFoto, PosicionRotulos, Rotulos } from "../../../src/lib/rrss/plan.js";
import type { MarcaId } from "../../../src/lib/instagram/tokens.js";
import { ficheroLogo } from "./recursos.js";
import { pintarAjustado, pintarTexto, type TextoPintado } from "./texto.js";

type Sharp = typeof sharpTipo;

export interface RecetaFoto {
  marca: MarcaId;
  estilo: EstiloId;
  ancho: number;
  alto: number;
  zonaSegura: ZonaSegura;
  tratamiento: Tratamiento;
  autoNiveles: boolean;
  encuadre: Encuadre;
  rotulos: Rotulos | null;
  logo: boolean;
  creativo: Creativo;
  composicion: ComposicionMarca;
}

export interface DependenciasFoto {
  sharp?: Sharp;
  /** Máscara del producto (PNG gris de 1 canal del mismo tamaño). Solo para `creativo`. */
  mascara?: (jpeg: Uint8Array) => Promise<Buffer>;
}

export interface FotoEditada {
  jpeg: Buffer;
  ancho: number;
  alto: number;
  recorte: Rect;
  avisos: string[];
}

export class ErrorFotoMotor extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorFotoMotor";
  }
}

/** Receta = pieza del plan + estilo + formato, todo resuelto. */
export function recetaFoto(p: PiezaFoto, marca: MarcaId, estilo: EstiloId, f: Pick<FormatoSalida, "ancho" | "alto" | "zonaSegura">): RecetaFoto {
  const e = ESTILOS[estilo];
  return {
    marca,
    estilo,
    ancho: f.ancho,
    alto: f.alto,
    zonaSegura: f.zonaSegura,
    tratamiento: sumarTratamientos(p.correccion, e.tratamiento[marca]),
    autoNiveles: p.autoNiveles,
    encuadre: p.encuadre,
    rotulos: p.rotulos,
    logo: p.logo,
    creativo: p.creativo,
    composicion: e.composicion[marca],
  };
}

async function cargarSharp(deps: DependenciasFoto): Promise<Sharp> {
  if (deps.sharp) return deps.sharp;
  return (await import("sharp")).default as unknown as Sharp;
}

/** Medidas tras aplicar la orientación EXIF. */
export async function medidasOrientadas(sharp: Sharp, original: Uint8Array): Promise<{ ancho: number; alto: number }> {
  let meta: sharpTipo.Metadata;
  try {
    meta = await sharp(original, { failOn: "none" }).metadata();
  } catch (e) {
    throw new ErrorFotoMotor(`No se pudo leer la foto: ${(e as Error)?.message ?? e}`);
  }
  if (!meta.width || !meta.height) throw new ErrorFotoMotor("La foto no tiene medidas legibles");
  const girada = (meta.orientation ?? 1) >= 5;
  return girada ? { ancho: meta.height, alto: meta.width } : { ancho: meta.width, alto: meta.height };
}

function svg(ancho: number, alto: number, cuerpo: string): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">${cuerpo}</svg>`);
}

/** rgba(...) o #hex → { color, opacidad } para SVG. */
export function colorSvg(c: string): { color: string; opacidad: number } {
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?\s*\)/i.exec(c);
  if (m) return { color: `rgb(${m[1]},${m[2]},${m[3]})`, opacidad: m[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(m[4]))) };
  return { color: c, opacidad: 1 };
}

/** Viñeta: degradado radial de negro transparente en el centro a negro en los bordes. */
function capaVineta(ancho: number, alto: number, fuerza: number): Buffer {
  const op = (0.6 * fuerza).toFixed(3);
  return svg(
    ancho,
    alto,
    `<defs><radialGradient id="v" cx="50%" cy="50%" r="75%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="${op}"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#v)"/>`,
  );
}

interface Bloques {
  antetitulo?: TextoPintado;
  titulo?: TextoPintado;
  subtitulo?: TextoPintado;
  cta?: { texto: TextoPintado; ancho: number; alto: number };
}

function posicionPorDefecto(c: ComposicionMarca): Exclude<PosicionRotulos, "auto"> {
  if (c.tipo === "cartel") return "centro";
  if (c.tipo === "minimo") return "arriba";
  return "abajo";
}

/** Luminancia media (0-255) de una zona de la imagen. */
async function luminanciaZona(sharp: Sharp, img: Buffer, r: Rect): Promise<number> {
  try {
    const st = await sharp(img).extract(r).greyscale().stats();
    return st.channels[0]?.mean ?? 128;
  } catch {
    return 128;
  }
}

async function pintarBloques(sharp: Sharp, r: Rotulos, c: ComposicionMarca, anchoTexto: number, ancho: number, colorTexto: string, altoMax: number): Promise<Bloques> {
  const b: Bloques = {};
  const alinear = c.alinear;
  if (r.antetitulo) {
    b.antetitulo = await pintarTexto(sharp, {
      texto: r.antetitulo.toLocaleUpperCase("es"),
      familia: c.antetitulo,
      px: ancho * 0.024,
      color: c.tipo === "banda" || c.tipo === "minimo" ? c.colorAcento : c.colorAcento,
      anchoMax: anchoTexto,
      alinear,
      espaciado: ancho * 0.004,
    });
  }
  if (r.titulo) {
    const texto = c.mayusculasTitular ? r.titulo.toLocaleUpperCase("es") : r.titulo;
    b.titulo = await pintarAjustado(sharp, { texto, familia: c.titular, px: ancho * c.escalaTitular, color: colorTexto, anchoMax: anchoTexto, alinear, interlineado: 0 }, altoMax * 0.55);
  }
  if (r.subtitulo) {
    b.subtitulo = await pintarAjustado(sharp, { texto: r.subtitulo, familia: c.texto, px: ancho * 0.032, color: colorTexto, anchoMax: anchoTexto, alinear }, altoMax * 0.3);
  }
  if (r.cta) {
    const texto = await pintarTexto(sharp, { texto: r.cta.toLocaleUpperCase("es"), familia: "montserrat-seminegrita", px: ancho * 0.024, color: c.colorSobreAcento, anchoMax: anchoTexto, espaciado: ancho * 0.002 });
    const alto = Math.round(texto.alto + ancho * 0.036);
    b.cta = { texto, ancho: Math.round(texto.ancho + ancho * 0.06), alto };
  }
  return b;
}

/** Alto de la pila de rótulos con sus separaciones. */
function altoPila(b: Bloques, ancho: number): number {
  const sep = ancho * 0.018;
  const partes = [b.antetitulo?.alto, b.titulo?.alto, b.subtitulo?.alto, b.cta ? b.cta.alto + sep : undefined].filter((x): x is number => typeof x === "number");
  return Math.round(partes.reduce((s, x) => s + x, 0) + sep * Math.max(0, partes.length - 1));
}

function anchoPila(b: Bloques): number {
  return Math.max(b.antetitulo?.ancho ?? 0, b.titulo?.ancho ?? 0, b.subtitulo?.ancho ?? 0, b.cta?.ancho ?? 0);
}

/** Sombra suave de un texto (para leerlo sobre la foto sin caja). */
async function sombraTexto(sharp: Sharp, t: TextoPintado, ancho: number): Promise<{ png: Buffer; margen: number }> {
  const margen = Math.max(4, Math.round(ancho / 120));
  const png = await sharp(t.png)
    .ensureAlpha()
    .linear([0, 0, 0, 0.55], [0, 0, 0, 0])
    .extend({ top: margen, bottom: margen, left: margen, right: margen, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(Math.max(1.2, ancho / 400))
    .png()
    .toBuffer();
  return { png, margen };
}

/** Capas de composite de la pila a partir de (x, y) con la alineación dada. */
async function capasPila(sharp: Sharp, b: Bloques, x: number, y: number, anchoCaja: number, alinear: "izquierda" | "centro", ancho: number, c: ComposicionMarca, sombra = false): Promise<sharpTipo.OverlayOptions[]> {
  const sep = ancho * 0.018;
  const capas: sharpTipo.OverlayOptions[] = [];
  let cursor = y;
  const colocar = (w: number) => Math.round(alinear === "centro" ? x + (anchoCaja - w) / 2 : x);
  const desplazamiento = Math.max(1, Math.round(ancho / 540));
  for (const t of [b.antetitulo, b.titulo, b.subtitulo]) {
    if (!t) continue;
    if (sombra) {
      const s = await sombraTexto(sharp, t, ancho);
      capas.push({ input: s.png, left: Math.max(0, colocar(t.ancho) - s.margen + desplazamiento), top: Math.max(0, Math.round(cursor) - s.margen + desplazamiento) });
    }
    capas.push({ input: t.png, left: colocar(t.ancho), top: Math.round(cursor) });
    cursor += t.alto + sep;
  }
  if (b.cta) {
    cursor += sep;
    const left = colocar(b.cta.ancho);
    const { color, opacidad } = colorSvg(c.colorAcento);
    const radio = b.cta.alto / 2;
    capas.push({ input: svg(b.cta.ancho, b.cta.alto, `<rect width="${b.cta.ancho}" height="${b.cta.alto}" rx="${radio}" fill="${color}" fill-opacity="${opacidad}"/>`), left, top: Math.round(cursor) });
    capas.push({ input: b.cta.texto.png, left: Math.round(left + (b.cta.ancho - b.cta.texto.ancho) / 2), top: Math.round(cursor + (b.cta.alto - b.cta.texto.alto) / 2) });
  }
  return capas;
}

async function capaLogo(sharp: Sharp, nombre: string, anchoLogo: number): Promise<{ png: Buffer; ancho: number; alto: number } | null> {
  try {
    const { data, info } = await sharp(ficheroLogo(nombre)).resize({ width: Math.round(anchoLogo) }).png().toBuffer({ resolveWithObject: true });
    return { png: data, ancho: info.width, alto: info.height };
  } catch {
    return null;
  }
}

/** Composición completa: fondos de la composición + rótulos + logo. */
async function capasComposicion(sharp: Sharp, img: Buffer, rc: RecetaFoto, avisos: string[]): Promise<sharpTipo.OverlayOptions[]> {
  const { ancho, alto, composicion: c } = rc;
  const capas: sharpTipo.OverlayOptions[] = [];
  const m = Math.round(Math.max(56, ancho * 0.067));
  const vertical = rc.zonaSegura.arriba > 100;
  const arribaSegura = vertical ? rc.zonaSegura.arriba : m;
  const abajoSegura = vertical ? rc.zonaSegura.abajo : m;
  const lados = Math.max(m, rc.zonaSegura.lados);

  if (c.tipo === "marco") {
    const { color, opacidad } = colorSvg(c.colorAcento);
    const ins = Math.round(m * 0.45);
    capas.push({ input: svg(ancho, alto, `<rect x="${ins}" y="${ins}" width="${ancho - 2 * ins}" height="${alto - 2 * ins}" fill="none" stroke="${color}" stroke-opacity="${opacidad}" stroke-width="${Math.max(2, Math.round(ancho / 360))}"/>`), left: 0, top: 0 });
  }

  const r = rc.rotulos;
  const posicion = r ? (r.posicion === "auto" ? posicionPorDefecto(c) : r.posicion) : "abajo";

  // Logo: esquina superior derecha o centrado arriba; si los rótulos van arriba, el logo baja.
  let logo: { png: Buffer; ancho: number; alto: number } | null = null;
  if (rc.logo) {
    logo = await capaLogo(sharp, c.logo, ancho * (c.posicionLogo === "arriba" ? 0.17 : 0.14));
    if (!logo) avisos.push("No se pudo cargar el logo");
  }

  if (r) {
    const conCaja = c.tipo === "bloque" || c.tipo === "banda";
    const pad = Math.round(ancho * 0.045);
    const anchoTexto = ancho - 2 * lados - (conCaja ? 2 * pad : 0);
    const altoDisponible = alto - arribaSegura - abajoSegura;
    let b = await pintarBloques(sharp, r, c, anchoTexto, ancho, c.colorTexto, altoDisponible);
    if (c.tipo === "minimo") {
      // Mínimo: sin fondo, el color del texto según lo claro u oscuro que sea justo donde va.
      const h = altoPila(b, ancho);
      const w = Math.max(32, Math.min(ancho - 2 * lados, anchoPila(b)));
      const top = posicion === "arriba" ? arribaSegura : posicion === "centro" ? Math.round((alto - h) / 2) : alto - abajoSegura - h;
      const lum = await luminanciaZona(sharp, img, { left: lados, top: Math.max(0, Math.min(alto - h, top)), width: w, height: Math.max(8, Math.min(h, alto)) });
      const oscuro = rc.marca === "touza" ? "#0a0a0a" : "#394147";
      const claro = rc.marca === "touza" ? "#f5f3ef" : "#ffffff";
      const colorTexto = lum > 150 ? oscuro : claro;
      if (colorTexto !== c.colorTexto) b = await pintarBloques(sharp, r, c, anchoTexto, ancho, colorTexto, altoDisponible);
    }
    const hp = altoPila(b, ancho);
    const wp = anchoPila(b);
    if (hp > altoDisponible) avisos.push("Los rótulos son largos para este formato: se ha reducido la letra");

    // Caja (bloque/banda) o zona de texto.
    const cajaAlto = hp + (conCaja ? 2 * pad : 0);
    let cajaTop: number;
    if (posicion === "arriba") cajaTop = arribaSegura + (logo && c.posicionLogo === "arriba" ? 0 : 0);
    else if (posicion === "centro") cajaTop = Math.round((alto - cajaAlto) / 2);
    else cajaTop = alto - abajoSegura - cajaAlto;
    // Banda en el feed: pegada al borde (sin margen) para que se lea como banda.
    if (c.tipo === "banda" && !vertical) cajaTop = posicion === "arriba" ? 0 : posicion === "centro" ? cajaTop : alto - cajaAlto - Math.round(m * 0.3);
    cajaTop = Math.max(0, Math.min(alto - cajaAlto, cajaTop));

    if (c.tipo === "degradado") {
      const { color, opacidad } = colorSvg(c.colorFondo);
      const altoGrad = Math.min(alto, Math.round(cajaAlto + alto * 0.28));
      if (posicion === "arriba") {
        capas.push({ input: svg(ancho, altoGrad, `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${opacidad}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`), left: 0, top: 0 });
      } else if (posicion === "centro") {
        capas.push({ input: svg(ancho, alto, `<rect width="100%" height="100%" fill="${color}" fill-opacity="${(opacidad * 0.45).toFixed(3)}"/>`), left: 0, top: 0 });
      } else {
        capas.push({ input: svg(ancho, altoGrad, `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0"/><stop offset="1" stop-color="${color}" stop-opacity="${opacidad}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`), left: 0, top: alto - altoGrad });
      }
      // Filete de acento sobre el antetítulo (o sobre el titular).
      const { color: ca } = colorSvg(c.colorAcento);
      const fx = c.alinear === "centro" ? Math.round(ancho / 2 - ancho * 0.04) : lados;
      capas.push({ input: svg(Math.round(ancho * 0.08), 4, `<rect width="100%" height="4" fill="${ca}"/>`), left: fx, top: Math.max(0, cajaTop - Math.round(ancho * 0.03)) });
      capas.push(...(await capasPila(sharp, b, lados, cajaTop, ancho - 2 * lados, c.alinear, ancho, c, true)));
    } else if (c.tipo === "banda") {
      const { color, opacidad } = colorSvg(c.colorFondo);
      capas.push({ input: svg(ancho, cajaAlto, `<rect width="100%" height="100%" fill="${color}" fill-opacity="${opacidad}"/>`), left: 0, top: cajaTop });
      capas.push(...(await capasPila(sharp, b, lados + pad, cajaTop + pad, ancho - 2 * lados - 2 * pad, c.alinear, ancho, c)));
    } else if (c.tipo === "bloque") {
      const { color, opacidad } = colorSvg(c.colorFondo);
      const cajaAncho = Math.min(ancho - 2 * lados, wp + 2 * pad);
      const { color: ca } = colorSvg(c.colorAcento);
      capas.push({ input: svg(cajaAncho, cajaAlto, `<rect width="100%" height="100%" fill="${color}" fill-opacity="${opacidad}"/><rect width="${Math.max(6, Math.round(ancho / 160))}" height="100%" fill="${ca}"/>`), left: lados, top: cajaTop });
      capas.push(...(await capasPila(sharp, b, lados + pad, cajaTop + pad, cajaAncho - 2 * pad, "izquierda", ancho, c)));
    } else if (c.tipo === "cartel") {
      const { color, opacidad } = colorSvg(c.colorFondo);
      capas.push({ input: svg(ancho, alto, `<rect width="100%" height="100%" fill="${color}" fill-opacity="${(opacidad * 0.55).toFixed(3)}"/>`), left: 0, top: 0 });
      capas.push(...(await capasPila(sharp, b, lados, cajaTop, ancho - 2 * lados, "centro", ancho, c, true)));
    } else if (c.tipo === "marco") {
      const { color, opacidad } = colorSvg(c.colorFondo);
      const cajaAncho = Math.min(ancho - 2 * lados, Math.max(wp + 2 * pad, ancho * 0.6));
      const left = Math.round((ancho - cajaAncho) / 2);
      const alturaCaja = hp + 2 * pad;
      const top = Math.max(0, Math.min(alto - alturaCaja, posicion === "abajo" ? alto - abajoSegura - alturaCaja : cajaTop));
      capas.push({ input: svg(Math.round(cajaAncho), alturaCaja, `<rect width="100%" height="100%" fill="${color}" fill-opacity="${opacidad}"/>`), left, top });
      capas.push(...(await capasPila(sharp, b, left + pad, top + pad, cajaAncho - 2 * pad, "centro", ancho, c)));
    } else {
      // mínimo
      capas.push(...(await capasPila(sharp, b, lados, cajaTop, ancho - 2 * lados, c.alinear, ancho, c, true)));
    }

    if (logo) {
      const logoArriba = !(posicion === "arriba");
      const top = logoArriba ? arribaSegura : alto - abajoSegura - logo.alto;
      const left = c.posicionLogo === "arriba" ? Math.round((ancho - logo.ancho) / 2) : ancho - lados - logo.ancho;
      capas.push({ input: logo.png, left, top: Math.max(0, top) });
    }
  } else if (logo) {
    const left = c.posicionLogo === "arriba" ? Math.round((ancho - logo.ancho) / 2) : ancho - lados - logo.ancho;
    capas.push({ input: logo.png, left, top: arribaSegura });
  }
  return capas;
}

/** Fondo de marca para «fondo-marca»: degradado suave con los colores de la casa. */
function fondoMarca(marca: MarcaId, ancho: number, alto: number): Buffer {
  const [a, b] = marca === "touza" ? ["#1f1f1f", "#0a0a0a"] : ["#fbf8f4", "#ded8d4"];
  return svg(ancho, alto, `<defs><radialGradient id="f" cx="50%" cy="40%" r="80%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#f)"/>`);
}

async function aplicarCreativo(sharp: Sharp, base: Buffer, rc: RecetaFoto, deps: DependenciasFoto, avisos: string[]): Promise<Buffer> {
  if (rc.creativo === "ninguno") return base;
  if (!deps.mascara) {
    avisos.push("La transformación creativa no está disponible en este servidor: se ha dejado la escena como estaba");
    return base;
  }
  let mascara: Buffer;
  try {
    mascara = await deps.mascara(base);
  } catch (e) {
    avisos.push(`No se encontró el producto para separarlo del fondo (${(e as Error)?.message ?? e}): se ha dejado la escena como estaba`);
    return base;
  }
  const alfa = await sharp(mascara).resize(rc.ancho, rc.alto, { fit: "fill" }).extractChannel(0).toColourspace("b-w").raw().toBuffer();
  const sujeto = await sharp(base).joinChannel(alfa, { raw: { width: rc.ancho, height: rc.alto, channels: 1 } }).png().toBuffer();
  const fondo = rc.creativo === "desenfocar-fondo" ? await sharp(base).blur(Math.max(8, rc.ancho / 60)).toBuffer() : await sharp(fondoMarca(rc.marca, rc.ancho, rc.alto)).png().toBuffer();
  return sharp(fondo).composite([{ input: sujeto, left: 0, top: 0 }]).removeAlpha().jpeg({ quality: 95 }).toBuffer();
}

/** Edita una foto. Lanza ErrorFotoMotor si el archivo no se puede leer. */
export async function editarFoto(original: Uint8Array, rc: RecetaFoto, deps: DependenciasFoto = {}): Promise<FotoEditada> {
  const sharp = await cargarSharp(deps);
  const avisos: string[] = [];
  const { ancho: W, alto: H } = await medidasOrientadas(sharp, original);
  const recorte = rectanguloRecorte(W, H, rc.ancho, rc.alto, rc.encuadre);
  if (seAmpliaDemasiado(recorte, rc.ancho)) avisos.push(`La foto es pequeña para este formato (se amplía ×${(rc.ancho / recorte.width).toFixed(1)}): puede verse blanda`);

  // 1. Orientación, niveles y encuadre.
  let p = sharp(original, { failOn: "none", limitInputPixels: 120_000_000 }).rotate().extract(recorte);
  if (rc.autoNiveles) p = p.normalise({ lower: 1, upper: 99 });
  let base = await p.resize(rc.ancho, rc.alto, { fit: "fill", kernel: "lanczos3" }).toColourspace("srgb").removeAlpha().jpeg({ quality: 95 }).toBuffer();

  // 2. Transformación creativa (solo si está en la receta, que solo la lleva si el usuario la permitió).
  base = await aplicarCreativo(sharp, base, rc, deps, avisos);

  // 3. Corrección + tratamiento del estilo.
  const f = factoresFoto(rc.tratamiento);
  let g = sharp(base)
    .modulate({ brightness: f.brillo, saturation: f.saturacion })
    .linear(f.linealA, f.linealB)
    .recomb([
      [f.rojo, 0, 0],
      [0, 1, 0],
      [0, 0, f.azul],
    ]);
  if (f.nitidezSigma) g = g.sharpen({ sigma: f.nitidezSigma });
  const graduada = await g.jpeg({ quality: 95 }).toBuffer();

  // 4. Viñeta, composición, rótulos y logo (encima de la foto ya graduada: los colores de marca salen exactos).
  const capas: sharpTipo.OverlayOptions[] = [];
  if (f.vineta > 0.01) capas.push({ input: capaVineta(rc.ancho, rc.alto, f.vineta), left: 0, top: 0 });
  capas.push(...(await capasComposicion(sharp, graduada, rc, avisos)));
  const jpeg = await sharp(graduada)
    .composite(capas)
    .toColourspace("srgb")
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
  if (jpeg.byteLength > 8 * 1024 * 1024) throw new ErrorFotoMotor("La imagen editada pasa de 8 MB");
  return { jpeg, ancho: rc.ancho, alto: rc.alto, recorte, avisos };
}
