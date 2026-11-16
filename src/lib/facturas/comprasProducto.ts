// ============================================================================
//  Facturas › Análisis — compras de un producto (cuentas puras)
// ----------------------------------------------------------------------------
//  15/11/2026, petición del dueño (aviso de GAMBA ROJA N1, Nicolás y Valero):
//    · «Comparar facturas» abría la hoja 1 de una factura quincenal de 6 hojas
//      y 61 líneas, sin gamba a la vista: parecía que la factura no la tenía.
//      Ahora cada documento se abre en la HOJA del producto
//      (`productos_factura.pagina`) y sus líneas salen arriba y marcadas.
//    · Al lado, TODAS las compras del producto: facturas y albaranes que aún
//      no están facturados (un albarán con `facturado_en_id` ya está dentro de
//      su factura: no se cuenta dos veces, la misma regla que facturas_decision).
//    · La gráfica de precio por mes usa estas compras para el tooltip de cada
//      punto (fecha, precio, cantidad y documento).
// ============================================================================
import type { DocumentoCifra, TipoDocumentoCifra } from "./documentosCifra";

/** El producto de un aviso (o de «Lo más comprado») con el que se buscan sus líneas. */
export interface ProductoBuscado {
  productoId: number | null;
  nombreNormalizado: string | null;
  /** Nombre para enseñar. */
  nombre: string;
}

/** Una línea de un documento (productos_factura). */
export interface LineaDocumento {
  id: number;
  nombre: string;
  nombreNormalizado: string | null;
  productoId: number | null;
  cantidad: number | null;
  unidad: string | null;
  precio: number | null;
  total: number | null;
  pagina: number | null;
  orden: number | null;
}

/** Una compra del producto: su línea y el documento donde está. */
export interface CompraProducto extends LineaDocumento {
  doc: DocumentoCifra;
  facturadoEnId: number | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const TIPOS: TipoDocumentoCifra[] = ["factura", "albaran", "abono"];
const normal = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export const COLUMNAS_LINEA = "id, nombre, nombre_normalizado, producto_id, cantidad, unidad, precio_unitario, total, pagina, orden, factura_id";
export const COLUMNAS_DOC = "id, fecha, proveedor, proveedor_id, numero_documento, tipo, local, total, drive_url, archivo_path, facturado_en_id";

export function aLinea(v: unknown): LineaDocumento | null {
  const l = obj(v);
  const id = num(l.id);
  if (id === null) return null;
  return {
    id,
    nombre: txt(l.nombre) ?? "(sin nombre)",
    nombreNormalizado: txt(l.nombre_normalizado),
    productoId: num(l.producto_id),
    cantidad: num(l.cantidad),
    unidad: txt(l.unidad),
    precio: num(l.precio_unitario),
    total: num(l.total),
    pagina: num(l.pagina),
    orden: num(l.orden),
  };
}

/** El documento (fila de `facturas`) con la forma del visor. */
export function aDocumento(v: unknown): DocumentoCifra | null {
  const d = obj(v);
  const id = num(d.id);
  if (id === null) return null;
  const total = num(d.total);
  const tipo = TIPOS.includes(d.tipo as TipoDocumentoCifra) ? (d.tipo as TipoDocumentoCifra) : "factura";
  return {
    id,
    fecha: txt(d.fecha),
    proveedor: txt(d.proveedor) ?? "Proveedor",
    proveedorId: num(d.proveedor_id),
    numero: txt(d.numero_documento),
    tipo: total !== null && total < 0 ? "abono" : tipo,
    local: d.local === "touza" ? "touza" : "casa_tomas",
    total,
    aporta: total ?? 0,
    cantidad: null,
    lineas: null,
    driveUrl: txt(d.drive_url),
    archivoPath: txt(d.archivo_path),
  };
}

/** Filas de `productos_factura` con su `facturas(...)` anidada → compras. */
export function aCompras(filas: unknown): CompraProducto[] {
  if (!Array.isArray(filas)) return [];
  const out: CompraProducto[] = [];
  for (const f of filas) {
    const linea = aLinea(f);
    const fa = obj(obj(f).facturas);
    const doc = aDocumento(fa);
    if (!linea || !doc) continue;
    out.push({ ...linea, doc, facturadoEnId: num(fa.facturado_en_id) });
  }
  return out;
}

/** ¿Esta línea es del producto? Por su id de producto y, si no lo hay, por la línea normalizada. */
export function esDelProducto(l: Pick<LineaDocumento, "productoId" | "nombreNormalizado" | "nombre">, p: ProductoBuscado): boolean {
  if (p.productoId !== null && l.productoId !== null) return l.productoId === p.productoId;
  const clave = normal(p.nombreNormalizado) || normal(p.nombre);
  if (!clave) return false;
  return normal(l.nombreNormalizado) === clave || normal(l.nombre) === clave;
}

/**
 * Todas las compras que cuentan: facturas y albaranes sin facturar (un albarán
 * con `facturado_en_id` ya está en su factura). Opcional: solo un local. La
 * más reciente primero.
 */
export function comprasQueCuentan(compras: CompraProducto[], local: "casa_tomas" | "touza" | null = null): CompraProducto[] {
  return compras
    .filter((c) => !(c.doc.tipo === "albaran" && c.facturadoEnId !== null))
    .filter((c) => local === null || c.doc.local === local)
    .sort((a, b) => (b.doc.fecha ?? "").localeCompare(a.doc.fecha ?? "") || b.doc.id - a.doc.id || (a.orden ?? 0) - (b.orden ?? 0));
}

/** Las líneas del documento con las del producto ARRIBA (en su orden) y luego el resto. */
export function lineasConProductoArriba(lineas: LineaDocumento[], p: ProductoBuscado | null): { lineas: LineaDocumento[]; delProducto: Set<number> } {
  const orden = [...lineas].sort((a, b) => (a.pagina ?? 0) - (b.pagina ?? 0) || (a.orden ?? 0) - (b.orden ?? 0) || a.id - b.id);
  if (!p) return { lineas: orden, delProducto: new Set() };
  const suyas = orden.filter((l) => esDelProducto(l, p));
  const ids = new Set(suyas.map((l) => l.id));
  return { lineas: [...suyas, ...orden.filter((l) => !ids.has(l.id))], delProducto: ids };
}

/** La primera hoja (1, 2…) donde sale el producto en el documento; null si no sale o no se sabe. */
export function hojaDelProducto(lineas: LineaDocumento[], p: ProductoBuscado | null): number | null {
  if (!p) return null;
  const hojas = lineas.filter((l) => esDelProducto(l, p) && l.pagina !== null && l.pagina >= 1).map((l) => l.pagina as number);
  return hojas.length ? Math.min(...hojas) : null;
}

/** Las hojas (sin repetir, en orden) donde sale el producto. */
export function hojasDelProducto(lineas: LineaDocumento[], p: ProductoBuscado | null): number[] {
  if (!p) return [];
  return [...new Set(lineas.filter((l) => esDelProducto(l, p) && l.pagina !== null && l.pagina >= 1).map((l) => l.pagina as number))].sort((a, b) => a - b);
}

/** Las compras de un mes (AAAA-MM) en una unidad y, si se da, de un proveedor: para el tooltip de la gráfica. */
export function comprasDelMes(compras: CompraProducto[], mes: string, unidad: string | null, proveedorId: number | null): CompraProducto[] {
  const u = normal(unidad);
  return compras
    .filter((c) => (c.doc.fecha ?? "").slice(0, 7) === mes)
    .filter((c) => c.precio !== null && c.precio > 0)
    .filter((c) => !u || normal(c.unidad || "ud") === u)
    .filter((c) => proveedorId === null || c.doc.proveedorId === proveedorId)
    .sort((a, b) => (a.doc.fecha ?? "").localeCompare(b.doc.fecha ?? "") || a.doc.id - b.doc.id);
}

/** El producto de un aviso de precio (datos normalizados de `alertas.ts`). */
export function productoDeAlerta(a: { titulo?: string | null; datos: { productoId: number | null; nombreNormalizado: string | null; producto: string | null } }): ProductoBuscado | null {
  const d = a.datos;
  if (d.productoId === null && !d.nombreNormalizado) return null;
  return { productoId: d.productoId, nombreNormalizado: d.nombreNormalizado, nombre: d.producto ?? a.titulo ?? "el producto" };
}
