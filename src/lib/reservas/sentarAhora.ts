// ============================================================================
// DÓNDE SENTAR A ALGUIEN AHORA — lógica pura compartida
// ----------------------------------------------------------------------------
// La usan la vista móvil de «Hoy» (Cambiar/Elegir mesa) y «Sin reserva»
// (walk-in). Dada una reserva (o un grupo que acaba de entrar):
//   · `caben`: mesas LIBRES a su hora donde caben, con las plazas de ESTE
//     servicio (piezas, picos y plazas de la Terraza ya ajustadas);
//   · `propuesta`: si no cabe en ninguna (de su sala, o de ninguna sala si no
//     tiene), la propuesta de piezas de la primera mesa que la admita.
// ============================================================================

import type {
  AjusteMesa,
  EstadoServicio,
  FilaMesaPiezas,
  MesaPiezas,
  Propuesta,
  ReservaEnMesas,
  ResultadoPropuesta,
} from "./piezasMesa";
import { estadoServicio, geometriaServicio, mesaPiezasDesde, proponerParaSentar } from "./piezasMesa";
import { mesasQueCaben, type MesaOpcion } from "./hoyMovil";
import { conflictoDeMesa, type AsignacionConReserva, type ConfigOcupacionMesa } from "./ocupacionMesa";
import { turnoDeHora } from "./asignacionMesas";

export interface FilaMesaSala extends FilaMesaPiezas {
  espacio_id: string;
  capacidad: number;
}

export type AsignacionDia = AsignacionConReserva;

/**
 * ¿Esta asignación sigue ocupando su mesa para sentar a alguien más? No, si la
 * reserva ya se fue («Liberar mesa»: `salida_at`) o no vino. (La base de datos
 * lo admite con la migración 20261009150000.)
 */
export function asignacionOcupa(a: AsignacionConReserva): boolean {
  const r = a.reservas as { estado?: string | null; salida_at?: string | null } | null | undefined;
  if (!r) return true;
  if (r.estado === "no_show" || r.estado === "cancelada") return false;
  return !r.salida_at;
}

export interface AjusteDia extends AjusteMesa {
  espacioId: string;
  turno: string;
}

export interface PropuestaSentar {
  mesa: MesaOpcion;
  propuesta: Propuesta;
}

export interface OpcionesSentar {
  caben: MesaOpcion[];
  propuesta: PropuestaSentar | null;
}

/** «HH:MM:00» de ahora (hora local). */
export function horaActual(ahora: Date = new Date()): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${dos(ahora.getHours())}:${dos(ahora.getMinutes())}:00`;
}

/**
 * Todas las mesas de todas las salas con sus plazas de ESTE servicio (piezas, picos y uniones ya aplicados),
 * en el orden de las salas. Las piezas que hoy están dentro de otra unión no salen.
 */
export function opcionesMesasServicio(params: {
  salas: ReadonlyArray<{ id: string; nombre: string }>;
  mesas: readonly FilaMesaSala[];
  ajustesDia: readonly AjusteDia[];
  turno: "comida" | "cena";
}): MesaOpcion[] {
  return construirOpciones(params.salas, params.mesas, params.ajustesDia, params.turno).opciones;
}

function construirOpciones(
  salas: ReadonlyArray<{ id: string; nombre: string }>,
  mesas: readonly FilaMesaSala[],
  ajustesDia: readonly AjusteDia[],
  turno: "comida" | "cena",
) {
  const opciones: MesaOpcion[] = [];
  const porSala = new Map<string, { piezas: MesaPiezas[]; estado: ReturnType<typeof estadoServicio> }>();

  for (const sala of salas) {
    const deSala = mesas.filter((m) => m.espacio_id === sala.id);
    const piezas = deSala.map(mesaPiezasDesde).filter((m): m is MesaPiezas => m !== null);
    const estado = estadoServicio(
      piezas,
      ajustesDia.filter((a) => a.espacioId === sala.id && a.turno === turno),
    );
    porSala.set(sala.id, { piezas, estado });
    for (const m of deSala) {
      const e = estado.get(m.id);
      if (e && e.piezas <= 0) continue;
      const g = geometriaServicio(m, e);
      opciones.push({
        id: m.id,
        nombre: m.nombre,
        espacioId: sala.id,
        salaNombre: sala.nombre,
        plazas: g?.capacidad ?? m.capacidad,
      });
    }
  }
  return { opciones, porSala };
}

export function opcionesParaSentar(params: {
  salas: ReadonlyArray<{ id: string; nombre: string }>;
  mesas: readonly FilaMesaSala[];
  ajustesDia: readonly AjusteDia[];
  asignaciones: readonly AsignacionDia[];
  excluidas: ReadonlySet<string>;
  configOcupacion?: ConfigOcupacionMesa;
  /** `id` vacío para quien aún no tiene reserva (walk-in). */
  reserva: { id: string; hora: string; comensales: number; espacioId: string | null };
}): OpcionesSentar {
  const { salas, mesas, ajustesDia, excluidas, configOcupacion, reserva } = params;
  const asignaciones = params.asignaciones.filter(asignacionOcupa);
  const turno = turnoDeHora(reserva.hora);
  const { opciones, porSala } = construirOpciones(salas, mesas, ajustesDia, turno);

  const libre = (mesaId: string) =>
    !excluidas.has(mesaId) &&
    !conflictoDeMesa(asignaciones, mesaId, { id: reserva.id || "__nueva__", hora: reserva.hora }, configOcupacion);
  const caben = mesasQueCaben(opciones, reserva.comensales, reserva.espacioId, libre);

  const cabeDondeToca = reserva.espacioId ? caben.some((m) => m.espacioId === reserva.espacioId) : caben.length > 0;
  if (cabeDondeToca) return { caben, propuesta: null };

  // Propuesta de piezas: en su sala, o en cualquiera si no tiene.
  const salasProbar = reserva.espacioId ? salas.filter((s) => s.id === reserva.espacioId) : salas;
  for (const sala of salasProbar) {
    const { piezas, estado } = porSala.get(sala.id)!;
    const porReserva = new Map<string, ReservaEnMesas>();
    for (const a of asignaciones) {
      if (a.reserva_id === reserva.id || turnoDeHora(a.reservas?.hora ?? "") !== turno) continue;
      if (!piezas.some((m) => m.id === a.mesa_id)) continue;
      const r = porReserva.get(a.reserva_id) ?? {
        reservaId: a.reserva_id,
        mesaIds: [],
        comensales: a.reservas?.numero_comensales ?? 0,
      };
      r.mesaIds.push(a.mesa_id);
      porReserva.set(a.reserva_id, r);
    }
    for (const m of piezas) {
      if (!libre(m.id)) continue;
      const r = proponerParaSentar({
        mesas: piezas,
        estado,
        reservas: [...porReserva.values()],
        mesaId: m.id,
        comensales: reserva.comensales,
      });
      const opcion = opciones.find((o) => o.id === m.id);
      if (r.propuestas[0] && opcion) return { caben, propuesta: { mesa: opcion, propuesta: r.propuestas[0] } };
    }
  }
  return { caben, propuesta: null };
}

/** Para quien entra sin reserva: la mesa más justa de cualquier sala, y luego por sala. */
export function ordenarParaSinReserva(caben: readonly MesaOpcion[]): MesaOpcion[] {
  return [...caben].sort((a, b) => a.plazas - b.plazas || a.salaNombre.localeCompare(b.salaNombre, "es"));
}

// ─── «Sin reserva» (walk-in) ─────────────────────────────────────────────────

/**
 * Canal de quien entra sin reserva. 'presencial' llega con la migración
 * 20261009100000_canal_presencial.sql; hasta que se aplique, la BD lo rechaza
 * (reservas_canal_check) y el alta reintenta con 'manual'.
 */
export const CANAL_SIN_RESERVA = "presencial" as const;
export const CANAL_SIN_RESERVA_RESPALDO = "manual" as const;

/** «Sin reserva 21:05» si no se escribe nombre. */
export function nombreSinReserva(nombre: string | null | undefined, hora: string): string {
  return (nombre ?? "").trim() || `Sin reserva ${hora.slice(0, 5)}`;
}

/**
 * La fila de `reservas` de quien entra sin reserva: de hoy, a la hora de
 * ahora, YA SENTADA («Llegó» = completada; así el trigger de aforo no la
 * cuenta ni la frena) y sin contacto: no hay correo ni lista negra que mirar.
 */
export function filaSinReserva(p: {
  fecha: string;
  hora: string;
  personas: number;
  nombre?: string | null;
  espacioId: string | null;
  canal: string;
  ahora?: Date;
}) {
  return {
    nombre: nombreSinReserva(p.nombre, p.hora),
    fecha: p.fecha,
    hora: p.hora,
    numero_comensales: Math.max(1, Math.round(p.personas)),
    estado: "completada",
    canal: p.canal,
    espacio_id: p.espacioId,
    marca: "casa_tomas",
    llegada_at: (p.ahora ?? new Date()).toISOString(),
    telefono: null,
    email: null,
  };
}

/** ¿El error es el CHECK de canal (falta la migración de 'presencial')? */
export function esErrorCanal(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === "23514" || /check/i.test(error.message ?? "")) && /canal/i.test(error.message ?? "");
}

// ─── Soltar una reserva en una mesa del plano (arrastrar o «Elegir mesa») ────

export type ResultadoSoltar =
  /** Cabe y está libre: se le da la mesa (y antes la sala, si era de otra). */
  | { tipo: "asignar"; cambiarSala: boolean }
  /** La mesa no está libre a la hora de la reserva. */
  | { tipo: "ocupada"; motivo: string }
  /** No cabe: la propuesta de piezas (puede venir vacía, con su motivo). */
  | { tipo: "noCabe"; cambiarSala: boolean; propuesta: ResultadoPropuesta | null };

/**
 * Qué pasa al soltar `reserva` en `mesa` (del plano de una sala, con sus plazas de ESTE servicio).
 * Lógica pura: la pantalla solo ejecuta lo que dice.
 */
export function decidirSoltar(p: {
  reserva: { id: string; hora: string; numero_comensales: number; espacio_id: string | null };
  mesa: { id: string; nombre: string; espacio_id: string; plazas: number };
  asignaciones: readonly AsignacionConReserva[];
  configOcupacion?: ConfigOcupacionMesa;
  /** Para la propuesta de piezas (mesas por piezas de la sala, su estado y quién las usa). */
  piezas?: {
    mesas: MesaPiezas[];
    estado: EstadoServicio;
    reservas: ReservaEnMesas[];
  };
}): ResultadoSoltar {
  const { reserva, mesa } = p;
  const cambiarSala = reserva.espacio_id !== mesa.espacio_id;
  const vivas = p.asignaciones.filter(asignacionOcupa);
  const choque = conflictoDeMesa(vivas, mesa.id, { id: reserva.id, hora: reserva.hora }, p.configOcupacion);
  if (choque) {
    const quien = choque.asignacion.reservas?.nombre?.trim() || "otra reserva";
    return { tipo: "ocupada", motivo: `La mesa ${mesa.nombre} está ocupada a esa hora por ${quien}` };
  }
  if (mesa.plazas >= reserva.numero_comensales) return { tipo: "asignar", cambiarSala };
  const enPiezas = p.piezas?.mesas.some((m) => m.id === mesa.id);
  const propuesta =
    p.piezas && enPiezas
      ? proponerParaSentar({
          mesas: p.piezas.mesas,
          estado: p.piezas.estado,
          reservas: p.piezas.reservas.filter((r) => r.reservaId !== reserva.id),
          mesaId: mesa.id,
          comensales: reserva.numero_comensales,
        })
      : null;
  return { tipo: "noCabe", cambiarSala, propuesta };
}
