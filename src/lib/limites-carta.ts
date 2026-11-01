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
