/**
 * Copia en el servidor de los rótulos de los EJEMPLOS del panel
 * (src/lib/instagram/ejemplos.ts; las Edge Functions no pueden importar de
 * src/). Sirve para avisar cuando una pieza sigue llevando los rótulos del
 * ejemplo con el que se abrió el editor («Nuestros espacios / Un entorno
 * para cada ocasión» sobre la foto de una botella de vino): la IA no los usa
 * como pista y propone otros acordes a la foto.
 *
 * Solo antetítulo, titular, cita y pie (las CTA son de la lista de la marca y
 * valen para cualquier pieza). El test instagram-ia/__tests__/ejemplos.test.ts
 * falla si esta copia se separa de EJEMPLOS: si cambias un ejemplo, cámbialo
 * también aquí.
 */
import type { MarcaIA, Rotulos } from "../_shared/instagram/validar-ia.ts";

export const CAMPOS_EJEMPLO = ["antetitulo", "titular", "cita", "pie"] as const;

export const ROTULOS_EJEMPLO: Readonly<Record<MarcaIA, readonly string[]>> = {
  "casa-tomas": [
    "Cada jueves por la noche",
    "Brasa, sal y paciencia",
    "Chuleta de vaca madurada",
    "Cocina gallega · Marisco · Crevillente",
    "De nuestra carta",
    "De padres a hijos",
    "Desde 1998",
    "Mucho más que un restaurante",
    "Nuestros espacios",
    "Nunca é longo o camiño que conduce á casa dun amigo.",
    "Tapas de los jueves",
    "Un entorno para cada ocasión",
  ],
  touza: [
    "Ambiente nocturno",
    "Cocktail bar · Crevillente",
    "Cócteles de autor",
    "De autor",
    "Donde la alquimia de los cócteles se encuentra con la excelencia.",
    "Horario",
    "Para empezar la noche",
    "Sofá, mármol y luz baja",
    "Te esperamos en Touza",
    "Un rincón para quedarse",
    "Un sitio para quedarse",
  ],
};

const plegar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();

/** Campos de la pieza cuyo texto es el de un ejemplo de la marca (vacío si ninguno). */
export function rotulosDeEjemplo(marca: MarcaIA, textos: Rotulos): string[] {
  const ejemplos = new Set(ROTULOS_EJEMPLO[marca].map(plegar));
  return CAMPOS_EJEMPLO.filter((c) => {
    const v = textos[c];
    return typeof v === "string" && v.trim() !== "" && ejemplos.has(plegar(v));
  });
}
