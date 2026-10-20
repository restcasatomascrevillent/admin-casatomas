// ============================================================================
// DETECCIÓN DE AUSENCIAS SIN AVISAR — funciones puras, sin I/O
// ============================================================================
// El endpoint (index.ts) trae de Supabase las reservas 'confirmada' cuya
// fecha+hora ya pasó, y por separado el historial de reservas anteriores del
// mismo teléfono. Aquí solo la decisión ("¿esto es una ausencia?") y el
// resumen ("¿qué le enseño a quien tenga que aprobar la sugerencia?").
//
// IMPORTANTE — lo que esto NO hace: no escribe en `blacklist`. Solo marca la
// reserva como 'no_show' (corrección factual: ya pasó y nadie la marcó
// 'completada') y prepara una fila para `sugerencias_blacklist`, pendiente
// de que una persona la apruebe o la rechace (fn_aprobar_sugerencia_blacklist
// / fn_rechazar_sugerencia_blacklist en la migración). Un no-show puede ser
// culpa del restaurante — el sistema propone, nunca veta.
// ============================================================================

export interface ReservaPasada {
  id: string;
  estado: string;
  fecha: string; // "YYYY-MM-DD"
  hora: string; // "HH:MM" o "HH:MM:SS"
}

/**
 * Verdadero si una reserva 'confirmada' es una ausencia sin avisar: ya pasó
 * su instante de reserva más un margen de gracia (para no marcar como
 * ausente a alguien que llega tarde o a quien el restaurante aún no ha
 * marcado 'completada' porque el servicio sigue en curso).
 *
 * Recibe el instante de la reserva y "ahora" YA RESUELTOS a ISO 8601 UTC
 * (`Date#toISOString()`), no `fecha`/`hora` en crudo: la conversión de la
 * hora de Madrid (fecha/hora de `reservas`, sin zona) a instante UTC real
 * la hace `tiempo.ts` (misma técnica que reservas-web/index.ts:114-125,
 * reimplementada aquí sin importar de ahí — ver cabecera del módulo). Que
 * esta función reciba instantes ya resueltos es lo que la mantiene pura y
 * fácil de testear sin simular zonas horarias.
 */
export function esAusenciaSinAvisar(
  estado: string,
  instanteReservaIso: string,
  ahoraIso: string,
  horasDeGracia = 3,
): boolean {
  if (estado !== "confirmada") return false;
  const limite = new Date(instanteReservaIso).getTime() + horasDeGracia * 60 * 60 * 1000;
  return new Date(ahoraIso).getTime() >= limite;
}

export interface ReservaHistorialCliente {
  estado: string;
  fecha: string;
}

export interface ResumenHistorialCliente {
  total_reservas_previas: number;
  no_shows_previos: number;
  completadas_previas: number;
  canceladas_previas: number;
  es_primera_falta: boolean;
}

/**
 * Construye el snapshot que se guarda en `sugerencias_blacklist.historial`.
 * `reservasPrevias` NO debe incluir la reserva que dispara la sugerencia
 * (esta función no lo comprueba: es responsabilidad de la consulta en
 * index.ts excluir el id que se está evaluando).
 */
export function resumirHistorialCliente(
  reservasPrevias: readonly ReservaHistorialCliente[],
): ResumenHistorialCliente {
  const noShows = reservasPrevias.filter((r) => r.estado === "no_show").length;
  const completadas = reservasPrevias.filter((r) => r.estado === "completada").length;
  const canceladas = reservasPrevias.filter((r) => r.estado === "cancelada").length;
  return {
    total_reservas_previas: reservasPrevias.length,
    no_shows_previos: noShows,
    completadas_previas: completadas,
    canceladas_previas: canceladas,
    // "primera falta" cuenta SOLO no-shows previos: una cancelación u otra
    // reserva completada no la convierten en reincidente.
    es_primera_falta: noShows === 0,
  };
}
