// ============================================================================
//  Super Admin › Informes — «Vinos: facturas y carta» y «Platos: facturas y
//  carta» (11/11/2026). Petición del dueño: «Revisa las facturas que hay y
//  quiero una lista de todos los vinos de la carta, precio en facturas, precio
//  en carta, si está activo o no y si tienen foto o no (en el apartado
//  Informes añade un botón para generar este tipo de informes en PDF). Para
//  platos lo mismo».
//    · Todos los vinos / platos de la tabla (activos o no), por categoría y nombre.
//    · La compra sale de la misma vinculación que Facturas › Márgenes (migración
//      20261115200000_analisis_margenes_carta): `vino_producto` (la botella) y,
//      en platos, el primer ingrediente del escandallo (`escandallo_platos` por
//      orden, como en «Por peso»). De ese producto, la ÚLTIMA línea de compra
//      con las reglas de `margenes_compras_producto`: solo Casa Tomás (local no
//      Touza), sin albaranes ya facturados, sin abonos y sin líneas a 0.
//      Precio = base sin IVA de la línea / cantidad: € por unidad tal como se
//      compra (botella, caja, kg…).
//    · Sin compra vinculada: «—».
//  12/11/2026 (dueño: «añade el margen de beneficio en los informes de vinos
//  facturas y carta y en platos di que falta el escandallo»):
//    · Vinos: columna «Margen», la MISMA cuenta que Facturas › Márgenes (RPC
//      `margenes_carta`): venta sin IVA ÷ coste sin IVA en el formato de la
//      carta («×2,30 · beneficio 57 %»: el % es el beneficio sobre la venta sin IVA).
//  13/11/2026: el coste de Facturas › Márgenes es el de la ÚLTIMA factura (migración
//  20261128140000), como la columna «Compra» de este informe.
//    · Platos sin escandallo: «Falta el escandallo» en lugar del ingrediente.
// ============================================================================
import { supabase } from "@/integrations/supabase/client";
import { fmt, normalizarMargenes } from "@/lib/analisis/margenesCarta";
import type { ContextoInforme } from "../registro";
import { nombreArchivoInforme, type ColumnaInforme, type FilaInforme, type ResultadoInformeTabla } from "../tabla";

export type TipoCartaFacturas = "vinos" | "platos";

/** Fila de «Vinos» o «Platos» (las columnas que usa el informe). */
export interface ArticuloCarta {
  id: string;
  nombre: string | null;
  categoria: string | null;
  precio_eur: number | null;
  activado: boolean | null;
  imagen_url: string | null;
}

/** Producto de compra vinculado a un vino (la botella) o a un plato (un ingrediente del escandallo). */
export interface VinculoCompra {
  articuloId: string;
  productoId: number;
  /** Nombre en el catálogo de productos. */
  producto: string | null;
  /** Orden en el escandallo (el primero es el principal); 0 en vinos. */
  orden: number;
}

/** Línea de compra con su documento (productos_factura + facturas). */
export interface LineaCompra {
  id: number;
  producto_id: number | null;
  cantidad: number | string | null;
  unidad: string | null;
  total: number | string | null;
  facturas: { fecha: string | null; tipo: string | null; local: string | null; total: number | string | null; facturado_en_id: number | null } | null;
}

export interface UltimaCompra {
  /** Base sin IVA de la línea / cantidad. */
  eurUd: number;
  /** Unidad en que se compra («botella», «caja», «kg»…). */
  unidad: string;
  /** `YYYY-MM-DD`. */
  fecha: string;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ¿Cuenta la línea? Las mismas reglas que `margenes_compras_producto`. */
function lineaValida(l: LineaCompra): boolean {
  const f = l.facturas;
  if (!f?.fecha || l.producto_id === null) return false;
  if (!((num(l.total) ?? 0) > 0) || !((num(l.cantidad) ?? 0) > 0)) return false;
  if (f.local === "touza") return false;
  if (f.tipo === "albaran" && f.facturado_en_id !== null && f.facturado_en_id !== undefined) return false;
  return (num(f.total) ?? 0) >= 0;
}

/** La última compra de cada producto (fecha más reciente; a igualdad, la última línea). */
export function ultimasCompras(lineas: readonly LineaCompra[]): Map<number, UltimaCompra> {
  const mejor = new Map<number, LineaCompra>();
  for (const l of lineas) {
    if (!lineaValida(l)) continue;
    const actual = mejor.get(l.producto_id as number);
    const fecha = l.facturas!.fecha as string;
    const fechaActual = actual?.facturas?.fecha ?? "";
    if (!actual || fecha > fechaActual || (fecha === fechaActual && l.id > actual.id)) mejor.set(l.producto_id as number, l);
  }
  const res = new Map<number, UltimaCompra>();
  for (const [producto, l] of mejor) {
    res.set(producto, {
      eurUd: Math.round(((num(l.total) as number) / (num(l.cantidad) as number)) * 10000) / 10000,
      unidad: l.unidad?.trim().toLowerCase() || "ud",
      fecha: (l.facturas!.fecha as string).slice(0, 10),
    });
  }
  return res;
}

/** «2026-10-12» → «12/10/2026». */
const fechaCorta = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const siNo = (v: boolean) => (v ? "Sí" : "No");
const tieneFoto = (a: Pick<ArticuloCarta, "imagen_url">) => !!a.imagen_url?.trim();

const TEXTOS: Record<TipoCartaFacturas, { titulo: string; singular: string; plural: string; columna: string }> = {
  vinos: { titulo: "Vinos: facturas y carta", singular: "vino", plural: "vinos", columna: "Vino" },
  platos: { titulo: "Platos: facturas y carta", singular: "plato", plural: "platos", columna: "Plato" },
};

/** Columnas: nombre, categoría, (ingrediente), carta, compra, (margen), unidad, fecha, activo y foto. Anchos para que quepan en la diapositiva. */
export function columnasCartaFacturas(tipo: TipoCartaFacturas): ColumnaInforme[] {
  return [
    { id: "nombre", etiqueta: TEXTOS[tipo].columna, tipo: "texto" },
    { id: "categoria", etiqueta: "Categoría", tipo: "texto", ancho: tipo === "vinos" ? 170 : 150 },
    ...(tipo === "platos" ? [{ id: "producto", etiqueta: "Ingrediente", tipo: "texto" as const, ancho: 170 }] : []),
    { id: "precio", etiqueta: "Carta", tipo: "precio", ancho: 105 },
    { id: "compra", etiqueta: "Compra", tipo: "precio", ancho: 105 },
    ...(tipo === "vinos" ? [{ id: "margen", etiqueta: "Margen", tipo: "texto" as const, ancho: 160 }] : []),
    { id: "unidad", etiqueta: "Unidad", tipo: "texto", ancho: 90 },
    { id: "fecha", etiqueta: "Fecha", tipo: "fecha", ancho: 120 },
    { id: "activo", etiqueta: "Activo", tipo: "texto", ancho: 85 },
    { id: "foto", etiqueta: "Foto", tipo: "texto", ancho: 70 },
  ];
}

/** El producto que cuenta de cada vino o plato: el de menor orden (a igualdad, el que llega antes). */
export function vinculosPrincipales(vinculos: readonly VinculoCompra[]): Map<string, VinculoCompra> {
  const principal = new Map<string, VinculoCompra>();
  for (const v of vinculos) {
    const actual = principal.get(v.articuloId);
    if (!actual || v.orden < actual.orden) principal.set(v.articuloId, v);
  }
  return principal;
}

/**
 * Una fila por vino o plato, por categoría y nombre (sin categoría, al final).
 * Si tiene varios productos vinculados (escandallo), cuenta el principal.
 */
/** Multiplicador de un vino en Facturas › Márgenes (venta sin IVA ÷ coste sin IVA). */
export type MargenesVinos = ReadonlyMap<string, number | null>;

/**
 * «×2,30 · beneficio 57 %»: multiplicador y beneficio sobre la venta sin IVA (1 − 1/×).
 * 13/11/2026 (dueño): el % va con su nombre; antes salía «57 %» solo y se confundía con el
 * % de coste. «—» sin datos de coste.
 */
export function textoMargen(multiplicador: number | null | undefined): string | null {
  if (multiplicador === null || multiplicador === undefined || !(multiplicador > 0)) return null;
  const beneficio = Math.round((1 - 1 / multiplicador) * 100);
  return `×${fmt(multiplicador, 2)} · beneficio ${beneficio} %`;
}

export const FALTA_ESCANDALLO = "Falta el escandallo";

export function filasCartaFacturas(
  tipo: TipoCartaFacturas,
  articulos: readonly ArticuloCarta[],
  vinculos: readonly VinculoCompra[],
  compras: ReadonlyMap<number, UltimaCompra>,
  margenes: MargenesVinos = new Map(),
): FilaInforme[] {
  const principal = vinculosPrincipales(vinculos);
  const porNombre = (x: string, y: string) => x.localeCompare(y, "es", { sensitivity: "base" });
  return [...articulos]
    .sort((a, b) => {
      const ca = a.categoria?.trim() ?? "";
      const cb = b.categoria?.trim() ?? "";
      if (!ca !== !cb) return ca ? -1 : 1;
      return porNombre(ca, cb) || porNombre(a.nombre ?? "", b.nombre ?? "");
    })
    .map((a) => {
      const v = principal.get(a.id);
      const c = v ? compras.get(v.productoId) : undefined;
      return {
        nombre: a.nombre?.trim() || "(sin nombre)",
        categoria: a.categoria?.trim() || null,
        // Sin ningún producto en su escandallo, se dice (antes, «—» sin explicar por qué).
        ...(tipo === "platos" ? { producto: v ? v.producto : FALTA_ESCANDALLO } : {}),
        precio: num(a.precio_eur),
        compra: c ? c.eurUd : null,
        ...(tipo === "vinos" ? { margen: textoMargen(margenes.get(a.id)) } : {}),
        unidad: c ? c.unidad : null,
        fecha: c ? fechaCorta(c.fecha) : null,
        activo: siNo(a.activado === true),
        foto: siNo(tieneFoto(a)),
      };
    });
}

export interface DatosCartaFacturas {
  articulos: readonly ArticuloCarta[];
  vinculos: readonly VinculoCompra[];
  compras: ReadonlyMap<number, UltimaCompra>;
  /** Solo vinos: multiplicador de Facturas › Márgenes por id de vino. */
  margenes?: MargenesVinos;
}

/** El informe como tabla. Función pura (se prueba sin Supabase). */
export function informeCartaFacturas(tipo: TipoCartaFacturas, datos: DatosCartaFacturas, ctx: ContextoInforme): ResultadoInformeTabla {
  const t = TEXTOS[tipo];
  if (datos.articulos.length === 0) return { vacio: true, motivo: `No hay ${t.plural} en la carta.` };
  const filas = filasCartaFacturas(tipo, datos.articulos, datos.vinculos, datos.compras, datos.margenes);
  const conCompra = filas.filter((f) => f.compra !== null).length;
  const sinEscandallo = tipo === "platos" ? filas.filter((f) => f.producto === FALTA_ESCANDALLO).length : 0;
  const activos = filas.filter((f) => f.activo === "Sí").length;
  const conFoto = filas.filter((f) => f.foto === "Sí").length;
  const deQue = tipo === "platos" ? "de su ingrediente principal (escandallo)" : "de la botella";
  return {
    vacio: false,
    titulo: t.titulo,
    descripcion:
      `${filas.length} ${filas.length === 1 ? t.singular : t.plural}: ${activos} activos, ${conFoto} con foto ` +
      `y ${conCompra} con compra en las facturas` +
      (tipo === "platos" ? `; a ${sinEscandallo} ${sinEscandallo === 1 ? "le falta" : "les falta"} el escandallo` : "") +
      `. Precio de carta frente a la última compra ${deQue}.`,
    textoPeriodo: `Carta a ${fechaCorta(ctx.hoy)}`,
    tablas: [
      {
        titulo: t.titulo,
        columnas: columnasCartaFacturas(tipo),
        filas,
        nota:
          "Compra: última factura o albarán de Casa Tomás, sin IVA, por la unidad en que se compra. «—»: sin compra vinculada (se vincula en Facturas › Márgenes)." +
          (tipo === "vinos"
            ? " Margen: el de Facturas › Márgenes con la última factura: cuántas veces cobras lo que pagas (venta sin IVA ÷ coste sin IVA, en el formato de la carta) y el beneficio, en % del precio de venta sin IVA."
            : " «Falta el escandallo»: el plato no tiene ingredientes; se añaden en Facturas › Márgenes."),
      },
    ],
    nombreArchivo: nombreArchivoInforme(t.titulo, ctx.hoy),
  };
}

// ─── Datos ──────────────────────────────────────────────────────────────────

const POR_PAGINA = 1000;
const PAGINAS_MAXIMAS = 50;

type Respuesta = { data: unknown; error: { message?: string } | null };
const fallo = (error: { message?: string }, que: string) => new Error(error.message || `No se han podido leer ${que}.`);

async function leerArticulos(tipo: TipoCartaFacturas): Promise<ArticuloCarta[]> {
  // «Platos» tiene las mismas columnas que «Vinos».
  const { data, error } = await supabase.from((tipo === "vinos" ? "Vinos" : "Platos") as "Vinos").select("id, nombre, categoria, precio_eur, activado, imagen_url");
  if (error) throw fallo(error, `los ${tipo}`);
  return (data ?? []) as ArticuloCarta[];
}

/** vino_producto y escandallo_platos no están en types.ts (migración 20261115200000). */
async function leerVinculos(tipo: TipoCartaFacturas): Promise<VinculoCompra[]> {
  const tabla = tipo === "vinos" ? "vino_producto" : "escandallo_platos";
  const columnas = tipo === "vinos" ? "vino_id, producto_id, productos_catalogo(nombre)" : "plato_id, producto_id, orden, productos_catalogo(nombre)";
  // Orden del escandallo de Márgenes (orden, id): el primero es el ingrediente principal.
  const { data, error } = (await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla fuera de los tipos generados
    .from(tabla as any)
    .select(columnas)
    .order(tipo === "vinos" ? "vino_id" : "orden", { ascending: true })
    .order(tipo === "vinos" ? "producto_id" : "id", { ascending: true })) as unknown as Respuesta;
  if (error) throw fallo(error, "los productos vinculados");
  type Fila = { vino_id?: string; plato_id?: string; producto_id: number; orden?: number | null; productos_catalogo?: { nombre: string | null } | null };
  return ((data ?? []) as Fila[])
    .map((f) => ({
      articuloId: String(tipo === "vinos" ? f.vino_id : f.plato_id),
      productoId: Number(f.producto_id),
      producto: f.productos_catalogo?.nombre ?? null,
      orden: f.orden ?? 0,
    }))
    .filter((v) => v.articuloId && Number.isFinite(v.productoId));
}

/** Las líneas de compra de esos productos, por tandas (PostgREST corta cada petición a 1.000 filas). */
async function leerLineasCompra(productos: number[]): Promise<LineaCompra[]> {
  if (productos.length === 0) return [];
  const lineas: LineaCompra[] = [];
  for (let pagina = 0; pagina < PAGINAS_MAXIMAS; pagina++) {
    const desde = pagina * POR_PAGINA;
    const { data, error } = await supabase
      .from("productos_factura")
      .select("id, producto_id, cantidad, unidad, total, facturas!inner(fecha, tipo, local, total, facturado_en_id)")
      .in("producto_id", productos)
      .gt("total", 0)
      .gt("cantidad", 0)
      // `id` da un orden total: sin él, dos tandas pueden repetir o saltarse líneas.
      .order("id", { ascending: true })
      .range(desde, desde + POR_PAGINA - 1);
    if (error) throw fallo(error, "las compras");
    const lote = (data ?? []) as unknown as LineaCompra[];
    lineas.push(...lote);
    if (lote.length < POR_PAGINA) break;
  }
  return lineas;
}

/**
 * Multiplicador de cada vino según Facturas › Márgenes (RPC `margenes_carta`, la misma cuenta). Si falla, el informe
 * sale igual con «—» en «Margen»: no se pierde el resto por esto.
 */
async function leerMargenesVinos(): Promise<MargenesVinos> {
  try {
    const llamar = supabase.rpc as unknown as (this: typeof supabase, fn: string, a?: Record<string, unknown>) => PromiseLike<Respuesta>;
    const { data, error } = await llamar.call(supabase, "margenes_carta", { p_hoy: null });
    if (error) return new Map();
    return new Map(normalizarMargenes(data).vinos.map((v) => [v.id, v.multiplicador]));
  } catch {
    return new Map();
  }
}

export async function obtenerInformeCartaFacturas(tipo: TipoCartaFacturas, ctx: ContextoInforme): Promise<ResultadoInformeTabla> {
  const [articulos, vinculos, margenes] = await Promise.all([
    leerArticulos(tipo),
    leerVinculos(tipo),
    tipo === "vinos" ? leerMargenesVinos() : Promise.resolve(new Map() as MargenesVinos),
  ]);
  // Solo las compras de los productos que cuentan (en platos, el ingrediente principal).
  const lineas = await leerLineasCompra([...new Set([...vinculosPrincipales(vinculos).values()].map((v) => v.productoId))]);
  return informeCartaFacturas(tipo, { articulos, vinculos, compras: ultimasCompras(lineas), margenes }, ctx);
}
