/**
 * Contrato «Montar con IA» (05/11/2026): el usuario sube o elige 1–10 fotos y
 * la IA monta la publicación entera (formato, orden, plantilla y rótulos de
 * cada imagen, texto, hashtags y textos alternativos) con el contexto del
 * negocio (guía de marca, carta, vinos, fechas y «Qué funciona»).
 *
 * Lo comparten el panel (src/components/instagram/crear, …/movil) y la Edge
 * Function instagram-ia (acción "montar_pieza"), que guarda una copia
 * literal en supabase/functions/_shared/instagram/montar.ts (un test
 * comprueba que son iguales). Solo tipos y constantes: sin dependencias.
 */
import type { MarcaId } from "./tokens";

/** Formatos que puede montar la IA. El reel va por su propio editor. */
export type FormatoMontado = "post" | "carrusel" | "story";

/** Máximo de imágenes de un carrusel en Instagram. */
export const MAX_FOTOS_CARRUSEL = 10;

/** Una foto ya preparada en el bucket (tmp/) o de la carta. */
export interface FotoParaMontar {
  /** «drive:<id>», «carta:<id>», «vino:<id>» o «subida:<uuid>». */
  id: string;
  /** URL pública preparada en el bucket instagram de NUESTRO Supabase (tmp/…) o de platos/vinos. */
  url: string;
  ancho?: number | null;
  alto?: number | null;
}

export interface PeticionMontar {
  accion: "montar_pieza";
  marca: MarcaId;
  fotos: FotoParaMontar[];
  /** «auto» deja elegir a la IA (1 foto → post; 2–10 → carrusel). */
  formato?: FormatoMontado | "auto";
  /** Indicación libre del usuario: «llegó bonito del Cantábrico», «para el finde»… (≤ 500). */
  indicacion?: string;
  /** Tono: cercano | elegante | retranca. */
  tono?: "cercano" | "elegante" | "retranca";
}

/** Una imagen de la publicación montada (un post tiene 1; un carrusel, 2–10). */
export interface DiapositivaMontada {
  /** id de una de las fotos recibidas. */
  foto: string;
  /** id de plantilla de src/lib/instagram/plantillas válida para la marca y el formato. */
  plantilla: string;
  /** Rótulos de la plantilla (los mismos campos que DatosPieza: antetitulo, titular, cita, cta, pie…). */
  datos: Record<string, unknown>;
  /** Texto alternativo de ESTA imagen, describiendo lo que se ve. */
  altText: string;
}

export interface RespuestaMontar {
  ok: true;
  formato: FormatoMontado;
  /** En el orden en que se publican. La primera es la portada. */
  diapositivas: DiapositivaMontada[];
  caption: string;
  hashtags: string[];
  /** ISO en Europe/Madrid, si «Qué funciona» o el calendario sugieren una hora. */
  horaSugerida?: string | null;
  /** Qué ha entendido de las fotos, en una frase (para enseñarlo y que el usuario corrija). */
  resumen: string;
  avisos: string[];
}

export interface ErrorMontar {
  ok: false;
  error: string;
  /** p. ej. «cupo», «foto_no_valida», «ia_no_disponible». */
  tipo?: string;
}
