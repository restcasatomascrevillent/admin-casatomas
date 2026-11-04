import * as z from "zod";
import { categoriaCarta } from "@/lib/limites-carta";
import { esCategoriaOrigenPendiente } from "@/lib/tipos-vino";

/**
 * Origen obligatorio de los vinos (04/11/2026, dueño: «deja de subir vinos si
 * el origen no está claro, no puede haber en web publicada vinos sin origen
 * porque si no el mapa no los va a leer»).
 *
 * Origen claro = país y región escritos (es lo que lee el mapa de la web,
 * MapaMundoVinos) y una categoría con su denominación (no vacía ni una de
 * «… — ORIGEN PENDIENTE»). Sin origen claro no se guarda ningún vino desde el
 * panel (alta a mano, con IA o en lote, y edición) ni se enciende
 * «Restaurante» o «Touza». La base de datos también lo exige para publicar
 * (país, región y categoría sin «ORIGEN PENDIENTE»; trigger
 * vinos_publicacion_por_carta, migración 20261104100000).
 */

export interface OrigenVino {
  categoria?: string | null;
  ubicacion_pais?: string | null;
  ubicacion_region?: string | null;
}

export type FaltaOrigen = "pais" | "region" | "categoria";

const vacio = (texto: string | null | undefined) => !texto?.trim();

/** Qué le falta al origen del vino (vacío = origen claro). */
export function faltasOrigenVino(vino: OrigenVino): FaltaOrigen[] {
  const faltas: FaltaOrigen[] = [];
  if (vacio(vino.ubicacion_pais)) faltas.push("pais");
  if (vacio(vino.ubicacion_region)) faltas.push("region");
  if (vacio(vino.categoria) || esCategoriaOrigenPendiente(vino.categoria)) faltas.push("categoria");
  return faltas;
}

export const origenVinoClaro = (vino: OrigenVino) => faltasOrigenVino(vino).length === 0;

const NOMBRE_FALTA: Record<FaltaOrigen, string> = {
  pais: "el país",
  region: "la región",
  categoria: "la categoría con su denominación (no vale «Origen pendiente»)",
};

function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/** «Falta el país y la región…» para avisos (toast, tarjeta). */
export function mensajeFaltaOrigen(vino: OrigenVino): string {
  const faltas = faltasOrigenVino(vino);
  if (faltas.length === 0) return "";
  return `Falta ${enumerar(faltas.map((f) => NOMBRE_FALTA[f]))}: sin el origen claro el mapa de la carta no sabe dónde poner el vino.`;
}

/**
 * Línea corta de la tarjeta de un vino sin origen claro: qué falta y qué hacer.
 * «No se puede publicar: falta elegir su categoría con la denominación de origen. Pulsa «Editar» y complétalo.»
 */
export function avisoTarjetaSinOrigen(vino: OrigenVino): string {
  const faltas = faltasOrigenVino(vino);
  if (faltas.length === 0) return "";
  const partes: string[] = [];
  const lugar = faltas.filter((f) => f !== "categoria").map((f) => NOMBRE_FALTA[f]);
  if (lugar.length) partes.push(`falta ${enumerar(lugar)}`);
  if (faltas.includes("categoria")) partes.push("falta elegir su categoría con la denominación de origen");
  return `No se puede publicar: ${partes.join(" y ")}. Pulsa «Editar» y complétalo.`;
}

/** Aviso al intentar encender «Restaurante» o «Touza» de un vino sin origen claro. */
export function mensajeNoPublicarSinOrigen(vino: OrigenVino & { nombre?: string | null }): string {
  const quien = vino.nombre?.trim() ? `«${vino.nombre.trim()}»` : "Este vino";
  return `${quien} no se puede publicar sin origen. ${mensajeFaltaOrigen(vino)} Edítalo y complétalo.`;
}

export const MENSAJE_CATEGORIA_PENDIENTE =
  "Elige la categoría con su denominación de origen: una «… — ORIGEN PENDIENTE» no vale, el mapa de la carta no sabe dónde ponerla";

// ─── Campos del formulario de vino (alta y edición) ─────────────────────────
/** Categoría obligatoria y con denominación (no «… — ORIGEN PENDIENTE»). */
export const categoriaVino = categoriaCarta.refine((c) => !esCategoriaOrigenPendiente(c), MENSAJE_CATEGORIA_PENDIENTE);
export const paisVino = z.string().trim().min(1, "El país es obligatorio: sin él el vino no sale en el mapa de la carta");
export const regionVino = z.string().trim().min(1, "La región es obligatoria: sin ella el vino no sale en el mapa de la carta");

/** Categorías que se pueden elegir en el formulario (sin las de origen pendiente). */
export function categoriasConOrigen(categorias: (string | null | undefined)[]): string[] {
  return categorias.filter((c): c is string => Boolean(c?.trim()) && !esCategoriaOrigenPendiente(c));
}
