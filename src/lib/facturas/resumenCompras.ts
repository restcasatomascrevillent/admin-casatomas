// ============================================================================
//  Facturas › Compras — local, periodo, abonos, regalado y resumen
// ----------------------------------------------------------------------------
//  Cuentas puras (sin React ni Supabase) del rediseño a todo el ancho
//  (05/11/2026). Todo lo que se suma usa el MISMO criterio que la lista por
//  meses y que la RPC de proveedores corregida (20261105130000): importe con
//  IVA de facturas + albaranes SIN factura; los abonos (total < 0) restan.
//
//  Local: `facturas.local` ('casa_tomas' | 'touza'); lo que no lo trae (las
//  subidas del OCR) es de Casa Tomás, decisión del dueño.
// ============================================================================
import type { Factura } from "@/hooks/useFacturas";
import { claveMes, etiquetaMes, importeQueSuma, masReciente, redondear, sumaEnTotal } from "./agrupacionDocumentos";
import type { Proveedor, ResolverProveedor } from "./proveedores";

// ─── Local ──────────────────────────────────────────────────────────────────

export type Local = "casa_tomas" | "touza";
export type FiltroLocal = "todos" | Local;

export const FILTROS_LOCAL: { valor: FiltroLocal; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "casa_tomas", etiqueta: "Casa Tomás" },
  { valor: "touza", etiqueta: "Touza" },
];

/** Local del documento: sin marcar = Casa Tomás. */
export const localDe = (d: Pick<Factura, "local">): Local => (d.local === "touza" ? "touza" : "casa_tomas");

export const pasaLocal = (d: Pick<Factura, "local">, filtro: FiltroLocal): boolean => filtro === "todos" || localDe(d) === filtro;

// ─── Periodo ────────────────────────────────────────────────────────────────

export type PeriodoPreset = "este_mes" | "mes_anterior" | "trimestre" | "anio" | "todo";
/** Un preset del selector, o un mes concreto (al tocar una barra de la gráfica). */
export type Periodo = { tipo: PeriodoPreset } | { tipo: "mes"; mes: string };

export const PERIODOS: { valor: PeriodoPreset; etiqueta: string }[] = [
  { valor: "este_mes", etiqueta: "Este mes" },
  { valor: "mes_anterior", etiqueta: "Mes anterior" },
  { valor: "trimestre", etiqueta: "Trimestre" },
  { valor: "anio", etiqueta: "Año" },
  { valor: "todo", etiqueta: "Todo" },
];

/** Meses `YYYY-MM` inclusive; null = sin límite (todo el histórico). */
export interface RangoMeses {
  desde: string;
  hasta: string;
}

const mesClave = (anio: number, mes0: number) => {
  const d = new Date(anio, mes0, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Meses que abarca un periodo. «Trimestre» y «Año» son los NATURALES de hoy
 * (los del IVA: oct-dic, ene-dic), no los últimos 3 o 12 meses.
 */
export function rangoPeriodo(p: Periodo, hoy: Date): RangoMeses | null {
  const a = hoy.getFullYear();
  const m = hoy.getMonth();
  switch (p.tipo) {
    case "este_mes":
      return { desde: mesClave(a, m), hasta: mesClave(a, m) };
    case "mes_anterior":
      return { desde: mesClave(a, m - 1), hasta: mesClave(a, m - 1) };
    case "trimestre": {
      const inicio = m - (m % 3);
      return { desde: mesClave(a, inicio), hasta: mesClave(a, inicio + 2) };
    }
    case "anio":
      return { desde: mesClave(a, 0), hasta: mesClave(a, 11) };
    case "mes":
      return { desde: p.mes, hasta: p.mes };
    default:
      return null;
  }
}

/** ¿El documento cae en el periodo? Sin fecha solo entra en «Todo». */
export function pasaPeriodo(d: Pick<Factura, "fecha">, rango: RangoMeses | null): boolean {
  if (!rango) return true;
  const mes = claveMes(d.fecha);
  return mes >= rango.desde && mes <= rango.hasta && /^\d{4}-\d{2}$/.test(mes);
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Mes corto: «oct» (o «oct 25» si `conAnio`). */
export function mesCorto(clave: string, conAnio = false): string {
  const m = /^(\d{4})-(\d{2})$/.exec(clave);
  if (!m) return clave;
  return `${MESES_CORTOS[Number(m[2]) - 1]}${conAnio ? ` ${m[1].slice(2)}` : ""}`;
}

/** Lo que abarca el periodo, en palabras: «Noviembre 2026», «4.º trimestre 2026 (oct–dic)», «Año 2026». */
export function textoPeriodo(p: Periodo, hoy: Date): string {
  const r = rangoPeriodo(p, hoy);
  if (!r) return "Todo el histórico";
  if (p.tipo === "trimestre") {
    const t = Math.floor((Number(r.desde.slice(5)) - 1) / 3) + 1;
    return `${t}.º trimestre ${r.desde.slice(0, 4)} (${mesCorto(r.desde)}–${mesCorto(r.hasta)})`;
  }
  if (p.tipo === "anio") return `Año ${r.desde.slice(0, 4)}`;
  return etiquetaMes(r.desde);
}

export const mismoPeriodo = (a: Periodo, b: Periodo): boolean =>
  a.tipo === b.tipo && (a.tipo !== "mes" || (b.tipo === "mes" && a.mes === b.mes));

// ─── Abonos y regalado ──────────────────────────────────────────────────────

/** Abono: documento con total negativo (devolución, rectificativa…). */
export const esAbono = (d: Pick<Factura, "total">): boolean => d.total != null && Number(d.total) < 0;

export interface Regalado {
  /** Valor de lo regalado o descontado, sin IVA (importe bruto − importe de la línea). */
  importe: number;
  /** Alguna línea trae el bruto estimado (con el precio de otras facturas). */
  estimado: boolean;
  /** Líneas regaladas (importe 0 y bruto > 0). */
  regalos: number;
}

/** Línea regalada: no se cobró nada pero vale algo. */
export const esLineaRegalo = (p: { precio?: number | null; importe_bruto?: number | null }): boolean =>
  p.importe_bruto != null && p.importe_bruto > 0.005 && Math.abs(p.precio ?? 0) < 0.005;

/** Regalado / descuentos de un documento: suma de (bruto − importe) en las líneas donde es > 0. */
export function regaladoDocumento(d: Pick<Factura, "productos">): Regalado {
  let importe = 0;
  let estimado = false;
  let regalos = 0;
  for (const p of d.productos) {
    if (p.importe_bruto == null) continue;
    const diferencia = p.importe_bruto - (p.precio ?? 0);
    if (diferencia <= 0.005) continue;
    importe += diferencia;
    if (p.importe_bruto_estimado) estimado = true;
    if (esLineaRegalo(p)) regalos += 1;
  }
  return { importe: redondear(importe), estimado, regalos };
}

// ─── Por proveedor ──────────────────────────────────────────────────────────

export interface AgregadoProveedor {
  /** Clave canónica (`#id`), el texto normalizado si no está unificado, o "" sin proveedor. */
  clave: string;
  nombre: string;
  /** Sus documentos (del filtro de local y periodo), el más reciente primero. */
  documentos: Factura[];
  /** Neto con IVA (sin albaranes ya facturados; los abonos restan). */
  gasto: number;
  /** Lo que restan sus abonos (0 o negativo) y cuántos son. */
  abonos: number;
  nAbonos: number;
  regalado: number;
  regaladoEstimado: boolean;
  albaranesSinFactura: number;
  ultimaFecha: string | null;
}

const claveProveedorDoc = (d: Pick<Factura, "proveedor">, resolver: ResolverProveedor) =>
  d.proveedor && d.proveedor.trim() ? resolver(d.proveedor) : null;

/** Una pasada por los documentos: lo de cada proveedor (para la lista, el despliegue y el top). */
export function agregarPorProveedor(docs: Factura[], resolver: ResolverProveedor): Map<string, AgregadoProveedor> {
  const mapa = new Map<string, AgregadoProveedor>();
  for (const d of docs) {
    const r = claveProveedorDoc(d, resolver);
    const clave = r?.clave || "";
    let a = mapa.get(clave);
    if (!a) {
      a = {
        clave,
        nombre: r?.nombre || "Sin proveedor",
        documentos: [],
        gasto: 0,
        abonos: 0,
        nAbonos: 0,
        regalado: 0,
        regaladoEstimado: false,
        albaranesSinFactura: 0,
        ultimaFecha: null,
      };
      mapa.set(clave, a);
    }
    a.documentos.push(d);
    const i = importeQueSuma(d);
    a.gasto += i;
    if (esAbono(d)) {
      a.nAbonos += 1;
      a.abonos += i;
    }
    if (sumaEnTotal(d)) {
      const reg = regaladoDocumento(d);
      a.regalado += reg.importe;
      if (reg.importe > 0 && reg.estimado) a.regaladoEstimado = true;
    }
    if (d.tipo === "albaran" && (d.facturado_en_id ?? null) === null) a.albaranesSinFactura += 1;
    if (d.fecha && (a.ultimaFecha === null || d.fecha > a.ultimaFecha)) a.ultimaFecha = d.fecha;
  }
  for (const a of mapa.values()) {
    a.documentos.sort(masReciente);
    a.gasto = redondear(a.gasto);
    a.abonos = redondear(a.abonos);
    a.regalado = redondear(a.regalado);
  }
  return mapa;
}

/**
 * Lista del modo Proveedores: por GASTO (mayor primero; empate, por nombre).
 * Con local o periodo elegidos (`soloConDocumentos`), solo los que tienen algún
 * documento en ese filtro.
 */
export function ordenarProveedoresPorGasto(
  proveedores: Proveedor[],
  agregados: Map<string, AgregadoProveedor>,
  soloConDocumentos: boolean,
): Proveedor[] {
  const gasto = (p: Proveedor) => agregados.get(`#${p.id}`)?.gasto ?? 0;
  return proveedores
    .filter((p) => !soloConDocumentos || agregados.has(`#${p.id}`))
    .sort((a, b) => gasto(b) - gasto(a) || a.nombre.localeCompare(b.nombre, "es"));
}

// ─── Resumen ────────────────────────────────────────────────────────────────

export interface ResumenCompras {
  /** Neto con IVA (los abonos ya restados). */
  gasto: number;
  /** Lo que restan los abonos (0 o negativo) y cuántos hay. */
  abonos: number;
  nAbonos: number;
  /** Regalado / descuentos, sin IVA. */
  regalado: number;
  regaladoEstimado: boolean;
  documentos: number;
}

/** Cifras de la franja de resumen (los documentos ya filtrados por local y periodo). */
export function resumirCompras(docs: Factura[]): ResumenCompras {
  let gasto = 0;
  let abonos = 0;
  let nAbonos = 0;
  let regalado = 0;
  let regaladoEstimado = false;
  for (const d of docs) {
    const i = importeQueSuma(d);
    gasto += i;
    if (esAbono(d)) {
      nAbonos += 1;
      abonos += i;
    }
    if (sumaEnTotal(d)) {
      const r = regaladoDocumento(d);
      regalado += r.importe;
      if (r.importe > 0 && r.estimado) regaladoEstimado = true;
    }
  }
  return {
    gasto: redondear(gasto),
    abonos: redondear(abonos),
    nAbonos,
    regalado: redondear(regalado),
    regaladoEstimado,
    documentos: docs.length,
  };
}

export interface MesGrafica {
  clave: string;
  casa_tomas: number;
  touza: number;
  total: number;
}

/**
 * Gasto neto de los `n` meses que acaban en el de hoy (el más antiguo primero),
 * repartido por local. Los documentos llegan ya filtrados por local (no por
 * periodo: la gráfica da el contexto y marca los meses del periodo).
 */
export function mesesGrafica(docs: Factura[], hoy: Date, n = 12): MesGrafica[] {
  const meses: MesGrafica[] = [];
  const indice = new Map<string, MesGrafica>();
  for (let i = n - 1; i >= 0; i--) {
    const clave = mesClave(hoy.getFullYear(), hoy.getMonth() - i);
    const m = { clave, casa_tomas: 0, touza: 0, total: 0 };
    meses.push(m);
    indice.set(clave, m);
  }
  for (const d of docs) {
    const m = indice.get(claveMes(d.fecha));
    if (!m) continue;
    const i = importeQueSuma(d);
    m[localDe(d)] += i;
    m.total += i;
  }
  for (const m of meses) {
    m.casa_tomas = redondear(m.casa_tomas);
    m.touza = redondear(m.touza);
    m.total = redondear(m.total);
  }
  return meses;
}

/** Los `n` proveedores con más gasto (sin «Sin proveedor» ni los que no suman nada). */
export function topProveedores(agregados: Map<string, AgregadoProveedor>, n = 10): AgregadoProveedor[] {
  return [...agregados.values()]
    .filter((a) => a.clave !== "" && a.gasto > 0)
    .sort((a, b) => b.gasto - a.gasto || a.nombre.localeCompare(b.nombre, "es"))
    .slice(0, n);
}
