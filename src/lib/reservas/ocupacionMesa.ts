// ============================================================================
// OCUPACIÓN DE MESA POR TIEMPO — lógica pura (sin React, sin Supabase)
// ----------------------------------------------------------------------------
// Petición del dueño (05/10/2026): una mesa se puede dar a VARIAS reservas del
// mismo día si sus horas no se pisan, sean del mismo turno o no («Oscar a las
// 14:00 y Ezequiel a las 20:30 en la mesa 3»).
//
// FRANJA de una reserva = [hora, hora + tiempo de ocupación de mesa). El tiempo
// es el ajuste «Tiempo de ocupación de mesa» de Reservas → Configuración:
// `configuracion_reservas.estancia_comida_minutos` (105 por defecto) y
// `estancia_cena_minutos` (120), según el turno de la PROPIA reserva (corte
// 17:00). Es el mismo ajuste que usa el modo servicio para «por liberar».
//
// La regla de verdad la aplica la base de datos (trigger de `asignaciones_mesa`,
// migración 20261005130000_mesas_ocupacion_por_tiempo.sql: `MESA_OCUPADA: La
// mesa 3 está ocupada de 14:00 a 16:00 por Oscar`). Esto es la MISMA cuenta en
// el navegador para pintar el plano y avisar antes de gastar un viaje.
//
// Límite consciente: aquí solo se miran las asignaciones del día que se pinta;
// una cena de las 23:30 que pisa una reserva de las 00:30 del día siguiente la
// detecta la base de datos, no el plano.
// ============================================================================

import { turnoDeHora } from "./asignacionMesas";
import { minutosHastaSiguienteTurnoFijo } from "../../../supabase/functions/_shared/disponibilidad";
import { CONFIG_SERVICIO_SALA_POR_DEFECTO, type ConfigServicioSala } from "./servicioSala";

/** Minutos desde medianoche [inicio, fin). `fin` puede pasar de 1440 (cenas tardías). */
export interface Franja {
  inicio: number;
  fin: number;
}

/** Lo mínimo de una reserva para saber su franja. */
export interface ReservaConHora {
  id: string;
  hora: string;
}

/** Una asignación con lo que hace falta para pintar quién ocupa la mesa. */
export interface AsignacionConReserva {
  mesa_id: string;
  reserva_id: string;
  reservas: { nombre?: string | null; hora: string; numero_comensales?: number | null };
}

/** Lo que el ajuste necesita: los dos minutajes del turno. */
export type ConfigOcupacionMesa = Pick<ConfigServicioSala, "estanciaComidaMinutos" | "estanciaCenaMinutos" | "horasFijas">;

export const CONFIG_OCUPACION_POR_DEFECTO: ConfigOcupacionMesa = {
  estanciaComidaMinutos: CONFIG_SERVICIO_SALA_POR_DEFECTO.estanciaComidaMinutos,
  estanciaCenaMinutos: CONFIG_SERVICIO_SALA_POR_DEFECTO.estanciaCenaMinutos,
};

/** 'HH:MM[:SS]' → minutos desde medianoche, o `null` si no se puede leer. */
export function minutosDeHora(hora: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(typeof hora === "string" ? hora.trim() : "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 24 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Minutos que ocupa la mesa una reserva a esa hora (por el turno de esa hora).
 * Con turnos de hora fija (`config.horasFijas`, jueves de tapas 20:30 y 22:00)
 * se recorta en el turno siguiente, como `fn_franja_ocupacion_mesa` (20261122200000).
 */
export function minutosOcupacionMesa(hora: string, config: ConfigOcupacionMesa = CONFIG_OCUPACION_POR_DEFECTO): number {
  const comida = turnoDeHora(hora) === "comida";
  const minutos = Number(comida ? config?.estanciaComidaMinutos : config?.estanciaCenaMinutos);
  const base =
    Number.isFinite(minutos) && minutos > 0
      ? minutos
      : comida
        ? CONFIG_OCUPACION_POR_DEFECTO.estanciaComidaMinutos
        : CONFIG_OCUPACION_POR_DEFECTO.estanciaCenaMinutos;
  const hastaSiguiente = minutosHastaSiguienteTurnoFijo(hora, config?.horasFijas);
  return hastaSiguiente === null ? base : Math.min(base, hastaSiguiente);
}

/** Franja de una reserva, o `null` si su hora es ilegible (entonces no se compara). */
export function franjaDeHora(hora: string, config: ConfigOcupacionMesa = CONFIG_OCUPACION_POR_DEFECTO): Franja | null {
  const inicio = minutosDeHora(hora);
  if (inicio === null) return null;
  return { inicio, fin: inicio + minutosOcupacionMesa(hora, config) };
}

/** ¿Se pisan? Extremo final abierto: 14:00-16:00 y 16:00-18:00 NO se pisan. */
export function seSolapan(a: Franja, b: Franja): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}

/** 'HH:MM' de unos minutos desde medianoche (pasada la medianoche vuelve a 00:00). */
export function horaDeMinutos(minutos: number): string {
  const total = ((Math.round(minutos) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** «14:00 a 16:00». */
export function textoFranja(franja: Franja): string {
  return `${horaDeMinutos(franja.inicio)} a ${horaDeMinutos(franja.fin)}`;
}

/**
 * La asignación que impide dar `mesaId` a `reserva` (otra reserva con esa mesa
 * en una franja que se pisa con la suya), o `null` si la mesa está libre PARA
 * ESA RESERVA. Las asignaciones de la propia reserva no cuentan (mesas juntas,
 * o volver a guardar las mismas). Si hay varias, la que empieza antes: es la
 * que nombra el mensaje de la base de datos.
 *
 * `asignaciones` tienen que ser las del DÍA ENTERO (no recortadas al turno): una
 * comida de las 16:30 sigue ocupando la mesa a las 18:00.
 */
export function conflictoDeMesa<T extends AsignacionConReserva>(
  asignaciones: readonly T[],
  mesaId: string,
  reserva: ReservaConHora,
  config: ConfigOcupacionMesa = CONFIG_OCUPACION_POR_DEFECTO,
): { asignacion: T; franja: Franja } | null {
  if (!mesaId || !reserva) return null;
  const propia = franjaDeHora(reserva.hora, config);
  if (!propia) return null;

  let mejor: { asignacion: T; franja: Franja } | null = null;
  for (const a of asignaciones ?? []) {
    if (!a || a.mesa_id !== mesaId || a.reserva_id === reserva.id) continue;
    const franja = franjaDeHora(a.reservas?.hora ?? "", config);
    if (!franja || !seSolapan(propia, franja)) continue;
    if (!mejor || franja.inicio < mejor.franja.inicio) mejor = { asignacion: a, franja };
  }
  return mejor;
}

/**
 * La frase del aviso, igual que la de la base de datos:
 * «La mesa 3 está ocupada de 14:00 a 16:00 por Oscar».
 */
export function textoMesaOcupada(mesaNombre: string, conflicto: { asignacion: AsignacionConReserva; franja: Franja }): string {
  const nombre = conflicto.asignacion.reservas?.nombre?.trim() || "otra reserva";
  return `La mesa ${mesaNombre} está ocupada de ${textoFranja(conflicto.franja)} por ${nombre}`;
}

/** Quién ocupa una mesa, en orden de hora (para el cartel del plano). */
export function ocupacionesDeMesa<T extends AsignacionConReserva>(asignaciones: readonly T[], mesaId: string): T[] {
  return (asignaciones ?? [])
    .filter((a) => a && a.mesa_id === mesaId)
    .sort(
      (a, b) =>
        (minutosDeHora(a.reservas?.hora ?? "") ?? 0) - (minutosDeHora(b.reservas?.hora ?? "") ?? 0) ||
        String(a.reserva_id).localeCompare(String(b.reserva_id)),
    );
}

/** Primer nombre para el cartel compacto: «Oscar Diaz Vidal» → «Oscar». */
export function nombreCorto(nombre: string | null | undefined): string {
  const limpio = (nombre ?? "").trim();
  if (!limpio) return "Sin nombre";
  return limpio.split(/\s+/)[0];
}

/** «14:00 Oscar · 20:30 Ezequiel»: quién ocupa la mesa y a qué hora, en una línea. */
export function resumenOcupacionMesa(asignaciones: readonly AsignacionConReserva[]): string {
  return (asignaciones ?? [])
    .map((a) => `${horaDeMinutos(minutosDeHora(a.reservas?.hora ?? "") ?? 0)} ${nombreCorto(a.reservas?.nombre)}`)
    .join(" · ");
}
