// ============================================================================
// REGLAS DE SALA DEL ALTA WEB (lógica pura, sin I/O)
// ============================================================================
// reservas-sin-salas (decisión del dueño, 2026-09-29, engram
// sdd/reservas-sin-salas/decisiones):
//   · Casa Tomás: el cliente reserva una HORA. La sala es una decisión
//     interna del restaurante (se asigna desde el panel), así que la web no
//     acepta sala del cliente ni exige que el grupo quepa entero en una sala.
//     Manda el aforo del turno (suma de las salas del negocio), igual que el
//     trigger validar_capacidad_reserva.
//   · Touza: El Reservado ES lo que se reserva. Se mantiene todo como estaba,
//     incluida la regla de que el grupo quepa en un espacio.
//
// Separado de index.ts para poder testearlo con vitest (index.ts importa de
// URLs de Deno). Solo lo usa handleCrear: handleDisponibilidad nunca tuvo la
// regla de sala.
// ============================================================================

import type { Marca } from "./plantillas.ts";

/**
 * ¿Hay que rechazar el alta por falta de sitio?
 *  - Sin aforo en el turno (`disponibleGlobal` false): sí, en los dos negocios.
 *  - Touza: también si ningún espacio tiene hueco para el grupo entero.
 *  - Casa Tomás: nunca por sala.
 * `espaciosLibres` = nº de espacios con hueco para todo el grupo (ver
 * contarEspaciosQueCaben).
 */
export function rechazarPorSala(marca: Marca, disponibleGlobal: boolean, espaciosLibres: number): boolean {
  if (!disponibleGlobal) return true;
  return marca === "touza" && espaciosLibres === 0;
}

/** Nº de espacios con hueco para el grupo entero. */
export function contarEspaciosQueCaben(espacios: ReadonlyArray<{ disponible: number }>, comensales: number): number {
  return espacios.filter((e) => e.disponible >= comensales).length;
}

/**
 * Sala que se toma del cuerpo de la petición. En Casa Tomás se ignora (queda
 * sin asignar y la asigna el personal); en Touza se respeta tal cual.
 */
export function salaDelCliente(
  marca: Marca,
  entrada: { espacioId: string | null; salaNombre: string | null },
): { espacioId: string | null; salaNombre: string | null } {
  if (marca === "casa_tomas") return { espacioId: null, salaNombre: null };
  return { espacioId: entrada.espacioId, salaNombre: entrada.salaNombre };
}
