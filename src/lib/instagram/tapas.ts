/**
 * Story del jueves de tapas (12/11/2026): lógica pura, sin red (isomórfica).
 *
 *  - piezaStoryTapas: el JSON de la pieza (ct-tapas o ct-tapas-clasica) a
 *    partir de las tapas guardadas en Gestión web › Tapas.
 *  - semanaDe: la semana (su lunes) a la que pertenece un día: la clave de
 *    «una story por semana».
 *  - instanteProgramacion: el día de las tapas a la hora de los ajustes
 *    (12:00 de Madrid por defecto); si ya ha pasado, dentro de 15 minutos.
 *  - decidirAccion: con la fila de la semana (instagram_story_tapas) y las
 *    tapas nuevas, qué toca: crear, regenerar o nada. La base de datos lo
 *    vuelve a decidir con cerrojo (instagram_story_tapas_reclamar): esto es
 *    para el panel y las pruebas.
 */
import { MAX_CARACTERES_TAPA, MAX_TAPAS, medidasTapas } from "./plantillas/ct-tapas/index.js";

export { MAX_CARACTERES_TAPA, MAX_TAPAS };

export type PlantillaTapas = "ct-tapas" | "ct-tapas-clasica";
export const PLANTILLAS_TAPAS: readonly PlantillaTapas[] = ["ct-tapas", "ct-tapas-clasica"];
export const PLANTILLA_TAPAS_POR_DEFECTO: PlantillaTapas = "ct-tapas";
/** Foto de fondo si no se ha elegido otra: la sala (catálogo estático, no hay que prepararla). */
export const FOTO_TAPAS_POR_DEFECTO = "ct-salon-5";
export const HORA_TAPAS_POR_DEFECTO = "12:00";
/** Si la hora ya ha pasado, se programa dentro de estos minutos (el mínimo de programar es 10). */
export const MINUTOS_SI_YA_PASO = 15;

const ZONA = "Europe/Madrid";
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

function partes(dia: string): { a: number; m: number; d: number } {
  if (!RE_DIA.test(dia)) throw new Error(`Fecha no válida: «${dia}»`);
  const [a, m, d] = dia.split("-").map(Number);
  return { a, m, d };
}

/** 0 = domingo … 6 = sábado (del día civil, sin zona). */
export function diaDeLaSemana(dia: string): number {
  const { a, m, d } = partes(dia);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** «Jueves» (con mayúscula). */
export function nombreDia(dia: string): string {
  const n = DIAS[diaDeLaSemana(dia)];
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** «13 de noviembre». */
export function textoFecha(dia: string): string {
  const { m, d } = partes(dia);
  return `${d} de ${MESES[m - 1]}`;
}

/** Lunes de la semana del día (AAAA-MM-DD). */
export function semanaDe(dia: string): string {
  const { a, m, d } = partes(dia);
  const f = new Date(Date.UTC(a, m - 1, d));
  const desdeLunes = (f.getUTCDay() + 6) % 7;
  f.setUTCDate(f.getUTCDate() - desdeLunes);
  return f.toISOString().slice(0, 10);
}

/** Día y hora de Madrid de un instante. */
export function enMadrid(instante: Date): { dia: string; hora: string } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(instante)
    .reduce<Record<string, string>>((o, x) => ((o[x.type] = x.value), o), {});
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

/** Instante UTC de un día y hora de Madrid (con el cambio de hora). */
export function madridAInstante(dia: string, hora: string): Date {
  const { a, m, d } = partes(dia);
  const [h, min] = hora.split(":").map(Number);
  // Se prueba con el desfase de invierno y de verano y se queda el que, visto en Madrid, da esa hora.
  for (const desfase of [1, 2]) {
    const t = new Date(Date.UTC(a, m - 1, d, h - desfase, min));
    const v = enMadrid(t);
    if (v.dia === dia && v.hora === `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`) return t;
  }
  return new Date(Date.UTC(a, m - 1, d, h - 1, min));
}

/** Hoy en Madrid. */
export function hoyEnMadrid(ahora: Date = new Date()): string {
  return enMadrid(ahora).dia;
}

/** «HH:MM» válida (00:00–23:59); acepta «HH:MM:SS» de Postgres. */
export function normalizarHora(hora: unknown): string {
  const m = typeof hora === "string" ? /^(\d{1,2}):(\d{2})/.exec(hora) : null;
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return HORA_TAPAS_POR_DEFECTO;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/**
 * Cuándo se publica: el día de las tapas a `hora` (Madrid). Si ese momento ya
 * ha pasado (o queda menos de lo que exige programar), dentro de 15 minutos.
 */
export function instanteProgramacion(dia: string, hora: string, ahora: Date = new Date()): { instante: Date; yaPaso: boolean } {
  const objetivo = madridAInstante(dia, normalizarHora(hora));
  const minimo = ahora.getTime() + MINUTOS_SI_YA_PASO * 60_000;
  if (objetivo.getTime() < minimo) return { instante: new Date(minimo), yaPaso: true };
  return { instante: objetivo, yaPaso: false };
}

/** Limpia la lista: sin vacías ni repetidas, sin espacios dobles. */
export function limpiarTapas(tapas: readonly string[]): string[] {
  const vistas = new Set<string>();
  const r: string[] = [];
  for (const t of tapas) {
    const limpia = t.replace(/\s+/g, " ").trim();
    if (!limpia || vistas.has(limpia.toLowerCase())) continue;
    vistas.add(limpia.toLowerCase());
    r.push(limpia);
  }
  return r;
}

/** Huella de las tapas y el día: si cambia, la story se regenera. */
export function huellaTapas(dia: string, tapas: readonly string[]): string {
  const texto = `${dia}\n${limpiarTapas(tapas).join("\n")}`;
  // FNV-1a de 32 bits: basta para comparar (no es seguridad).
  let h = 0x811c9dc5;
  for (const c of texto) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${dia}:${limpiarTapas(tapas).length}:${h.toString(16).padStart(8, "0")}`;
}

/** Problemas de las tapas para la story ([] = valen). Con la plantilla, comprueba además que caben. */
export function problemasTapas(tapas: readonly string[], plantilla?: PlantillaTapas, conPie = false): string[] {
  const limpias = limpiarTapas(tapas);
  const p: string[] = [];
  if (limpias.length === 0) p.push("No hay tapas.");
  if (limpias.length > MAX_TAPAS) p.push(`Hay ${limpias.length} tapas: en la story caben ${MAX_TAPAS} como mucho.`);
  for (const t of limpias) if ([...t].length > MAX_CARACTERES_TAPA) p.push(`«${t.slice(0, 30)}…» es demasiado larga (máximo ${MAX_CARACTERES_TAPA} caracteres).`);
  if (p.length === 0 && plantilla && !medidasTapas(plantilla, limpias, conPie).cabe) {
    p.push("Hay demasiado texto para que se lea bien en la story: acorta alguna tapa o quita alguna.");
  }
  return p;
}

export interface EntradaStoryTapas {
  dia: string;
  tapas: readonly string[];
  plantilla?: PlantillaTapas | string | null;
  foto?: string | null;
  /** Turnos («20:30 y 22:00»): solo los usa la mejorada, en el pie. */
  turnos?: string | null;
}

/** JSON de la pieza (lo que va a /api/instagram-render y se guarda en instagram_piezas.datos). */
export function piezaStoryTapas(e: EntradaStoryTapas): Record<string, unknown> {
  const plantilla: PlantillaTapas = e.plantilla === "ct-tapas-clasica" ? "ct-tapas-clasica" : "ct-tapas";
  const pieza: Record<string, unknown> = {
    marca: "casa-tomas",
    plantilla,
    formato: "story",
    foto: e.foto?.trim() || FOTO_TAPAS_POR_DEFECTO,
    titular: nombreDia(e.dia),
    antetitulo: "De tapas",
    lista: limpiarTapas(e.tapas).map((etiqueta) => ({ etiqueta })),
  };
  if (plantilla === "ct-tapas") {
    pieza.cita = textoFecha(e.dia);
    if (e.turnos?.trim()) pieza.pie = `Turnos ${e.turnos.trim()}`;
  }
  return pieza;
}

/** «20:30 y 22:00» de las horas fijas de configuracion_turnos (["20:30:00","22:00:00"]). null si no hay. */
export function textoTurnos(horas: unknown): string | null {
  if (!Array.isArray(horas)) return null;
  const hs = horas
    .map((h) => (typeof h === "string" ? /^(\d{2}):(\d{2})/.exec(h) : null))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => `${m[1]}:${m[2]}`)
    .sort();
  if (hs.length === 0) return null;
  if (hs.length === 1) return hs[0];
  return `${hs.slice(0, -1).join(", ")} y ${hs[hs.length - 1]}`;
}

// ── Una por semana ───────────────────────────────────────────────────────────

export type EstadoStoryTapas = "preparando" | "programada" | "publicada" | "cancelada" | "error";

/** Fila de instagram_story_tapas (lo que importa para decidir). */
export interface FilaStoryTapas {
  semana: string;
  estado: EstadoStoryTapas;
  huella: string | null;
  pieza_id: string | null;
  programacion_id: string | null;
  bloqueo_hasta?: string | null;
}

export type AccionStoryTapas = "crear" | "regenerar" | "nada";

/**
 * Qué hacer al guardar o activar las tapas (lo mismo que decide la RPC
 * instagram_story_tapas_reclamar, con cerrojo):
 *  - sin fila, o con error sin pieza → crear;
 *  - publicada → nada (nunca dos la misma semana);
 *  - cancelada a mano → nada en automático (el botón manual sí puede);
 *  - otra pasada trabajando (bloqueo vigente) → nada;
 *  - programada (o error con pieza) con otras tapas → regenerar; con las mismas → nada;
 *  - «preparando» con pieza (un «Publicar ahora» a medias) → nada en automático.
 */
export function decidirAccion(fila: FilaStoryTapas | null, huella: string, opciones: { manual?: boolean; ahora?: Date } = {}): AccionStoryTapas {
  if (!fila) return "crear";
  if (fila.estado === "publicada") return "nada";
  const ahora = opciones.ahora ?? new Date();
  if (fila.bloqueo_hasta && new Date(fila.bloqueo_hasta).getTime() > ahora.getTime()) return "nada";
  if (fila.estado === "cancelada") return opciones.manual ? (fila.pieza_id ? "regenerar" : "crear") : "nada";
  if (!fila.pieza_id) return "crear";
  if (opciones.manual) return "regenerar";
  if (fila.huella === huella && fila.estado === "programada") return "nada";
  // «preparando» con pieza = un «Publicar ahora» a medias: el automático no la toca.
  return fila.estado === "programada" || fila.estado === "error" ? "regenerar" : "nada";
}
