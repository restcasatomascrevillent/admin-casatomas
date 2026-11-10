/**
 * RRSS · estilos visuales del editor IA.
 *
 * Un estilo NO es una descripción: son números y reglas que el motor aplica de
 * verdad (api/_lib/rrss/foto.ts con sharp y api/_lib/rrss/video.ts con ffmpeg)
 * y que el panel usa para la vista previa del estilo (`previaCss`). Cambiar un
 * valor aquí cambia a la vez la vista previa, la foto editada y el vídeo.
 *
 *   tratamiento  → luz, contraste, color, negros (mate), viñeta y nitidez que
 *                  el estilo SUMA a la corrección de cada foto (la corrección
 *                  la propone la IA y se puede ajustar a mano).
 *   composicion  → dónde y cómo van los rótulos (degradado, banda, bloque,
 *                  cartel, mínimo o marco), qué tipografía y en qué colores.
 *   ritmo        → segundos por plano, transición, su duración y cuánto se
 *                  mueven las fotos en las piezas animadas.
 *
 * Isomórfico y sin dependencias (lo importa el motor de Vercel). Los colores y
 * las familias salen de los tokens de marca (src/lib/instagram/tokens.ts).
 *
 * Fidelidad: ningún tratamiento cambia el contenido de la foto (solo tono,
 * luz y encuadre). Lo que cambia la escena (desenfocar o cambiar el fondo) es
 * aparte, `creativo` en el plan, y solo si el usuario lo permite.
 */
import type { MarcaId } from "../instagram/tokens.js";

export type EstiloId = "elegante" | "natural" | "moderno" | "promocion" | "minimalista" | "marca";
export const ESTILOS_IDS: readonly EstiloId[] = ["elegante", "natural", "moderno", "promocion", "minimalista", "marca"];

/** Ajustes de imagen normalizados. Todos en [-1, 1] salvo negros, viñeta y nitidez en [0, 1]. */
export interface Tratamiento {
  exposicion: number;
  contraste: number;
  saturacion: number;
  temperatura: number;
  negros: number;
  vineta: number;
  nitidez: number;
}

export const TRATAMIENTO_NEUTRO: Tratamiento = { exposicion: 0, contraste: 0, saturacion: 0, temperatura: 0, negros: 0, vineta: 0, nitidez: 0 };

export type TipoComposicion = "degradado" | "banda" | "bloque" | "cartel" | "minimo" | "marco";
export type Transicion = "fundido" | "deslizar" | "zoom" | "corte";
export const TRANSICIONES: readonly Transicion[] = ["fundido", "deslizar", "zoom", "corte"];

/** Familias tipográficas que el motor tiene en TTF (api/_lib/rrss/fuentes). */
export type FamiliaMotor =
  | "baskerville"
  | "baskerville-seminegrita"
  | "baskerville-cursiva"
  | "cormorant-titular"
  | "cormorant-cursiva"
  | "montserrat-medio"
  | "montserrat-seminegrita";

/** Familia CSS equivalente para la vista previa del panel (fuentes ya cargadas por Instagram). */
export const CSS_FAMILIA: Record<FamiliaMotor, { familia: string; peso: number; estilo: "normal" | "italic" }> = {
  baskerville: { familia: '"Libre Baskerville", serif', peso: 400, estilo: "normal" },
  "baskerville-seminegrita": { familia: '"Libre Baskerville", serif', peso: 600, estilo: "normal" },
  "baskerville-cursiva": { familia: '"Libre Baskerville", serif', peso: 400, estilo: "italic" },
  "cormorant-titular": { familia: '"Cormorant Garamond", serif', peso: 600, estilo: "normal" },
  "cormorant-cursiva": { familia: '"Cormorant Garamond", serif', peso: 400, estilo: "italic" },
  "montserrat-medio": { familia: "Montserrat, sans-serif", peso: 500, estilo: "normal" },
  "montserrat-seminegrita": { familia: "Montserrat, sans-serif", peso: 600, estilo: "normal" },
};

export interface ComposicionMarca {
  tipo: TipoComposicion;
  titular: FamiliaMotor;
  texto: FamiliaMotor;
  antetitulo: FamiliaMotor;
  mayusculasTitular: boolean;
  /** Tamaño del titular respecto al ancho (px de cuerpo = ancho × factor). */
  escalaTitular: number;
  alinear: "izquierda" | "centro";
  colorTexto: string;
  colorAcento: string;
  /** Fondo de banda/bloque/cartel (con alfa si hace falta). */
  colorFondo: string;
  /** Texto sobre `colorAcento` (píldora del CTA). */
  colorSobreAcento: string;
  /** Variante del logo (public/instagram/logos/<fichero>). */
  logo: string;
  /** Logo pequeño en una esquina o centrado arriba. */
  posicionLogo: "esquina" | "arriba";
}

export interface RitmoVideo {
  segundosPorPlano: number;
  transicion: Transicion;
  duracionTransicion: number;
  /** 0 quieto … 1 mucho movimiento (zoom/paneo de las fotos). */
  movimiento: number;
}

export interface Estilo {
  id: EstiloId;
  nombre: string;
  descripcion: string;
  /** Cuándo conviene (lo lee también la IA). */
  usoRecomendado: string;
  tratamiento: Record<MarcaId, Tratamiento>;
  composicion: Record<MarcaId, ComposicionMarca>;
  ritmo: RitmoVideo;
}

// ── Paletas (tokens de marca) ───────────────────────────────────────────────
const CT = { pizarra: "#394147", oro: "#b6852f", oroClaro: "#d7ad65", papel: "#fbf8f4", blanco: "#ffffff", piedraClara: "#ded8d4" };
const TZ = { negro: "#0a0a0a", crema: "#f5f3ef", oro: "#d49a35", oroClaro: "#dab981", blanco: "#ffffff" };

const t = (p: Partial<Tratamiento>): Tratamiento => ({ ...TRATAMIENTO_NEUTRO, ...p });

export const ESTILOS: Record<EstiloId, Estilo> = {
  elegante: {
    id: "elegante",
    nombre: "Elegante y gastronómico",
    descripcion: "Contraste profundo, tonos cálidos y viñeta suave; titular con serifa sobre un degradado oscuro.",
    usoRecomendado: "Platos de autor, vinos, cenas y menús especiales.",
    tratamiento: {
      "casa-tomas": t({ exposicion: -0.05, contraste: 0.25, saturacion: -0.05, temperatura: 0.15, vineta: 0.35, nitidez: 0.35 }),
      touza: t({ exposicion: -0.1, contraste: 0.3, saturacion: -0.1, temperatura: 0.2, vineta: 0.45, nitidez: 0.3 }),
    },
    composicion: {
      "casa-tomas": { tipo: "degradado", titular: "baskerville-seminegrita", texto: "baskerville", antetitulo: "montserrat-medio", mayusculasTitular: false, escalaTitular: 0.07, alinear: "izquierda", colorTexto: CT.blanco, colorAcento: CT.oroClaro, colorFondo: "rgba(20,24,27,0.82)", colorSobreAcento: CT.pizarra, logo: "casa-tomas-logo-blanco.png", posicionLogo: "esquina" },
      touza: { tipo: "degradado", titular: "cormorant-titular", texto: "cormorant-cursiva", antetitulo: "montserrat-medio", mayusculasTitular: false, escalaTitular: 0.085, alinear: "izquierda", colorTexto: TZ.crema, colorAcento: TZ.oro, colorFondo: "rgba(10,10,10,0.85)", colorSobreAcento: TZ.negro, logo: "touza-cruz-tau-oro.png", posicionLogo: "esquina" },
    },
    ritmo: { segundosPorPlano: 3, transicion: "fundido", duracionTransicion: 0.6, movimiento: 0.35 },
  },
  natural: {
    id: "natural",
    nombre: "Natural y artesanal",
    descripcion: "Luz cálida y suave, negros mate y color natural; rótulo en cursiva sobre una banda de papel.",
    usoRecomendado: "Producto de temporada, cocina a la vista, mercado y elaboración.",
    tratamiento: {
      "casa-tomas": t({ exposicion: 0.1, contraste: -0.05, saturacion: 0.1, temperatura: 0.3, negros: 0.35, vineta: 0.15, nitidez: 0.2 }),
      touza: t({ exposicion: 0.05, contraste: 0, saturacion: 0.05, temperatura: 0.3, negros: 0.3, vineta: 0.2, nitidez: 0.2 }),
    },
    composicion: {
      "casa-tomas": { tipo: "banda", titular: "baskerville-cursiva", texto: "baskerville", antetitulo: "montserrat-medio", mayusculasTitular: false, escalaTitular: 0.06, alinear: "centro", colorTexto: CT.pizarra, colorAcento: CT.oro, colorFondo: "rgba(251,248,244,0.94)", colorSobreAcento: CT.blanco, logo: "casa-tomas-logo-negro.png", posicionLogo: "esquina" },
      touza: { tipo: "banda", titular: "cormorant-cursiva", texto: "cormorant-cursiva", antetitulo: "montserrat-medio", mayusculasTitular: false, escalaTitular: 0.075, alinear: "centro", colorTexto: TZ.crema, colorAcento: TZ.oroClaro, colorFondo: "rgba(10,10,10,0.78)", colorSobreAcento: TZ.negro, logo: "touza-cruz-tau-crema.png", posicionLogo: "esquina" },
    },
    ritmo: { segundosPorPlano: 2.6, transicion: "fundido", duracionTransicion: 0.5, movimiento: 0.3 },
  },
  moderno: {
    id: "moderno",
    nombre: "Moderno y dinámico",
    descripcion: "Color vivo y nítido, contraste alto; titular en mayúsculas sobre un bloque de color y cortes rápidos.",
    usoRecomendado: "Reels con ritmo, novedades, barra y cócteles.",
    tratamiento: {
      "casa-tomas": t({ exposicion: 0.05, contraste: 0.35, saturacion: 0.25, temperatura: -0.1, nitidez: 0.5 }),
      touza: t({ exposicion: 0, contraste: 0.4, saturacion: 0.15, temperatura: -0.05, vineta: 0.15, nitidez: 0.5 }),
    },
    composicion: {
      "casa-tomas": { tipo: "bloque", titular: "montserrat-seminegrita", texto: "montserrat-medio", antetitulo: "montserrat-medio", mayusculasTitular: true, escalaTitular: 0.06, alinear: "izquierda", colorTexto: CT.blanco, colorAcento: CT.oro, colorFondo: CT.pizarra, colorSobreAcento: CT.blanco, logo: "casa-tomas-logo-blanco.png", posicionLogo: "esquina" },
      touza: { tipo: "bloque", titular: "montserrat-seminegrita", texto: "montserrat-medio", antetitulo: "montserrat-medio", mayusculasTitular: true, escalaTitular: 0.06, alinear: "izquierda", colorTexto: TZ.negro, colorAcento: TZ.negro, colorFondo: TZ.oro, colorSobreAcento: TZ.crema, logo: "touza-cruz-tau-negro.png", posicionLogo: "esquina" },
    },
    ritmo: { segundosPorPlano: 1.4, transicion: "deslizar", duracionTransicion: 0.35, movimiento: 0.8 },
  },
  promocion: {
    id: "promocion",
    nombre: "Promoción o evento",
    descripcion: "Imagen luminosa y viva; cartel con titular grande, dato del evento y llamada a la acción destacada.",
    usoRecomendado: "Eventos, fechas señaladas, menús de temporada y anuncios.",
    tratamiento: {
      "casa-tomas": t({ exposicion: 0.12, contraste: 0.2, saturacion: 0.2, temperatura: 0.05, vineta: 0.1, nitidez: 0.4 }),
      touza: t({ exposicion: 0.05, contraste: 0.3, saturacion: 0.15, temperatura: 0.1, vineta: 0.25, nitidez: 0.4 }),
    },
    composicion: {
      "casa-tomas": { tipo: "cartel", titular: "baskerville-seminegrita", texto: "montserrat-medio", antetitulo: "montserrat-seminegrita", mayusculasTitular: false, escalaTitular: 0.085, alinear: "centro", colorTexto: CT.blanco, colorAcento: CT.oro, colorFondo: "rgba(57,65,71,0.72)", colorSobreAcento: CT.blanco, logo: "casa-tomas-logo-blanco.png", posicionLogo: "arriba" },
      touza: { tipo: "cartel", titular: "cormorant-titular", texto: "montserrat-medio", antetitulo: "montserrat-seminegrita", mayusculasTitular: false, escalaTitular: 0.1, alinear: "centro", colorTexto: TZ.crema, colorAcento: TZ.blanco, colorFondo: "rgba(10,10,10,0.7)", colorSobreAcento: TZ.negro, logo: "touza-cruz-tau-oro.png", posicionLogo: "arriba" },
    },
    ritmo: { segundosPorPlano: 1.8, transicion: "zoom", duracionTransicion: 0.4, movimiento: 0.6 },
  },
  minimalista: {
    id: "minimalista",
    nombre: "Minimalista",
    descripcion: "Luz limpia y color contenido; rótulo pequeño con mucho aire y sin adornos.",
    usoRecomendado: "Producto aislado, botellas, detalles de sala y emplatados limpios.",
    tratamiento: {
      "casa-tomas": t({ exposicion: 0.15, contraste: -0.05, saturacion: -0.2, negros: 0.1, nitidez: 0.2 }),
      touza: t({ exposicion: 0, contraste: 0.1, saturacion: -0.25, negros: 0.05, nitidez: 0.2 }),
    },
    composicion: {
      "casa-tomas": { tipo: "minimo", titular: "baskerville", texto: "baskerville", antetitulo: "montserrat-medio", mayusculasTitular: false, escalaTitular: 0.045, alinear: "izquierda", colorTexto: CT.pizarra, colorAcento: CT.oro, colorFondo: "rgba(255,255,255,0)", colorSobreAcento: CT.blanco, logo: "casa-tomas-logo-negro.png", posicionLogo: "esquina" },
      touza: { tipo: "minimo", titular: "cormorant-titular", texto: "montserrat-medio", antetitulo: "montserrat-medio", mayusculasTitular: false, escalaTitular: 0.055, alinear: "izquierda", colorTexto: TZ.crema, colorAcento: TZ.oro, colorFondo: "rgba(10,10,10,0)", colorSobreAcento: TZ.negro, logo: "touza-cruz-tau-crema.png", posicionLogo: "esquina" },
    },
    ritmo: { segundosPorPlano: 3.2, transicion: "fundido", duracionTransicion: 0.8, movimiento: 0.2 },
  },
  marca: {
    id: "marca",
    nombre: "Identidad de la marca",
    descripcion: "Los colores, el logo y la tipografía de la casa: marco fino de oro, medallón y titular con serifa.",
    usoRecomendado: "Piezas institucionales, la casa, el equipo y cualquier contenido que deba sonar a la marca.",
    tratamiento: {
      "casa-tomas": t({ contraste: 0.15, temperatura: 0.1, vineta: 0.2, nitidez: 0.3 }),
      touza: t({ exposicion: -0.1, contraste: 0.3, saturacion: -0.1, temperatura: 0.15, vineta: 0.45, nitidez: 0.3 }),
    },
    composicion: {
      "casa-tomas": { tipo: "marco", titular: "baskerville-seminegrita", texto: "baskerville-cursiva", antetitulo: "montserrat-medio", mayusculasTitular: false, escalaTitular: 0.065, alinear: "centro", colorTexto: CT.blanco, colorAcento: CT.oro, colorFondo: "rgba(57,65,71,0.88)", colorSobreAcento: CT.blanco, logo: "casa-tomas-medallon-oro.png", posicionLogo: "arriba" },
      touza: { tipo: "marco", titular: "cormorant-titular", texto: "cormorant-cursiva", antetitulo: "montserrat-medio", mayusculasTitular: true, escalaTitular: 0.075, alinear: "centro", colorTexto: TZ.crema, colorAcento: TZ.oro, colorFondo: "rgba(10,10,10,0.88)", colorSobreAcento: TZ.negro, logo: "touza-cruz-tau-oro.png", posicionLogo: "arriba" },
    },
    ritmo: { segundosPorPlano: 2.2, transicion: "fundido", duracionTransicion: 0.5, movimiento: 0.4 },
  },
};

export function esEstilo(v: unknown): v is EstiloId {
  return typeof v === "string" && (ESTILOS_IDS as readonly string[]).includes(v);
}

const limitar = (v: number, min: number, max: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : 0);

/** Limita cada campo a su rango (los de [-1, 1] y los de [0, 1]). */
export function limitarTratamiento(p: Partial<Tratamiento> | null | undefined): Tratamiento {
  const v = { ...TRATAMIENTO_NEUTRO, ...(p ?? {}) };
  return {
    exposicion: limitar(Number(v.exposicion), -1, 1),
    contraste: limitar(Number(v.contraste), -1, 1),
    saturacion: limitar(Number(v.saturacion), -1, 1),
    temperatura: limitar(Number(v.temperatura), -1, 1),
    negros: limitar(Number(v.negros), 0, 1),
    vineta: limitar(Number(v.vineta), 0, 1),
    nitidez: limitar(Number(v.nitidez), 0, 1),
  };
}

/** Corrección de la foto + tratamiento del estilo, limitado. */
export function sumarTratamientos(a: Partial<Tratamiento>, b: Partial<Tratamiento>): Tratamiento {
  const x = limitarTratamiento(a);
  const y = limitarTratamiento(b);
  return limitarTratamiento({
    exposicion: x.exposicion + y.exposicion,
    contraste: x.contraste + y.contraste,
    saturacion: x.saturacion + y.saturacion,
    temperatura: x.temperatura + y.temperatura,
    negros: x.negros + y.negros,
    vineta: Math.max(x.vineta, y.vineta),
    nitidez: Math.max(x.nitidez, y.nitidez),
  });
}

// ── Correspondencia con el motor (mismas cuentas en foto, vídeo y vista previa) ──

/** Factores que usa el motor de fotos (sharp). */
export function factoresFoto(tr: Tratamiento) {
  const contraste = 1 + 0.3 * tr.contraste;
  return {
    brillo: 1 + 0.25 * tr.exposicion,
    saturacion: Math.max(0, 1 + 0.4 * tr.saturacion),
    /** linear(a, b) alrededor del gris medio, con los negros levantados (mate). */
    linealA: contraste * (1 - 0.1 * tr.negros),
    linealB: 128 * (1 - contraste) + 22 * tr.negros,
    /** Multiplicadores de rojo y azul (temperatura). */
    rojo: 1 + 0.08 * tr.temperatura,
    azul: 1 - 0.1 * tr.temperatura,
    vineta: tr.vineta,
    nitidezSigma: tr.nitidez > 0.01 ? 0.5 + tr.nitidez : 0,
  };
}

/** Filtros de ffmpeg equivalentes (para vídeos y piezas animadas). */
export function filtrosVideo(tr: Tratamiento): string[] {
  const f = factoresFoto(tr);
  const filtros: string[] = [];
  // eq: brillo aditivo (−1…1), contraste y saturación multiplicativos.
  filtros.push(
    `eq=brightness=${(0.07 * tr.exposicion + 0.025 * tr.negros).toFixed(3)}:contrast=${(f.linealA).toFixed(3)}:saturation=${f.saturacion.toFixed(3)}`,
  );
  if (Math.abs(tr.temperatura) > 0.01) {
    filtros.push(`colorbalance=rm=${(0.1 * tr.temperatura).toFixed(3)}:bm=${(-0.12 * tr.temperatura).toFixed(3)}:rh=${(0.05 * tr.temperatura).toFixed(3)}:bh=${(-0.06 * tr.temperatura).toFixed(3)}`);
  }
  if (tr.nitidez > 0.01) filtros.push(`unsharp=5:5:${(0.4 + 0.8 * tr.nitidez).toFixed(2)}:5:5:0`);
  if (tr.vineta > 0.01) filtros.push(`vignette=angle=${(0.25 + 0.5 * tr.vineta).toFixed(3)}`);
  return filtros;
}

/**
 * Aproximación en CSS del tratamiento, para ver el estilo sobre tus fotos
 * antes de generar (la foto editada de verdad la hace el motor).
 */
export function previaCss(tr: Tratamiento): { filter: string; vineta: number; mate: number } {
  const f = factoresFoto(tr);
  const calido = Math.max(0, tr.temperatura);
  const frio = Math.max(0, -tr.temperatura);
  const partes = [
    `brightness(${f.brillo.toFixed(3)})`,
    `contrast(${(1 + 0.3 * tr.contraste).toFixed(3)})`,
    `saturate(${f.saturacion.toFixed(3)})`,
  ];
  if (calido > 0) partes.push(`sepia(${(0.22 * calido).toFixed(3)})`);
  if (frio > 0) partes.push(`hue-rotate(${(-10 * frio).toFixed(1)}deg)`);
  return { filter: partes.join(" "), vineta: tr.vineta, mate: tr.negros };
}

export function estilo(id: EstiloId): Estilo {
  return ESTILOS[id];
}
