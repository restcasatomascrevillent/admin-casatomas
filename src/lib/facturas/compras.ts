// ============================================================================
//  Facturas › Compras — cuentas puras (sin React ni Supabase)
// ----------------------------------------------------------------------------
//  Rediseño del 08/10/2026: «Documentos», «Productos» y «Proveedores» son tres
//  formas de mirar lo mismo (lo que se ha comprado) detrás de UN buscador.
//  Aquí vive lo que reparte el texto buscado entre los tres modos (contadores),
//  los filtros de cada modo y la traducción de un documento a su proveedor.
// ============================================================================
import type { Factura } from "@/hooks/useFacturas";
import { filtrarProductos, normalizarBusqueda, type MapaCategorias, type ResumenProducto } from "./productos";
import { filtrarProveedores, type Proveedor, type ResolverProveedor } from "./proveedores";
import { esAbono } from "./resumenCompras";

export type ModoCompras = "documentos" | "productos" | "proveedores";

export const MODOS_COMPRAS: { valor: ModoCompras; etiqueta: string }[] = [
  { valor: "documentos", etiqueta: "Documentos" },
  { valor: "productos", etiqueta: "Productos" },
  { valor: "proveedores", etiqueta: "Proveedores" },
];

export type FiltroDocumentos =
  | "todo"
  | "facturas"
  | "albaranes"
  | "albaranes_sin_factura"
  | "abonos"
  | "con_avisos"
  | "sin_revisar";

export const FILTROS_DOCUMENTOS: { valor: FiltroDocumentos; etiqueta: string }[] = [
  { valor: "todo", etiqueta: "Todo" },
  { valor: "facturas", etiqueta: "Facturas" },
  { valor: "albaranes", etiqueta: "Albaranes" },
  { valor: "albaranes_sin_factura", etiqueta: "Albaranes sin factura" },
  { valor: "abonos", etiqueta: "Abonos" },
  { valor: "con_avisos", etiqueta: "Con avisos" },
  { valor: "sin_revisar", etiqueta: "Sin revisar" },
];

export type FiltroProveedores = "todos" | "albaranes_sin_factura";

export const FILTROS_PROVEEDORES: { valor: FiltroProveedores; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "albaranes_sin_factura", etiqueta: "Con albaranes sin factura" },
];

/** Albarán que todavía no está recogido en ninguna factura (`facturado_en_id` vacío). */
export const esAlbaranSinFactura = (d: Pick<Factura, "tipo" | "facturado_en_id">): boolean =>
  d.tipo === "albaran" && (d.facturado_en_id ?? null) === null;

/** Palabras del texto buscado, sin tildes ni mayúsculas. [] = sin búsqueda. */
export const palabrasBusqueda = (texto: string): string[] => {
  const q = normalizarBusqueda(texto);
  return q ? q.split(" ") : [];
};

/** Todo lo que se puede buscar de un documento: cabecera y nombre de cada línea. */
function pajarDocumento(d: Factura): string {
  return normalizarBusqueda(
    [
      d.numero_documento,
      d.proveedor,
      d.cif,
      d.observaciones,
      ...d.productos.flatMap((p) => [p.producto_nombre, p.producto_canonico]),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

// El pajar de cada documento se calcula una vez por objeto (la lista de
// react-query conserva las referencias entre renders): buscar letra a letra
// no vuelve a recorrer todas las líneas.
const cachePajar = new WeakMap<Factura, string>();
const pajar = (d: Factura): string => {
  let v = cachePajar.get(d);
  if (v === undefined) {
    v = pajarDocumento(d);
    cachePajar.set(d, v);
  }
  return v;
};

export const coincideDocumento = (d: Factura, palabras: string[]): boolean => {
  if (palabras.length === 0) return true;
  const h = pajar(d);
  return palabras.every((w) => h.includes(w));
};

type Avisos = Map<number, unknown[]>;

function pasaFiltroDocumento(d: Factura, filtro: FiltroDocumentos, avisos: Avisos): boolean {
  switch (filtro) {
    case "facturas":
      return d.tipo === "factura";
    case "albaranes":
      return d.tipo === "albaran";
    case "albaranes_sin_factura":
      return esAlbaranSinFactura(d);
    case "abonos":
      return esAbono(d);
    case "con_avisos":
      return (avisos.get(d.id) ?? []).length > 0;
    case "sin_revisar":
      return !d.verificada;
    default:
      return true;
  }
}

/** Documentos que cumplen el texto y el chip elegido, del más reciente al más antiguo. */
export function filtrarDocumentos(docs: Factura[], texto: string, filtro: FiltroDocumentos, avisos: Avisos): Factura[] {
  const palabras = palabrasBusqueda(texto);
  return docs
    .filter((d) => coincideDocumento(d, palabras) && pasaFiltroDocumento(d, filtro, avisos))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
}

/** Cuántos documentos salen con cada chip (para el texto buscado). */
export function contarFiltrosDocumentos(docs: Factura[], texto: string, avisos: Avisos): Record<FiltroDocumentos, number> {
  const palabras = palabrasBusqueda(texto);
  const base = docs.filter((d) => coincideDocumento(d, palabras));
  const cuenta = (f: FiltroDocumentos) => base.filter((d) => pasaFiltroDocumento(d, f, avisos)).length;
  return {
    todo: base.length,
    facturas: cuenta("facturas"),
    albaranes: cuenta("albaranes"),
    albaranes_sin_factura: cuenta("albaranes_sin_factura"),
    abonos: cuenta("abonos"),
    con_avisos: cuenta("con_avisos"),
    sin_revisar: cuenta("sin_revisar"),
  };
}

/** Clave del proveedor canónico de un documento (la de `crearResolverProveedor`). */
export const claveProveedorDocumento = (d: Pick<Factura, "proveedor">, resolver: ResolverProveedor): string =>
  d.proveedor ? resolver(d.proveedor).clave : "";

/** Albaranes sin factura de cada proveedor (por clave canónica). */
export function albaranesSinFacturaPorProveedor(docs: Factura[], resolver: ResolverProveedor): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const d of docs) {
    if (!esAlbaranSinFactura(d)) continue;
    const k = claveProveedorDocumento(d, resolver);
    if (k) mapa.set(k, (mapa.get(k) ?? 0) + 1);
  }
  return mapa;
}

/**
 * Proveedores del texto buscado: los que se llaman así (nombre, comercial,
 * CIF, variantes) y los que tienen algún documento con ese texto (p. ej.
 * «merluza» → quien te la vende).
 */
export function proveedoresDelTexto(
  proveedores: Proveedor[],
  docs: Factura[],
  texto: string,
  resolver: ResolverProveedor,
): Proveedor[] {
  const palabras = palabrasBusqueda(texto);
  if (palabras.length === 0) return proveedores;
  const porNombre = new Set(filtrarProveedores(proveedores, texto).map((p) => p.id));
  const clavesConDocumento = new Set<string>();
  for (const d of docs) if (coincideDocumento(d, palabras)) clavesConDocumento.add(claveProveedorDocumento(d, resolver));
  return proveedores.filter((p) => porNombre.has(p.id) || clavesConDocumento.has(`#${p.id}`));
}

/** Lista final del modo Proveedores: texto + chip, por documentos de más a menos. */
export function filtrarProveedoresCompras(
  proveedores: Proveedor[],
  docs: Factura[],
  texto: string,
  filtro: FiltroProveedores,
  resolver: ResolverProveedor,
): Proveedor[] {
  const lista = proveedoresDelTexto(proveedores, docs, texto, resolver);
  const sinFactura = filtro === "albaranes_sin_factura" ? albaranesSinFacturaPorProveedor(docs, resolver) : null;
  return lista
    .filter((p) => !sinFactura || (sinFactura.get(`#${p.id}`) ?? 0) > 0)
    .sort((a, b) => b.documentos - a.documentos || a.nombre.localeCompare(b.nombre, "es"));
}

export interface ContadoresCompras {
  documentos: number;
  productos: number;
  proveedores: number;
}

/** Resultados por modo para el texto buscado (sin chips: el contador es del texto). */
export function contarPorModo(args: {
  texto: string;
  documentos: Factura[];
  productos: ResumenProducto[];
  proveedores: Proveedor[];
  mapaCategorias: MapaCategorias;
  resolver: ResolverProveedor;
}): ContadoresCompras {
  const palabras = palabrasBusqueda(args.texto);
  return {
    documentos: args.documentos.filter((d) => coincideDocumento(d, palabras)).length,
    productos: filtrarProductos(
      args.productos,
      { busqueda: args.texto, categoria: "todas", proveedor: "", soloConCompras: false },
      args.mapaCategorias,
      args.resolver,
    ).length,
    proveedores: proveedoresDelTexto(args.proveedores, args.documentos, args.texto, args.resolver).length,
  };
}

/** Documentos de un proveedor canónico (clave `#id`), el más reciente primero. */
export function documentosDeProveedor(docs: Factura[], proveedor: Pick<Proveedor, "id">, resolver: ResolverProveedor): Factura[] {
  const clave = `#${proveedor.id}`;
  return docs
    .filter((d) => claveProveedorDocumento(d, resolver) === clave)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
}

// ─── Productos que han subido de precio ─────────────────────────────────────

/** Nombres (normalizados) de los productos de `variacion_precios_agente` con subida. */
export function nombresConSubida(datos: unknown): Set<string> {
  const salida = new Set<string>();
  const productos = (datos as { productos?: unknown } | null)?.productos;
  if (!Array.isArray(productos)) return salida;
  for (const p of productos) {
    const nombre = (p as { producto?: unknown } | null)?.producto;
    if (typeof nombre === "string" && nombre.trim()) salida.add(normalizarBusqueda(nombre));
  }
  return salida;
}

// ─── Ficha de proveedor (RPC `ficha_proveedor_agente`) ──────────────────────

export interface TopProductoProveedor {
  producto: string;
  unidad: string | null;
  ultimo_precio: number | null;
  ultima_fecha: string | null;
}

export interface FichaProveedorDatos {
  proveedor: string;
  otros_parecidos: string[];
  docs: number;
  primera: string | null;
  ultima: string | null;
  intervalo_medio_dias: number | null;
  /** Total con IVA de facturas + albaranes sin factura. */
  gasto: number | null;
  reparto: { en_facturas: number; en_albaranes_sin_factura: number } | null;
  sin_total: number | null;
  top_productos: TopProductoProveedor[];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const cadena = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Valida el JSON de la RPC. `null` = no es una ficha (ni `sin_datos` ni
 * `error`): `{ sinDatos: true }` si la RPC dice que no hay tal proveedor.
 */
export function normalizarFichaProveedor(entrada: unknown): FichaProveedorDatos | { sinDatos: true; nota: string | null } | null {
  if (!entrada || typeof entrada !== "object") return null;
  const d = entrada as Record<string, unknown>;
  if (d.sin_datos === true || typeof d.error === "string") {
    return { sinDatos: true, nota: cadena(d.nota) ?? cadena(d.error) };
  }
  if (typeof d.proveedor !== "string") return null;
  const reparto = d.reparto && typeof d.reparto === "object" ? (d.reparto as Record<string, unknown>) : null;
  return {
    proveedor: d.proveedor,
    otros_parecidos: Array.isArray(d.otros_parecidos) ? d.otros_parecidos.filter((x): x is string => typeof x === "string") : [],
    docs: num(d.docs) ?? 0,
    primera: cadena(d.primera),
    ultima: cadena(d.ultima),
    intervalo_medio_dias: num(d.intervalo_medio_dias),
    gasto: num(d.gasto),
    reparto: reparto
      ? { en_facturas: num(reparto.en_facturas) ?? 0, en_albaranes_sin_factura: num(reparto.en_albaranes_sin_factura) ?? 0 }
      : null,
    sin_total: num(d.sin_total),
    top_productos: Array.isArray(d.top_productos)
      ? d.top_productos
          .filter((t): t is Record<string, unknown> => !!t && typeof t === "object" && typeof (t as { producto?: unknown }).producto === "string")
          .map((t) => ({
            producto: String(t.producto),
            unidad: cadena(t.unidad),
            ultimo_precio: num(t.ultimo_precio),
            ultima_fecha: cadena(t.ultima_fecha),
          }))
      : [],
  };
}

/** «cada 9 días», «cada semana»… a partir del intervalo medio. */
export function textoFrecuencia(dias: number | null): string | null {
  if (dias === null || !Number.isFinite(dias) || dias <= 0) return null;
  if (dias < 1.5) return "casi a diario";
  if (dias < 5) return `cada ${Math.round(dias)} días`;
  if (dias < 10) return "cada semana";
  if (dias < 17) return "cada dos semanas";
  if (dias < 45) return "cada mes";
  return `cada ${Math.round(dias / 30)} meses`;
}
