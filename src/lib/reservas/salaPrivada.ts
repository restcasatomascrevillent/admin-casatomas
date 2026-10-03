// ============================================================================
// SALA PRIVADA — la reserva se queda la sala ENTERA (lógica pura, sin I/O)
// ----------------------------------------------------------------------------
// Regla del dueño (2026-10-03): «nunca van a caer dos reservas, siempre una
// reserva en el reservado; aunque sea para 5, llena el reservado». Una sala con
// `espacios_reserva.caracteristicas.privada = true` (hoy el «Reservado» de Casa
// Tomás, 20 plazas):
//   · a efectos de aforo, una reserva viva cuenta como la CAPACIDAD de la sala,
//     no como sus comensales;
//   · solo puede haber una reserva (viva o ya sentada) por día y turno.
// La BD la hace cumplir (`validar_capacidad_reserva`, migración
// 20261003130000_sala_privada_ocupa_turno.sql). Este módulo solo:
//   · reconoce una sala privada (`esSalaPrivada`);
//   · reconoce y traduce el error de la BD (23514 «Sala privada ocupada: …»);
//   · avisa ANTES de intentar el movimiento en el kanban (`salaPrivadaOcupadaPor`).
//
// El mensaje de la BD NO contiene la palabra «Aforo» a propósito: los
// traductores que buscan «Aforo» (mensajeErrorEdicion, mensajeErrorServicio,
// el alta) no lo confunden con un turno lleno. Se comprueba aquí primero.
// ============================================================================

import { turnoDeHora } from "../../../supabase/functions/_shared/disponibilidad";
import { ocupaEspacio } from "./estadosReserva";

/** Prefijo fijo del mensaje del trigger (ver la migración). */
export const PREFIJO_SALA_PRIVADA_OCUPADA = "Sala privada ocupada";

/**
 * ¿Es una sala privada (que se queda una reserva entera)? Acepta la fila de
 * `espacios_reserva` (con `caracteristicas`) o un objeto ya aplanado con
 * `privada`. Solo el valor booleano `true` (o el texto "true", como lo lee el
 * trigger con `->>`) cuenta.
 */
export function esSalaPrivada(
  espacio: { caracteristicas?: unknown; privada?: unknown; activa?: boolean | null } | null | undefined,
): boolean {
  if (!espacio) return false;
  if (espacio.activa === false) return false;
  const flag =
    espacio.privada !== undefined
      ? espacio.privada
      : (espacio.caracteristicas as { privada?: unknown } | null | undefined)?.privada;
  return flag === true || flag === "true";
}

/** El error del trigger por una sala privada ya reservada (23514 «Sala privada ocupada: …»). */
export function esErrorSalaPrivadaOcupada(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string; message?: string };
  return e.code === "23514" && String(e.message ?? "").startsWith(PREFIJO_SALA_PRIVADA_OCUPADA);
}

/** Lo mismo, a partir solo del texto (p. ej. el `mensaje` que devuelve un RPC en JSON). */
export function esMensajeSalaPrivadaOcupada(mensaje: string | null | undefined): boolean {
  return String(mensaje ?? "").startsWith(PREFIJO_SALA_PRIVADA_OCUPADA);
}

/** El nombre de la sala que viene entre «» en el mensaje de la BD, si viene. */
export function nombreSalaDelError(mensaje: string | null | undefined): string | null {
  const m = /«([^»]+)»/.exec(String(mensaje ?? ""));
  return m ? m[1].trim() || null : null;
}

/**
 * La frase para el personal. `nombre`: la sala si se conoce (del error o de la
 * pantalla); sin ella se dice «La sala privada».
 */
export function textoSalaPrivadaOcupada(nombre?: string | null): string {
  const sala = nombre && nombre.trim() ? `La sala privada «${nombre.trim()}»` : "La sala privada";
  return `${sala} ya está reservada en ese turno: una reserva se queda la sala entera. Elige otro turno u otro día, o cancela la otra reserva.`;
}

/** Mensaje para el personal a partir del error de la BD. Úsalo tras `esErrorSalaPrivadaOcupada`. */
export function mensajeSalaPrivadaOcupada(error: unknown): string {
  const e = (error ?? {}) as { message?: string };
  return textoSalaPrivadaOcupada(nombreSalaDelError(e.message));
}

/** Lo mínimo de una reserva para saber si ocupa una sala en un turno. */
export interface ReservaDeSala {
  id: string;
  hora: string;
  estado: string;
  espacio_id?: string | null;
}

/**
 * La reserva que YA tiene la sala `espacioId` en el turno de `hora` (la primera
 * que se encuentre), o `null`. Cuentan las que ocupan sitio físico
 * (`ocupaEspacio`: pendiente, verificada, confirmada y completada); cancelada
 * y «No vino» liberan. `excluirId`: la propia reserva que se mueve.
 *
 * Es la misma regla que aplica el trigger de la BD (que además mira el día;
 * aquí `reservas` ya es de un solo día).
 */
export function salaPrivadaOcupadaPor<T extends ReservaDeSala>(
  reservas: readonly T[],
  espacioId: string,
  hora: string,
  excluirId?: string,
): T | null {
  const turno = turnoDeHora(hora);
  return (
    reservas.find(
      (r) =>
        r.id !== excluirId && r.espacio_id === espacioId && ocupaEspacio(r.estado) && turnoDeHora(r.hora) === turno,
    ) ?? null
  );
}
