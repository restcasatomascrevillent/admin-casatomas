// ============================================================================
//  Facturas › Compras › Documentos — agrupar por mes
// ----------------------------------------------------------------------------
//  Cuentas puras (sin React). Petición del dueño (10/10/2026): la lista de
//  documentos sale agrupada por MES (el actual primero) con el total de cada
//  mes. Desde el rediseño a todo el ancho (05/11/2026) el proveedor es una
//  columna de cada fila y ya no hay subgrupo por proveedor: dentro del mes, del
//  documento más reciente al más antiguo.
//
//  Total de un mes = facturas + albaranes SIN factura (abonos incluidos, que
//  restan). Un albarán ya recogido en una factura (`facturado_en_id`) se enseña
//  pero NO suma: ya cuenta en el importe de su factura.
// ============================================================================
import type { Factura } from "@/hooks/useFacturas";

export const CLAVE_SIN_FECHA = "sin-fecha";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Lo mínimo de un documento para agruparlo y sumarlo (vale `Factura` y la cabecera de la lista). */
export type DocumentoAgrupable = Pick<Factura, "id" | "fecha" | "tipo" | "total"> & { facturado_en_id?: number | null };

export interface GrupoMes<D extends DocumentoAgrupable = Factura> {
  /** `YYYY-MM`, o `CLAVE_SIN_FECHA`. */
  clave: string;
  etiqueta: string;
  /** Del más reciente al más antiguo. */
  documentos: D[];
  /** Neto con IVA: facturas + albaranes sin factura, abonos restando. */
  total: number;
  /** Lo que restan los abonos de ese mes (0 o negativo). */
  abonos: number;
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

export const redondear = (n: number) => Math.round(n * 100) / 100;

/** Lo que suma un documento en los totales (0 si no suma o no tiene importe). */
export const importeQueSuma = (d: Pick<Factura, "tipo" | "facturado_en_id" | "total">): number =>
  sumaEnTotal(d) && d.total != null && Number.isFinite(Number(d.total)) ? Number(d.total) : 0;

/** Orden de las listas: el más reciente primero (desempate por id). */
export const masReciente = (a: Pick<Factura, "fecha" | "id">, b: Pick<Factura, "fecha" | "id">) =>
  (b.fecha ?? "").localeCompare(a.fecha ?? "") || b.id - a.id;

/** Agrupa por mes (el más reciente primero; «Sin fecha» al final). */
export function agruparDocumentos<D extends DocumentoAgrupable>(docs: D[]): GrupoMes<D>[] {
  const meses = new Map<string, D[]>();
  for (const d of docs) {
    const mes = claveMes(d.fecha);
    const lista = meses.get(mes);
    if (lista) lista.push(d);
    else meses.set(mes, [d]);
  }
  const salida: GrupoMes<D>[] = [];
  for (const [clave, documentos] of meses) {
    documentos.sort(masReciente);
    let total = 0;
    let abonos = 0;
    for (const d of documentos) {
      const i = importeQueSuma(d);
      total += i;
      if (i < 0) abonos += i;
    }
    salida.push({ clave, etiqueta: etiquetaMes(clave), documentos, total: redondear(total), abonos: redondear(abonos) });
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

/** Con texto buscado (o en el despliegue de un proveedor), cuántos meses (los más recientes) salen desplegados. */
export const MESES_ABIERTOS_BUSCANDO = 3;

/**
 * ¿Está abierto el mes? Lo que el usuario decidió manda (`estado`). Si no:
 *  - si la lista tiene un solo mes (p. ej. periodo «Este mes»), abierto;
 *  - sin búsqueda, solo el mes de hoy y el anterior (los chips no cambian nada:
 *    antes abrían el año entero y en tablet eso eran cientos de filas);
 *  - con búsqueda, `posicionBuscando` es el sitio del mes entre los que tienen
 *    resultados (0 = el más reciente) y solo se abren los 3 primeros.
 * Con búsqueda, `estado` es el de ESA búsqueda (no el recordado en localStorage).
 */
export function mesAbierto(
  mes: string,
  estado: EstadoPlegado,
  hoy: Date,
  posicionBuscando: number | null = null,
  totalMeses = 0,
): boolean {
  const k = claveEstadoMes(mes);
  if (k in estado) return estado[k];
  if (totalMeses === 1) return true;
  if (posicionBuscando !== null) return posicionBuscando < MESES_ABIERTOS_BUSCANDO;
  return mesesRecientes(hoy).includes(mes);
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
