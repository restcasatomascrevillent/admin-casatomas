/**
 * Números y fechas del informe en es-ES, con el estilo del informe de redes del
 * dueño: miles con punto también en cifras de 4 dígitos («9.903»; `Intl` en
 * es-ES no agrupa por debajo de 10.000), coma decimal y espacio antes de «%».
 * Ese espacio es de no separación (U+00A0) para que «%» nunca quede solo al
 * principio de una línea. Funciones puras y deterministas (no dependen de la
 * versión de ICU).
 */
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";

/** Espacio de no separación entre la cifra y «%». */
export const ESPACIO_PCT = "\u00A0";

const agruparMiles = (entero: string): string => entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Número con `decimales` fijos: 1234.5 → «1.234,5». El signo menos es el tipográfico (−). */
export function fmtCifra(v: number, decimales = 0): string {
  const negativo = v < 0 && Math.abs(v) >= 0.5 * 10 ** -decimales;
  const [entero, dec] = Math.abs(v).toFixed(decimales).split(".");
  return `${negativo ? "−" : ""}${agruparMiles(entero)}${dec ? `,${dec}` : ""}`;
}

/** Entero redondeado: 16850 → «16.850». */
export const fmtEntero = (v: number): string => fmtCifra(Math.round(v), 0);

/** Media diaria y similares: una cifra decimal solo por debajo de 100 («17,0» → «17»; «4,9»). */
export function fmtMedia(v: number): string {
  if (Math.abs(v) >= 100) return fmtEntero(v);
  const t = fmtCifra(v, 1);
  return t.endsWith(",0") ? t.slice(0, -2) : t;
}

/** Variación con signo: «+10,8 %», «−66,0 %», «+250 %». */
export function fmtVariacion(v: number): string {
  const decimales = Math.abs(v) >= 100 ? 0 : 1;
  const t = fmtCifra(v, decimales);
  return `${v > 0 && t !== "0" && t !== "0,0" ? "+" : ""}${t}${ESPACIO_PCT}%`;
}

/** Variación sin signo, para frases («un 10,8 % más»). */
export const fmtVariacionAbs = (v: number): string => fmtVariacion(Math.abs(v)).replace(/^\+/, "");

/**
 * Cuota sobre el total: entera de 10 a 99 («67 %»), con un decimal en los
 * extremos para no redondear 99,5 a «100 %» ni 0,4 a «0 %».
 */
export function fmtCuota(p: number): string {
  if (p <= 0) return `0${ESPACIO_PCT}%`;
  if (p >= 100) return `100${ESPACIO_PCT}%`;
  const decimales = p < 10 || p > 99 ? 1 : 0;
  let t = fmtCifra(p, decimales);
  if (t.endsWith(",0") && p >= 10) t = t.slice(0, -2);
  return `${t}${ESPACIO_PCT}%`;
}

/** «octubre 2026». */
export const fmtMesAnio = (isoDia: string): string => format(parseISO(isoDia), "LLLL yyyy", { locale: es });

/** «octubre». */
export const fmtMes = (isoDia: string): string => format(parseISO(isoDia), "LLLL", { locale: es });

/** «jueves 1 de octubre». */
export const fmtDiaLargo = (isoDia: string): string => format(parseISO(isoDia), "EEEE d 'de' LLLL", { locale: es });

/** «1 oct». */
export const fmtDiaCorto = (isoDia: string): string => format(parseISO(isoDia), "d MMM", { locale: es }).replace(".", "");

export const mayusculaInicial = (t: string): string => (t ? t[0].toLocaleUpperCase("es-ES") + t.slice(1) : t);

/** «A, B y C». */
export function unirLista(partes: string[]): string {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}
