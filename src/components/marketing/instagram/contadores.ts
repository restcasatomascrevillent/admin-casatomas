/** Límites de Instagram para el texto del post (caption). */
export const MAX_CAPTION = 2200;
export const MAX_HASHTAGS = 30;
export const MAX_MENCIONES = 20;
/** Palabras recomendadas del titular: más no cabe en la plantilla sin desbordarse. */
export const MAX_PALABRAS_TITULAR = 6;

/** Caracteres «de verdad» (un emoji cuenta como uno, como en Instagram). */
export function contarCaracteres(texto: string): number {
  return Array.from(texto).length;
}

export function contarPalabras(texto: string): number {
  const t = texto.trim();
  return t ? t.split(/\s+/u).length : 0;
}

export function contarHashtags(texto: string): number {
  // Misma expresión que el servidor (api/_lib/instagram/validacion.ts).
  return (texto.match(/(?:^|[^\p{L}\p{N}_&#])#[\p{L}\p{N}_]+/gu) ?? []).length;
}

export function contarMenciones(texto: string): number {
  return (texto.match(/(?:^|[^\p{L}\p{N}_.@])@[A-Za-z0-9._]{1,30}/gu) ?? []).length;
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
