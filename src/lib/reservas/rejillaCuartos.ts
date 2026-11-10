// ============================================================================
// REJILLA EN CUARTOS DE HORA: lógica pura (sin I/O)
// ----------------------------------------------------------------------------
// Vista INTERNA de disponibilidad (decisión del dueño 2026-09-29,
// reservas-sin-salas): cómo se reparten los comensales a lo largo del turno,
// de 15 en 15 minutos. El cliente reserva una hora, no una sala; esta rejilla
// es para que el personal vea cuándo llega la gente y cuánta hay sentada.
// La pinta `components/reservas/DisponibilidadCuartos.tsx`, con los datos que
// ya trae `useOcupacionSalasDia` (no hay consulta nueva).
//
// CÓMO SE CUENTA:
//   · FRANJAS: TODAS las horas de cada periodo de `configuracion_turnos`, de
//     hora_inicio (incluida) a hora_fin (EXCLUIDA), de 15 en 15 minutos.
//     Mismo `t < fin` que el motor (`generarCandidatos` en disponibilidad.ts),
//     así que con Comida 13-16 salen 13:00…15:45. La ESCALERA se ignora a
//     propósito: aquí interesa ver el turno entero, no lo que se ofrece.
//     EXCEPCIÓN — turnos de HORA FIJA (`horas_fijas`, jueves de tapas por la
//     noche, 20261122200100): ese periodo solo tiene esas horas (20:30 y 22:00),
//     así que solo salen ellas como franjas «turno» (y el alta solo ofrece
//     ésas). La estancia de un turno fijo acaba, como mucho, en el siguiente.
//   · TURNO: corte a las 17:00 (`turnoDeHora`), igual que el trigger
//     `validar_capacidad_reserva`. Una reserva de las 16:45 es de comida.
//   · LLEGAN: comensales cuya hora cae en ese cuarto (13:10 cuenta en 13:00).
//     Si la reserva cae fuera de todos los periodos se añade una franja extra
//     con origen "reserva", para que ningún comensal desaparezca de la vista.
//   · EN SALA: comensales cuya estancia [hora, hora + estancia del turno)
//     SOLAPA el cuarto. Con una reserva en punto de cuarto es exactamente
//     `hora <= franja < hora + estancia` (4 a las 13:00 con 105 min: sentados
//     hasta la franja de las 14:30, a las 14:45 ya no).
//   · Estados: llegan / en sala usan `ocupaEspacio` (pendiente, verificada,
//     confirmada y 'completada': quien ya llegó está sentado). El AFORO del
//     turno usa `ESTADOS_QUE_OCUPAN`, la cuenta exacta del trigger. Canceladas
//     y no presentadas no cuentan nunca.
//   · CAPACIDAD: la del turno de Casa Tomás (suma de sus salas activas). Las
//     salas no limitan nada aquí: son asignación interna. Touza no admite
//     reservas (2026-10-01): sus reservas y salas ya llegan filtradas.
// ============================================================================

import {
  diaDeLaSemana,
  ESTADOS_QUE_OCUPAN,
  horaAMinutos,
  horasFijasDeConfig,
  minutosAHora,
  minutosHastaSiguienteTurnoFijo,
  seleccionarConfiguraciones,
  turnoDeHora,
  type ConfiguracionTurnoInput,
} from "../../../supabase/functions/_shared/disponibilidad";
import { nivelOcupacion, TURNOS, type AforoTurnoDia, type NivelOcupacion, type Turno } from "./ocupacionSalas";
import { ocupaEspacio } from "./servicioSala";

export const PASO_CUARTOS_MINUTOS = 15;
const MINUTOS_DIA = 24 * 60;

/** Periodo de un turno en minutos desde medianoche: [inicio, fin). */
export interface PeriodoCuarto {
  inicio: number;
  fin: number;
  /** Turnos de hora fija (minutos desde medianoche): solo esas franjas. Sin él, cada cuarto. */
  horas?: number[];
}

/** Por qué está una franja: la da el turno, la trae una reserva o es la hora propuesta. */
export type OrigenCuarto = "turno" | "reserva" | "propuesta";

export interface FranjaCuarto {
  /** "HH:MM" */
  hora: string;
  turno: Turno;
  /** Comensales que llegan en este cuarto. */
  llegan: number;
  /** Número de reservas que llegan en este cuarto. */
  reservasQueLlegan: number;
  /** Comensales sentados durante este cuarto (llegados antes y aún sin irse). */
  enSala: number;
  /** Plazas del turno que quedan (capacidad − aforo del trigger). */
  restanteTurno: number;
  /** Nivel de los sentados frente a la capacidad del turno. */
  nivel: NivelOcupacion;
  origen: OrigenCuarto;
}

export interface RejillaCuartos {
  franjas: FranjaCuarto[];
  aforo: Record<Turno, AforoTurnoDia>;
}

export interface ReservaCuarto {
  id?: string | null;
  hora: string;
  numero_comensales: number;
  estado: string;
}

export interface EstanciaTurnos {
  comida: number;
  cena: number;
}

export interface EntradaRejillaCuartos {
  periodos: readonly PeriodoCuarto[];
  /** Reservas del día de Casa Tomás, en cualquier estado (aquí se filtran). */
  reservas: readonly ReservaCuarto[];
  /** Capacidad del turno (suma de las salas activas de Casa Tomás). */
  capacidadTurno: number;
  /** Minutos de estancia estimada por turno (`configuracion_reservas`). */
  estancia: EstanciaTurnos;
  paso?: number;
  /** Grupo que se quiere colocar: se prueba en el aforo del turno de su hora. */
  propuesta?: { hora?: string | null; comensales?: number | null } | null;
  /** Al editar una reserva existente: no contarla contra sí misma. */
  excluirReservaId?: string | null;
}

/**
 * Periodos del día: los turnos generales (`espacio_id` null), los de Casa
 * Tomás, igual que `horasBaseDelDia`. Vacío = ese día no abre.
 */
export function periodosDelDia(
  fecha: string,
  configuraciones: readonly ConfiguracionTurnoInput[] | null | undefined,
): PeriodoCuarto[] {
  const dia = diaDeLaSemana(fecha);
  if (dia === null) return [];

  const vistos = new Map<string, PeriodoCuarto>();
  for (const c of seleccionarConfiguraciones([...(configuraciones ?? [])], null, dia)) {
    const inicio = horaAMinutos(c.hora_inicio);
    let fin = horaAMinutos(c.hora_fin);
    if (inicio === null || fin === null) continue;
    if (fin <= inicio) fin += MINUTOS_DIA; // cruza medianoche
    const fijas = horasFijasDeConfig(c);
    vistos.set(`${inicio}-${fin}`, fijas ? { inicio, fin, horas: fijas } : { inicio, fin });
  }
  return Array.from(vistos.values()).sort((a, b) => a.inicio - b.inicio || a.fin - b.fin);
}

const ocupaAforo = (estado: string) => (ESTADOS_QUE_OCUPAN as readonly string[]).includes(estado);
const paxDe = (r: ReservaCuarto) => Math.max(0, Number(r.numero_comensales) || 0);
const cuartoDe = (minutos: number, paso: number) => Math.floor(minutos / paso) * paso;

export function construirRejillaCuartos(entrada: EntradaRejillaCuartos): RejillaCuartos {
  const paso = entrada.paso && entrada.paso > 0 ? entrada.paso : PASO_CUARTOS_MINUTOS;
  const capacidad = Math.max(0, Number(entrada.capacidadTurno) || 0);
  const reservas = entrada.reservas.filter(
    (r) => !entrada.excluirReservaId || r.id !== entrada.excluirReservaId,
  );

  // --- Aforo del turno: la cuenta exacta del trigger ---
  const minutosPropuesta = horaAMinutos(entrada.propuesta?.hora ?? null);
  const turnoPropuesta: Turno | null = minutosPropuesta === null ? null : turnoDeHora(minutosPropuesta);
  const paxPropuesta = Math.max(0, Number(entrada.propuesta?.comensales) || 0);
  const aforo = {} as Record<Turno, AforoTurnoDia>;
  for (const turno of TURNOS) {
    const ocupados = reservas
      .filter((r) => ocupaAforo(r.estado) && turnoDeHora(r.hora) === turno)
      .reduce((s, r) => s + paxDe(r), 0);
    const tras = ocupados + (turnoPropuesta === turno ? paxPropuesta : 0);
    aforo[turno] = {
      ocupados,
      capacidad,
      tras,
      nivel: nivelOcupacion(ocupados, capacidad),
      cabe: tras <= capacidad,
    };
  }

  // --- Qué franjas hay y de dónde sale cada una ---
  const origenes = new Map<number, OrigenCuarto>();
  const horasFijas: string[] = [];
  for (const p of entrada.periodos) {
    if (p.horas && p.horas.length > 0) {
      for (const h of p.horas) {
        origenes.set(h % MINUTOS_DIA, "turno");
        horasFijas.push(minutosAHora(h % MINUTOS_DIA));
      }
      continue;
    }
    for (let t = Math.ceil(p.inicio / paso) * paso; t < p.fin; t += paso) {
      origenes.set(t % MINUTOS_DIA, "turno");
    }
  }

  // Sentados y llegadas: solo lo que ocupa sitio físico.
  const presentes: { minutos: number; pax: number; estancia: number }[] = [];
  for (const r of reservas) {
    if (!ocupaEspacio(r.estado)) continue;
    const minutos = horaAMinutos(r.hora);
    if (minutos === null) continue;
    const turno = turnoDeHora(minutos);
    const estanciaTurno = turno === "comida" ? entrada.estancia.comida : entrada.estancia.cena;
    // Turno fijo: la mesa hace falta a la hora del siguiente turno (20:30 → hasta las 22:00).
    const hastaSiguiente = minutosHastaSiguienteTurnoFijo(minutos, horasFijas);
    presentes.push({ minutos, pax: paxDe(r), estancia: hastaSiguiente === null ? estanciaTurno : Math.min(estanciaTurno, hastaSiguiente) });
    const cuarto = cuartoDe(minutos, paso);
    if (!origenes.has(cuarto)) origenes.set(cuarto, "reserva");
  }
  if (minutosPropuesta !== null) {
    const cuarto = cuartoDe(minutosPropuesta, paso);
    if (!origenes.has(cuarto)) origenes.set(cuarto, "propuesta");
  }

  const franjas: FranjaCuarto[] = Array.from(origenes.entries())
    .sort(([a], [b]) => a - b)
    .map(([inicio, origen]) => {
      const fin = inicio + paso;
      const turno = turnoDeHora(inicio);
      let llegan = 0;
      let reservasQueLlegan = 0;
      let enSala = 0;
      for (const p of presentes) {
        if (cuartoDe(p.minutos, paso) === inicio) {
          llegan += p.pax;
          reservasQueLlegan += 1;
        }
        if (p.minutos < fin && p.minutos + Math.max(1, p.estancia) > inicio) enSala += p.pax;
      }
      return {
        hora: minutosAHora(inicio),
        turno,
        llegan,
        reservasQueLlegan,
        enSala,
        restanteTurno: capacidad - aforo[turno].ocupados,
        nivel: nivelOcupacion(enSala, capacidad),
        origen,
      };
    });

  return { franjas, aforo };
}
