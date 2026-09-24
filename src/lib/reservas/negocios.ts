// ============================================================================
// NEGOCIOS DEL GRUPO EN LAS PANTALLAS DE RESERVAS — lógica pura (sin I/O)
// ----------------------------------------------------------------------------
// El panel gestiona las reservas de DOS negocios con el mismo flujo
// (pendiente → verificada → confirmada, mismos correos, mismas herramientas):
//   · Casa Tomás (restaurante): Comedor, Salón, Terraza.
//   · Touza (bar): "El Reservado", su espacio privado para eventos. La web de
//     Touza tiene un formulario "El Reservado" que crea reservas con
//     `reservas.marca = 'touza'`.
// Decisión del dueño (2026-09-24, corrige la del 2026-09-23): las reservas de
// El Reservado se ven y se gestionan EXACTAMENTE igual que las demás; el
// panel no las esconde, las distingue (insignia + filtro) y nunca mezcla su
// aforo con el del restaurante.
//
// De dónde sale el negocio (mismo criterio en todo el sistema):
//   · Reserva: columna `reservas.marca` (NOT NULL DEFAULT 'casa_tomas',
//     migración 20260922180000). Es la que usa el trigger de aforo.
//   · Espacio: `espacios_reserva.caracteristicas->>'marca'`; sin etiqueta =
//     Casa Tomás (igual que el trigger `validar_capacidad_reserva`).
//   · Solicitud del bot/web (`solicitudes_pendientes` no tiene columna marca):
//     la sala propuesta si la hay; si no, el marcador que escribe el
//     formulario de El Reservado en `notas_cliente`; si no, Casa Tomás. Mismo
//     orden que `fn_aceptar_propuesta_solicitud` (migración 20260924090000).
// ============================================================================

import { MARCA_POR_DEFECTO } from "../../../supabase/functions/_shared/disponibilidad";
import { resolverMarcaPorNotas } from "../../../supabase/functions/reservas-web/plantillas";

export { MARCA_POR_DEFECTO };

export interface NegocioPanel {
  /** Valor de `reservas.marca` / `caracteristicas.marca`. */
  marca: string;
  /** Nombre corto ("Casa Tomás", "Touza"). */
  nombre: string;
  /** Etiqueta de la insignia y de los grupos ("Touza · El Reservado"). */
  etiqueta: string;
}

/** Orden fijo en toda la interfaz: primero el restaurante. */
export const NEGOCIOS_PANEL: readonly NegocioPanel[] = [
  { marca: "casa_tomas", nombre: "Casa Tomás", etiqueta: "Casa Tomás" },
  { marca: "touza", nombre: "Touza", etiqueta: "Touza · El Reservado" },
];

/** Valor del filtro "Negocio" que no filtra. */
export const FILTRO_NEGOCIO_TODOS = "all";

/** Normaliza cualquier valor de marca (null/"" → Casa Tomás). */
export function normalizarMarca(marca: string | null | undefined): string {
  return marca && String(marca).trim() ? String(marca).trim() : MARCA_POR_DEFECTO;
}

export function negocioDeMarca(marca: string | null | undefined): NegocioPanel {
  const m = normalizarMarca(marca);
  return NEGOCIOS_PANEL.find((n) => n.marca === m) ?? { marca: m, nombre: m, etiqueta: m };
}

export const etiquetaNegocio = (marca: string | null | undefined) => negocioDeMarca(marca).etiqueta;
export const nombreNegocio = (marca: string | null | undefined) => negocioDeMarca(marca).nombre;

/** Negocio de una reserva (columna `marca`). */
export function marcaDeReserva(reserva: { marca?: string | null } | null | undefined): string {
  return normalizarMarca(reserva?.marca);
}

/** Negocio de un espacio (`caracteristicas.marca`). */
export function marcaDeEspacio(espacio: { caracteristicas?: unknown; marca?: string | null } | null | undefined): string {
  if (!espacio) return MARCA_POR_DEFECTO;
  if (espacio.marca) return normalizarMarca(espacio.marca);
  const c = espacio.caracteristicas as { marca?: unknown } | null | undefined;
  return normalizarMarca(typeof c?.marca === "string" ? c.marca : null);
}

/**
 * Negocio que tendrá una reserva creada desde el panel: el del espacio
 * elegido; sin espacio, Casa Tomás (default de `reservas.marca`).
 */
export function marcaParaAlta(
  espacioId: string | null | undefined,
  espacios: readonly { id: string; caracteristicas?: unknown; marca?: string | null }[] | null | undefined,
): string {
  if (!espacioId) return MARCA_POR_DEFECTO;
  return marcaDeEspacio((espacios ?? []).find((e) => e.id === espacioId));
}

/**
 * Sala por defecto de un negocio que solo tiene UNA (Touza: "El Reservado").
 * Para Casa Tomás (varias salas, y "Sin asignar" es válido) devuelve null.
 */
export function espacioUnicoDeNegocio(
  marca: string | null | undefined,
  espacios: readonly { id: string; caracteristicas?: unknown; marca?: string | null; activa?: boolean }[] | null | undefined,
): string | null {
  const m = normalizarMarca(marca);
  if (m === MARCA_POR_DEFECTO) return null;
  const propios = (espacios ?? []).filter((e) => e.activa !== false && marcaDeEspacio(e) === m);
  return propios.length === 1 ? propios[0].id : null;
}

/** Negocio de una solicitud (no tiene columna `marca`, ver cabecera). */
export function marcaDeSolicitud(
  solicitud: { espacio_propuesto_id?: string | null; notas_cliente?: string | null },
  espacios: readonly { id: string; caracteristicas?: unknown; marca?: string | null }[] | null | undefined,
): string {
  if (solicitud.espacio_propuesto_id) {
    const espacio = (espacios ?? []).find((e) => e.id === solicitud.espacio_propuesto_id);
    if (espacio) return marcaDeEspacio(espacio);
  }
  return resolverMarcaPorNotas(solicitud.notas_cliente ?? null) ?? MARCA_POR_DEFECTO;
}

/**
 * Agrupa en el orden de `NEGOCIOS_PANEL` (marcas desconocidas al final, por
 * nombre). Solo devuelve los grupos que tienen algún elemento, salvo las
 * marcas de `incluirSiempre`.
 */
export function agruparPorNegocio<T>(
  items: readonly T[],
  marcaDe: (item: T) => string,
  incluirSiempre: readonly string[] = [],
): { negocio: NegocioPanel; items: T[] }[] {
  const mapa = new Map<string, T[]>();
  for (const m of incluirSiempre) mapa.set(normalizarMarca(m), []);
  for (const item of items) {
    const m = normalizarMarca(marcaDe(item));
    const lista = mapa.get(m) ?? [];
    lista.push(item);
    mapa.set(m, lista);
  }
  const orden = (m: string) => {
    const i = NEGOCIOS_PANEL.findIndex((n) => n.marca === m);
    return i === -1 ? NEGOCIOS_PANEL.length : i;
  };
  return Array.from(mapa.entries())
    .sort(([a], [b]) => orden(a) - orden(b) || a.localeCompare(b))
    .map(([marca, lista]) => ({ negocio: negocioDeMarca(marca), items: lista }));
}

/** ¿Pasa el filtro "Negocio" (Todos / Casa Tomás / Touza)? */
export function coincideNegocio(marca: string | null | undefined, filtro: string | null | undefined): boolean {
  if (!filtro || filtro === FILTRO_NEGOCIO_TODOS) return true;
  return normalizarMarca(marca) === filtro;
}
