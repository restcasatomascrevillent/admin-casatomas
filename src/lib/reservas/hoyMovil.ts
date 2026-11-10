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
import { estaSentadaFuera } from "./sentarFuera";

export interface ReservaHoyMovil {
  id: string;
  nombre: string | null;
  hora: string;
  numero_comensales: number;
  estado: string;
  espacio_id: string | null;
  email?: string | null;
  telefono?: string | null;
  /** «Sentar fuera» (20261122171500): dónde está sentada fuera de las salas; NULL = dentro. */
  fuera_lugar?: string | null;
  fuera_mesa?: string | null;
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
/** Grupo de las sentadas fuera de las salas (Touza, Terraza Touza…): no cuentan en ninguna sala. */
export const CLAVE_FUERA = "fuera";

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
  const fuera: FilaHoyMovil<R>[] = [];

  for (const reserva of reservas) {
    if (reserva.estado === "cancelada") continue;
    if (!coincideFiltroHoy(reserva, filtros)) continue;
    const mesas = mesasDe(reserva.id);
    const terminada = estaTerminada(reserva.estado);
    const fila: FilaHoyMovil<R> = { reserva, mesas, terminada };
    // Sentada fuera: ni «Sin mesa» ni en ninguna sala (no cuenta en sus cifras).
    if (estaSentadaFuera(reserva)) fuera.push(fila);
    else if (mesas.length === 0 && !terminada) sinMesa.push(fila);
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
  if (fuera.length > 0) grupos.push(grupo(CLAVE_FUERA, "Fuera", fuera));
  return grupos;
}

/** «Mesa 3», «Mesas 4 + 5» o «Sin mesa». */
export function textoMesas(mesas: string[]): string {
  if (mesas.length === 0) return "Sin mesa";
  return mesas.length === 1 ? `Mesa ${mesas[0]}` : `Mesas ${mesas.join(" + ")}`;
}

/**
 * La mesa de una reserva con el lenguaje del servicio (07/11/2026): mientras no ha llegado es solo la
 * PREVISIÓN («Prevista: Mesa 7»); sentada, la confirmada («En mesa 9»).
 */
export function textoMesaConfirmada(mesas: string[], sentada: boolean): string {
  if (mesas.length === 0) return "Sin mesa";
  const t = textoMesas(mesas);
  return sentada ? `En ${t.charAt(0).toLowerCase()}${t.slice(1)}` : `Prevista: ${t}`;
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
  /** Mesas que se usan solo como último recurso (para dejar paso): detrás de las demás de su sala. */
  alFinal?: ReadonlySet<string>,
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
        Number(!!alFinal?.has(a.id)) - Number(!!alFinal?.has(b.id)) ||
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

// ─── Lista del camarero (07/11/2026) ─────────────────────────────────────────

export interface ListaHoyMovil<R extends ReservaHoyMovil = ReservaHoyMovil> {
  /** «Llegan ahora»: próximos 15 min y hasta 30 min tarde. */
  llegan: FilaLlegada<R>[];
  /** El resto de las que aún no han llegado, por hora (las pasadas de hora, marcadas «Tarde»). */
  porLlegar: FilaLlegada<R>[];
  /** Ya sentadas («Llegó»), por hora: van abajo y plegadas. */
  sentadas: FilaHoyMovil<R>[];
  /** Sentadas FUERA de las salas (Touza, Terraza Touza…) y aún sin irse, por hora: la lista del móvil las enseña
   * aparte porque no están en ninguna mesa de «Mesas» (es el único sitio donde cambiarlas o deshacerlas). */
  fuera: FilaHoyMovil<R>[];
}

/**
 * La lista de Hoy en móvil, pensada para sentar rápido: primero las que aún no han llegado («Llegan ahora»
 * arriba y luego el resto por hora), y abajo las ya sentadas. «No vino» y canceladas no salen. Mismos
 * filtros (turno y buscador) que la barra.
 */
export function listaHoyMovil<R extends ReservaHoyMovil>(
  reservas: readonly R[],
  mesasDe: (reservaId: string) => string[],
  minutoAhora: number,
  filtros: { busqueda: string; filtroTurno: FiltroTurnoHoy },
): ListaHoyMovil<R> {
  const llegan = lleganAhora(reservas, mesasDe, minutoAhora, filtros);
  const enLlegan = new Set(llegan.map((f) => f.reserva.id));
  const porHora = (a: R, b: R) => a.hora.localeCompare(b.hora) || (a.nombre ?? "").localeCompare(b.nombre ?? "", "es");
  const vivas = reservas.filter((r) => coincideFiltroHoy(r, filtros));
  const porLlegar = vivas
    .filter((r) => ESTADOS_POR_LLEGAR.has(r.estado) && !enLlegan.has(r.id))
    .sort(porHora)
    .map((r) => {
      const m = minutos(r.hora);
      return { reserva: r, mesas: mesasDe(r.id), terminada: false, tarde: m != null && m < minutoAhora };
    });
  const sentadas = vivas
    .filter((r) => r.estado === ESTADO_LLEGADA)
    .sort(porHora)
    .map((r) => ({ reserva: r, mesas: mesasDe(r.id), terminada: true }));
  const fuera = sentadas.filter((f) => estaSentadaFuera(f.reserva) && !(f.reserva as { salida_at?: string | null }).salida_at);
  return { llegan, porLlegar, sentadas, fuera };
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

// ─── Panel del Plano de Hoy: «Reservas en <sala>» ────────────────────────────

/** Ya no esperan a nadie: sentadas, liberadas o «No vino» (van al final y atenuadas). */
export function yaAtendida(r: { estado: string; salida_at?: string | null }): boolean {
  return estaTerminada(r.estado) || !!r.salida_at;
}

/**
 * Las reservas de una sala que YA tienen mesa (sin canceladas), por hora; las ya atendidas al final.
 * El turno y el buscador se aplican antes, en la lista que se pasa.
 */
export function reservasConMesaEnSala<R extends { id: string; hora: string; estado: string; espacio_id: string | null; salida_at?: string | null }>(
  reservas: readonly R[],
  salaId: string,
  tieneMesa: (reservaId: string) => boolean,
): R[] {
  return reservas
    .filter((r) => r.espacio_id === salaId && r.estado !== "cancelada" && tieneMesa(r.id))
    .sort((a, b) => Number(yaAtendida(a)) - Number(yaAtendida(b)) || a.hora.localeCompare(b.hora) || a.id.localeCompare(b.id));
}

// ─── «Hoy» de escritorio: la lista completa por estados (07/11/2026) ─────────

export interface ListaHoyEscritorio<R extends ReservaHoyMovil = ReservaHoyMovil> {
  /** Aún no han llegado (pendiente, verificada, confirmada), por hora; las pasadas de hora, «Tarde». */
  porLlegar: FilaLlegada<R>[];
  /** «Llegó» y siguen en la mesa (sin `salida_at`), por hora. */
  sentadas: FilaHoyMovil<R>[];
  /** Ya se fueron (mesa liberada), «No vino» y canceladas, por hora: al final y plegadas. */
  terminadas: FilaHoyMovil<R>[];
}

/**
 * La lista de «Hoy» de ESCRITORIO (petición del dueño, 07/11/2026: «eso era para el móvil»): TODAS las reservas
 * del día del turno elegido, agrupadas por estado. Mismos filtros (turno y buscador) que la barra.
 */
export function listaHoyEscritorio<R extends ReservaHoyMovil & { salida_at?: string | null }>(
  reservas: readonly R[],
  mesasDe: (reservaId: string) => string[],
  minutoAhora: number,
  filtros: { busqueda: string; filtroTurno: FiltroTurnoHoy },
): ListaHoyEscritorio<R> {
  const porHora = (a: R, b: R) => a.hora.localeCompare(b.hora) || (a.nombre ?? "").localeCompare(b.nombre ?? "", "es");
  const vistas = reservas.filter((r) => coincideFiltroHoy(r, filtros)).sort(porHora);
  const porLlegar: FilaLlegada<R>[] = [];
  const sentadas: FilaHoyMovil<R>[] = [];
  const terminadas: FilaHoyMovil<R>[] = [];
  const vistos = new Set<string>();
  for (const r of vistas) {
    if (vistos.has(r.id)) continue;
    vistos.add(r.id);
    if (ESTADOS_POR_LLEGAR.has(r.estado)) {
      const m = minutos(r.hora);
      porLlegar.push({ reserva: r, mesas: mesasDe(r.id), terminada: false, tarde: m != null && m < minutoAhora });
    } else if (r.estado === ESTADO_LLEGADA && !r.salida_at) {
      sentadas.push({ reserva: r, mesas: mesasDe(r.id), terminada: false });
    } else if (r.estado === ESTADO_LLEGADA || r.estado === ESTADO_NO_SHOW || r.estado === "cancelada") {
      terminadas.push({ reserva: r, mesas: mesasDe(r.id), terminada: true });
    }
  }
  return { porLlegar, sentadas, terminadas };
}

/** Palabras que en la nota del cliente avisan de una alergia o intolerancia (icono en la lista de escritorio). */
const RE_ALERGIA = /alerg|intoleran|cel[ií]ac|gluten|lactosa|frutos secos|marisco/i;

export const tieneAlergia = (notas: string | null | undefined) => RE_ALERGIA.test(notas ?? "");

// ─── Hoja de una mesa libre (móvil): a quién sentar aquí (08/11/2026) ────────

/** Una mesa de una reserva, con su sala, para decir dónde está («Comedor 7»). */
export interface MesaDeReserva {
  id: string;
  nombre: string;
  sala?: string;
}

export type SituacionReserva = "sin_mesa" | "aqui" | "prevista" | "fijada";

export interface CandidataMesa<R extends ReservaHoyMovil = ReservaHoyMovil> {
  reserva: R;
  situacion: SituacionReserva;
  /** «Sin mesa», «Prevista aquí», «Prevista: Comedor 7», «Fijada · Comedor 7». */
  textoSituacion: string;
  /** Sus mesas (las previstas o fijadas), si tiene. */
  mesas: MesaDeReserva[];
  /** Son más personas que plazas tiene esta mesa. */
  noCaben: boolean;
  /** Ya pasó su hora y no ha llegado. */
  retrasada: boolean;
}

/** «Comedor 7» o «Comedor 7+8». */
function textoMesasConSala(mesas: readonly MesaDeReserva[]): string {
  const sala = mesas[0]?.sala;
  return `${sala ? `${sala} ` : ""}${mesas.map((m) => m.nombre).join("+")}`;
}

/** «la mesa 7 del Comedor» / «las mesas 7+8 del Comedor», para la confirmación de quitar la fijación. */
export function textoMesaFijada(mesas: readonly MesaDeReserva[]): string {
  const nombres = mesas.map((m) => m.nombre).join("+");
  const sala = mesas[0]?.sala;
  return `${mesas.length > 1 ? "las mesas" : "la mesa"} ${nombres}${sala ? ` del ${sala}` : ""}`;
}

/**
 * A quién sentar en una mesa libre (hoja de mesa del móvil, petición del dueño 08/11/2026: «grande y claro»).
 * Las que aún no han llegado en el turno, en tres grupos:
 *   · `encajan`: caben y no tienen mesa (o la tienen prevista aquí): las retrasadas arriba y luego por hora;
 *   · `otras`: no caben, o tienen prevista otra mesa: por hora;
 *   · `fijadasOtra`: tienen FIJADA otra mesa: al final (la vista las atenúa y pide confirmación).
 */
export function candidatasParaMesa<R extends ReservaHoyMovil & { mesa_fijada?: boolean | null }>(
  reservas: readonly R[],
  opciones: {
    mesaId: string;
    plazas: number;
    turno: "comida" | "cena";
    turnoDe: (hora: string) => "comida" | "cena";
    minutoAhora: number;
    mesasDe: (reservaId: string) => MesaDeReserva[];
  },
): { encajan: CandidataMesa<R>[]; otras: CandidataMesa<R>[]; fijadasOtra: CandidataMesa<R>[] } {
  const encajan: CandidataMesa<R>[] = [];
  const otras: CandidataMesa<R>[] = [];
  const fijadasOtra: CandidataMesa<R>[] = [];
  for (const r of reservas) {
    if (!ESTADOS_POR_LLEGAR.has(r.estado) || opciones.turnoDe(r.hora) !== opciones.turno) continue;
    const mesas = opciones.mesasDe(r.id);
    const aqui = mesas.some((m) => m.id === opciones.mesaId);
    const fijada = !!r.mesa_fijada && mesas.length > 0;
    const situacion: SituacionReserva = mesas.length === 0 ? "sin_mesa" : aqui ? "aqui" : fijada ? "fijada" : "prevista";
    const textoSituacion =
      situacion === "sin_mesa"
        ? "Sin mesa"
        : situacion === "aqui"
          ? fijada ? "Fijada aquí" : "Prevista aquí"
          : situacion === "fijada"
            ? `Fijada · ${textoMesasConSala(mesas)}`
            : `Prevista: ${textoMesasConSala(mesas)}`;
    const m = minutos(r.hora);
    const fila: CandidataMesa<R> = {
      reserva: r,
      situacion,
      textoSituacion,
      mesas,
      noCaben: (r.numero_comensales || 0) > opciones.plazas,
      retrasada: m != null && m < opciones.minutoAhora,
    };
    if (situacion === "fijada") fijadasOtra.push(fila);
    else if (!fila.noCaben && (situacion === "sin_mesa" || situacion === "aqui")) encajan.push(fila);
    else otras.push(fila);
  }
  const porHora = (a: CandidataMesa<R>, b: CandidataMesa<R>) =>
    a.reserva.hora.localeCompare(b.reserva.hora) || (a.reserva.nombre ?? "").localeCompare(b.reserva.nombre ?? "", "es");
  encajan.sort((a, b) => Number(b.retrasada) - Number(a.retrasada) || porHora(a, b));
  otras.sort(porHora);
  fijadasOtra.sort(porHora);
  return { encajan, otras, fijadasOtra };
}
