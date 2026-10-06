// ============================================================================
// LA CIFRA DEL BOTÓN «POR ATENDER» DE LA LISTA — lógica pura (sin I/O)
// ----------------------------------------------------------------------------
// Aquí vivían también las cifras por estado de «Cómo avanza una reserva»
// (`cifrasDeLaLista`, `contarPorEstado`, `alcanceCifrasDeLaLista`). El 2026-10-06
// el dueño quitó esas cifras del timeline («los números no tienen sentido») y se
// retiraron: ya no las usaba nadie. Queda solo la del botón «Por atender», que sí
// sigue en la barra de filtros.
//
// `cifraPorAtender` (2026-10-05)
// ----------------------------------------------------------------------------
//   Se cuenta con los filtros de la lista MENOS el de estado —búsqueda, fecha y
//   canal— y es justo el número de filas que la lista enseña al pulsar el botón:
//   las reservas `pendiente` MÁS las solicitudes del asistente sin resolver
//   (`estaPorAtender`). Sin el filtro de estado porque así no cambia al elegir
//   otro estado en el desplegable (si contara con él, al elegir «Confirmada» se
//   quedaría en 0 justo cuando más falta hace saber que hay cosas por atender).
//   · SOLO CASA TOMÁS (decisión del dueño, 2026-10-01: Touza no admite reservas):
//     lo de otro negocio no cuenta, igual que no sale en la lista. Lo descarta
//     `unificarReservasYSolicitudes` con `admiteReservas`, la regla común.
//   · Sin consulta propia: recibe lo que la lista YA tiene cargado.
//
// El filtro es el MISMO que el de la lista (`filtrarFilasUnificadas`, en
// `vistaUnificada.ts`) con `estado: FILTRO_POR_ATENDER`: nada de repetir aquí la
// lógica de búsqueda o canal. Si cambia allí, cambia aquí.
// ============================================================================

import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";
import {
  FILTRO_POR_ATENDER,
  filtrarFilasUnificadas,
  unificarReservasYSolicitudes,
  type FiltrosListaUnificada,
  type ReservaListable,
} from "./vistaUnificada";

/**
 * La cifra del botón «Por atender» de la Lista: las filas que la lista enseña al
 * pulsarlo (reservas `pendiente` + solicitudes sin resolver), con sus filtros
 * (búsqueda, fecha, canal) y SIN el de estado (`filtros.estado` se ignora). Como
 * en la lista, lo que no es de Casa Tomás no entra. No toca lo que recibe.
 */
export function cifraPorAtender<R extends ReservaListable>(
  reservas: readonly R[],
  solicitudes: readonly SolicitudPendiente[],
  filtros: FiltrosListaUnificada,
): number {
  return filtrarFilasUnificadas(unificarReservasYSolicitudes(reservas, solicitudes), {
    ...filtros,
    estado: FILTRO_POR_ATENDER,
  }).length;
}
