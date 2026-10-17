// ============================================================================
// SALA PRIVADA — FUERA DE AFORO, pero una sola reserva por turno (lógica pura)
// ----------------------------------------------------------------------------
// Decisión del dueño (2026-10-03, por la tarde; sustituye a la de la mañana):
// «el Reservado no quiero que se tenga en cuenta en los aforos porque no es
// accesible, es para gente especial y está fuera del sistema de reservas, pero
// que sepamos que está». Una sala con `espacios_reserva.caracteristicas.privada
// = true` (hoy el «Reservado» de Casa Tomás, 14 plazas desde 13/10/2026):
//   · NO suma su capacidad al aforo de la marca (Casa Tomás: 150, no 170);
//   · una reserva en ella NO consume aforo (ni capacidad ni comensales): no
//     entra en las cifras de ocupación, comensales ni porcentajes;
//   · SIGUE habiendo una sola reserva (viva o ya sentada) por día y turno;
//   · solo se reserva desde el panel (la web y el bot no la ofrecen);
//   · el personal tiene que VERLA: indicador en el calendario.
// La BD lo hace cumplir (`validar_capacidad_reserva`, migración
// 20261003150000_sala_privada_fuera_de_aforo.sql; la exclusividad viene de
// 20261003130000). Este módulo es el PUNTO ÚNICO para el panel:
//   · reconoce una sala privada (`esSalaPrivada`) y la saca del aforo
//     (`capacidadDeAforo`, `reservasQueConsumenAforo`);
//   · reconoce y traduce el error de la BD (23514 «Sala privada ocupada: …»);
//   · avisa ANTES de intentar el movimiento en el kanban (`salaPrivadaOcupadaPor`).
//
// El mensaje de la BD NO contiene la palabra «Aforo» a propósito: los
// traductores que buscan «Aforo» (mensajeErrorEdicion, mensajeErrorServicio,
// el alta) no lo confunden con un turno lleno. Se comprueba aquí primero.
// ============================================================================

import {
  esCaracteristicaPrivada,
  sinReservasEnSalasPrivadas,
  turnoDeHora,
} from "../../../supabase/functions/_shared/disponibilidad";
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
  if (espacio.privada !== undefined) return espacio.privada === true || espacio.privada === "true";
  return esCaracteristicaPrivada(espacio.caracteristicas);
}

/** Ids de las salas privadas ACTIVAS de una lista de espacios (filas de `espacios_reserva`). */
export function idsSalasPrivadasActivas(
  espacios: ReadonlyArray<{ id?: string | null; caracteristicas?: unknown; privada?: unknown; activa?: boolean | null } | null | undefined> | null | undefined,
): string[] {
  const ids: string[] = [];
  for (const e of espacios ?? []) {
    if (e?.id && esSalaPrivada(e)) ids.push(String(e.id));
  }
  return ids;
}

/** ¿Esta reserva está en una sala privada (fuera de aforo)? `privadas`: ids de `idsSalasPrivadasActivas`. */
export function estaFueraDeAforo(
  reserva: { espacio_id?: string | null } | null | undefined,
  privadas: ReadonlySet<string> | readonly string[] | null | undefined,
): boolean {
  const id = reserva?.espacio_id;
  if (!id || !privadas) return false;
  return Array.isArray(privadas) ? privadas.includes(String(id)) : (privadas as ReadonlySet<string>).has(String(id));
}

/** Las reservas que SÍ consumen aforo (las que no están en una sala privada). */
export function reservasQueConsumenAforo<T extends { espacio_id?: string | null }>(
  reservas: readonly T[],
  privadas: readonly string[] | null | undefined,
): T[] {
  return sinReservasEnSalasPrivadas(reservas, privadas);
}

/**
 * Aforo de las salas: suma de `capacidad_maxima` de las salas ACTIVAS que NO son
 * privadas. Es lo que suma el trigger de la BD (Casa Tomás = 150). Ojo: no mira
 * la marca; quien llama ya pasa las salas de Casa Tomás.
 */
export function capacidadDeAforo(
  espacios: ReadonlyArray<
    | { id?: unknown; nombre?: unknown; capacidad_maxima?: unknown; caracteristicas?: unknown; privada?: unknown; activa?: boolean | null }
    | null
    | undefined
  > | null | undefined,
): number {
  let total = 0;
  for (const e of espacios ?? []) {
    if (!e || e.activa === false || esSalaPrivada(e)) continue;
    const n = Number(e.capacidad_maxima);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
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
