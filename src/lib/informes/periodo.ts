// ============================================================================
//  Super Admin › Informes — el periodo de cada informe (cuentas puras, sin React)
// ----------------------------------------------------------------------------
//  Cada informe del registro (./registro.ts) dice qué periodo admite:
//    · «mes»: un mes natural (los 12 últimos y el que va en curso), como el
//      informe de Tráfico web. Por defecto, el último mes cerrado.
//    · «rango»: desde–hasta, con atajos (este mes, mes anterior, este año…)
//      o fechas a mano. Por defecto, el mes anterior.
//    · «ninguno»: el informe no depende de fechas (p. ej. la votación del vino
//      favorito: todos los votos que haya).
//  La página guarda la elección en la URL (?informe=…&mes=… o &desde=…&hasta=…)
//  para poder volver o compartir el enlace.
// ============================================================================
import { format, parseISO, startOfMonth, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import { atajosPeriodo, esFechaIso, textoRango } from "@/lib/facturas/periodoAnalisis";

export type TipoPeriodo = "mes" | "rango" | "ninguno";

export type Periodo =
  | { tipo: "mes"; /** `YYYY-MM` */ mes: string }
  | { tipo: "rango"; /** `YYYY-MM-DD` */ desde: string; /** `YYYY-MM-DD` */ hasta: string }
  | { tipo: "ninguno" };

export interface OpcionMes {
  clave: string;
  etiqueta: string;
  enCurso: boolean;
}

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
export const esMesIso = (v: string | null | undefined): v is string => !!v && RE_MES.test(v);

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** «octubre de 2026». */
export const textoMes = (mes: string): string => format(parseISO(`${mes}-01`), "MMMM 'de' yyyy", { locale: es });

/** Los 12 meses anteriores al actual y, si ya ha pasado el día 1, el que va en curso (el primero). */
export function mesesPorDefecto(hoy: string, cuantos = 12): OpcionMes[] {
  const dia = parseISO(hoy);
  const base = startOfMonth(dia);
  const opciones: OpcionMes[] = [];
  if (dia.getDate() > 1) opciones.push({ clave: format(base, "yyyy-MM"), etiqueta: `${mayuscula(textoMes(format(base, "yyyy-MM")))} (en curso)`, enCurso: true });
  for (let i = 1; i <= cuantos; i++) {
    const m = format(subMonths(base, i), "yyyy-MM");
    opciones.push({ clave: m, etiqueta: mayuscula(textoMes(m)), enCurso: false });
  }
  return opciones;
}

/** El último mes cerrado. */
export const mesAnteriorA = (hoy: string): string => format(subMonths(startOfMonth(parseISO(hoy)), 1), "yyyy-MM");

/** Atajos del periodo «rango» (los mismos de Facturas › Análisis). */
export function atajosRango(hoy: string) {
  return atajosPeriodo(parseISO(hoy));
}

/** Rango por defecto: el mes anterior entero. */
export function rangoPorDefecto(hoy: string): { desde: string; hasta: string } {
  const a = atajosRango(hoy).find((x) => x.id === "mes-anterior")!;
  return { desde: a.desde, hasta: a.hasta };
}

/** Periodo inicial de un informe (lo de la URL si vale; si no, el de por defecto). */
export function periodoInicial(
  tipo: TipoPeriodo,
  hoy: string,
  url: { mes?: string | null; desde?: string | null; hasta?: string | null } = {},
  opciones?: { meses?: OpcionMes[]; mesPorDefecto?: string },
): Periodo {
  if (tipo === "ninguno") return { tipo };
  if (tipo === "mes") {
    const meses = opciones?.meses ?? mesesPorDefecto(hoy);
    const elegido = esMesIso(url.mes) && meses.some((m) => m.clave === url.mes) ? url.mes : null;
    return { tipo, mes: elegido ?? opciones?.mesPorDefecto ?? mesAnteriorA(hoy) };
  }
  const rango = validarRango(url.desde ?? null, url.hasta ?? null);
  return { tipo, ...(rango ?? rangoPorDefecto(hoy)) };
}

/** null si el rango no vale (fechas que no existen o «desde» después de «hasta»). */
export function validarRango(desde: string | null, hasta: string | null): { desde: string; hasta: string } | null {
  if (!esFechaIso(desde) || !esFechaIso(hasta) || desde > hasta) return null;
  return { desde, hasta };
}

/** Texto del periodo para la cabecera y la portada: «Octubre de 2026», «1 – 31 oct 2026», «Todos los datos». */
export function textoPeriodo(p: Periodo): string {
  if (p.tipo === "mes") return mayuscula(textoMes(p.mes));
  if (p.tipo === "rango") return textoRango(p.desde, p.hasta);
  return "Todos los datos";
}

/** Sufijo para el nombre del archivo: «2026-10», «2026-01-01-a-2026-03-31» o «" "» sin periodo. */
export function sufijoArchivo(p: Periodo): string {
  if (p.tipo === "mes") return p.mes;
  if (p.tipo === "rango") return p.desde === p.hasta ? p.desde : `${p.desde}-a-${p.hasta}`;
  return format(new Date(), "yyyy-MM-dd");
}

/** Lo que se escribe en la URL para este periodo. */
export function periodoEnUrl(p: Periodo): Record<string, string> {
  if (p.tipo === "mes") return { mes: p.mes };
  if (p.tipo === "rango") return { desde: p.desde, hasta: p.hasta };
  return {};
}

/** Clave estable para react-query. */
export const clavePeriodo = (p: Periodo): string => JSON.stringify(p);
