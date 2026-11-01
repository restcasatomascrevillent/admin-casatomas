// Máximos de los textos de la carta (Bebidas y Cocteles).
// ---------------------------------------------------------------------------
// Son LOS MISMOS números que los CHECK de la migración
// supabase/migrations/*_restricciones_bebidas_cocteles.sql. Si cambia uno,
// hay que cambiar el otro: la prueba `npm run test:restricciones-carta:db`
// compara esta tabla con la migración y falla si no coinciden.
//
// Suposiciones de la tarea (Pablo puede cambiarlas): nombre 150,
// descripción 2.000, precio 0–9.999,99. El resto se ha elegido con margen
// sobre lo que hay hoy en la demo (el más largo de cada columna entre
// paréntesis, 01/11/2026).
// ---------------------------------------------------------------------------
import { z } from "zod";

export const LIMITES_CARTA = {
  nombre: 150, // (45)
  categoria: 100, // (17)
  descripcion: 2000, // (105)
  tamano: 30, // (4)
  tipo: 100, // (22)
  tag: 50, // (11)
  base: 100, // (11)
  ingredientes: 2000, // (91)
  preparacion: 2000, // (vacío)
  alergenosNotas: 500, // (vacío)
  /** Largo de cada alérgeno de la lista. */
  alergeno: 60,
  /** Cuántos alérgenos puede tener una lista. */
  alergenosMax: 30,
  imagenUrl: 2048,
} as const;

export const PRECIO_MAXIMO_CARTA = 9999.99;

const maximo = (n: number) => `Como máximo ${n} caracteres`;

/** Texto obligatorio: sin recortar a la vista, pero rechaza vacío o solo espacios. */
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
