/**
 * Lógica pura de las publicaciones programadas de Instagram (sin React ni
 * Supabase, se prueba sola): hora de Madrid ↔ instante, validación de la
 * fecha (las mismas reglas que las RPC de 20261106110000_instagram_programacion),
 * aviso de ±30 min de la misma marca y rejilla del calendario (semana y mes).
 *
 * Las fechas de calendario («día») son cadenas "AAAA-MM-DD" del calendario de
 * Madrid; los instantes, ISO en UTC. Todo pasa por Intl con la zona
 * Europe/Madrid, así que da igual en qué zona esté el dispositivo.
 */

export const ZONA_HORARIA = "Europe/Madrid";
export const MARGEN_MINIMO_MIN = 10;
export const MAXIMO_DIAS = 75;
export const VENTANA_CONFLICTO_MIN = 30;

export type EstadoProgramacion = "programada" | "publicando" | "publicada" | "error" | "cancelada";
export type VistaCalendario = "semana" | "mes";

const MS_MIN = 60_000;
const MS_DIA = 86_400_000;
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA = /^(\d{2}):(\d{2})$/;

const formateador = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONA_HORARIA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dos = (n: number) => String(n).padStart(2, "0");

/** Fecha ("AAAA-MM-DD") y hora ("HH:mm") de Madrid de un instante. */
export function utcAMadrid(instante: Date | string | number): { fecha: string; hora: string } {
  const d = instante instanceof Date ? instante : new Date(instante);
  const p: Record<string, string> = {};
  for (const parte of formateador.formatToParts(d)) p[parte.type] = parte.value;
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}

/** Desfase de Madrid respecto a UTC en ese instante, en minutos (60 o 120). */
function desfaseMin(ms: number): number {
  const { fecha, hora } = utcAMadrid(ms);
  const [y, m, d] = fecha.split("-").map(Number);
  const [h, mi] = hora.split(":").map(Number);
  return Math.round((Date.UTC(y, m - 1, d, h, mi) - Math.floor(ms / MS_MIN) * MS_MIN) / MS_MIN);
}

/**
 * Instante de una fecha y hora de Madrid. null si el formato no vale o si esa
 * hora no existe (el salto de las 02:00 a las 03:00 de finales de marzo). En
 * la hora repetida de finales de octubre se toma la primera (horario de verano).
 */
export function madridAUtc(fecha: string, hora: string): Date | null {
  const f = FECHA.exec(fecha);
  const h = HORA.exec(hora);
  if (!f || !h) return null;
  const [y, m, d, hh, mm] = [Number(f[1]), Number(f[2]), Number(f[3]), Number(h[1]), Number(h[2])];
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  const pared = Date.UTC(y, m - 1, d, hh, mm);
  const candidatos = new Set([desfaseMin(pared - 3 * 3_600_000), desfaseMin(pared + 3 * 3_600_000), desfaseMin(pared)]);
  const validos = [...candidatos]
    .map((off) => pared - off * MS_MIN)
    .filter((t) => {
      const v = utcAMadrid(t);
      return v.fecha === fecha && v.hora === hora;
    })
    .sort((a, b) => a - b);
  return validos.length ? new Date(validos[0]) : null;
}

export type ResultadoValidacion = { ok: true; instante: Date } | { ok: false; error: string };

/** Valida la fecha y hora (de Madrid) elegidas: ≥ ahora + 10 min y ≤ ahora + 75 días. */
export function validarProgramacion(fecha: string, hora: string, ahora: Date = new Date()): ResultadoValidacion {
  if (!fecha || !hora) return { ok: false, error: "Elige la fecha y la hora" };
  const instante = madridAUtc(fecha, hora);
  if (!instante) {
    return FECHA.test(fecha) && HORA.test(hora)
      ? { ok: false, error: "Esa hora no existe en Madrid (es el cambio de hora); elige otra" }
      : { ok: false, error: "La fecha o la hora no son válidas" };
  }
  if (instante.getTime() <= ahora.getTime()) return { ok: false, error: "Esa fecha ya ha pasado" };
  if (instante.getTime() < ahora.getTime() + MARGEN_MINIMO_MIN * MS_MIN) {
    return { ok: false, error: `Hay que programarla con al menos ${MARGEN_MINIMO_MIN} minutos de margen` };
  }
  if (instante.getTime() > ahora.getTime() + MAXIMO_DIAS * MS_DIA) {
    return { ok: false, error: `Como mucho se puede programar a ${MAXIMO_DIAS} días vista` };
  }
  return { ok: true, instante };
}

export interface ProgramacionBasica {
  id: string;
  pieza_id: string;
  marca: string;
  programada_para: string;
  estado: EstadoProgramacion | string;
}

/** Otras programaciones activas de la misma marca a ±30 min (sin contar la propia pieza). */
export function conflictosCercanos<T extends ProgramacionBasica>(lista: readonly T[], marca: string, instante: Date, piezaId: string | null): T[] {
  const t = instante.getTime();
  return lista.filter(
    (p) =>
      p.marca === marca &&
      (p.estado === "programada" || p.estado === "publicando") &&
      p.pieza_id !== piezaId &&
      Math.abs(new Date(p.programada_para).getTime() - t) <= VENTANA_CONFLICTO_MIN * MS_MIN,
  );
}

// ─── Calendario ─────────────────────────────────────────────────────────────

function aMs(dia: string): number {
  const [y, m, d] = dia.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function deMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
}

export function sumarDias(dia: string, n: number): string {
  return deMs(aMs(dia) + n * MS_DIA);
}

/** Día de la semana empezando en lunes (0 = lunes … 6 = domingo). */
export function diaSemana(dia: string): number {
  return (new Date(aMs(dia)).getUTCDay() + 6) % 7;
}

export function hoyMadrid(ahora: Date = new Date()): string {
  return utcAMadrid(ahora).fecha;
}

export function inicioSemana(dia: string): string {
  return sumarDias(dia, -diaSemana(dia));
}

/** Los 7 días (lunes a domingo) de la semana de `dia`. */
export function diasSemana(dia: string): string[] {
  const lunes = inicioSemana(dia);
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

/** 6 semanas (42 días) desde el lunes de la semana del día 1 del mes de `dia`. */
export function diasMes(dia: string): string[] {
  const lunes = inicioSemana(`${dia.slice(0, 7)}-01`);
  return Array.from({ length: 42 }, (_, i) => sumarDias(lunes, i));
}

export function diasVista(vista: VistaCalendario, dia: string): string[] {
  return vista === "semana" ? diasSemana(dia) : diasMes(dia);
}

/** Rango de instantes [desde, hasta) que cubre la vista (de medianoche a medianoche de Madrid). */
export function rangoVista(vista: VistaCalendario, dia: string): { desde: Date; hasta: Date } {
  const dias = diasVista(vista, dia);
  return {
    desde: madridAUtc(dias[0], "00:00") as Date,
    hasta: madridAUtc(sumarDias(dias[dias.length - 1], 1), "00:00") as Date,
  };
}

/** Día de referencia tras avanzar (+1) o retroceder (−1) una semana o un mes. */
export function moverVista(vista: VistaCalendario, dia: string, paso: number): string {
  if (vista === "semana") return sumarDias(dia, 7 * paso);
  const [y, m] = dia.split("-").map(Number);
  const total = y * 12 + (m - 1) + paso;
  return `${Math.floor(total / 12)}-${dos((total % 12) + 1)}-01`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
export const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

export function tituloVista(vista: VistaCalendario, dia: string): string {
  if (vista === "mes") {
    const [y, m] = dia.split("-").map(Number);
    return `${MESES[m - 1]} de ${y}`;
  }
  const dias = diasSemana(dia);
  const [y1, m1, d1] = dias[0].split("-").map(Number);
  const [y2, m2, d2] = dias[6].split("-").map(Number);
  if (y1 !== y2) return `${d1} ${MESES_CORTOS[m1 - 1]} ${y1} – ${d2} ${MESES_CORTOS[m2 - 1]} ${y2}`;
  if (m1 !== m2) return `${d1} ${MESES_CORTOS[m1 - 1]} – ${d2} ${MESES_CORTOS[m2 - 1]} ${y2}`;
  return `${d1}–${d2} ${MESES_CORTOS[m2 - 1]} ${y2}`;
}

/** «lun 10 nov, 13:30» en hora de Madrid. */
export function textoInstante(instante: Date | string): string {
  const { fecha, hora } = utcAMadrid(instante);
  const [, m, d] = fecha.split("-").map(Number);
  return `${DIAS_CORTOS[diaSemana(fecha)]} ${d} ${MESES_CORTOS[m - 1]}, ${hora}`;
}

// ─── Eventos del calendario ─────────────────────────────────────────────────

export interface PiezaResumen {
  id: string;
  marca: string;
  formato: string;
  plantilla: string;
  datos?: Record<string, unknown> | null;
  imagen_ruta: string | null;
  updated_at?: string | null;
  estado?: string | null;
  permalink?: string | null;
  media_id?: string | null;
  publicada_at?: string | null;
}

export interface ProgramacionConPieza extends ProgramacionBasica {
  intentos: number;
  ultimo_error: string | null;
  permalink?: string | null;
  pieza?: PiezaResumen | null;
}

/** Borrador con fecha prevista (campañas, 20261109000000): un plan, aún sin programar. */
export interface BorradorResumen extends PiezaResumen {
  fecha_prevista: string | null;
  campana_id?: string | null;
  /** Programaciones de la pieza (embebidas): si tiene una activa ya sale como programada. */
  programaciones?: Array<{ estado: string }> | null;
}

export interface EventoCalendario {
  clave: string;
  /**
   * «programada» (pendiente, publicándose o con error), «publicada» (pieza ya
   * en Instagram) o «borrador» (fecha prevista de una campaña, sin programar).
   */
  tipo: "programada" | "publicada" | "borrador";
  estado: EstadoProgramacion | "publicada" | "borrador";
  instante: string;
  dia: string;
  hora: string;
  piezaId: string;
  programacionId: string | null;
  marca: string;
  pieza: PiezaResumen | null;
  intentos: number;
  error: string | null;
  permalink: string | null;
}

const ESTADOS_VISIBLES = new Set(["programada", "publicando", "error"]);

/**
 * Eventos de la vista: programaciones pendientes/publicándose/con error (en
 * su hora programada) y piezas publicadas (en su publicada_at, se publicaran
 * a mano o programadas). Las canceladas no salen. Ordenados por instante.
 */
export function construirEventos(
  programaciones: readonly ProgramacionConPieza[],
  publicadas: readonly PiezaResumen[],
  borradores: readonly BorradorResumen[] = [],
): EventoCalendario[] {
  const eventos: EventoCalendario[] = [];
  const conProgramacion = new Set(programaciones.filter((p) => ESTADOS_VISIBLES.has(p.estado)).map((p) => p.pieza_id));
  // Borradores: solo los que aún no están programados ni publicados (si no, ya salen como tales).
  for (const b of borradores) {
    if (!b.fecha_prevista || b.publicada_at || b.media_id || b.estado === "publicada" || conProgramacion.has(b.id)) continue;
    if ((b.programaciones ?? []).some((p) => p.estado === "programada" || p.estado === "publicando")) continue;
    const { fecha, hora } = utcAMadrid(b.fecha_prevista);
    eventos.push({
      clave: `b:${b.id}`,
      tipo: "borrador",
      estado: "borrador",
      instante: b.fecha_prevista,
      dia: fecha,
      hora,
      piezaId: b.id,
      programacionId: null,
      marca: b.marca,
      pieza: b,
      intentos: 0,
      error: null,
      permalink: null,
    });
  }
  for (const p of programaciones) {
    if (!ESTADOS_VISIBLES.has(p.estado)) continue;
    const { fecha, hora } = utcAMadrid(p.programada_para);
    eventos.push({
      clave: `p:${p.id}`,
      tipo: "programada",
      estado: p.estado as EstadoProgramacion,
      instante: p.programada_para,
      dia: fecha,
      hora,
      piezaId: p.pieza_id,
      programacionId: p.id,
      marca: p.marca,
      pieza: p.pieza ?? null,
      intentos: p.intentos ?? 0,
      error: p.ultimo_error ?? null,
      permalink: null,
    });
  }
  for (const pz of publicadas) {
    if (!pz.publicada_at) continue;
    const { fecha, hora } = utcAMadrid(pz.publicada_at);
    eventos.push({
      clave: `i:${pz.id}`,
      tipo: "publicada",
      estado: "publicada",
      instante: pz.publicada_at,
      dia: fecha,
      hora,
      piezaId: pz.id,
      programacionId: null,
      marca: pz.marca,
      pieza: pz,
      intentos: 0,
      error: null,
      permalink: pz.permalink ?? null,
    });
  }
  return eventos.sort((a, b) => new Date(a.instante).getTime() - new Date(b.instante).getTime() || a.clave.localeCompare(b.clave));
}

export function agruparPorDia(eventos: readonly EventoCalendario[]): Map<string, EventoCalendario[]> {
  const mapa = new Map<string, EventoCalendario[]>();
  for (const e of eventos) {
    const lista = mapa.get(e.dia);
    if (lista) lista.push(e);
    else mapa.set(e.dia, [e]);
  }
  return mapa;
}

/** Valor inicial del diálogo: la hora dada, o mañana a las 13:00 de Madrid. */
export function valorInicial(inicial: Date | string | null | undefined, ahora: Date = new Date()): { fecha: string; hora: string } {
  if (inicial) {
    const d = new Date(inicial);
    if (!Number.isNaN(d.getTime()) && d.getTime() > ahora.getTime() + MARGEN_MINIMO_MIN * MS_MIN) return utcAMadrid(d);
  }
  return { fecha: sumarDias(hoyMadrid(ahora), 1), hora: "13:00" };
}

/** Límites del selector de fecha (calendario de Madrid). */
export function limitesFecha(ahora: Date = new Date()): { min: string; max: string } {
  return { min: hoyMadrid(ahora), max: utcAMadrid(new Date(ahora.getTime() + MAXIMO_DIAS * MS_DIA)).fecha };
}
