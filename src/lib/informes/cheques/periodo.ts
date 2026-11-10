/**
 * Periodos del informe de cheques regalo: un mes (como el informe de tráfico web) o un año, y el periodo anterior
 * con el que se compara. Funciones puras: `hoy` es el día de Madrid en `yyyy-MM-dd`.
 *
 *   · Mes cerrado      → el mes entero frente al mes anterior entero.
 *   · Mes en curso     → del día 1 a hoy frente a los mismos días del mes anterior (sin pasar de su último día).
 *   · Año cerrado      → el año entero frente al anterior.
 *   · Año en curso     → del 1 de enero a hoy frente al mismo tramo del año anterior.
 *
 * A diferencia del tráfico web, el día de hoy SÍ cuenta: las ventas y canjes se guardan al momento.
 */
import { addDays, differenceInCalendarDays, endOfMonth, endOfYear, format, isValid, parseISO, startOfMonth, subMonths, subYears } from "date-fns";
import { fmtMes, fmtMesAnio, mayusculaInicial } from "@/components/trafico-web/informe/formatoInforme";

const ISO = "yyyy-MM-dd";

export type TipoPeriodo = "mes" | "anio";

export interface PeriodoInforme {
  tipo: TipoPeriodo;
  /** `yyyy-MM` (mes) o `yyyy` (año). */
  clave: string;
  desde: string;
  /** Último día con datos: el fin del periodo o hoy si está en curso. */
  hasta: string;
  /** Fin natural del periodo (último día del mes o del año). */
  fin: string;
  desdeAnterior: string;
  hastaAnterior: string;
  enCurso: boolean;
  dias: number;
  /** «octubre 2026» / «2026». */
  nombre: string;
  /** «septiembre» / «2025»: para «frente a …». */
  nombreAnterior: string;
  /** «Del 1 al 31 de octubre de 2026 · comparado con septiembre». */
  descripcion: string;
}

export interface OpcionPeriodo {
  clave: string;
  etiqueta: string;
  tipo: TipoPeriodo;
}

const esMes = (clave: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(clave);
const esAnio = (clave: string) => /^\d{4}$/.test(clave);
const minimo = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);

/** Periodo de una clave (`2026-10` o `2026`). Lanza si la clave no es válida o el periodo aún no ha empezado. */
export function periodoInforme(clave: string, hoy: string): PeriodoInforme {
  const dia = parseISO(hoy);
  if (!isValid(dia)) throw new Error(`Día no válido: ${hoy}`);
  if (esMes(clave)) {
    const ini = parseISO(`${clave}-01`);
    if (ini.getTime() > dia.getTime()) throw new Error(`El mes ${clave} aún no ha empezado`);
    const fin = endOfMonth(ini);
    const hasta = minimo(fin, dia);
    const enCurso = hasta.getTime() < fin.getTime();
    const dias = differenceInCalendarDays(hasta, ini) + 1;
    const iniAnt = subMonths(ini, 1);
    const finAnt = endOfMonth(iniAnt);
    const hastaAnt = enCurso ? minimo(addDays(iniAnt, dias - 1), finAnt) : finAnt;
    const nombre = fmtMesAnio(format(ini, ISO));
    const nombreAnterior = fmtMes(format(iniAnt, ISO));
    const tramo = `Del 1 al ${hasta.getDate()} de ${fmtMes(format(ini, ISO))} de ${ini.getFullYear()}`;
    return {
      tipo: "mes",
      clave,
      desde: format(ini, ISO),
      hasta: format(hasta, ISO),
      fin: format(fin, ISO),
      desdeAnterior: format(iniAnt, ISO),
      hastaAnterior: format(hastaAnt, ISO),
      enCurso,
      dias,
      nombre,
      nombreAnterior,
      descripcion: `${tramo}${enCurso ? " (en curso)" : ""} · comparado con ${enCurso ? `los mismos días de ${nombreAnterior}` : nombreAnterior}`,
    };
  }
  if (esAnio(clave)) {
    const ini = parseISO(`${clave}-01-01`);
    if (ini.getTime() > dia.getTime()) throw new Error(`El año ${clave} aún no ha empezado`);
    const fin = endOfYear(ini);
    const hasta = minimo(fin, dia);
    const enCurso = hasta.getTime() < fin.getTime();
    const iniAnt = subYears(ini, 1);
    const hastaAnt = enCurso ? subYears(hasta, 1) : endOfYear(iniAnt);
    const nombreAnterior = String(iniAnt.getFullYear());
    return {
      tipo: "anio",
      clave,
      desde: format(ini, ISO),
      hasta: format(hasta, ISO),
      fin: format(fin, ISO),
      desdeAnterior: format(iniAnt, ISO),
      hastaAnterior: format(hastaAnt, ISO),
      enCurso,
      dias: differenceInCalendarDays(hasta, ini) + 1,
      nombre: clave,
      nombreAnterior,
      descripcion: enCurso
        ? `Del 1 de enero al ${format(hasta, "d")} de ${fmtMes(format(hasta, ISO))} de ${clave} · comparado con el mismo tramo de ${nombreAnterior}`
        : `Año ${clave} completo · comparado con ${nombreAnterior}`,
    };
  }
  throw new Error(`Periodo no válido: ${clave}`);
}

/** El mes en curso y los `meses` anteriores, más el año en curso y los `anios` anteriores. */
export function periodosSeleccionables(hoy: string, meses = 12, anios = 2): OpcionPeriodo[] {
  const base = startOfMonth(parseISO(hoy));
  const opciones: OpcionPeriodo[] = [];
  for (let i = 0; i <= meses; i++) {
    const m = subMonths(base, i);
    opciones.push({ clave: format(m, "yyyy-MM"), etiqueta: `${mayusculaInicial(fmtMesAnio(format(m, ISO)))}${i === 0 ? " (en curso)" : ""}`, tipo: "mes" });
  }
  for (let i = 0; i <= anios; i++) {
    const a = base.getFullYear() - i;
    opciones.push({ clave: String(a), etiqueta: `Año ${a}${i === 0 ? " (en curso)" : ""}`, tipo: "anio" });
  }
  return opciones;
}

/** Por defecto, el último mes cerrado (como el informe de tráfico web). */
export const periodoPorDefecto = (hoy: string): string => format(subMonths(startOfMonth(parseISO(hoy)), 1), "yyyy-MM");
