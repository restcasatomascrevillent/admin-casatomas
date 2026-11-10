/**
 * Cálculos de la pestaña Stripe de Cheques (puros, sin React): rangos de fechas en hora local, periodo anterior para
 * comparar, variaciones y la serie de ingresos con todos los días (o semanas/meses) del rango, también los vacíos.
 */
import { addDays, differenceInCalendarDays, endOfMonth, format, parseISO, startOfMonth, startOfWeek, startOfYear, subDays, subMonths } from "date-fns";
import { es } from "date-fns/locale";

const ISO = "yyyy-MM-dd";

export type ClaveRango = "mes" | "mes_pasado" | "30" | "90" | "anio" | "personalizado";

export const RANGOS: { clave: ClaveRango; etiqueta: string }[] = [
  { clave: "mes", etiqueta: "Este mes" },
  { clave: "mes_pasado", etiqueta: "Mes pasado" },
  { clave: "30", etiqueta: "Últimos 30 días" },
  { clave: "90", etiqueta: "Últimos 90 días" },
  { clave: "anio", etiqueta: "Este año" },
  { clave: "personalizado", etiqueta: "Fechas a medida" },
];

/** Día de hoy en la zona del navegador (no en UTC: a las 00:30 en España `toISOString()` aún da el día anterior). */
export const hoyLocal = (ahora: Date = new Date()): string => format(ahora, ISO);

/** Fechas de un rango predefinido; `null` para «personalizado». */
export function fechasDeRango(clave: ClaveRango, hoy: string): { desde: string; hasta: string } | null {
  const d = parseISO(hoy);
  switch (clave) {
    case "mes":
      return { desde: format(startOfMonth(d), ISO), hasta: hoy };
    case "mes_pasado": {
      const m = subMonths(startOfMonth(d), 1);
      return { desde: format(m, ISO), hasta: format(endOfMonth(m), ISO) };
    }
    case "30":
      return { desde: format(subDays(d, 29), ISO), hasta: hoy };
    case "90":
      return { desde: format(subDays(d, 89), ISO), hasta: hoy };
    case "anio":
      return { desde: format(startOfYear(d), ISO), hasta: hoy };
    default:
      return null;
  }
}

/** El tramo de igual duración justo antes (para «frente al periodo anterior»). */
export function rangoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const dias = differenceInCalendarDays(parseISO(hasta), parseISO(desde)) + 1;
  return { desde: format(subDays(parseISO(desde), dias), ISO), hasta: format(subDays(parseISO(desde), 1), ISO) };
}

/** % de cambio; `null` si no hay base con la que comparar. */
export function variacionPct(actual: number, anterior: number | null | undefined): number | null {
  if (anterior === null || anterior === undefined || !(anterior > 0)) return null;
  return ((actual - anterior) / anterior) * 100;
}

export interface PuntoIngresos {
  clave: string;
  etiqueta: string;
  /** Texto del tooltip: «lunes 3 de noviembre», «semana del 3 nov», «noviembre 2026». */
  titulo: string;
  bruto_eur: number;
  pagos: number;
}

export type Agrupacion = "dia" | "semana" | "mes";

/** Hasta 62 días, por día; hasta ~9 meses, por semana (lunes); más, por mes. */
export const agrupacionPara = (dias: number): Agrupacion => (dias <= 62 ? "dia" : dias <= 280 ? "semana" : "mes");

/** Serie completa del rango, con ceros donde no hubo pagos (antes solo salían los días con pagos y el eje mentía). */
export function serieIngresos(porDia: { dia: string; pagos: number; bruto_eur: number }[], desde: string, hasta: string): { agrupacion: Agrupacion; puntos: PuntoIngresos[] } {
  const ini = parseISO(desde);
  const dias = Math.max(1, differenceInCalendarDays(parseISO(hasta), ini) + 1);
  const agrupacion = agrupacionPara(dias);
  const claveDe = (fecha: Date) =>
    agrupacion === "dia" ? format(fecha, ISO) : agrupacion === "semana" ? format(startOfWeek(fecha, { weekStartsOn: 1 }), ISO) : format(fecha, "yyyy-MM");
  const puntos = new Map<string, PuntoIngresos>();
  for (let i = 0; i < dias; i++) {
    const fecha = addDays(ini, i);
    const clave = claveDe(fecha);
    if (puntos.has(clave)) continue;
    const base = agrupacion === "mes" ? parseISO(`${clave}-01`) : parseISO(clave);
    puntos.set(clave, {
      clave,
      etiqueta: agrupacion === "mes" ? format(base, "MMM yy", { locale: es }).replace(".", "") : format(base, "dd/MM"),
      titulo:
        agrupacion === "dia"
          ? format(base, "EEEE d 'de' LLLL", { locale: es })
          : agrupacion === "semana"
            ? `Semana del ${format(base, "d MMM", { locale: es }).replace(".", "")}`
            : format(base, "LLLL yyyy", { locale: es }),
      bruto_eur: 0,
      pagos: 0,
    });
  }
  for (const d of porDia) {
    const punto = puntos.get(claveDe(parseISO(d.dia)));
    if (!punto) continue;
    punto.bruto_eur = Math.round((punto.bruto_eur + Number(d.bruto_eur || 0)) * 100) / 100;
    punto.pagos += Number(d.pagos || 0);
  }
  return { agrupacion, puntos: [...puntos.values()] };
}
