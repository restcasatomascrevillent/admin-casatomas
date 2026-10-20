// ============================================================================
//  Facturas › Productos — cuentas puras (sin React ni Supabase)
// ----------------------------------------------------------------------------
//  Catálogo de productos canónicos con categoría (migración
//  20261007160000_productos_catalogo_categorias): árbol de dos niveles,
//  filtros de la pantalla, totales por categoría y periodos.
// ============================================================================
import type { ResolverProveedor } from "./proveedores";

export interface CategoriaProducto {
  id: number;
  clave: string | null;
  nombre: string;
  descripcion: string | null;
  padre_id: number | null;
  orden: number;
  activa: boolean;
}

/** Una fila de `productos_resumen`. */
export interface ResumenProducto {
  producto_id: number;
  nombre: string;
  categoria_id: number | null;
  origen: "ia" | "manual" | string;
  unidad_habitual: string | null;
  compras: number;
  documentos: number;
  /** Suma de cantidades por unidad: {"kg": 48, "ud": 12}. "" = sin unidad. */
  cantidades: Record<string, number>;
  /** Suma de importes de línea (base, sin IVA). */
  gasto: number;
  lineas_sin_importe: number;
  ultimo_precio: number | null;
  ultima_fecha: string | null;
  proveedores: string[];
}

/** Una fila de `productos_gasto_por_categoria`. */
export interface GastoCategoria {
  categoria_id: number | null;
  categoria: string;
  padre_id: number | null;
  padre: string | null;
  sin_clasificar: boolean;
  gasto: number;
  lineas: number;
  productos: number;
  lineas_sin_importe: number;
}

export type MapaCategorias = Map<number, CategoriaProducto>;

export const indexarCategorias = (cats: CategoriaProducto[]): MapaCategorias => new Map(cats.map((c) => [c.id, c]));

/** «Bebidas › Vinos»; null si no hay categoría o no se conoce. */
export function rutaCategoria(mapa: MapaCategorias, id: number | null | undefined): string | null {
  if (id === null || id === undefined) return null;
  const c = mapa.get(id);
  if (!c) return null;
  const padre = c.padre_id !== null ? mapa.get(c.padre_id) : undefined;
  return padre ? `${padre.nombre} › ${c.nombre}` : c.nombre;
}

/** La categoría de primer nivel de `id` (ella misma si ya lo es). */
export function categoriaRaiz(mapa: MapaCategorias, id: number | null | undefined): number | null {
  if (id === null || id === undefined) return null;
  const c = mapa.get(id);
  if (!c) return null;
  return c.padre_id ?? c.id;
}

const porOrden = (a: CategoriaProducto, b: CategoriaProducto) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es");

export interface OpcionCategoria {
  id: number;
  etiqueta: string;
  nivel: 0 | 1;
  activa: boolean;
}

/**
 * Opciones en árbol (madre y debajo sus hijas). Las desactivadas solo salen si
 * `incluir` es una de ellas (la categoría actual de un producto).
 */
export function opcionesCategoria(cats: CategoriaProducto[], incluir?: number | null): OpcionCategoria[] {
  const visibles = cats.filter((c) => c.activa || c.id === incluir);
  const raices = visibles.filter((c) => c.padre_id === null).sort(porOrden);
  const salida: OpcionCategoria[] = [];
  for (const r of raices) {
    salida.push({ id: r.id, etiqueta: r.nombre, nivel: 0, activa: r.activa });
    for (const h of visibles.filter((c) => c.padre_id === r.id).sort(porOrden)) {
      salida.push({ id: h.id, etiqueta: `${r.nombre} › ${h.nombre}`, nivel: 1, activa: h.activa });
    }
  }
  return salida;
}

const fmtNum = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });

/** «48 kg · 12 ud». Unidad vacía → «12 (sin unidad)». */
export function formatCantidades(cantidades: Record<string, number> | null | undefined): string {
  const partes = Object.entries(cantidades ?? {})
    .filter(([, v]) => Number.isFinite(Number(v)) && Number(v) !== 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([u, v]) => (u ? `${fmtNum.format(Number(v))} ${u}` : `${fmtNum.format(Number(v))} (sin unidad)`));
  return partes.length ? partes.join(" · ") : "—";
}

export const normalizarBusqueda = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Clave de proveedor: sin mayúsculas, tildes, puntuación ni forma jurídica. */
export const claveProveedor = (s: string) =>
  normalizarBusqueda(s).replace(/[.,]/g, " ").replace(/\b(s\s?l\s?u?|s\s?a|c\s?b|slu)\b/g, "").replace(/\s+/g, " ").trim();

/** Sin proveedores unificados: la clave de texto de siempre y el propio texto. */
const resolverPorTexto: ResolverProveedor = (texto) => ({ clave: claveProveedor(texto), nombre: texto });

/**
 * Proveedores distintos (por clave), con el primer nombre visto. Orden alfabético.
 * Con `resolver` (proveedores unificados, `crearResolverProveedor`) la clave y el
 * nombre son los del proveedor canónico: «JOSELITO (Cárnicas Joselito)» y
 * «Cárnicas Joselito S.A.» salen una sola vez.
 */
export function proveedoresDe(
  lista: Pick<ResumenProducto, "proveedores">[],
  resolver: ResolverProveedor = resolverPorTexto,
): { clave: string; nombre: string }[] {
  const mapa = new Map<string, string>();
  for (const p of lista) for (const n of p.proveedores ?? []) {
    const r = resolver(n);
    if (r.clave && !mapa.has(r.clave)) mapa.set(r.clave, r.nombre);
  }
  return [...mapa].map(([clave, nombre]) => ({ clave, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Nombres de proveedor de un producto, ya canónicos y sin repetir. */
export function nombresProveedores(
  p: Pick<ResumenProducto, "proveedores">,
  resolver: ResolverProveedor = resolverPorTexto,
): string[] {
  const vistos = new Map<string, string>();
  for (const n of p.proveedores ?? []) {
    const r = resolver(n);
    if (r.clave && !vistos.has(r.clave)) vistos.set(r.clave, r.nombre);
  }
  return [...vistos.values()];
}

/** «todas» · «sin» (productos sin categoría) · id de categoría (incluye sus hijas). */
export type FiltroCategoria = "todas" | "sin" | number;

export interface FiltrosProductos {
  busqueda: string;
  categoria: FiltroCategoria;
  /** Clave de proveedor (la de `proveedoresDe` con el mismo resolver) o "" para todos. */
  proveedor: string;
  /** Ocultar productos sin compras en el periodo. */
  soloConCompras: boolean;
}

export function filtrarProductos(
  lista: ResumenProducto[],
  f: FiltrosProductos,
  mapa: MapaCategorias,
  resolver: ResolverProveedor = resolverPorTexto,
): ResumenProducto[] {
  const q = normalizarBusqueda(f.busqueda);
  return lista.filter((p) => {
    if (f.soloConCompras && p.compras === 0) return false;
    if (f.categoria === "sin" && p.categoria_id !== null) return false;
    if (typeof f.categoria === "number" && p.categoria_id !== f.categoria && categoriaRaiz(mapa, p.categoria_id) !== f.categoria) {
      return false;
    }
    if (f.proveedor && !(p.proveedores ?? []).some((n) => resolver(n).clave === f.proveedor)) return false;
    if (q && !normalizarBusqueda(p.nombre).includes(q) && !normalizarBusqueda(rutaCategoria(mapa, p.categoria_id)).includes(q)) {
      return false;
    }
    return true;
  });
}

export interface TotalCategoria {
  /** id de la categoría raíz; "sin" = productos sin categoría; "pendiente" = líneas sin producto. */
  clave: number | "sin" | "pendiente";
  nombre: string;
  gasto: number;
  lineas: number;
}

/** Suma el gasto de las subcategorías en su categoría madre. Orden: más gasto primero, «Sin clasificar» al final. */
export function totalesPorRaiz(gastos: GastoCategoria[], mapa: MapaCategorias): TotalCategoria[] {
  const acc = new Map<TotalCategoria["clave"], TotalCategoria>();
  for (const g of gastos) {
    let clave: TotalCategoria["clave"];
    let nombre: string;
    if (g.sin_clasificar) {
      clave = "pendiente";
      nombre = "Sin clasificar";
    } else if (g.categoria_id === null) {
      clave = "sin";
      nombre = "Sin categoría";
    } else {
      clave = g.padre_id ?? g.categoria_id;
      nombre = g.padre ?? mapa.get(clave)?.nombre ?? g.categoria;
    }
    const t = acc.get(clave) ?? { clave, nombre, gasto: 0, lineas: 0 };
    t.gasto = Math.round((t.gasto + Number(g.gasto || 0)) * 100) / 100;
    t.lineas += Number(g.lineas || 0);
    acc.set(clave, t);
  }
  const peso = (t: TotalCategoria) => (t.clave === "pendiente" ? 2 : t.clave === "sin" ? 1 : 0);
  return [...acc.values()].sort((a, b) => peso(a) - peso(b) || b.gasto - a.gasto);
}

export type Periodo = "todo" | "mes" | "mes_anterior" | "trimestre" | "anio" | "anio_anterior";

export const ETIQUETAS_PERIODO: Record<Periodo, string> = {
  todo: "Todo",
  mes: "Este mes",
  mes_anterior: "Mes pasado",
  trimestre: "Últimos 3 meses",
  anio: "Este año",
  anio_anterior: "Año pasado",
};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Fechas (YYYY-MM-DD, inclusivas) del periodo; null = sin límite. */
export function rangoPeriodo(p: Periodo, hoy: Date = new Date()): { desde: string | null; hasta: string | null } {
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  switch (p) {
    case "mes":
      return { desde: iso(new Date(y, m, 1)), hasta: iso(new Date(y, m + 1, 0)) };
    case "mes_anterior":
      return { desde: iso(new Date(y, m - 1, 1)), hasta: iso(new Date(y, m, 0)) };
    case "trimestre":
      return { desde: iso(new Date(y, m - 2, 1)), hasta: iso(new Date(y, m + 1, 0)) };
    case "anio":
      return { desde: `${y}-01-01`, hasta: `${y}-12-31` };
    case "anio_anterior":
      return { desde: `${y - 1}-01-01`, hasta: `${y - 1}-12-31` };
    default:
      return { desde: null, hasta: null };
  }
}

/** El que queda al fusionar: el de más compras (y, a igualdad, más gasto; luego el más antiguo). */
export function destinoFusionSugerido(seleccion: Pick<ResumenProducto, "producto_id" | "compras" | "gasto" | "origen">[]): number | null {
  if (seleccion.length === 0) return null;
  const orden = [...seleccion].sort(
    (a, b) =>
      (a.origen === "manual" ? 0 : 1) - (b.origen === "manual" ? 0 : 1) ||
      b.compras - a.compras ||
      b.gasto - a.gasto ||
      a.producto_id - b.producto_id,
  );
  return orden[0].producto_id;
}

/** Normaliza una fila cruda de la RPC (numeric llega como string o número). */
export function aResumen(f: Record<string, unknown>): ResumenProducto {
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const cant: Record<string, number> = {};
  const c = f.cantidades;
  if (c && typeof c === "object") for (const [k, v] of Object.entries(c as Record<string, unknown>)) cant[k] = Number(v);
  return {
    producto_id: Number(f.producto_id),
    nombre: String(f.nombre ?? ""),
    categoria_id: nn(f.categoria_id),
    origen: String(f.origen ?? "manual"),
    unidad_habitual: (f.unidad_habitual as string | null) ?? null,
    compras: n(f.compras),
    documentos: n(f.documentos),
    cantidades: cant,
    gasto: n(f.gasto),
    lineas_sin_importe: n(f.lineas_sin_importe),
    ultimo_precio: nn(f.ultimo_precio),
    ultima_fecha: (f.ultima_fecha as string | null) ?? null,
    proveedores: Array.isArray(f.proveedores) ? (f.proveedores as string[]) : [],
  };
}

export function aGastoCategoria(f: Record<string, unknown>): GastoCategoria {
  return {
    categoria_id: f.categoria_id === null || f.categoria_id === undefined ? null : Number(f.categoria_id),
    categoria: String(f.categoria ?? ""),
    padre_id: f.padre_id === null || f.padre_id === undefined ? null : Number(f.padre_id),
    padre: (f.padre as string | null) ?? null,
    sin_clasificar: Boolean(f.sin_clasificar),
    gasto: Number(f.gasto ?? 0),
    lineas: Number(f.lineas ?? 0),
    productos: Number(f.productos ?? 0),
    lineas_sin_importe: Number(f.lineas_sin_importe ?? 0),
  };
}

/** ¿El error es que la migración del catálogo aún no está aplicada? */
export function faltaMigracionCatalogo(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (["PGRST202", "PGRST205", "42P01", "42883", "PGRST200"].includes(error.code ?? "")) return true;
  return /productos_resumen|productos_gasto_por_categoria|categorias_producto|producto_id|productos_catalogo/i.test(error.message ?? "")
    && /does not exist|not find|schema cache|no existe|relationship/i.test(error.message ?? "");
}
