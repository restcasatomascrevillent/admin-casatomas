// ============================================================================
// ESTADO PREVIO — a dónde vuelve una reserva al deshacer «Ha llegado» / «No vino».
// ----------------------------------------------------------------------------
// «Ha llegado» y «No vino» sobrescriben `estado` ('completada' / 'no_show') y la BD no
// guarda lo que había antes. El «Deshacer» del aviso (los 10 s de después) sí lo sabe
// porque lo lleva en su cierre; el «Deshacer» del CHIP (más tarde, desde la tarjeta)
// no tenía de dónde sacarlo y devolvía SIEMPRE a «Confirmada»: una reserva que llegó
// estando «Pendiente» acababa «Confirmada» sin pasar por la verificación.
//
// Aquí se guarda, en memoria y por reserva, el estado de partida de cada llegada / «No
// vino» hecho en esta sesión. Es compartido por todos los usos del hook (kanban, modo
// servicio), no por React Query: no es un dato del servidor.
//
// SI NO SE SABE —la llegada la marcó otra persona u otro navegador, la marcó el sistema
// (el cron de ausencias pasa 'confirmada' a 'no_show'), o se recargó la página— se
// vuelve a «Confirmada», que es lo que se hacía siempre y lo correcto en el caso del
// cron. Por eso la memoria es una mejora de lo habitual, no una condición.
// ============================================================================

import { ESTADO_TRAS_DESHACER, esEstadoVivo } from "./estadosReserva";

/** Tope de reservas recordadas: un servicio mueve unas pocas decenas, esto es un cinturón. */
const MAXIMO_RECORDADAS = 500;

const previos = new Map<string, string>();

/**
 * Guarda el estado que tenía `id` justo antes de llegar / no venir. Solo los estados
 * VIVOS (pendiente, verificada, confirmada): de los demás no se llega a «Llegó» ni a
 * «No vino», así que no hay nada a lo que valga la pena volver.
 */
export function recordarEstadoPrevio(id: string, estado: string | null | undefined): void {
  if (!id || !esEstadoVivo(estado)) return;
  previos.delete(id); // para que la más reciente quede al final
  previos.set(id, estado as string);
  while (previos.size > MAXIMO_RECORDADAS) {
    const masAntigua = previos.keys().next().value as string;
    previos.delete(masAntigua);
  }
}

/** El estado recordado de `id`, o `undefined` si no se sabe. */
export function estadoPrevioDe(id: string): string | undefined {
  return previos.get(id);
}

/** Olvida el de `id` (ya se ha deshecho: lo que quede apuntado no serviría para nada). */
export function olvidarEstadoPrevio(id: string): void {
  previos.delete(id);
}

/** A qué estado devuelve «Deshacer» a `id`: al que tenía antes, o «Confirmada» si no se sabe. */
export function estadoAlDeshacer(id: string): string {
  return previos.get(id) ?? ESTADO_TRAS_DESHACER;
}

/** Solo para tests. */
export function __vaciarEstadosPreviosParaTests(): void {
  previos.clear();
}
