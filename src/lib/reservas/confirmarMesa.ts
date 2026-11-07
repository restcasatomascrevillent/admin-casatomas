// ============================================================================
// CONFIRMAR LA MESA REAL AL SENTAR — lógica pura (sin React, sin Supabase)
// ----------------------------------------------------------------------------
// Idea del dueño (07/11/2026): la mesa y la sala de una reserva son solo la
// PREVISIÓN. En el servicio las mesas cambian sin parar, y el panel tiene que
// hacer facilísimo confirmar la mesa donde se sientan DE VERDAD:
//   · mientras no ha llegado: «Prevista: Mesa 7»;
//   · al sentarla: «En mesa 9» (lo confirmado = «Llegó» + su asignación).
//
// El selector de mesa de móvil enseña TODAS las mesas donde cabe, por sala, y
// marca cada una para la franja de la reserva (la misma cuenta que el trigger
// de la base de datos, `ocupacionMesa.ts`):
//   · LIBRE: nadie la usa en esa franja;
//   · OCUPADA: alguien SENTADO («Llegó» y sin «Liberar») la usa → no se ofrece;
//   · PREVISTA para otra reserva que aún no ha llegado → se puede elegir, pero
//     antes se le QUITA esa mesa a la otra (`desplazadas`), porque el trigger
//     rechaza dos reservas en la misma mesa a la vez (MESA_OCUPADA).
// Sin migraciones: todo con el RPC `asignar_mesas_reserva`, que REEMPLAZA las
// mesas de una reserva (array vacío = quitárselas).
// ============================================================================

import { ESTADO_LLEGADA } from "./estadosReserva";
import { franjaDeHora, seSolapan, type ConfigOcupacionMesa } from "./ocupacionMesa";
import type { MesaOpcion } from "./hoyMovil";

/** Una fila de `asignaciones_mesa` con lo que hace falta de su reserva (`AsignacionConDetalles` vale). */
export interface AsignacionConfirmar {
  mesa_id: string;
  reserva_id: string;
  reservas: {
    nombre?: string | null;
    hora: string;
    estado?: string | null;
    salida_at?: string | null;
    numero_comensales?: number | null;
  } | null;
}

/** Otra reserva que pierde una mesa prevista para que se siente alguien ahí. */
export interface Desplazamiento {
  reservaId: string;
  nombre: string;
  hora: string;
  /** Sus mesas antes del cambio (para deshacer si el paso siguiente falla). */
  mesaIdsAntes: string[];
  /** Las mesas con las que se queda (vacío = se queda sin mesa prevista). */
  mesaIdsQuedan: string[];
}

export type EstadoConfirmar =
  | { tipo: "libre" }
  | { tipo: "ocupada"; nombre: string; hora: string }
  | { tipo: "prevista"; desplazadas: Desplazamiento[] };

export interface MesaParaConfirmar extends MesaOpcion {
  estado: EstadoConfirmar;
  /** Es (una de) la mesa(s) que ya tiene la propia reserva. */
  propia: boolean;
}

export interface GrupoSalaConfirmar {
  salaId: string;
  salaNombre: string;
  mesas: MesaParaConfirmar[];
}

export interface SelectorMesas {
  /** Las mesas que ya tiene la reserva (su previsión, o donde está sentada). */
  propias: MesaParaConfirmar[];
  /** Las demás donde cabe, por sala (la suya primero). */
  salas: GrupoSalaConfirmar[];
}

const ESTADOS_SIN_MESA = new Set(["no_show", "cancelada"]);

/** ¿La reserva de esta asignación sigue usando la mesa? No si no vino, se canceló o ya se fue. */
function usaLaMesa(a: AsignacionConfirmar): boolean {
  const r = a.reservas;
  if (!r) return true;
  if (r.estado && ESTADOS_SIN_MESA.has(r.estado)) return false;
  return !r.salida_at;
}

const sentada = (a: AsignacionConfirmar) => a.reservas?.estado === ESTADO_LLEGADA && !a.reservas?.salida_at;

/**
 * Cómo está `mesaId` para sentar ahí a `reserva` (su franja). `reserva.id` vacío = alguien sin reserva.
 * Si la pisa alguien sentado, OCUPADA; si solo la pisan reservas por llegar, PREVISTA con a quién hay que
 * quitársela (y con qué mesas se queda cada una); si nadie, LIBRE.
 */
export function estadoParaConfirmar(
  asignaciones: readonly AsignacionConfirmar[],
  mesaId: string,
  reserva: { id: string; hora: string },
  config?: ConfigOcupacionMesa,
): EstadoConfirmar {
  const propia = franjaDeHora(reserva.hora, config);
  if (!propia) return { tipo: "libre" };
  const vivas = asignaciones.filter((a) => a && usaLaMesa(a));
  const pisan = vivas.filter((a) => {
    if (a.mesa_id !== mesaId || a.reserva_id === reserva.id) return false;
    const franja = franjaDeHora(a.reservas?.hora ?? "", config);
    return !!franja && seSolapan(propia, franja);
  });
  if (pisan.length === 0) return { tipo: "libre" };

  const sentadaAhi = pisan.find(sentada);
  if (sentadaAhi) {
    return { tipo: "ocupada", nombre: sentadaAhi.reservas?.nombre?.trim() || "otra mesa", hora: sentadaAhi.reservas?.hora ?? "" };
  }

  const vistas = new Set<string>();
  const desplazadas: Desplazamiento[] = [];
  for (const a of [...pisan].sort((x, y) => (x.reservas?.hora ?? "").localeCompare(y.reservas?.hora ?? ""))) {
    if (vistas.has(a.reserva_id)) continue;
    vistas.add(a.reserva_id);
    const antes = vivas.filter((b) => b.reserva_id === a.reserva_id).map((b) => b.mesa_id);
    desplazadas.push({
      reservaId: a.reserva_id,
      nombre: a.reservas?.nombre?.trim() || "otra reserva",
      hora: a.reservas?.hora ?? "",
      mesaIdsAntes: antes,
      mesaIdsQuedan: antes.filter((id) => id !== mesaId),
    });
  }
  return { tipo: "prevista", desplazadas };
}

const RANGO: Record<EstadoConfirmar["tipo"], number> = { libre: 0, prevista: 1, ocupada: 2 };

function numeroMesa(nombre: string): number {
  const v = parseInt(nombre, 10);
  return Number.isNaN(v) ? Number.MAX_SAFE_INTEGER : v;
}

/**
 * Las mesas para el selector «¿Dónde se sientan?»: arriba las que ya tiene la reserva; después, por sala (la
 * de la reserva primero y luego en el orden de las salas), las mesas donde CABEN sus comensales, cada una con
 * su estado. Dentro de cada sala: libres, previstas para otros y ocupadas; y entre iguales, la más justa
 * (menos sillas vacías) y luego por número. Las mesas excluidas del reparto no salen (salvo la propia).
 */
export function clasificarMesasParaSentar(p: {
  opciones: readonly MesaOpcion[];
  asignaciones: readonly AsignacionConfirmar[];
  /** `id` vacío para quien entra sin reserva (su hora = ahora). */
  reserva: { id: string; hora: string; comensales: number; espacioId: string | null };
  propias: readonly string[];
  excluidas?: ReadonlySet<string>;
  config?: ConfigOcupacionMesa;
}): SelectorMesas {
  const { opciones, asignaciones, reserva, config } = p;
  const propias = new Set(p.propias);
  const conEstado = (m: MesaOpcion): MesaParaConfirmar => ({
    ...m,
    propia: propias.has(m.id),
    estado: estadoParaConfirmar(asignaciones, m.id, reserva, config),
  });

  const listaPropias = p.propias
    .map((id) => opciones.find((o) => o.id === id))
    .filter((m): m is MesaOpcion => !!m)
    .map(conEstado);

  const ordenSalas: string[] = [];
  for (const o of opciones) if (!ordenSalas.includes(o.espacioId)) ordenSalas.push(o.espacioId);
  if (reserva.espacioId && ordenSalas.includes(reserva.espacioId)) {
    ordenSalas.splice(ordenSalas.indexOf(reserva.espacioId), 1);
    ordenSalas.unshift(reserva.espacioId);
  }

  const salas: GrupoSalaConfirmar[] = [];
  for (const salaId of ordenSalas) {
    const mesas = opciones
      .filter((m) => m.espacioId === salaId && !propias.has(m.id) && !p.excluidas?.has(m.id) && m.plazas >= reserva.comensales)
      .map(conEstado)
      .sort(
        (a, b) =>
          RANGO[a.estado.tipo] - RANGO[b.estado.tipo] ||
          a.plazas - b.plazas ||
          numeroMesa(a.nombre) - numeroMesa(b.nombre) ||
          a.nombre.localeCompare(b.nombre, "es"),
      );
    if (mesas.length > 0) salas.push({ salaId, salaNombre: mesas[0].salaNombre, mesas });
  }
  return { propias: listaPropias, salas };
}

const horaCorta = (h: string) => (h ?? "").slice(0, 5);

/**
 * El aviso antes de quitarle la mesa a otra reserva:
 * «La mesa 7 estaba prevista para García (21:30). García se quedará sin mesa prevista.»
 */
export function textoDesplazamiento(
  mesaNombre: string,
  desplazadas: readonly Desplazamiento[],
  nombreMesa: (id: string) => string = (id) => id,
): string {
  const quienes = desplazadas.map((d) => `${d.nombre} (${horaCorta(d.hora)})`).join(" y ");
  const restos = desplazadas
    .map((d) =>
      d.mesaIdsQuedan.length === 0
        ? `${d.nombre} se quedará sin mesa prevista.`
        : `${d.nombre} sigue con la ${d.mesaIdsQuedan.length === 1 ? "mesa" : "mesas"} ${d.mesaIdsQuedan.map(nombreMesa).join(" + ")}.`,
    )
    .join(" ");
  return `La mesa ${mesaNombre} estaba prevista para ${quienes}. ${restos}`;
}

/** Fila mínima de la lista de asignaciones que pinta el móvil (`AsignacionConDetalles`). */
export interface FilaAsignacionLocal {
  id: string;
  reserva_id: string;
  mesa_id: string;
  created_at: string;
  reservas: Record<string, unknown> & { id: string; nombre: string; hora: string; numero_comensales: number; estado: string };
  mesas: { id: string; nombre: string; capacidad: number; espacio_id?: string };
}

/**
 * Cambio LOCAL (optimista) de la lista de asignaciones del día: las mesas de `reservaId` pasan a ser
 * `mesaIds`. Las filas nuevas copian la reserva de una fila suya que ya hubiera (o `reserva`) y la mesa de
 * `mesas`. Si falta algo para pintarlas, la fila no se inventa: el refresco del servidor la traerá.
 */
export function reemplazarMesasEnLista<F extends FilaAsignacionLocal>(
  lista: readonly F[],
  reservaId: string,
  mesaIds: readonly string[],
  datos: {
    reserva?: F["reservas"] | null;
    mesas: ReadonlyMap<string, { id: string; nombre: string; capacidad: number; espacio_id?: string }>;
    ahora?: string;
  },
): F[] {
  const suyas = lista.filter((a) => a.reserva_id === reservaId);
  const resto = lista.filter((a) => a.reserva_id !== reservaId);
  const reserva = suyas[0]?.reservas ?? datos.reserva ?? null;
  const nuevas: F[] = [];
  for (const mesaId of mesaIds) {
    const yaEstaba = suyas.find((a) => a.mesa_id === mesaId);
    if (yaEstaba) {
      nuevas.push(yaEstaba);
      continue;
    }
    const mesa = datos.mesas.get(mesaId);
    if (!reserva || !mesa) continue;
    nuevas.push({
      id: `local-${reservaId}-${mesaId}`,
      reserva_id: reservaId,
      mesa_id: mesaId,
      created_at: datos.ahora ?? new Date().toISOString(),
      reservas: reserva,
      mesas: { id: mesa.id, nombre: mesa.nombre, capacidad: mesa.capacidad, espacio_id: mesa.espacio_id },
    } as F);
  }
  return [...resto, ...nuevas];
}
