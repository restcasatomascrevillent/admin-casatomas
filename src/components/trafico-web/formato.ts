import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";

/** Texto que se pinta cuando una métrica es NULL. Nunca se sustituye por 0. */
export const SIN_DATOS = "sin datos";

const fmtEntero = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const fmtDecimal = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const fmtDosDecimales = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const esNulo = (v: number | null | undefined): v is null | undefined =>
  v === null || v === undefined || !Number.isFinite(v);

export const fmtNumero = (v: number | null | undefined): string => (esNulo(v) ? SIN_DATOS : fmtEntero.format(v));

export const fmtDecimal1 = (v: number | null | undefined): string => (esNulo(v) ? SIN_DATOS : fmtDecimal.format(v));

export const fmtDecimal2 = (v: number | null | undefined): string =>
  esNulo(v) ? SIN_DATOS : fmtDosDecimales.format(v);

export const fmtPct = (v: number | null | undefined, conSigno = false): string => {
  if (esNulo(v)) return SIN_DATOS;
  const signo = conSigno && v > 0 ? "+" : "";
  return `${signo}${fmtDecimal.format(v)} %`;
};

/** Cambia el guion de un número negativo («-0,11») por el signo menos tipográfico («−0,11»), que se lee mejor. */
export const menosTipografico = (texto: string): string => texto.replace(/^-/, "−");

/** Bytes en unidades DECIMALES (1 GB = 1e9 B), igual que factura Vercel. */
export const fmtBytes = (v: number | null | undefined): string => {
  if (esNulo(v)) return SIN_DATOS;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${fmtDosDecimales.format(v / 1e9)} GB`;
  if (abs >= 1e6) return `${fmtDecimal.format(v / 1e6)} MB`;
  if (abs >= 1e3) return `${fmtEntero.format(v / 1e3)} KB`;
  return `${fmtEntero.format(v)} B`;
};

export const fmtFechaCorta = (iso: string): string => format(parseISO(iso), "d MMM", { locale: es });

export const fmtFechaLarga = (iso: string): string => format(parseISO(iso), "EEE d MMM yyyy", { locale: es });

export const fmtFechaHora = (iso: string | null | undefined): string =>
  iso ? format(parseISO(iso), "d MMM yyyy, HH:mm", { locale: es }) : SIN_DATOS;

/** Página de uso de Vercel (el `[team]` lo resuelve Vercel con el equipo de la sesión). */
export const URL_USO_VERCEL = "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fusage&title=Uso+de+Vercel";
