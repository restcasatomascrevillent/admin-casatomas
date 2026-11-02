/**
 * Máximos de los textos que la BD también exige (CHECK de
 * supabase/migrations/20261101180000_restricciones_novedades_espacios.sql).
 * Si cambias uno aquí, cámbialo también en una migración nueva: el formulario
 * y la BD tienen que decir lo mismo.
 */
export const MAX_NOMBRE = 150;
export const MAX_DESCRIPCION = 2000;
export const MAX_ETIQUETA = 40;

export interface CampoTexto {
  /** Cómo se nombra el campo en el mensaje: «El título en inglés». */
  etiqueta: string;
  valor: string | null | undefined;
  max: number;
}

// A mano: `toLocaleString("es-ES")` no separa los miles de 4 cifras (2000).
export const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * Mensajes en castellano de los campos que pasan de su máximo (vacío si todo
 * cabe). Cuenta caracteres como `char_length` de Postgres (puntos de código).
 */
export function erroresLongitud(campos: readonly CampoTexto[]): string[] {
  return campos.flatMap(({ etiqueta, valor, max }) => {
    const largo = valor ? Array.from(valor).length : 0;
    return largo > max
      ? [`${etiqueta} no puede pasar de ${miles(max)} caracteres (tiene ${miles(largo)}).`]
      : [];
  });
}

interface TextosNovedad {
  titulo: string | null;
  titulo_en: string | null;
  titulo_fr: string | null;
  descripcion: string | null;
  descripcion_en: string | null;
  descripcion_fr: string | null;
  badge_text: string | null;
  badge_text_en: string | null;
  badge_text_fr: string | null;
}

/** Errores de longitud de una novedad, en el orden en que salen en el formulario. */
export function erroresLongitudNovedad(n: TextosNovedad): string[] {
  return erroresLongitud([
    { etiqueta: "El título", valor: n.titulo, max: MAX_NOMBRE },
    { etiqueta: "La etiqueta de la tarjeta", valor: n.badge_text, max: MAX_ETIQUETA },
    { etiqueta: "La descripción", valor: n.descripcion, max: MAX_DESCRIPCION },
    { etiqueta: "El título en inglés", valor: n.titulo_en, max: MAX_NOMBRE },
    { etiqueta: "La etiqueta en inglés", valor: n.badge_text_en, max: MAX_ETIQUETA },
    { etiqueta: "La descripción en inglés", valor: n.descripcion_en, max: MAX_DESCRIPCION },
    { etiqueta: "El título en francés", valor: n.titulo_fr, max: MAX_NOMBRE },
    { etiqueta: "La etiqueta en francés", valor: n.badge_text_fr, max: MAX_ETIQUETA },
    { etiqueta: "La descripción en francés", valor: n.descripcion_fr, max: MAX_DESCRIPCION },
  ]);
}
