// ============================================================================
// VENTANA DE ASIGNACIÓN — lógica pura del panel "Asignación" (Fase B)
// ----------------------------------------------------------------------------
// Decisión del dueño (2026-09-29, engram sdd/reservas-sin-salas/decisiones): el
// cliente de Casa Tomás reserva solo una hora; la sala y la mesa se deciden por
// dentro. El panel pone ARRIBA las reservas de las próximas N horas
// (`configuracion_reservas.asignacion_ventana_horas`, 48 por defecto) para que
// el equipo las reparta a tiempo.
//
// La ventana SOLO RESALTA, nunca bloquea: se puede asignar sala y mesa a
// cualquier reserva futura, esté dentro o fuera. Una reserva creada con menos
// de N horas de antelación cae directamente en la ventana.
//
// Las horas de `reservas` son hora local de Madrid (columnas `date` + `time`
// sin zona). Aquí se convierten a instante real con la zona Europe/Madrid, así
// el resultado no depende de la zona del navegador ni del equipo de tests.
// ============================================================================

import { z } from "zod";
import { turnoDeHora, type GradoAsignacion, type Turno } from "@/lib/reservas/asignacionMesas";

export const VENTANA_HORAS_POR_DEFECTO = 48;
/** Mismo rango que el CHECK de la migración 20260930110000_config_asignacion. */
export const VENTANA_HORAS_MIN = 1;
export const VENTANA_HORAS_MAX = 168;

/** Estados que ocupan sitio y por tanto hay que repartir (los de `vista_asignacion_dia`). */
const ESTADOS_ACTIVOS = new Set(["pendiente", "verificada", "confirmada"]);
export const esReservaActiva = (estado: string | null | undefined) => ESTADOS_ACTIVOS.has(String(estado ?? ""));

const ORDEN_GRADOS: readonly GradoAsignacion[] = ["sin_sala", "sin_mesa", "con_mesa"];

const ZONA_RESTAURANTE = "Europe/Madrid";
const MS_HORA = 3_600_000;

// ----------------------------------------------------------------------------
// Configuración
// ----------------------------------------------------------------------------

export interface ConfigAsignacion {
  ventanaHoras: number;
  avisoActivo: boolean;
  /** Salas NO usables al asignar. Vacío = todas las activas. */
  espaciosExcluidos: string[];
  /** Mesas NO usables al asignar. Vacío = todas las activas. */
  mesasExcluidas: string[];
}

export interface ColumnasConfigAsignacion {
  asignacion_ventana_horas?: number | null;
  asignacion_aviso_activo?: boolean | null;
  asignacion_espacios_excluidos?: string[] | null;
  asignacion_mesas_excluidas?: string[] | null;
}

/**
 * Lee las cuatro columnas `asignacion_*` con sus valores por defecto. Faltan si
 * la migración B1 aún no está aplicada: entonces se comporta como el default
 * del producto (48 h, aviso activo, todo usable).
 */
export function configAsignacionDesde(config: ColumnasConfigAsignacion | null | undefined): ConfigAsignacion {
  const horas = Number(config?.asignacion_ventana_horas);
  return {
    ventanaHoras: ventanaHorasValida(horas) ? horas : VENTANA_HORAS_POR_DEFECTO,
    avisoActivo: config?.asignacion_aviso_activo ?? true,
    espaciosExcluidos: Array.isArray(config?.asignacion_espacios_excluidos)
      ? [...config.asignacion_espacios_excluidos]
      : [],
    mesasExcluidas: Array.isArray(config?.asignacion_mesas_excluidas) ? [...config.asignacion_mesas_excluidas] : [],
  };
}

/** Entero entre 1 y 168. `NaN` (campo vacío) no es válido. */
export function ventanaHorasValida(horas: number): boolean {
  return Number.isInteger(horas) && horas >= VENTANA_HORAS_MIN && horas <= VENTANA_HORAS_MAX;
}

// ----------------------------------------------------------------------------
// Salas y mesas usables
// ----------------------------------------------------------------------------

export interface Exclusiones {
  espaciosExcluidos: readonly string[];
  mesasExcluidas: readonly string[];
}

interface MesaDeSala {
  id: string;
  espacio_id: string;
}

/**
 * Mesas marcadas como usables cuya sala NO es usable. Es una configuración
 * incoherente (el panel nunca ofrecería esa sala, así que la mesa tampoco) y el
 * formulario la rechaza.
 */
export function mesasIncoherentes(exclusiones: Exclusiones, mesas: readonly MesaDeSala[]): string[] {
  const salas = new Set(exclusiones.espaciosExcluidos);
  const mesasFuera = new Set(exclusiones.mesasExcluidas);
  return mesas.filter((m) => salas.has(m.espacio_id) && !mesasFuera.has(m.id)).map((m) => m.id);
}

/** Mensajes del formulario (visibles para el personal). */
const MENSAJE_VENTANA = `Indica entre ${VENTANA_HORAS_MIN} y ${VENTANA_HORAS_MAX} horas (una semana como máximo)`;

/**
 * Validación de los cuatro campos de asignación del formulario de
 * Configuración. Recibe las mesas (con su sala) porque una regla cruza las dos
 * listas: una mesa usable de una sala no usable se rechaza.
 */
export function crearEsquemaConfigAsignacion(mesas: readonly MesaDeSala[]) {
  return z
    .object({
      asignacion_ventana_horas: z
        .number({ required_error: MENSAJE_VENTANA, invalid_type_error: MENSAJE_VENTANA })
        .int(MENSAJE_VENTANA)
        .min(VENTANA_HORAS_MIN, MENSAJE_VENTANA)
        .max(VENTANA_HORAS_MAX, MENSAJE_VENTANA),
      asignacion_aviso_activo: z.boolean(),
      asignacion_espacios_excluidos: z.array(z.string()),
      asignacion_mesas_excluidas: z.array(z.string()),
    })
    .superRefine((valores, ctx) => {
      const sueltas = mesasIncoherentes(
        { espaciosExcluidos: valores.asignacion_espacios_excluidos, mesasExcluidas: valores.asignacion_mesas_excluidas },
        mesas,
      );
      if (sueltas.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["asignacion_mesas_excluidas"],
          message:
            sueltas.length === 1
              ? "Hay una mesa marcada como usable en una sala que no lo es"
              : `Hay ${sueltas.length} mesas marcadas como usables en salas que no lo son`,
        });
      }
    });
}

/** Marca una sala como no usable y, con ella, todas sus mesas. */
export function excluirSala(exclusiones: Exclusiones, espacioId: string, mesas: readonly MesaDeSala[]) {
  const espaciosExcluidos = exclusiones.espaciosExcluidos.includes(espacioId)
    ? [...exclusiones.espaciosExcluidos]
    : [...exclusiones.espaciosExcluidos, espacioId];
  const mesasExcluidas = [...exclusiones.mesasExcluidas];
  for (const m of mesas) {
    if (m.espacio_id === espacioId && !mesasExcluidas.includes(m.id)) mesasExcluidas.push(m.id);
  }
  return { espaciosExcluidos, mesasExcluidas };
}

/** Vuelve a hacer usable una sala y todas sus mesas. */
export function incluirSala(exclusiones: Exclusiones, espacioId: string, mesas: readonly MesaDeSala[]) {
  const deLaSala = new Set(mesas.filter((m) => m.espacio_id === espacioId).map((m) => m.id));
  return {
    espaciosExcluidos: exclusiones.espaciosExcluidos.filter((id) => id !== espacioId),
    mesasExcluidas: exclusiones.mesasExcluidas.filter((id) => !deLaSala.has(id)),
  };
}

// ----------------------------------------------------------------------------
// Tiempo (hora de Madrid)
// ----------------------------------------------------------------------------

const formateadorMadrid = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_RESTAURANTE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partesMadrid(instante: number) {
  const partes: Record<string, number> = {};
  for (const p of formateadorMadrid.formatToParts(new Date(instante))) {
    if (p.type !== "literal") partes[p.type] = Number(p.value);
  }
  return partes;
}

/** Diferencia (ms) entre la hora de pared de Madrid y UTC en ese instante. */
function desfaseMadrid(instante: number): number {
  const p = partesMadrid(instante);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instante / 1000) * 1000;
}

/** Día de Madrid (`YYYY-MM-DD`) en ese instante. */
export function fechaMadrid(instante: number | Date): string {
  const p = partesMadrid(typeof instante === "number" ? instante : instante.getTime());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** `YYYY-MM-DD` + n días (calendario, sin zonas). */
export function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * Instante (ms epoch) de una reserva: su `fecha` + `hora` leídas como hora de
 * Madrid. `null` si no se pueden leer.
 */
export function instanteReserva(fecha: string | null | undefined, hora: string | null | undefined): number | null {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha ?? ""));
  const h = /^(\d{1,2}):(\d{2})/.exec(String(hora ?? ""));
  if (!f || !h) return null;
  const pared = Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]), Number(h[1]), Number(h[2]));
  // Dos pasadas: el desfase se mide primero en la hora "como si fuera UTC" y
  // luego en el instante ya corregido, que es el bueno en los cambios de hora.
  const primera = pared - desfaseMadrid(pared);
  return pared - desfaseMadrid(primera);
}

// ----------------------------------------------------------------------------
// Ventana y agrupación
// ----------------------------------------------------------------------------

/** Lo mínimo de una fila de `vista_asignacion_dia` que usa este módulo. */
export interface ReservaVentana {
  reserva_id: string;
  fecha: string;
  hora: string;
  estado: string;
  grado: GradoAsignacion;
  numero_comensales: number;
  /** Si falta, se deduce de la hora (corte 17:00, igual que el SQL). */
  turno?: Turno;
}

const aMs = (ahora: number | Date) => (typeof ahora === "number" ? ahora : ahora.getTime());

/**
 * ¿Está la reserva entre ahora y ahora + N horas (ambos bordes incluidos)?
 * Solo reservas activas: una cancelada nunca está en la ventana.
 */
export function enVentana(
  reserva: Pick<ReservaVentana, "fecha" | "hora" | "estado">,
  ventanaHoras: number,
  ahora: number | Date,
): boolean {
  if (!esReservaActiva(reserva.estado)) return false;
  const instante = instanteReserva(reserva.fecha, reserva.hora);
  if (instante == null) return false;
  const t = aMs(ahora);
  return instante >= t && instante <= t + ventanaHoras * MS_HORA;
}

const compararPorMomento = (a: ReservaVentana, b: ReservaVentana) =>
  a.fecha !== b.fecha ? (a.fecha < b.fecha ? -1 : 1) : a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : 0;

/**
 * Parte las reservas en dos listas, cada una por fecha y hora: primero las de
 * la ventana, después las posteriores. Quedan fuera las no activas y las que
 * ya han pasado (esas se atienden en la pestaña Hoy).
 */
export function ordenarVentanaPrimero<T extends ReservaVentana>(
  reservas: readonly T[],
  ventanaHoras: number,
  ahora: number | Date,
): { enVentana: T[]; despues: T[] } {
  const t = aMs(ahora);
  const limite = t + ventanaHoras * MS_HORA;
  const dentro: T[] = [];
  const despues: T[] = [];
  for (const r of reservas) {
    if (!esReservaActiva(r.estado)) continue;
    const instante = instanteReserva(r.fecha, r.hora);
    if (instante == null || instante < t) continue;
    (instante <= limite ? dentro : despues).push(r);
  }
  return { enVentana: dentro.sort(compararPorMomento), despues: despues.sort(compararPorMomento) };
}

export interface GrupoGrado<T> {
  grado: GradoAsignacion;
  reservas: T[];
}

export interface GrupoTurno<T> {
  fecha: string;
  turno: Turno;
  grados: GrupoGrado<T>[];
  /** Comensales del turno (todas las reservas del grupo). */
  comensales: number;
  /** Reservas que aún no tienen mesa (`sin_sala` + `sin_mesa`). */
  pendientes: number;
}

/**
 * Agrupa por día y turno (en orden cronológico) y, dentro de cada turno, por
 * grado en el orden de trabajo: sin sala → sin mesa → con mesa. Solo salen los
 * grados que tienen alguna reserva.
 */
export function agruparPorTurnoYGrado<T extends ReservaVentana>(reservas: readonly T[]): GrupoTurno<T>[] {
  const grupos = new Map<string, GrupoTurno<T>>();
  for (const r of [...reservas].sort(compararPorMomento)) {
    const turno = r.turno ?? turnoDeHora(r.hora);
    const clave = `${r.fecha}|${turno}`;
    let grupo = grupos.get(clave);
    if (!grupo) {
      grupo = { fecha: r.fecha, turno, grados: [], comensales: 0, pendientes: 0 };
      grupos.set(clave, grupo);
    }
    let porGrado = grupo.grados.find((g) => g.grado === r.grado);
    if (!porGrado) {
      porGrado = { grado: r.grado, reservas: [] };
      grupo.grados.push(porGrado);
    }
    porGrado.reservas.push(r);
    grupo.comensales += Number(r.numero_comensales) || 0;
    if (r.grado !== "con_mesa") grupo.pendientes += 1;
  }

  const ordenTurno = (t: Turno) => (t === "comida" ? 0 : 1);
  return [...grupos.values()]
    .sort((a, b) => (a.fecha !== b.fecha ? (a.fecha < b.fecha ? -1 : 1) : ordenTurno(a.turno) - ordenTurno(b.turno)))
    .map((g) => ({
      ...g,
      grados: [...g.grados].sort((a, b) => ORDEN_GRADOS.indexOf(a.grado) - ORDEN_GRADOS.indexOf(b.grado)),
    }));
}
