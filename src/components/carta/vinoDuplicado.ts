import { anadaDeNombre } from "./parker/parker";

/**
 * ¿Este vino ya está en la carta? (11/11/2026, petición del dueño: «Revisar si
 * se suben botellas de la misma pero diferente añada no salta duplicada»).
 * Hasta hoy el panel no avisaba nunca: ni con otra añada (bien) ni con la
 * misma (mal). Regla:
 * - Mismo vino = mismo nombre sin el año (sin tildes, mayúsculas ni signos) y
 *   misma añada. Un formato distinto («(Magnum)») es otro vino.
 * - Distinta añada NO es duplicado: «Pago de Carraovejas 2020» y «… 2021»
 *   conviven. Los dos sin añada, sí. Uno con añada y otro sin ella, no.
 * - La añada es la del campo «Añada que se sirve» y, si está vacío, el último
 *   año del nombre. «Sin añada (NV)» cuenta como sin añada.
 * Solo avisa (VinoForm): guardar sigue permitido.
 */

export interface VinoComparable {
  id?: string | null;
  nombre?: string | null;
  /** Añada que se sirve: número (BD) o texto del formulario («2021», ""). */
  anada?: unknown;
  sin_anada?: boolean | null;
}

const ANO = /\b(?:19|20)\d{2}\b/g;

/** Nombre para comparar: sin años, tildes, mayúsculas ni signos. */
export function nombreBaseVino(nombre: string | null | undefined): string {
  return String(nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(ANO, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Añada del vino: la del campo y, si no hay, la del nombre; NV o ninguna → null. */
export function anadaDeVino(v: VinoComparable): number | null {
  if (v.sin_anada === true) return null;
  const campo =
    typeof v.anada === "number" ? v.anada : typeof v.anada === "string" && /^\s*\d{4}\s*$/.test(v.anada) ? Number(v.anada) : NaN;
  if (Number.isInteger(campo) && campo >= 1900 && campo <= 2100) return campo;
  return anadaDeNombre(v.nombre);
}

export function esMismoVino(a: VinoComparable, b: VinoComparable): boolean {
  const base = nombreBaseVino(a.nombre);
  return base !== "" && base === nombreBaseVino(b.nombre) && anadaDeVino(a) === anadaDeVino(b);
}

/** El primer vino de la carta que sería un duplicado de `nuevo` (sin contarse a sí mismo). */
export function buscarVinoDuplicado<T extends VinoComparable>(
  nuevo: VinoComparable,
  carta: readonly T[] | null | undefined,
): T | null {
  if (!nombreBaseVino(nuevo.nombre)) return null;
  return (carta ?? []).find((v) => (!nuevo.id || v.id !== nuevo.id) && esMismoVino(nuevo, v)) ?? null;
}

/** Texto del aviso en el formulario. */
export function avisoVinoDuplicado(duplicado: VinoComparable & { activado?: boolean | null }): string {
  const nombre = `«${String(duplicado.nombre ?? "").trim()}»${duplicado.activado === false ? " (desactivado)" : ""}`;
  const anada = anadaDeVino(duplicado);
  return anada !== null
    ? `Ya está en la carta: ${nombre}, de la misma añada (${anada}). Si la botella es de otra añada, cámbiala en «Añada que se sirve».`
    : `Ya está en la carta: ${nombre}, también sin añada. Si la botella tiene añada, ponla en «Añada que se sirve».`;
}
