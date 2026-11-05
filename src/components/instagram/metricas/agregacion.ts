/**
 * Utilidades de la pestaña «Métricas»: interacciones y tasa de cada
 * publicación, nombres (plantilla, marca, tipo de foto) y formatos en
 * español. «Qué funciona» (por formato, plantilla, tipo de foto, día, hora y
 * hashtag, con muestra mínima) lo agrega la base de datos (RPC
 * instagram_que_funciona) y lo nombra vistaQueFunciona.ts. Funciones puras,
 * probadas en __tests__/agregacion.test.ts.
 *
 * Tasa de interacción = interacciones / alcance.
 */
import { FOTOS, NOMBRE_TIPO_FOTO, buscarFoto, type Foto, type TipoFoto } from "@/lib/instagram/fotos";
import { MARCAS, type MarcaId } from "@/lib/instagram/tokens";
import { obtenerPlantilla } from "@/lib/instagram/plantillas/index";
import type { Publicacion } from "./tipos";

/** Interacciones de una publicación: las de Meta o, si no hay, la suma de su desglose. */
export function interaccionesDe(p: Pick<Publicacion, "interacciones" | "meGusta" | "comentarios" | "guardados" | "compartidos">): number | null {
  if (typeof p.interacciones === "number") return p.interacciones;
  const partes = [p.meGusta, p.comentarios, p.guardados, p.compartidos].filter((x): x is number => typeof x === "number");
  return partes.length ? partes.reduce((a, b) => a + b, 0) : null;
}

/** Tasa de interacción (%) de una publicación. */
export function tasaDe(p: Publicacion): number | null {
  const i = interaccionesDe(p);
  if (i === null || !p.alcance) return null;
  return Math.round((i / p.alcance) * 1000) / 10;
}

/** Tipo de foto: el que trae la función (fotos subidas) o el del catálogo estático. */
export function tipoFotoDe(p: Pick<Publicacion, "tipoFoto" | "foto">, fotos: readonly Foto[] = FOTOS): TipoFoto | null {
  const t = p.tipoFoto ?? (p.foto ? buscarFoto(p.foto, fotos)?.tipo : undefined) ?? null;
  return t && t in NOMBRE_TIPO_FOTO ? (t as TipoFoto) : null;
}

export function nombrePlantilla(id: string): string {
  return obtenerPlantilla(id)?.nombre ?? id;
}

export function nombreMarca(id: string): string {
  return MARCAS[id as MarcaId]?.nombre ?? id;
}

export function nombreTipoFoto(id: string): string {
  return NOMBRE_TIPO_FOTO[id as TipoFoto] ?? id;
}

const NUMERO = new Intl.NumberFormat("es-ES");
const DECIMAL = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

export function formatearNumero(n: number | null | undefined): string {
  return typeof n === "number" ? NUMERO.format(n) : "—";
}

export function formatearPorcentaje(n: number | null | undefined): string {
  return typeof n === "number" ? `${DECIMAL.format(n)} %` : "—";
}

/** «+12,5 %», «−3 %», «=» o «—» (sin base). */
export function textoVariacion(v: number | null | undefined): string {
  if (typeof v !== "number") return "—";
  if (v === 0) return "= 0 %";
  return `${v > 0 ? "+" : "−"}${DECIMAL.format(Math.abs(v))} %`;
}

/** Ordena las publicaciones: recientes primero o por alcance. */
export function ordenarPublicaciones(pubs: readonly Publicacion[], orden: "recientes" | "alcance"): Publicacion[] {
  const copia = [...pubs];
  if (orden === "alcance") return copia.sort((a, b) => (b.alcance ?? -1) - (a.alcance ?? -1));
  return copia.sort((a, b) => (b.publicadoAt ?? "").localeCompare(a.publicadoAt ?? ""));
}
