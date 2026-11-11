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
    "aporta y el formato si distingue (70 cl, 5 L, Magnum); sin códigos internos. En vinos, cavas y champanes, " +
    "CON la añada si la línea la trae («Pago de Carraovejas 2019»). Varias líneas que " +
    "sean el mismo producto nuevo llevan EXACTAMENTE el mismo nombre_nuevo. Pon categoria_id con la categoría " +
    "MÁS CONCRETA de la lista (la subcategoría si la hay).\n" +
    "- Otro vino, otra añada del mismo vino, otra variedad u otro tamaño (botella frente a Magnum) son productos distintos.\n" +
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

/**
 * Añada de un texto de línea o de producto: un año de 4 cifras suelto
 * (1950-2049) que no sea una medida («2000 g», «1500 ml»). null si no hay o
 * si hay dos años distintos (no se sabe cuál es la añada).
 */
export function anadaDe(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const anos = new Set<number>();
  for (const m of texto.matchAll(/(?<![\d.,])(19[5-9]\d|20[0-4]\d)(?![\d.,])(?!\s*(?:g|gr|grs|kg|mg|ml|cl|l|lt|cc|uds?|unid)\b)/gi)) {
    anos.add(Number(m[1]));
  }
  return anos.size === 1 ? [...anos][0] : null;
}

/**
 * Dos añadas del mismo vino son productos DISTINTOS. Si la línea trae una
 * añada y el producto (del catálogo o el nombre nuevo) lleva OTRA, no es el
 * mismo producto: devuelve el nombre con la añada de la línea. Si alguno de
 * los dos no lleva añada no se puede saber y devuelve null (se deja como está).
 */
export function nombreConOtraAnada(nombreProducto: string, textoLinea: string, ejemplo?: string | null): string | null {
  const deLinea = anadaDe(textoLinea) ?? anadaDe(ejemplo);
  const delProducto = anadaDe(nombreProducto);
  if (deLinea === null || delProducto === null || deLinea === delProducto) return null;
  return nombreProducto.replace(String(delProducto), String(deLinea));
}

/**
 * Categorías donde la añada distingue productos: las de vino, cava, champán o
 * espumoso y todas sus subcategorías (por nombre de la categoría o de un padre).
 */
export function categoriasConAnada(categorias: Categoria[]): Set<number> {
  const porId = new Map(categorias.map((c) => [c.id, c]));
  const res = new Set<number>();
  for (const c of categorias) {
    for (let x: Categoria | undefined = c, n = 0; x && n < 10; x = x.padre_id === null ? undefined : porId.get(x.padre_id), n++) {
      if (/vino|cava|champ|espumos/i.test(x.nombre)) { res.add(c.id); break; }
    }
  }
  return res;
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
  const productos = new Map(catalogo.map((p) => [p.id, p]));
  const categoriasActivas = new Set(categorias.filter((c) => c.activa).map((c) => c.id));
  const porNombre = new Map(catalogo.map((p) => [claveNombre(limpiarNombre(p.nombre)), p]));
  const conAnada = categoriasConAnada(categorias);
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
    const elegido = typeof a.producto_id === "number" ? productos.get(a.producto_id) : undefined;
    // Solo vinos, cavas y champanes: el mismo vino de OTRA añada que la del catálogo es
    // otro producto, con la añada de la línea. En el resto un año en el nombre no cuenta.
    const otraAnada = elegido && conAnada.has(elegido.categoria_id ?? -1)
      ? nombreConOtraAnada(elegido.nombre, pedido.texto, pedido.ejemplo) : null;
    // Si ese producto (con la añada de la línea) ya está en el catálogo, se usa: no se duplica.
    const yaExiste = otraAnada ? porNombre.get(claveNombre(otraAnada)) : undefined;
    const delCatalogo = yaExiste ?? (otraAnada === null ? elegido : undefined);
    if (delCatalogo) {
      clave = `id:${delCatalogo.id}`;
      elemento = { textos: [], producto_id: delCatalogo.id, nombre: null, categoria_id: null, unidad: null };
    } else {
      const categoriaPropia = otraAnada ? elegido?.categoria_id : a.categoria_id;
      const propuesto = otraAnada ?? limpiarNombre(a.nombre_nuevo).slice(0, 200);
      const corregido = propuesto && typeof categoriaPropia === "number" && conAnada.has(categoriaPropia)
        ? nombreConOtraAnada(propuesto, pedido.texto, pedido.ejemplo) : null;
      const nombre = corregido ?? propuesto;
      if (!nombre) continue;
      const igual = porNombre.get(claveNombre(nombre));
      if (igual) {
        clave = `id:${igual.id}`;
        elemento = { textos: [], producto_id: igual.id, nombre: null, categoria_id: null, unidad: null };
        vistos.add(texto);
        const ex = porClave.get(clave);
        if (ex) ex.textos.push(texto); else { elemento.textos.push(texto); porClave.set(clave, elemento); }
        continue;
      }
      clave = `nuevo:${claveNombre(nombre)}`;
      const categoriaPedida = categoriaPropia;
      const categoria = typeof categoriaPedida === "number" && categoriasActivas.has(categoriaPedida) ? categoriaPedida : null;
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
