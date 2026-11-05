/**
 * Temas de color y tipografía de los reels y textos fijos de cada marca.
 *
 * Los temas son los de marca-base/reel-kit.jsx (THEMES) TAL CUAL: el oro de
 * Casa Tomás en vídeo es el oficial #B6852F (no el #8e6725 de las imágenes del
 * panel; decisión abierta 2 de la propuesta). Las fuentes son las del panel
 * (public/instagram/fuentes, @font-face de tokens.ts): nada de Google Fonts.
 *
 * Los textos que en los reels del dueño iban escritos a mano (teléfono, @,
 * dirección y «EST. 2023 · CREVILLENTE») salen de aquí: si cambian, se cambian
 * en un sitio. OJO: el marco de Touza dice «Crevillente» y el resto del
 * material «Crevillent» (pendiente de que el dueño elija; se respeta el reel).
 */
import { generarFontFaces, type MarcaId } from "../tokens.js";

export type MarcaReel = MarcaId;

export interface TemaReel {
  oro: string;
  oroClaro: string;
  titular: string;
  pesoTitular: number;
  texto: string;
  /** rgb del velo del cierre (sin alfa). */
  velo: string;
  ctaFondo: string;
  ctaTexto: string;
  /** rgb del fondo del rótulo «caja» (sin alfa). */
  caja: string;
}

/** reel-kit.jsx → THEMES.casa / THEMES.touza */
export const TEMAS_REEL: Record<MarcaReel, TemaReel> = {
  "casa-tomas": {
    oro: "#B6852F",
    oroClaro: "#E7C98C",
    titular: '"Libre Baskerville","Bodoni MT",serif',
    pesoTitular: 700,
    texto: '"Montserrat",sans-serif',
    velo: "34,39,42",
    ctaFondo: "#B6852F",
    ctaTexto: "#fff",
    caja: "10,10,10",
  },
  touza: {
    oro: "#D49A35",
    oroClaro: "#DAB981",
    titular: '"Cormorant Garamond",serif',
    pesoTitular: 600,
    texto: '"Montserrat",sans-serif',
    velo: "10,10,10",
    ctaFondo: "#fff",
    ctaTexto: "#000",
    caja: "0,0,0",
  },
};

export interface DatosMarcaReel {
  nombre: string;
  /** Línea de datos del cierre por defecto (teléfono o dirección · @). */
  datosCierre: string;
  /** Rótulo superior del marco «premium» (solo Touza). */
  rotuloMarco?: string;
  /** Lema en gallego (firma emocional para aperturas y cierres; readme). */
  lema?: string;
}

/** Textos fijos de cada marca (antes escritos a mano en cada REEL_CONFIG). */
export const DATOS_MARCA_REEL: Record<MarcaReel, DatosMarcaReel> = {
  "casa-tomas": {
    nombre: "Casa Tomás",
    datosCierre: "966 10 78 87 · @casatomascrevillent",
    lema: "Nunca é longo o camiño que conduce á casa dun amigo.",
  },
  touza: {
    nombre: "Touza",
    datosCierre: "C/ San Vicente, 14 · @touzabar",
    rotuloMarco: "EST. 2023 · CREVILLENTE",
  },
};

/** CTA del cierre: lista cerrada (CTAs de marca-base/readme.md). */
export const CTAS_REEL = [
  "Reservar mesa",
  "Reservar",
  "Reservar ahora",
  "Ver carta",
  "Ver la carta completa",
  "El Reservado",
  "Comprar cheque regalo",
  "Llamar",
] as const;
export type CtaReel = (typeof CTAS_REEL)[number];

/** @font-face de las tres familias de los reels (Libre Baskerville, Cormorant, Montserrat), servidas por el panel. */
export function cssFuentesReel(baseRecursos = "/instagram"): string {
  return `${generarFontFaces("casa-tomas", { baseRecursos })}
${generarFontFaces("touza", { baseRecursos })}`;
}
