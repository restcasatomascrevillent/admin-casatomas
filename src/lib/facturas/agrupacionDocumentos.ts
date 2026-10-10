// ============================================================================
//  Facturas › Compras › Documentos — agrupar por mes y, dentro, por proveedor
// ----------------------------------------------------------------------------
//  Cuentas puras (sin React). Petición del dueño (10/10/2026): la lista de
//  documentos sale agrupada por MES (el actual primero) y dentro por PROVEEDOR
//  canónico, con el total de cada grupo.
//
//  Total de un grupo = facturas + albaranes SIN factura. Un albarán ya recogido
//  en una factura (`facturado_en_id`) se enseña pero NO suma: ya cuenta en el
//  importe de su factura (o, si esa factura está en otro mes, en aquel mes).
// ============================================================================
import type { Factura } from "@/hooks/useFacturas";
import type { ResolverProveedor } from "./proveedores";

export const CLAVE_SIN_FECHA = "sin-fecha";
export const CLAVE_SIN_PROVEEDOR = "";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export interface GrupoProveedor {
  /** Clave del proveedor canónico (`#id`, o el texto normalizado; "" = sin proveedor). */
  clave: string;
  nombre: string;
  documentos: Factura[];
  /** Facturas + albaranes sin factura (sin contar dos veces los ya facturados). */
  total: number;
}

export interface GrupoMes {
  /** `YYYY-MM`, o `CLAVE_SIN_FECHA`. */
  clave: string;
  etiqueta: string;
  documentos: number;
  total: number;
  proveedores: GrupoProveedor[];
}

/** `YYYY-MM` de una fecha `YYYY-MM-DD…`, o «sin-fecha» si no se puede leer. */
export function claveMes(fecha: string | null | undefined): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])/.exec(fecha ?? "");
  return m ? `${m[1]}-${m[2]}` : CLAVE_SIN_FECHA;
}

/** «Octubre 2026» (o «Sin fecha»). */
export function etiquetaMes(clave: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(clave);
  return m ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : "Sin fecha";
}

/** Mes de hoy y el anterior (`YYYY-MM`), los que se enseñan desplegados por defecto. */
export function mesesRecientes(hoy: Date): string[] {
  const a = hoy.getFullYear();
  const m = hoy.getMonth(); // 0-11
  const clave = (anio: number, mes: number) => `${anio}-${String(mes + 1).padStart(2, "0")}`;
  return [clave(a, m), m === 0 ? clave(a - 1, 11) : clave(a, m - 1)];
}

/** ¿Suma en los totales? Facturas sí; albaranes solo si no están en ninguna factura. */
export const sumaEnTotal = (d: Pick<Factura, "tipo" | "facturado_en_id">): boolean =>
  d.tipo !== "albaran" || (d.facturado_en_id ?? null) === null;

const redondear = (n: number) => Math.round(n * 100) / 100;
const importe = (d: Factura) => (sumaEnTotal(d) && d.total != null && Number.isFinite(Number(d.total)) ? Number(d.total) : 0);
const masReciente = (a: Factura, b: Factura) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || b.id - a.id;

/**
 * Agrupa por mes (el más reciente primero; «Sin fecha» al final) y, dentro, por
 * proveedor canónico (A-Z; «Sin proveedor» al final). Dentro de cada proveedor,
 * del documento más reciente al más antiguo.
 */
export function agruparDocumentos(docs: Factura[], resolver: ResolverProveedor): GrupoMes[] {
  const meses = new Map<string, Map<string, GrupoProveedor>>();
  for (const d of docs) {
    const mes = claveMes(d.fecha);
    let provs = meses.get(mes);
    if (!provs) meses.set(mes, (provs = new Map()));
    const r = d.proveedor && d.proveedor.trim() ? resolver(d.proveedor) : null;
    const clave = r?.clave || CLAVE_SIN_PROVEEDOR;
    let g = provs.get(clave);
    if (!g) provs.set(clave, (g = { clave, nombre: r?.nombre || "Sin proveedor", documentos: [], total: 0 }));
    g.documentos.push(d);
  }
  const salida: GrupoMes[] = [];
  for (const [clave, provs] of meses) {
    const proveedores = [...provs.values()];
    for (const g of proveedores) {
      g.documentos.sort(masReciente);
      g.total = redondear(g.documentos.reduce((s, d) => s + importe(d), 0));
    }
    proveedores.sort((a, b) => {
      if ((a.clave === CLAVE_SIN_PROVEEDOR) !== (b.clave === CLAVE_SIN_PROVEEDOR)) return a.clave === CLAVE_SIN_PROVEEDOR ? 1 : -1;
      return a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });
    });
    salida.push({
      clave,
      etiqueta: etiquetaMes(clave),
      documentos: proveedores.reduce((s, g) => s + g.documentos.length, 0),
      total: redondear(proveedores.reduce((s, g) => s + g.total, 0)),
      proveedores,
    });
  }
  return salida.sort((a, b) => {
    if ((a.clave === CLAVE_SIN_FECHA) !== (b.clave === CLAVE_SIN_FECHA)) return a.clave === CLAVE_SIN_FECHA ? 1 : -1;
    return b.clave.localeCompare(a.clave);
  });
}

// ─── Qué grupos están abiertos ──────────────────────────────────────────────

/** Estado explícito recordado: clave del grupo → abierto. Lo que no está, usa el valor por defecto. */
export type EstadoPlegado = Record<string, boolean>;

export const claveEstadoMes = (mes: string) => `m:${mes}`;
export const claveEstadoProveedor = (mes: string, proveedor: string) => `p:${mes}|${proveedor}`;

/**
 * ¿Está abierto el mes? Lo que el usuario decidió manda; si no, solo el mes de
 * hoy y el anterior; y con búsqueda o chip activos, todos (para no esconder
 * resultados en un mes plegado).
 */
export function mesAbierto(mes: string, estado: EstadoPlegado, hoy: Date, hayFiltros: boolean): boolean {
  const k = claveEstadoMes(mes);
  if (k in estado) return estado[k];
  return hayFiltros || mesesRecientes(hoy).includes(mes);
}

/** ¿Está abierto el subgrupo de proveedor? Por defecto sí. */
export function proveedorAbierto(mes: string, proveedor: string, estado: EstadoPlegado): boolean {
  const k = claveEstadoProveedor(mes, proveedor);
  return k in estado ? estado[k] : true;
}

/** Mes y proveedor en los que cae un documento (para abrirlos al saltar a él). */
export function ubicacionDocumento(d: Pick<Factura, "fecha" | "proveedor">, resolver: ResolverProveedor): { mes: string; proveedor: string } {
  const r = d.proveedor && d.proveedor.trim() ? resolver(d.proveedor) : null;
  return { mes: claveMes(d.fecha), proveedor: r?.clave || CLAVE_SIN_PROVEEDOR };
}

const CLAVE_ALMACEN = "compras.documentos.plegado";

export function leerPlegado(): EstadoPlegado {
  try {
    const crudo = window.localStorage.getItem(CLAVE_ALMACEN);
    const v = crudo ? JSON.parse(crudo) : null;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const salida: EstadoPlegado = {};
    for (const [k, val] of Object.entries(v)) if (typeof val === "boolean") salida[k] = val;
    return salida;
  } catch {
    return {};
  }
}

export function guardarPlegado(estado: EstadoPlegado): void {
  try {
    window.localStorage.setItem(CLAVE_ALMACEN, JSON.stringify(estado));
  } catch {
    /* sin almacenamiento (modo privado…): el estado vive solo en esta sesión */
  }
}
