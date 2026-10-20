// ============================================================================
// QUÉ NEGOCIO ADMITE RESERVAS — el interruptor central (lógica pura, sin I/O)
// ----------------------------------------------------------------------------
// Solo Casa Tomás admite reservas. Decisión del dueño (2026-10-01): «toda la
// lógica de reservas de Touza va fuera, no se reserva». Hasta entonces el panel
// gestionaba dos negocios (Casa Tomás y Touza · El Reservado) con filtro
// «Negocio», insignias, columnas y aforos por negocio; todo eso ha salido de la
// interfaz y el único negocio es `MARCA_POR_DEFECTO` ('casa_tomas').
//
// LO QUE SE ESCRIBE: la columna `marca` sigue existiendo y el panel la sigue
// mandando en las altas (`marca: MARCA_POR_DEFECTO`), porque la base de datos
// tiene los CHECK `reservas_marca_valida` y `solicitudes_pendientes_marca_valida`
// y el trigger de aforo `validar_capacidad_reserva` suma POR MARCA.
//
// LO QUE SE LEE: las filas de otro negocio que aún queden en la base de datos
// (las reservas de demostración de Touza, sus espacios todavía activos) se
// IGNORAN en todas las pantallas y cifras con UNA sola regla, `admiteReservas`.
// No hay ningún otro filtro de negocio en el panel.
//
// De dónde sale el negocio de una fila (vacío o null = Casa Tomás, como en la BD):
//   · Reserva: columna `reservas.marca` (NOT NULL DEFAULT 'casa_tomas').
//   · Solicitud: columna `solicitudes_pendientes.marca` (ídem).
//   · Espacio: `espacios_reserva.caracteristicas->>'marca'`; un espacio sin
//     etiqueta es de Casa Tomás (igual que el trigger).
//
// LAS SALAS SE IDENTIFICAN POR ID, NUNCA POR NOMBRE: en la base de datos hay dos
// «Terraza» (una de cada negocio) y «Reservado» (Casa Tomás) no es «El Reservado»
// (Touza).
// ============================================================================

import { MARCA_POR_DEFECTO } from "../../../supabase/functions/_shared/disponibilidad";

export { MARCA_POR_DEFECTO };

/** Normaliza cualquier valor de marca (null/"" → Casa Tomás). */
export function normalizarMarca(marca: string | null | undefined): string {
  return marca && String(marca).trim() ? String(marca).trim() : MARCA_POR_DEFECTO;
}

/**
 * ¿Admite reservas el negocio de esta fila? Solo Casa Tomás. Es la ÚNICA regla
 * de negocio del panel: lo que no la cumple ni se enseña ni se cuenta.
 */
export function admiteReservas(marca: string | null | undefined): boolean {
  return normalizarMarca(marca) === MARCA_POR_DEFECTO;
}

/** Negocio de un espacio (`caracteristicas.marca`, o `marca` si ya viene aplanada). */
export function marcaDeEspacio(espacio: { caracteristicas?: unknown; marca?: string | null } | null | undefined): string {
  if (!espacio) return MARCA_POR_DEFECTO;
  if (espacio.marca) return normalizarMarca(espacio.marca);
  const c = espacio.caracteristicas as { marca?: unknown } | null | undefined;
  return normalizarMarca(typeof c?.marca === "string" ? c.marca : null);
}

/** La misma regla aplicada a un espacio: ¿es una sala de Casa Tomás? */
export function salaAdmiteReservas(espacio: { caracteristicas?: unknown; marca?: string | null } | null | undefined): boolean {
  return admiteReservas(marcaDeEspacio(espacio));
}
