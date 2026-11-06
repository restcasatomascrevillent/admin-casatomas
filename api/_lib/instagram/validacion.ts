/**
 * Validaciones ANTES de gastar cuota (portado de instagram-studio/src/publicar/validacion.ts).
 * Caption: ≤ 2200 caracteres, ≤ 30 hashtags, ≤ 20 menciones; texto alternativo ≤ 1000.
 *
 * FUENTE ÚNICA de estas reglas: la usan la Edge Function (instagram-publicar),
 * el panel (src/components/marketing/instagram/contadores.ts la importa) y,
 * como COPIA IDÉNTICA, la función de Vercel (api/_lib/instagram/validacion.ts):
 * Vercel no puede importar de supabase/functions. El test
 * api/_lib/__tests__/copias-instagram.test.ts falla si la copia diverge.
 */
export type TipoPublicacion = "post" | "story";

export const LIMITES_CAPTION = { caracteres: 2200, hashtags: 30, menciones: 20 } as const;
export const MAX_BYTES_IMAGEN = 8 * 1024 * 1024;

const RE_HASHTAG = /(?:^|[^\p{L}\p{N}_&#])#[\p{L}\p{N}_]+/gu;
const RE_MENCION = /(?:^|[^\p{L}\p{N}_.@])@[A-Za-z0-9._]{1,30}/gu;

export function contarHashtags(texto: string): number {
  return texto.match(RE_HASHTAG)?.length ?? 0;
}

export function contarMenciones(texto: string): number {
  return texto.match(RE_MENCION)?.length ?? 0;
}

export interface ResultadoCaption {
  ok: boolean;
  errores: string[];
  avisos: string[];
  caracteres: number;
  hashtags: number;
  menciones: number;
}

export function validarCaption(texto: string, tipo: TipoPublicacion = "post"): ResultadoCaption {
  const errores: string[] = [];
  const avisos: string[] = [];
  // Puntos de código (un emoji = 1). Meta no documenta si cuenta UTF-16.
  const caracteres = [...texto].length;
  const hashtags = contarHashtags(texto);
  const menciones = contarMenciones(texto);
  if (caracteres > LIMITES_CAPTION.caracteres) errores.push(`El texto tiene ${caracteres} caracteres; el máximo es ${LIMITES_CAPTION.caracteres}.`);
  if (hashtags > LIMITES_CAPTION.hashtags) errores.push(`El texto tiene ${hashtags} hashtags; el máximo es ${LIMITES_CAPTION.hashtags}.`);
  if (menciones > LIMITES_CAPTION.menciones) errores.push(`El texto tiene ${menciones} menciones (@); el máximo es ${LIMITES_CAPTION.menciones}.`);
  if (tipo === "story" && texto.trim()) avisos.push("Las stories no admiten texto por la API: el texto se ignorará.");
  if (tipo === "post" && !texto.trim()) avisos.push("La publicación no lleva texto (caption vacío).");
  return { ok: errores.length === 0, errores, avisos, caracteres, hashtags, menciones };
}

/**
 * Texto alternativo de la imagen (alt_text de la Graph API, solo en posts de
 * imagen; las stories no lo admiten). Meta lo limita a 1000 caracteres.
 */
export const MAX_ALT_TEXT = 1000;

export interface ResultadoAltText {
  ok: boolean;
  errores: string[];
  avisos: string[];
  caracteres: number;
}

export function validarAltText(texto: string, tipo: TipoPublicacion = "post"): ResultadoAltText {
  const errores: string[] = [];
  const avisos: string[] = [];
  const caracteres = [...texto].length;
  if (caracteres > MAX_ALT_TEXT) errores.push(`El texto alternativo tiene ${caracteres} caracteres; el máximo es ${MAX_ALT_TEXT}.`);
  if (tipo === "story" && texto.trim()) avisos.push("Las stories no admiten texto alternativo por la API: se ignorará.");
  return { ok: errores.length === 0, errores, avisos, caracteres };
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function esUuid(v: unknown): v is string {
  return typeof v === "string" && RE_UUID.test(v);
}
