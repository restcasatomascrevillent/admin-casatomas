import * as z from "zod";

/**
 * Máximos de los textos y del precio de la carta (Platos y Vinos).
 *
 * Son LOS MISMOS que imponen las restricciones CHECK de la base de datos
 * (supabase/migrations/20261101220000_restricciones_platos_vinos.sql). Si se
 * cambia uno aquí, hay que cambiarlo también allí con otra migración: si el
 * formulario deja pasar más que la BD, el guardado falla con un error de
 * Postgres en vez de con el mensaje en castellano junto al campo.
 */
export const MAX_NOMBRE_CARTA = 150;
export const MAX_DESCRIPCION_CARTA = 2000;
export const MAX_PRECIO_CARTA = 9999.99;

/** Nombre obligatorio: sin espacios a los lados, de 1 a 150 caracteres. */
export const nombreCarta = z
  .string()
  .trim()
  .min(1, "El nombre es obligatorio")
  .max(MAX_NOMBRE_CARTA, `El nombre no puede pasar de ${MAX_NOMBRE_CARTA} caracteres`);

/** Categoría obligatoria (no vale solo con espacios). */
export const categoriaCarta = z.string().trim().min(1, "La categoría es obligatoria");

/** Descripción opcional de hasta 2.000 caracteres. */
export const descripcionCarta = z
  .string()
  .max(
    MAX_DESCRIPCION_CARTA,
    `La descripción no puede pasar de ${MAX_DESCRIPCION_CARTA.toLocaleString("es-ES")} caracteres`,
  )
  .optional();

export const mensajePrecioMaximo = `El precio no puede pasar de ${MAX_PRECIO_CARTA.toLocaleString("es-ES", {
  minimumFractionDigits: 2,
})} €`;

// ---------------------------------------------------------------------------
// Bebidas y Cocteles (tarea 40b3221d, 2/3)
// ---------------------------------------------------------------------------
// Los mismos números que los CHECK de
// supabase/migrations/20261102120000_restricciones_bebidas_cocteles.sql; la
// prueba `npm run test:restricciones-bebidas:db` los compara con la migración.
// Entre paréntesis, el más largo en la demo el 01/11/2026.
export const LIMITES_CARTA = {
  nombre: MAX_NOMBRE_CARTA, // (45)
  categoria: 100, // (17)
  descripcion: MAX_DESCRIPCION_CARTA, // (105)
  tamano: 30, // (4)
  tipo: 100, // (22)
  tag: 50, // (11)
  base: 100, // (11)
  ingredientes: 2000, // (91)
  preparacion: 2000, // (vacío)
  alergenosNotas: 500, // (vacío)
  /** Largo de cada alérgeno: el de public.alergenos_bien_formados (1/3). */
  alergeno: 100,
  imagenUrl: 2048,
} as const;

const maximo = (n: number) => `Como máximo ${n} caracteres`;

/** Texto obligatorio: rechaza vacío o solo espacios y lo que pase del máximo. */
export const textoObligatorio = (max: number, obligatorio: string) =>
  z
    .string({ required_error: obligatorio })
    .refine((v) => v.trim().length > 0, obligatorio)
    .refine((v) => v.length <= max, maximo(max));

/** Texto opcional con máximo. */
export const textoOpcional = (max: number) =>
  z.string().max(max, maximo(max)).optional();

/** Mensaje si un alérgeno escrito a mano no cabe; null si vale. */
export function errorAlergenoPersonalizado(valor: string): string | null {
  return valor.trim().length > LIMITES_CARTA.alergeno
    ? `Cada alérgeno, como máximo ${LIMITES_CARTA.alergeno} caracteres`
    : null;
}
