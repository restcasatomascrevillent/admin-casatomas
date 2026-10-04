// ============================================================================
// COLUMNAS DEL KANBAN DE «HOY» — qué es una columna y en cuál va cada reserva
// ----------------------------------------------------------------------------
// Compartido por el kanban (`GestorReservasKanban`), la tarjeta de reserva
// (`ReservaCard`) y el desplegable de la sala privada (`AvisoSalasPrivadas`).
//
// Solo Casa Tomás (decisión del dueño, 2026-10-01: Touza no admite reservas).
// Las columnas son «Sin asignar» + las salas activas de Casa Tomás, y las
// reservas, las de Casa Tomás: lo que quede de Touza en la base de datos (sus
// salas aún activas, sus reservas de demostración) no sale (`admiteReservas`).
//
// 04/10/2026 (dueño): el kanban NO pinta columna para las salas privadas (el
// Reservado): quien está en él se ve en el aviso desplegable de «Hoy». Aun así
// la sala privada SIGUE siendo una `Columna` de la lista (con `privada: true`)
// para poder elegirla como destino de «Mover a…» y para que `columnaDeReserva`
// no mande a «Sin asignar» a quien ya está ahí.
// ============================================================================

import { salaAdmiteReservas } from "./negocios";
import { esSalaPrivada } from "./salaPrivada";
import type { ReservaServicio } from "./servicioSala";

export const SIN_ASIGNAR = "sin-asignar";
export const esSinAsignar = (id: string) => id === SIN_ASIGNAR;

export interface Columna {
  id: string;
  title: string;
  capacidadMax?: number;
  /** Sala privada (`caracteristicas.privada`, el Reservado): una reserva se queda la sala entera. */
  privada?: boolean;
}

/** Columna en la que va una reserva: su sala si está entre las columnas; si no, "Sin asignar". */
export function columnaDeReserva(reserva: ReservaServicio, columnas: readonly Columna[]): string {
  return reserva.espacio_id && columnas.some((c) => c.id === reserva.espacio_id) ? reserva.espacio_id : SIN_ASIGNAR;
}

/** Las columnas que el kanban PINTA: todas menos las salas privadas. */
export const columnasVisibles = (columnas: readonly Columna[]): Columna[] => columnas.filter((c) => !c.privada);

/**
 * «Sin asignar» + las salas ACTIVAS de Casa Tomás (filas de `espacios_reserva`), las privadas
 * incluidas (con `privada: true`). Lo que quede de Touza en la base de datos no sale.
 */
export function construirColumnas(
  espacios: ReadonlyArray<{ id?: string; nombre?: string; capacidad_maxima?: number | null; activa?: boolean | null; caracteristicas?: unknown }> | null | undefined,
): Columna[] {
  return [
    { id: SIN_ASIGNAR, title: "Sin asignar" },
    ...(espacios ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((e) => e && e.activa !== false && salaAdmiteReservas(e as any))
      .map((e) => ({
        id: e.id as string,
        title: e.nombre as string,
        capacidadMax: e.capacidad_maxima ?? undefined,
        privada: esSalaPrivada(e),
      })),
  ];
}
