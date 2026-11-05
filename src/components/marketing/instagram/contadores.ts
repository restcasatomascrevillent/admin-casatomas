/**
 * Contadores del texto de la publicación en el panel. Las REGLAS (límites y
 * cómo se cuentan hashtags y menciones) salen de la misma fuente que usa el
 * servidor al publicar: supabase/functions/_shared/instagram/validacion.ts.
 * Aquí solo están los textos para el usuario.
 */
import { LIMITES_CAPTION, MAX_ALT_TEXT, contarHashtags, contarMenciones } from "../../../../supabase/functions/_shared/instagram/validacion";

export { MAX_ALT_TEXT, contarHashtags, contarMenciones };

/** Límites de Instagram para el texto del post (caption). */
export const MAX_CAPTION = LIMITES_CAPTION.caracteres;
export const MAX_HASHTAGS = LIMITES_CAPTION.hashtags;
export const MAX_MENCIONES = LIMITES_CAPTION.menciones;
/** Palabras recomendadas del titular: más no cabe en la plantilla sin desbordarse. */
export const MAX_PALABRAS_TITULAR = 6;

/** Caracteres «de verdad» (un emoji cuenta como uno, como en Instagram y en el servidor). */
export function contarCaracteres(texto: string): number {
  return Array.from(texto).length;
}

export function contarPalabras(texto: string): number {
  const t = texto.trim();
  return t ? t.split(/\s+/u).length : 0;
}

export interface ResumenCaption {
  caracteres: number;
  hashtags: number;
  menciones: number;
  problemas: string[];
}

export function resumenCaption(texto: string): ResumenCaption {
  const caracteres = contarCaracteres(texto);
  const hashtags = contarHashtags(texto);
  const menciones = contarMenciones(texto);
  const problemas: string[] = [];
  if (caracteres > MAX_CAPTION) problemas.push(`El texto pasa de ${MAX_CAPTION} caracteres: acórtalo.`);
  if (hashtags > MAX_HASHTAGS) problemas.push(`Hay más de ${MAX_HASHTAGS} hashtags: Instagram no lo publicaría.`);
  if (menciones > MAX_MENCIONES) problemas.push(`Hay más de ${MAX_MENCIONES} menciones: quita alguna.`);
  return { caracteres, hashtags, menciones, problemas };
}

/** Problemas del texto alternativo (vacío = sin problemas). */
export function problemasAltText(texto: string): string[] {
  const n = contarCaracteres(texto);
  return n > MAX_ALT_TEXT ? [`El texto alternativo pasa de ${MAX_ALT_TEXT} caracteres: acórtalo.`] : [];
}
