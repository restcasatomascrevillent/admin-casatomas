// ============================================================================
// SALA PRIVADA — FUERA DE AFORO, pero una sola reserva por turno (lógica pura)
// ----------------------------------------------------------------------------
// Decisión del dueño (2026-10-03, por la tarde; sustituye a la de la mañana):
// «el Reservado no quiero que se tenga en cuenta en los aforos porque no es
// accesible, es para gente especial y está fuera del sistema de reservas, pero
// que sepamos que está». Una sala con `espacios_reserva.caracteristicas.privada
// = true` (hoy el «Reservado» de Casa Tomás, 20 plazas):
//   · NO suma su capacidad al aforo de la marca (Casa Tomás: 150, no 170);
//   · una reserva en ella NO consume aforo (ni capacidad ni comensales): no
//     entra en las cifras de ocupación, comensales ni porcentajes;
//   · SIGUE habiendo una sola reserva (viva o ya sentada) por día y turno;
//   · solo se reserva desde el panel (la web y el bot no la ofrecen);
//   · el personal tiene que VERLA: aviso aparte en Hoy y en el Dashboard
//     (`avisosSalasPrivadas`), etiqueta «Fuera de aforo» en el kanban y en la
//     Lista, e indicador en el calendario.
// La BD lo hace cumplir (`validar_capacidad_reserva`, migración
// 20261003150000_sala_privada_fuera_de_aforo.sql; la exclusividad viene de
// 20261003130000). Este módulo es el PUNTO ÚNICO para el panel:
//   · reconoce una sala privada (`esSalaPrivada`) y la saca del aforo
//     (`capacidadDeAforo`, `reservasQueConsumenAforo`);
//   · reconoce y traduce el error de la BD (23514 «Sala privada ocupada: …»);
//   · avisa ANTES de intentar el movimiento en el kanban (`salaPrivadaOcupadaPor`);
//   · arma el aviso «Reservado: ocupado — García, 8 pax (comida)».
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

/** Etiqueta corta de lo que no cuenta en el aforo (kanban, Lista, calendario). */
export const ETIQUETA_FUERA_DE_AFORO = "Fuera de aforo";

/** Frase para el `title`/tooltip de la etiqueta. */
export const AYUDA_FUERA_DE_AFORO =
  "Sala privada: no cuenta en el aforo ni en las cifras de ocupación. Solo admite una reserva por turno.";

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

// ----------------------------------------------------------------------------
// AVISO «Reservado: ocupado — García, 8 pax (comida)» (Hoy y Dashboard)
// ----------------------------------------------------------------------------
// La sala privada está fuera de las cifras de aforo, pero el personal tiene que
// saber si está ocupada. El aviso va APARTE de las cifras de ocupación y
// comensales: nunca se suma a ellas.

export type TurnoSala = "comida" | "cena";
const TURNOS_SALA: readonly TurnoSala[] = ["comida", "cena"];

/** Lo mínimo de una reserva para el aviso (`nombre` puede faltar). */
export interface ReservaParaAviso {
  id?: string;
  nombre?: string | null;
  hora: string;
  numero_comensales: number | string | null;
  estado: string;
  espacio_id?: string | null;
}

export interface TurnoAvisoSalaPrivada {
  turno: TurnoSala;
  /** La reserva que tiene la sala en ese turno; `null` = libre. */
  reserva: ReservaParaAviso | null;
}

export interface AvisoSalaPrivada {
  espacioId: string;
  nombre: string;
  /** Siempre los dos turnos, en orden de servicio. */
  turnos: TurnoAvisoSalaPrivada[];
  /** ¿Está ocupada en algún turno? */
  ocupada: boolean;
}

/**
 * Un aviso por cada sala privada ACTIVA, con quién la tiene en la comida y en la
 * cena. `reservas` son las de UN día (cualquier estado: aquí se filtran con
 * `ocupaEspacio`; cancelada y «No vino» la liberan). Si hay dos reservas en el
 * mismo turno (dato heredado que la BD ya no permite) se muestra la primera.
 */
export function avisosSalasPrivadas(
  espacios: ReadonlyArray<{ id?: string | null; nombre?: string | null; caracteristicas?: unknown; privada?: unknown; activa?: boolean | null } | null | undefined> | null | undefined,
  reservas: readonly ReservaParaAviso[] | null | undefined,
): AvisoSalaPrivada[] {
  const avisos: AvisoSalaPrivada[] = [];
  for (const e of espacios ?? []) {
    if (!e?.id || !esSalaPrivada(e)) continue;
    const id = String(e.id);
    const delaSala = (reservas ?? []).filter((r) => r && r.espacio_id === id && ocupaEspacio(r.estado));
    const turnos = TURNOS_SALA.map((turno) => ({
      turno,
      reserva: delaSala.find((r) => turnoDeHora(r.hora) === turno) ?? null,
    }));
    avisos.push({
      espacioId: id,
      nombre: (e.nombre ?? "").trim() || "Sala privada",
      turnos,
      ocupada: turnos.some((t) => t.reserva !== null),
    });
  }
  return avisos;
}

/** «García, 8 pax (comida)». */
export function textoReservaDeAviso(turno: TurnoSala, reserva: ReservaParaAviso): string {
  const nombre = (reserva.nombre ?? "").trim() || "Sin nombre";
  const pax = Number(reserva.numero_comensales) || 0;
  return `${nombre}, ${pax} pax (${turno})`;
}

/**
 * La frase del aviso. Libre en los dos turnos: «Reservado: libre». Con reserva:
 * «Reservado: ocupado — García, 8 pax (comida)»; con las dos:
 * «Reservado: ocupado — García, 8 pax (comida) · López, 4 pax (cena)»; y si solo
 * uno de los turnos está ocupado se dice que el otro está libre.
 * `soloTurno`: limita el aviso a un turno (p. ej. el filtro del kanban).
 */
export function textoAvisoSalaPrivada(aviso: AvisoSalaPrivada, soloTurno?: TurnoSala | null): string {
  const turnos = aviso.turnos.filter((t) => !soloTurno || t.turno === soloTurno);
  const ocupados = turnos.filter((t) => t.reserva !== null);
  if (ocupados.length === 0) return `${aviso.nombre}: libre`;
  const quien = ocupados.map((t) => textoReservaDeAviso(t.turno, t.reserva as ReservaParaAviso)).join(" · ");
  const libres = turnos.filter((t) => t.reserva === null);
  const resto = libres.length > 0 ? `; libre en ${libres.map((t) => (t.turno === "comida" ? "la comida" : "la cena")).join(" y ")}` : "";
  return `${aviso.nombre}: ocupado — ${quien}${resto}`;
}
