// ============================================================================
//  clasificacion.ts · Clasificar líneas de factura sin producto (sin Deno)
// ----------------------------------------------------------------------------
//  Lo usa index.ts (desplegado) y los tests (vitest). Recibe el cliente de
//  Supabase y la llamada al modelo por parámetro.
//
//  Flujo (una tanda):
//    1. Líneas con producto_id NULL (hasta 300), agrupadas por su texto
//       normalizado (productos_factura.nombre_normalizado).
//    2. Catálogo (id, nombre, categoría) y categorías activas.
//    3. UNA llamada barata (gpt-5.6-luna por defecto) con Structured Outputs:
//       por cada texto, producto existente (producto_id) o uno nuevo
//       (nombre_nuevo + categoria_id).
//    4. Se valida (ids que existen, textos que se pidieron) y se manda a la
//       RPC productos_aplicar_clasificacion_ia, que crea los productos (origen
//       'ia'), los alias y asigna SOLO las líneas sin producto. Un alias que ya
//       exista manda: nunca pisa una corrección hecha a mano.
//  Lo que la IA no conteste se queda sin clasificar y sale en «Sin
//  clasificar» de Facturas › Productos.
// ============================================================================

export const FUNCION = "clasificar-productos";
export const MODELO_POR_DEFECTO = "gpt-5.6-luna";
/** Líneas pendientes que se leen por tanda y textos distintos que se mandan al modelo. */
export const MAX_LINEAS = 300;
export const MAX_TEXTOS = 120;

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface LineaPendiente {
  id: number;
  nombre: string;
  nombre_normalizado: string | null;
  unidad: string | null;
  precio_unitario: number | string | null;
  proveedor: string | null;
}

export interface TextoPendiente {
  texto: string;
  ejemplo: string;
  proveedor: string | null;
  unidad: string | null;
  precio: number | null;
  lineas: number;
}

export interface ProductoCatalogo {
  id: number;
  nombre: string;
  categoria_id: number | null;
}

export interface Categoria {
  id: number;
  nombre: string;
  padre_id: number | null;
  descripcion: string | null;
  activa: boolean;
}

export interface Asignacion {
  texto: string;
  producto_id: number | null;
  nombre_nuevo: string | null;
  categoria_id: number | null;
}

/** Lo que recibe productos_aplicar_clasificacion_ia. */
export interface ElementoClasificacion {
  textos: string[];
  producto_id: number | null;
  nombre: string | null;
  categoria_id: number | null;
  unidad: string | null;
}

export const ESQUEMA_CLASIFICACION = {
  name: "clasificacion_productos",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["asignaciones"],
    properties: {
      asignaciones: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["texto", "producto_id", "nombre_nuevo", "categoria_id"],
          properties: {
            texto: { type: "string", description: "El campo t EXACTO de la línea" },
            producto_id: { type: ["integer", "null"], description: "id del catálogo si es el MISMO producto" },
            nombre_nuevo: { type: ["string", "null"], description: "Nombre canónico si no está en el catálogo" },
            categoria_id: { type: ["integer", "null"], description: "id de la categoría más concreta (para nombre_nuevo)" },
          },
        },
      },
    },
  },
} as const;

/** Agrupa las líneas por texto normalizado (el que usa productos_alias). */
export function agruparPendientes(lineas: LineaPendiente[], max = MAX_TEXTOS): TextoPendiente[] {
  const mapa = new Map<string, TextoPendiente>();
  for (const l of lineas) {
    const t = (l.nombre_normalizado ?? "").trim();
    if (!t || t.length > 500) continue;
    const previo = mapa.get(t);
    if (previo) {
      previo.lineas++;
      continue;
    }
    if (mapa.size >= max) continue;
    const precio = l.precio_unitario === null || l.precio_unitario === undefined ? null : Number(l.precio_unitario);
    mapa.set(t, {
      texto: t,
      ejemplo: l.nombre,
      proveedor: l.proveedor ?? null,
      unidad: l.unidad ?? null,
      precio: Number.isFinite(precio) ? precio : null,
      lineas: 1,
    });
  }
  return [...mapa.values()];
}

/** «Bebidas › Vinos». */
export function rutaCategoria(c: Categoria, porId: Map<number, Categoria>): string {
  const padre = c.padre_id !== null ? porId.get(c.padre_id) : undefined;
  return padre ? `${padre.nombre} › ${c.nombre}` : c.nombre;
}

export function construirMensajes(
  textos: TextoPendiente[],
  catalogo: ProductoCatalogo[],
  categorias: Categoria[],
): { role: "system" | "user"; content: string }[] {
  const activas = categorias.filter((c) => c.activa);
  const porId = new Map(categorias.map((c) => [c.id, c]));
  const taxonomia = activas
    .sort((a, b) => rutaCategoria(a, porId).localeCompare(rutaCategoria(b, porId), "es"))
    .map((c) => `${c.id}: ${rutaCategoria(c, porId)}${c.descripcion ? ` — ${c.descripcion}` : ""}`)
    .join("\n");
  const sistema =
    "Eres el encargado de compras de un restaurante español. Ordenas las líneas de facturas y albaranes de " +
    "proveedores en un catálogo de productos canónicos.\n" +
    "Para CADA línea pendiente (campo t) devuelve una asignación:\n" +
    "- Si es EL MISMO producto que uno del catálogo (aunque esté escrito distinto, con erratas del OCR o el " +
    "formato del envase repetido), pon su producto_id y deja nombre_nuevo y categoria_id a null.\n" +
    "- Si no está, inventa nombre_nuevo: corto, legible, en español con mayúscula inicial, con la marca si " +
    "aporta y el formato si distingue (70 cl, 5 L, Magnum); sin códigos internos ni añada. Varias líneas que " +
    "sean el mismo producto nuevo llevan EXACTAMENTE el mismo nombre_nuevo. Pon categoria_id con la categoría " +
    "MÁS CONCRETA de la lista (la subcategoría si la hay).\n" +
    "- Otro vino, otra variedad u otro tamaño (botella frente a Magnum) son productos distintos.\n" +
    "- Portes, mano de obra, reparaciones, guardias, gestión y logística o rappels van a Servicios.\n" +
    `Categorías (id: ruta — qué entra):\n${taxonomia}`;
  const lista = catalogo.length
    ? catalogo.map((p) => `${p.id}|${p.nombre}|${p.categoria_id ?? ""}`).join("\n")
    : "(vacío)";
  const usuario =
    `Catálogo actual (id|nombre|categoria_id):\n${lista}\n\n` +
    "Líneas pendientes (t = texto normalizado EXACTO, ej = texto original, prov = proveedor, u = unidad, p = precio):\n" +
    textos.map((t) => JSON.stringify({ t: t.texto, ej: t.ejemplo, prov: t.proveedor, u: t.unidad, p: t.precio })).join("\n") +
    "\n\nDevuelve una asignación por cada t, con el t exacto.";
  return [
    { role: "system", content: sistema },
    { role: "user", content: usuario },
  ];
}

const limpiarNombre = (s: unknown): string =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
const claveNombre = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Convierte la respuesta del modelo en elementos para la RPC: descarta textos
 * que no se pidieron, ids que no existen y nombres vacíos; junta los textos que
 * van al mismo producto. La unidad de un producto nuevo es la de sus líneas.
 */
export function validarAsignaciones(
  respuesta: unknown,
  textos: TextoPendiente[],
  catalogo: ProductoCatalogo[],
  categorias: Categoria[],
): ElementoClasificacion[] {
  const pedidos = new Map(textos.map((t) => [t.texto, t]));
  const productos = new Set(catalogo.map((p) => p.id));
  const categoriasActivas = new Set(categorias.filter((c) => c.activa).map((c) => c.id));
  const lista = (respuesta as { asignaciones?: unknown })?.asignaciones;
  if (!Array.isArray(lista)) return [];

  const vistos = new Set<string>();
  const porClave = new Map<string, ElementoClasificacion>();
  for (const bruto of lista) {
    const a = bruto as Partial<Asignacion>;
    const texto = typeof a?.texto === "string" ? a.texto : "";
    const pedido = pedidos.get(texto);
    if (!pedido || vistos.has(texto)) continue;
    let clave: string;
    let elemento: ElementoClasificacion;
    if (typeof a.producto_id === "number" && productos.has(a.producto_id)) {
      clave = `id:${a.producto_id}`;
      elemento = { textos: [], producto_id: a.producto_id, nombre: null, categoria_id: null, unidad: null };
    } else {
      const nombre = limpiarNombre(a.nombre_nuevo).slice(0, 200);
      if (!nombre) continue;
      clave = `nuevo:${claveNombre(nombre)}`;
      const categoria = typeof a.categoria_id === "number" && categoriasActivas.has(a.categoria_id) ? a.categoria_id : null;
      elemento = { textos: [], producto_id: null, nombre, categoria_id: categoria, unidad: pedido.unidad };
    }
    vistos.add(texto);
    const existente = porClave.get(clave);
    if (existente) {
      existente.textos.push(texto);
      if (existente.categoria_id === null && elemento.categoria_id !== null) existente.categoria_id = elemento.categoria_id;
    } else {
      elemento.textos.push(texto);
      porClave.set(clave, elemento);
    }
  }
  return [...porClave.values()];
}

export interface DependenciasClasificar {
  supabase: Supa;
  /** Llama al modelo y devuelve el JSON ya parseado. */
  llamarModelo: (mensajes: { role: string; content: string }[], esquema: typeof ESQUEMA_CLASIFICACION) => Promise<unknown>;
}

export interface ResultadoClasificar {
  pendientes: number;
  textos: number;
  propuestas: number;
  aplicado: { productos_creados?: number; alias_creados?: number; lineas_asignadas?: number } | null;
}

export async function clasificarPendientes(deps: DependenciasClasificar): Promise<ResultadoClasificar> {
  const { supabase } = deps;
  const { data: filas, error: e1 } = await supabase
    .from("productos_factura")
    .select("id, nombre, nombre_normalizado, unidad, precio_unitario, facturas(proveedor)")
    .is("producto_id", null)
    .order("id", { ascending: true })
    .limit(MAX_LINEAS);
  if (e1) throw new Error(`Líneas pendientes: ${e1.message}`);
  // deno-lint-ignore no-explicit-any
  const lineas: LineaPendiente[] = (filas ?? []).map((f: any) => ({
    id: f.id,
    nombre: f.nombre,
    nombre_normalizado: f.nombre_normalizado,
    unidad: f.unidad,
    precio_unitario: f.precio_unitario,
    proveedor: f.facturas?.proveedor ?? null,
  }));
  const textos = agruparPendientes(lineas);
  if (textos.length === 0) return { pendientes: lineas.length, textos: 0, propuestas: 0, aplicado: null };

  const [{ data: cat, error: e2 }, { data: cats, error: e3 }] = await Promise.all([
    supabase.from("productos_catalogo").select("id, nombre, categoria_id").order("id", { ascending: true }).limit(3000),
    supabase.from("categorias_producto").select("id, nombre, padre_id, descripcion, activa"),
  ]);
  if (e2) throw new Error(`Catálogo: ${e2.message}`);
  if (e3) throw new Error(`Categorías: ${e3.message}`);
  const catalogo = (cat ?? []) as ProductoCatalogo[];
  const categorias = (cats ?? []) as Categoria[];

  const respuesta = await deps.llamarModelo(construirMensajes(textos, catalogo, categorias), ESQUEMA_CLASIFICACION);
  const items = validarAsignaciones(respuesta, textos, catalogo, categorias);
  if (items.length === 0) return { pendientes: lineas.length, textos: textos.length, propuestas: 0, aplicado: null };

  const { data: aplicado, error: e4 } = await supabase.rpc("productos_aplicar_clasificacion_ia", { p_items: items });
  if (e4) throw new Error(`productos_aplicar_clasificacion_ia: ${e4.message}`);
  return { pendientes: lineas.length, textos: textos.length, propuestas: items.length, aplicado: aplicado ?? null };
}
