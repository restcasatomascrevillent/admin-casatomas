// ============================================================================
// «HOY» EN MÓVIL — agrupado y orden (lógica pura, con tests)
// ----------------------------------------------------------------------------
// Para el camarero que va sentando gente con el teléfono (08/10/2026):
//   · Arriba, «Sin mesa»: las reservas vivas que aún no tienen mesa.
//   · Después, una sección por sala (en el orden de las salas), con cuántas
//     reservas y cuántas personas tiene.
//   · Dentro de cada grupo, por hora; las que ya llegaron («Llegó») y las de
//     «No vino» bajan al final (y la vista las atenúa).
// ============================================================================

import { ESTADO_LLEGADA, ESTADO_NO_SHOW } from "./estadosReserva";
import { coincideFiltroHoy, type FiltroTurnoHoy } from "./vistaHoy";

export interface ReservaHoyMovil {
  id: string;
  nombre: string | null;
  hora: string;
  numero_comensales: number;
  estado: string;
  espacio_id: string | null;
  email?: string | null;
  telefono?: string | null;
}

export interface FilaHoyMovil<R extends ReservaHoyMovil = ReservaHoyMovil> {
  reserva: R;
  /** Nombres de sus mesas («3», «4 + 5»); vacío = sin mesa. */
  mesas: string[];
  /** Ya llegó o no vino: va al final y atenuada. */
  terminada: boolean;
}

export interface GrupoHoyMovil<R extends ReservaHoyMovil = ReservaHoyMovil> {
  /** `"sin-mesa"` o el id de la sala. */
  clave: string;
  titulo: string;
  filas: FilaHoyMovil<R>[];
  /** Sin contar las de «No vino». */
  totalReservas: number;
  totalPersonas: number;
}

export const CLAVE_SIN_MESA = "sin-mesa";

export const estaTerminada = (estado: string) => estado === ESTADO_LLEGADA || estado === ESTADO_NO_SHOW;

function ordenar<R extends ReservaHoyMovil>(filas: FilaHoyMovil<R>[]): FilaHoyMovil<R>[] {
  return [...filas].sort(
    (a, b) =>
      Number(a.terminada) - Number(b.terminada) ||
      a.reserva.hora.localeCompare(b.reserva.hora) ||
      (a.reserva.nombre ?? "").localeCompare(b.reserva.nombre ?? "", "es"),
  );
}

function grupo<R extends ReservaHoyMovil>(clave: string, titulo: string, filas: FilaHoyMovil<R>[]): GrupoHoyMovil<R> {
  const cuentan = filas.filter((f) => f.reserva.estado !== ESTADO_NO_SHOW);
  return {
    clave,
    titulo,
    filas: ordenar(filas),
    totalReservas: cuentan.length,
    totalPersonas: cuentan.reduce((s, f) => s + (f.reserva.numero_comensales || 0), 0),
  };
}

/**
 * Agrupa las reservas de hoy para la vista móvil. Respeta el turno y la
 * búsqueda de la barra de filtros. Las canceladas no salen.
 */
export function agruparHoyMovil<R extends ReservaHoyMovil>(
  reservas: readonly R[],
  salas: ReadonlyArray<{ id: string; nombre: string }>,
  mesasDe: (reservaId: string) => string[],
  filtros: { busqueda: string; filtroTurno: FiltroTurnoHoy },
): GrupoHoyMovil<R>[] {
  const sinMesa: FilaHoyMovil<R>[] = [];
  const porSala = new Map<string, FilaHoyMovil<R>[]>();
  const sinSala: FilaHoyMovil<R>[] = [];

  for (const reserva of reservas) {
    if (reserva.estado === "cancelada") continue;
    if (!coincideFiltroHoy(reserva, filtros)) continue;
    const mesas = mesasDe(reserva.id);
    const terminada = estaTerminada(reserva.estado);
    const fila: FilaHoyMovil<R> = { reserva, mesas, terminada };
    if (mesas.length === 0 && !terminada) sinMesa.push(fila);
    else if (reserva.espacio_id) porSala.set(reserva.espacio_id, [...(porSala.get(reserva.espacio_id) ?? []), fila]);
    else sinSala.push(fila);
  }

  const grupos: GrupoHoyMovil<R>[] = [];
  if (sinMesa.length > 0) grupos.push(grupo(CLAVE_SIN_MESA, "Sin mesa", sinMesa));
  for (const sala of salas) {
    const filas = porSala.get(sala.id);
    if (filas?.length) grupos.push(grupo(sala.id, sala.nombre, filas));
    porSala.delete(sala.id);
  }
  // Salas que no vienen en la lista (no debería pasar) y terminadas sin sala.
  for (const [id, filas] of porSala) grupos.push(grupo(id, "Otra sala", filas));
  if (sinSala.length > 0) grupos.push(grupo("sin-sala", "Sin sala", sinSala));
  return grupos;
}

/** «Mesa 3», «Mesas 4 + 5» o «Sin mesa». */
export function textoMesas(mesas: string[]): string {
  if (mesas.length === 0) return "Sin mesa";
  return mesas.length === 1 ? `Mesa ${mesas[0]}` : `Mesas ${mesas.join(" + ")}`;
}

export interface MesaOpcion {
  id: string;
  nombre: string;
  espacioId: string;
  salaNombre: string;
  /** Plazas de la mesa en este servicio (con piezas/picos ya aplicados). */
  plazas: number;
}

/**
 * «Cambiar mesa»: las mesas LIBRES a la hora de la reserva donde caben sus
 * comensales. Primero las de su sala, y dentro de cada sala la más justa
 * (menos sillas vacías) y luego por número.
 */
export function mesasQueCaben(
  mesas: readonly MesaOpcion[],
  comensales: number,
  salaReserva: string | null,
  libre: (mesaId: string) => boolean,
): MesaOpcion[] {
  const numero = (n: string) => {
    const v = parseInt(n, 10);
    return Number.isNaN(v) ? Number.MAX_SAFE_INTEGER : v;
  };
  return mesas
    .filter((m) => m.plazas >= comensales && libre(m.id))
    .sort(
      (a, b) =>
        Number(b.espacioId === salaReserva) - Number(a.espacioId === salaReserva) ||
        a.salaNombre.localeCompare(b.salaNombre, "es") ||
        a.plazas - b.plazas ||
        numero(a.nombre) - numero(b.nombre) ||
        a.nombre.localeCompare(b.nombre, "es"),
    );
}

// ─── «Llegan ahora» ──────────────────────────────────────────────────────────

const ESTADOS_POR_LLEGAR = new Set(["pendiente", "verificada", "confirmada"]);

function minutos(hora: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hora ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export interface FilaLlegada<R extends ReservaHoyMovil = ReservaHoyMovil> extends FilaHoyMovil<R> {
  /** Ya debería estar aquí (hasta 30 min tarde). */
  tarde: boolean;
}

/**
 * Las que aún no han llegado y llegan en los próximos 15 min, más las que van
 * hasta 30 min tarde (marcadas). Por hora. Mismos filtros que la lista.
 */
export function lleganAhora<R extends ReservaHoyMovil>(
  reservas: readonly R[],
  mesasDe: (reservaId: string) => string[],
  minutoAhora: number,
  filtros: { busqueda: string; filtroTurno: FiltroTurnoHoy },
): FilaLlegada<R>[] {
  return reservas
    .filter((r) => ESTADOS_POR_LLEGAR.has(r.estado) && coincideFiltroHoy(r, filtros))
    .map((r) => ({ r, m: minutos(r.hora) }))
    .filter(({ m }) => m != null && m >= minutoAhora - 30 && m <= minutoAhora + 15)
    .sort((a, b) => (a.m as number) - (b.m as number) || (a.r.nombre ?? "").localeCompare(b.r.nombre ?? "", "es"))
    .map(({ r, m }) => ({ reserva: r, mesas: mesasDe(r.id), terminada: false, tarde: (m as number) < minutoAhora }));
}

// ─── Estado de cada mesa («Mesas») ───────────────────────────────────────────

export type EstadoMesaHoy =
  | { tipo: "libre" }
  | { tipo: "sentada"; reservaId: string; nombre: string; comensales: number }
  | { tipo: "reservada"; reservaId: string; nombre: string; comensales: number; hora: string };

export interface ReservaParaMesa {
  id: string;
  nombre: string | null;
  hora: string;
  numero_comensales: number;
  estado: string;
  salida_at?: string | null;
}

/**
 * Cómo está cada mesa en el turno: SENTADA (alguien con «Llegó» que no se ha
 * ido), RESERVADA (la próxima reserva por llegar, con su hora) o LIBRE. Una
 * mesa liberada (`salida_at`) o de un «No vino» cuenta como libre.
 */
export function estadoMesasHoy(
  asignaciones: ReadonlyArray<{ mesa_id: string; reserva_id: string }>,
  reservas: readonly ReservaParaMesa[],
  turno: "comida" | "cena",
  turnoDe: (hora: string) => "comida" | "cena",
): Map<string, EstadoMesaHoy> {
  const porId = new Map(reservas.map((r) => [r.id, r]));
  const sentadas = new Map<string, ReservaParaMesa>();
  const proximas = new Map<string, ReservaParaMesa>();
  for (const a of asignaciones) {
    const r = porId.get(a.reserva_id);
    if (!r || turnoDe(r.hora) !== turno) continue;
    if (r.estado === ESTADO_LLEGADA && !r.salida_at) sentadas.set(a.mesa_id, r);
    else if (ESTADOS_POR_LLEGAR.has(r.estado)) {
      const actual = proximas.get(a.mesa_id);
      if (!actual || r.hora < actual.hora) proximas.set(a.mesa_id, r);
    }
  }
  const estado = new Map<string, EstadoMesaHoy>();
  for (const [mesaId, r] of proximas) {
    estado.set(mesaId, { tipo: "reservada", reservaId: r.id, nombre: r.nombre ?? "", comensales: r.numero_comensales, hora: r.hora });
  }
  for (const [mesaId, r] of sentadas) {
    estado.set(mesaId, { tipo: "sentada", reservaId: r.id, nombre: r.nombre ?? "", comensales: r.numero_comensales });
  }
  return estado;
}
