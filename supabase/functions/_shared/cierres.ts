// ============================================================
// CIERRES DE RESERVAS — módulo compartido (web, panel y tests)
// ============================================================
// Encargo del dueño (2026-10-13): no se cogen reservas los LUNES y JUEVES
// (todo el día) ni los DOMINGOS por la noche; el personal puede cerrar un
// día o servicio concreto desde el calendario, y abrir uno que cierra por
// defecto.
//
// La regla vive en la base de datos (migración 20261013120000):
//   - semanal: `configuracion_reservas.dias_cerrados_comida/cena`
//   - excepciones: tabla `cierres_reserva` (abierto = false cierra,
//     abierto = true abre)
//   - consulta: RPC `servicios_cerrados_reserva(desde, hasta)` -> solo los
//     servicios CERRADOS.
// Este fichero solo tiene lo puro: la regla por defecto (de respaldo
// mientras la migración no esté aplicada), agrupar el resultado por día y
// decidir qué fila escribir al cerrar/abrir.
//
// Mismas reglas que `disponibilidad.ts`: CERO imports, CERO efectos.
// La copia JS del bot telefónico (restaurante-phone/api/_cierres.js) tiene
// la MISMA regla por defecto: si se cambia aquí, cámbiese allí.
// ============================================================

export type TurnoServicio = "comida" | "cena";
export const TURNOS_SERVICIO: readonly TurnoServicio[] = ["comida", "cena"];

export type OrigenCierre = "semanal" | "manual";

/** Una fila de `servicios_cerrados_reserva`. */
export interface ServicioCerrado {
  fecha: string;
  turno: TurnoServicio;
  origen: OrigenCierre;
  motivo?: string | null;
}

/** Días de la semana (0 = domingo … 6 = sábado) cerrados por servicio. */
export interface CierreSemanal {
  comida: readonly number[];
  cena: readonly number[];
}

/** Lunes y jueves todo el día; domingo, la cena. */
export const CIERRE_SEMANAL_POR_DEFECTO: CierreSemanal = {
  comida: [1, 4],
  cena: [0, 1, 4],
};

/** Corte comida/cena: el mismo que `turnoDeHora` y el trigger de aforo. */
export function turnoDeHoraServicio(hora: string): TurnoServicio {
  return String(hora || "").slice(0, 5) < "17:00" ? "comida" : "cena";
}

/** 0 = domingo … 6 = sábado, sin zona horaria. `null` si la fecha no vale. */
export function diaSemanaDe(fecha: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

/** Lee la regla semanal de una fila de `configuracion_reservas` (o la por defecto). */
export function cierreSemanalDesde(config: unknown): CierreSemanal {
  const c = (config ?? {}) as { dias_cerrados_comida?: unknown; dias_cerrados_cena?: unknown };
  const lista = (v: unknown, defecto: readonly number[]) =>
    Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : defecto;
  return {
    comida: lista(c.dias_cerrados_comida, CIERRE_SEMANAL_POR_DEFECTO.comida),
    cena: lista(c.dias_cerrados_cena, CIERRE_SEMANAL_POR_DEFECTO.cena),
  };
}

/** ¿Ese servicio cierra por la regla semanal? */
export function cierraPorSemana(
  fecha: string,
  turno: TurnoServicio,
  semanal: CierreSemanal = CIERRE_SEMANAL_POR_DEFECTO,
): boolean {
  const dia = diaSemanaDe(fecha);
  return dia !== null && semanal[turno].includes(dia);
}

function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * Lo mismo que la RPC pero SOLO con la regla semanal: el respaldo cuando la
 * RPC no existe todavía (migración sin aplicar) o falla.
 */
export function serviciosCerradosPorSemana(
  desde: string,
  hasta: string,
  semanal: CierreSemanal = CIERRE_SEMANAL_POR_DEFECTO,
): ServicioCerrado[] {
  const salida: ServicioCerrado[] = [];
  if (diaSemanaDe(desde) === null || diaSemanaDe(hasta) === null || hasta < desde) return salida;
  let fecha = desde;
  for (let i = 0; i <= 400 && fecha <= hasta; i++) {
    for (const turno of TURNOS_SERVICIO) {
      if (cierraPorSemana(fecha, turno, semanal)) salida.push({ fecha, turno, origen: "semanal", motivo: null });
    }
    fecha = sumarDias(fecha, 1);
  }
  return salida;
}

/** Normaliza las filas que devuelve la RPC (descarta basura). */
export function normalizarServiciosCerrados(filas: unknown): ServicioCerrado[] {
  if (!Array.isArray(filas)) return [];
  return filas
    .map((f) => f as Record<string, unknown>)
    .filter((f) => f && typeof f.fecha === "string" && (f.turno === "comida" || f.turno === "cena"))
    .map((f) => ({
      fecha: String(f.fecha).slice(0, 10),
      turno: f.turno as TurnoServicio,
      origen: f.origen === "manual" ? "manual" : "semanal",
      motivo: typeof f.motivo === "string" ? f.motivo : null,
    }));
}

/** Turnos cerrados de una fecha. */
export function turnosCerradosEn(cierres: readonly ServicioCerrado[], fecha: string): TurnoServicio[] {
  return TURNOS_SERVICIO.filter((t) => cierres.some((c) => c.fecha === fecha && c.turno === t));
}

/** `fecha -> turnos cerrados`, solo con los días que tienen alguno. */
export function cierresPorDia(cierres: readonly ServicioCerrado[]): Record<string, ServicioCerrado[]> {
  const mapa: Record<string, ServicioCerrado[]> = {};
  for (const c of cierres) (mapa[c.fecha] ||= []).push(c);
  return mapa;
}

/** «todo el día» | «a mediodía» | «por la noche», para textos al cliente. */
export function textoTurnosCerrados(turnos: readonly TurnoServicio[]): string {
  if (turnos.includes("comida") && turnos.includes("cena")) return "en todo el día";
  if (turnos.includes("comida")) return "a mediodía";
  if (turnos.includes("cena")) return "por la noche";
  return "";
}

/**
 * Qué hay que escribir en `cierres_reserva` para dejar un servicio
 * cerrado (`cerrar = true`) o abierto. Si el estado pedido coincide con la
 * regla semanal, la excepción sobra y se BORRA; si no, se guarda.
 */
export function cambioCierre(
  fecha: string,
  turno: TurnoServicio,
  cerrar: boolean,
  semanal: CierreSemanal = CIERRE_SEMANAL_POR_DEFECTO,
): { tipo: "borrar" } | { tipo: "guardar"; abierto: boolean } {
  const porSemana = cierraPorSemana(fecha, turno, semanal);
  if (porSemana === cerrar) return { tipo: "borrar" };
  return { tipo: "guardar", abierto: !cerrar };
}
