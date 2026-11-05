// ============================================================================
//  Facturas › Análisis — el periodo del tablero (cuentas puras, sin React)
// ----------------------------------------------------------------------------
//  Además de Mes · Trimestre · Año · Todo (naturales, como Compras), un rango
//  PERSONALIZADO desde–hasta con atajos (últimos 7/30/90 días, este mes, mes
//  anterior, este año, año pasado). El periodo y el local van a la URL
//  (`?tab=chat&desde=YYYY-MM-DD&hasta=YYYY-MM-DD&local=touza`) para poder
//  volver o compartir el enlace; «Todo» se escribe `periodo=todo`.
// ============================================================================
import { fechasPeriodo, fechaCorta, PERIODO_ANALISIS_POR_DEFECTO, type PeriodoAnalisis } from "./tableroCompras";
import type { FiltroLocal } from "./resumenCompras";

export type SeleccionPeriodo = { tipo: PeriodoAnalisis } | { tipo: "personalizado"; desde: string; hasta: string };

export const SELECCION_POR_DEFECTO: SeleccionPeriodo = { tipo: PERIODO_ANALISIS_POR_DEFECTO };

const dos = (n: number) => String(n).padStart(2, "0");
/** Fecha local (no UTC) como `YYYY-MM-DD`: «hoy» es el día del restaurante. */
export const isoLocal = (d: Date): string => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const RE_ISO = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** `YYYY-MM-DD` que existe de verdad (nada de 31 de febrero). */
export function esFechaIso(v: string | null | undefined): v is string {
  if (!v || !RE_ISO.test(v)) return false;
  const [a, m, d] = v.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

export function sumarDiasIso(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d + n));
  return `${f.getUTCFullYear()}-${dos(f.getUTCMonth() + 1)}-${dos(f.getUTCDate())}`;
}

/** Fechas que se mandan a las RPC (null = sin límite, «Todo»). */
export function fechasSeleccion(sel: SeleccionPeriodo, hoy: Date): { desde: string | null; hasta: string | null } {
  return sel.tipo === "personalizado" ? { desde: sel.desde, hasta: sel.hasta } : fechasPeriodo(sel.tipo, hoy);
}

export interface AtajoPeriodo {
  id: string;
  etiqueta: string;
  desde: string;
  hasta: string;
}

/** Atajos del selector personalizado. */
export function atajosPeriodo(hoy: Date): AtajoPeriodo[] {
  const h = isoLocal(hoy);
  const a = hoy.getFullYear();
  const m = hoy.getMonth();
  const ultimoDia = (anio: number, mes0: number) => new Date(anio, mes0 + 1, 0).getDate();
  const mesAnt = m === 0 ? { a: a - 1, m: 11 } : { a, m: m - 1 };
  return [
    { id: "7d", etiqueta: "Últimos 7 días", desde: sumarDiasIso(h, -6), hasta: h },
    { id: "30d", etiqueta: "Últimos 30 días", desde: sumarDiasIso(h, -29), hasta: h },
    { id: "90d", etiqueta: "Últimos 90 días", desde: sumarDiasIso(h, -89), hasta: h },
    { id: "este-mes", etiqueta: "Este mes", desde: `${a}-${dos(m + 1)}-01`, hasta: `${a}-${dos(m + 1)}-${dos(ultimoDia(a, m))}` },
    {
      id: "mes-anterior",
      etiqueta: "Mes anterior",
      desde: `${mesAnt.a}-${dos(mesAnt.m + 1)}-01`,
      hasta: `${mesAnt.a}-${dos(mesAnt.m + 1)}-${dos(ultimoDia(mesAnt.a, mesAnt.m))}`,
    },
    { id: "este-anio", etiqueta: "Este año", desde: `${a}-01-01`, hasta: `${a}-12-31` },
    { id: "anio-pasado", etiqueta: "Año pasado", desde: `${a - 1}-01-01`, hasta: `${a - 1}-12-31` },
  ];
}

const PERIODOS: PeriodoAnalisis[] = ["mes", "trimestre", "anio", "todo"];

/**
 * Un rango que coincide con Mes · Trimestre · Año se enseña como ese botón
 * (así el enlace `desde=2026-01-01&hasta=2026-12-31` abre «Año 2026»).
 */
export function seleccionDeRango(desde: string, hasta: string, hoy: Date): SeleccionPeriodo {
  for (const p of PERIODOS) {
    const f = fechasPeriodo(p, hoy);
    if (f.desde === desde && f.hasta === hasta) return { tipo: p };
  }
  return { tipo: "personalizado", desde, hasta };
}

const LOCALES: FiltroLocal[] = ["todos", "casa_tomas", "touza"];

/** Lee periodo y local de la URL; lo que no venga o no sea válido, null. */
export function leerAnalisisDeUrl(p: URLSearchParams, hoy: Date): { periodo: SeleccionPeriodo | null; local: FiltroLocal | null } {
  const desde = p.get("desde");
  const hasta = p.get("hasta");
  let periodo: SeleccionPeriodo | null = null;
  if (p.get("periodo") === "todo") periodo = { tipo: "todo" };
  else if (esFechaIso(desde) && esFechaIso(hasta) && desde <= hasta) periodo = seleccionDeRango(desde, hasta, hoy);
  const l = p.get("local");
  const local = l && (LOCALES as string[]).includes(l) ? (l as FiltroLocal) : null;
  return { periodo, local };
}

/** Escribe periodo y local en la URL (sin tocar el resto de parámetros). */
export function escribirAnalisisEnUrl(p: URLSearchParams, sel: SeleccionPeriodo, local: FiltroLocal, hoy: Date): URLSearchParams {
  const s = new URLSearchParams(p);
  s.delete("desde");
  s.delete("hasta");
  s.delete("periodo");
  if (sel.tipo === "todo") s.set("periodo", "todo");
  else {
    const f = fechasSeleccion(sel, hoy);
    if (f.desde && f.hasta) {
      s.set("desde", f.desde);
      s.set("hasta", f.hasta);
    }
  }
  if (local === "todos") s.delete("local");
  else s.set("local", local);
  return s;
}

/** «12 ene – 3 mar 2026» · «5 nov 2025 – 4 nov 2026» · «7 mar 2026». */
export function textoRango(desde: string, hasta: string): string {
  if (desde === hasta) return fechaCorta(desde);
  // Mismo mes: «1 – 31 oct 2026».
  if (desde.slice(0, 7) === hasta.slice(0, 7)) return `${Number(desde.slice(8, 10))} – ${fechaCorta(hasta)}`;
  const corta = fechaCorta(desde);
  return desde.slice(0, 4) === hasta.slice(0, 4) ? `${corta.replace(/ \d{4}$/, "")} – ${fechaCorta(hasta)}` : `${corta} – ${fechaCorta(hasta)}`;
}

/** Número de días del rango, ambos incluidos. */
export function diasRango(desde: string, hasta: string): number {
  const a = Date.UTC(+desde.slice(0, 4), +desde.slice(5, 7) - 1, +desde.slice(8, 10));
  const b = Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10));
  return Math.round((b - a) / 86_400_000) + 1;
}

export const mismaSeleccion = (a: SeleccionPeriodo, b: SeleccionPeriodo): boolean =>
  a.tipo === b.tipo && (a.tipo !== "personalizado" || (b.tipo === "personalizado" && a.desde === b.desde && a.hasta === b.hasta));
