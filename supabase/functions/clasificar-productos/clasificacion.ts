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
//       Desde el 18/11/2026 va en tandas de TANDA_RPC productos y, si la base
//       corta una tanda por tiempo (8 s de PostgREST), se reintenta (CAS-7:
//       con la base cargada, mandar los 120 de golpe se cortaba).
//  Lo que la IA no conteste se queda sin clasificar y sale en «Sin
//  clasificar» de Facturas › Productos.
// ============================================================================

import { conReintentoPorTiempo, ESPERAS_REINTENTO_MS } from "../_shared/reintento-bd.ts";
import {
  abreviaturasActivas,
  type AbreviaturaFila,
  type AbreviaturasPorProveedor,
  compactarAbreviaturas,
  expandirAbreviaturaInicial,
  extraerAbreviaturasNuevas,
} from "./abreviaturas.ts";

export const FUNCION = "clasificar-productos";
export const MODELO_POR_DEFECTO = "gpt-5.6-luna";
/** Líneas pendientes que se leen por tanda y textos distintos que se mandan al modelo. */
export const MAX_LINEAS = 300;
export const MAX_TEXTOS = 120;
/**
 * Productos por llamada a productos_aplicar_clasificacion_ia. Cada llamada es
 * una transacción con el límite de 8 s de PostgREST: con 120 de golpe tardaba
 * de media 3,4 s y hasta 7,5 s (sin carga), y con la base cargada se cortaba.
 */
export const TANDA_RPC = 30;

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface LineaPendiente {
  id: number;
  nombre: string;
  nombre_normalizado: string | null;
  unidad: string | null;
  precio_unitario: number | string | null;
  proveedor: string | null;
  proveedor_id?: number | null;
}

export interface TextoPendiente {
  texto: string;
  ejemplo: string;
  proveedor: string | null;
  proveedor_id?: number | null;
  unidad: string | null;
  precio: number | null;
  lineas: number;
}

/** Ficha de proveedor que se le pasa a la IA (solo si tiene notas). */
export interface FichaProveedor {
  id: number;
  nombre: string;
  notas_ia: string | null;
}

export interface ExtrasPrompt {
  abreviaturas?: AbreviaturasPorProveedor;
  fichas?: FichaProveedor[];
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
  /** Abreviatura de marca NUEVA vista en la línea (no está en el diccionario del proveedor). */
  abreviatura?: { token: string; expansion: string } | null;
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
          required: ["texto", "producto_id", "nombre_nuevo", "categoria_id", "abreviatura"],
          properties: {
            texto: { type: "string", description: "El campo t EXACTO de la línea" },
            producto_id: { type: ["integer", "null"], description: "id del catálogo si es el MISMO producto" },
            nombre_nuevo: { type: ["string", "null"], description: "Nombre canónico si no está en el catálogo" },
            categoria_id: { type: ["integer", "null"], description: "id de la categoría más concreta (para nombre_nuevo)" },
            abreviatura: {
              anyOf: [
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["token", "expansion"],
                  properties: {
                    token: { type: "string", description: "La abreviatura TAL CUAL aparece en la línea, sin puntos («LP»)" },
                    expansion: { type: "string", description: "La marca completa a la que corresponde («Laurent-Perrier»)" },
                  },
                },
                { type: "null" },
              ],
              description: "Abreviatura de MARCA que no está en la lista del proveedor y cuya marca se deduce; si no, null",
            },
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
      ...(l.proveedor_id != null ? { proveedor_id: l.proveedor_id } : {}),
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
  extras: ExtrasPrompt = {},
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
    "- Si no está, inventa nombre_nuevo con SIEMPRE este patrón: MARCA + producto o variedad + formato " +
    "(«Laurent-Perrier La Cuvée 75 cl», «Johnnie Walker Black 70 cl», «Marqués de Murrieta Reserva 2021»). " +
    "La MARCA va completa y primero, NUNCA su abreviatura («LP» es Laurent-Perrier, «JW» es Johnnie Walker) ni su " +
    "forma cortada. La marca se deduce, por este orden, de: la propia línea; otras líneas pendientes que sean el " +
    "mismo producto (si una trae la marca entera, úsala en todas); el catálogo (un producto de la misma marca); " +
    "las abreviaturas conocidas del proveedor y su ficha. Si de verdad no se puede saber, deja solo el producto: " +
    "no inventes la marca. El producto genérico sin marca (rape, lubina) va solo con su nombre. Formato si " +
    "distingue (70 cl, 5 L, Magnum); sin códigos internos ni palabras de envase o familia (BOT., C/6B, CAJA, CHA., " +
    "UD). El orden de las palabras de un producto YA del catálogo no importa para reconocerlo: «Nata Natop Debic " +
    "2 L» y «Debic Nata Natop 2 L» son el mismo. En vinos, cavas y champanes, " +
    "CON la añada si la línea la trae («Pago de Carraovejas 2019»). Varias líneas que " +
    "sean el mismo producto nuevo llevan EXACTAMENTE el mismo nombre_nuevo. Pon categoria_id con la categoría " +
    "MÁS CONCRETA de la lista (la subcategoría si la hay).\n" +
    "- abreviatura: si la línea lleva (tras palabras de envase o familia como BOT., C/6B, CHA., W.) una abreviatura " +
    "de MARCA que NO está en la lista de abreviaturas de su proveedor, devuélvela como {token, expansion} " +
    "(token = «DP», expansion = «Dom Pérignon»; token = «LP», expansion = «Laurent-Perrier»), también si la línea " +
    "se asigna a un producto del catálogo. Propón la marca más probable por la otra línea, el catálogo o lo que " +
    "sepas del sector: una persona la confirmará o corregirá. El token tiene que estar en la línea y ser las " +
    "iniciales o el comienzo de la marca. Nunca para BOT, CHA, C/6B, CAJA, UD, W, LC ni otras palabras de envase, " +
    "familia o formato. Si no hay una candidata razonable, null.\n" +
    "- Otro vino, otra añada del mismo vino, otra variedad u otro tamaño (botella frente a Magnum) son productos distintos.\n" +
    "- Portes, mano de obra, reparaciones, guardias, gestión y logística o rappels van a Servicios.\n" +
    `Categorías (id: ruta — qué entra):\n${taxonomia}`;
  const lista = catalogo.length
    ? catalogo.map((p) => `${p.id}|${p.nombre}|${p.categoria_id ?? ""}`).join("\n")
    : "(vacío)";
  const nombresProveedor = new Map<number, string>();
  for (const t of textos) if (t.proveedor_id != null && t.proveedor) nombresProveedor.set(t.proveedor_id, t.proveedor);
  const abrev = extras.abreviaturas ? compactarAbreviaturas(extras.abreviaturas, nombresProveedor) : "";
  const fichas = (extras.fichas ?? [])
    .filter((f) => f.notas_ia && f.notas_ia.trim())
    .map((f) => `${f.nombre}: ${f.notas_ia!.replace(/\s+/g, " ").trim().slice(0, 300)}`)
    .join("\n");
  const usuario =
    `Catálogo actual (id|nombre|categoria_id):\n${lista}\n\n` +
    (abrev ? `Abreviaturas de cada proveedor (ABREV=Marca completa; sustitúyelas siempre en nombre_nuevo):\n${abrev}\n\n` : "") +
    (fichas ? `Ficha de proveedores:\n${fichas}\n\n` : "") +
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

/** Familia ra\u00edz de una categor\u00eda (sube por padre_id). null si no se conoce. */
function familiaRaiz(id: number | null | undefined, porId: Map<number, Categoria>): number | null {
  if (typeof id !== "number") return null;
  let c = porId.get(id);
  if (!c) return null;
  const vistos = new Set<number>();
  while (c.padre_id != null && porId.has(c.padre_id) && !vistos.has(c.id)) {
    vistos.add(c.id);
    c = porId.get(c.padre_id)!;
  }
  return c.id;
}

/** Palabras de 3 o m\u00e1s letras, sin tildes. */
const palabras = (s: string | null | undefined): string[] =>
  claveNombre(s ?? "").split(/[^a-z0-9\u00f1]+/).filter((p) => p.length >= 3 && !/^\d+$/.test(p));

/** \u00bfComparten alguna palabra (o el comienzo de una, para las abreviaturas: \u00abcerv\u00bb y \u00abcerveza\u00bb)? */
function compartenPalabra(nombreProducto: string, ...textos: (string | null | undefined)[]): boolean {
  const delProducto = palabras(nombreProducto);
  return textos.flatMap(palabras).some((t) => delProducto.some((p) => p.startsWith(t) || t.startsWith(p)));
}

/**
 * El modelo a veces pone en producto_id el id de la CATEGOR\u00cdA (17/11/2026: \u00ab11\u00bb = Servicios ca\u00eda en
 * el producto 11, \u00abMostaza de cerveza Rooftop 150 g\u00bb, con alquileres, luz y descuentos). Un producto
 * del cat\u00e1logo no se acepta si es de otra familia que la categor\u00eda que propone el propio modelo, ni si
 * su id coincide con el de una categor\u00eda y no comparte ninguna palabra con la l\u00ednea.
 */
function productoSospechoso(
  a: Partial<Asignacion>,
  elegido: ProductoCatalogo,
  pedido: TextoPendiente,
  categoriasPorId: Map<number, Categoria>,
): boolean {
  const propuesta = familiaRaiz(a.categoria_id, categoriasPorId);
  const delProducto = familiaRaiz(elegido.categoria_id, categoriasPorId);
  if (propuesta !== null && delProducto !== null && propuesta !== delProducto) return true;
  return categoriasPorId.has(elegido.id) && !compartenPalabra(elegido.nombre, pedido.texto, pedido.ejemplo);
}

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
  abreviaturas: AbreviaturasPorProveedor = new Map(),
): ElementoClasificacion[] {
  const pedidos = new Map(textos.map((t) => [t.texto, t]));
  const productos = new Map(catalogo.map((p) => [p.id, p]));
  const categoriasPorId = new Map(categorias.map((c) => [c.id, c]));
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
    const candidato = typeof a.producto_id === "number" ? productos.get(a.producto_id) : undefined;
    const elegido = candidato && !productoSospechoso(a, candidato, pedido, categoriasPorId) ? candidato : undefined;
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
      // Red de seguridad: «LP La Cuvée» → «Laurent-Perrier La Cuvée» con el diccionario del proveedor.
      const nombreIA = expandirAbreviaturaInicial(
        limpiarNombre(a.nombre_nuevo), pedido.proveedor_id != null ? abreviaturas.get(pedido.proveedor_id) : undefined);
      const propuesto = otraAnada ?? nombreIA.slice(0, 200);
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
  /** Esperas antes de reintentar una tanda cortada por tiempo (por defecto 3 s y 8 s). */
  esperasReintentoMs?: readonly number[];
  /** Para los tests. */
  dormir?: (ms: number) => Promise<void>;
}

/** Lo que devuelve productos_aplicar_clasificacion_ia (sumado entre tandas). */
export interface Aplicado {
  productos_creados: number;
  alias_creados: number;
  lineas_asignadas: number;
  /** Quedan líneas de estos textos por asignar: las asigna el cron (cada 5 min). */
  lineas_pendientes: boolean;
}

/** Trocea una lista en tandas de `tam` elementos. */
export function trocear<T>(lista: T[], tam: number): T[][] {
  const t = Math.max(1, Math.floor(tam));
  const res: T[][] = [];
  for (let i = 0; i < lista.length; i += t) res.push(lista.slice(i, i + t));
  return res;
}

/**
 * Manda los elementos a productos_aplicar_clasificacion_ia en tandas de
 * TANDA_RPC. Cada tanda es independiente (lo de las anteriores ya queda
 * guardado) y se puede repetir sin duplicar nada, así que si la base la corta
 * por tiempo se reintenta tras una espera. Si aun así no entra, lanza con el
 * mensaje de Postgres (el monitor lo reconoce como «la base iba cargada»): lo
 * que no se aplicó vuelve a la siguiente pasada del cron.
 */
export async function aplicarPorTandas(
  supabase: Supa,
  items: ElementoClasificacion[],
  opts: { tam?: number; esperasMs?: readonly number[]; dormir?: (ms: number) => Promise<void> } = {},
): Promise<Aplicado> {
  const total: Aplicado = { productos_creados: 0, alias_creados: 0, lineas_asignadas: 0, lineas_pendientes: false };
  const tandas = trocear(items, opts.tam ?? TANDA_RPC);
  for (let i = 0; i < tandas.length; i++) {
    const { data, error } = await conReintentoPorTiempo(
      () => supabase.rpc("productos_aplicar_clasificacion_ia", { p_items: tandas[i] }),
      {
        esperasMs: opts.esperasMs ?? ESPERAS_REINTENTO_MS,
        dormir: opts.dormir,
        alReintentar: (n, ms, e) =>
          console.warn(`[${FUNCION}] tanda ${i + 1}/${tandas.length} cortada por tiempo (${e.message}); reintento ${n} en ${ms / 1000} s`),
      },
    );
    if (error) {
      // El mensaje queda igual que antes (agrupa con la misma incidencia en el monitor); el detalle, en el registro.
      console.error(`[${FUNCION}] tanda ${i + 1}/${tandas.length} sin aplicar; ${i} ya guardadas: ${JSON.stringify(total)}`);
      throw new Error(`productos_aplicar_clasificacion_ia: ${error.message}`);
    }
    const d = (data ?? {}) as Partial<Aplicado>;
    total.productos_creados += Number(d.productos_creados ?? 0);
    total.alias_creados += Number(d.alias_creados ?? 0);
    total.lineas_asignadas += Number(d.lineas_asignadas ?? 0);
    total.lineas_pendientes = total.lineas_pendientes || d.lineas_pendientes === true;
  }
  return total;
}

export interface ResultadoClasificar {
  pendientes: number;
  textos: number;
  propuestas: number;
  aplicado: Aplicado | null;
  /** Avisos de abreviatura nueva creados (pantalla de subida y campana). */
  avisos_abreviaturas?: number;
}

export async function clasificarPendientes(deps: DependenciasClasificar): Promise<ResultadoClasificar> {
  const { supabase } = deps;
  const { data: filas, error: e1 } = await supabase
    .from("productos_factura")
    .select("id, nombre, nombre_normalizado, unidad, precio_unitario, facturas(proveedor, proveedor_id)")
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
    proveedor_id: f.facturas?.proveedor_id ?? null,
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

  const extras = await cargarExtras(supabase, textos);
  const respuesta = await deps.llamarModelo(construirMensajes(textos, catalogo, categorias, extras), ESQUEMA_CLASIFICACION);
  const items = validarAsignaciones(respuesta, textos, catalogo, categorias, extras.abreviaturas);
  if (items.length === 0) return { pendientes: lineas.length, textos: textos.length, propuestas: 0, aplicado: null };

  const aplicado = await aplicarPorTandas(supabase, items, { esperasMs: deps.esperasReintentoMs, dormir: deps.dormir });
  // Abreviaturas nuevas: aviso para confirmarlas. Es una ayuda: si falla no se pierde la clasificación.
  let avisos = 0;
  const nuevas = extraerAbreviaturasNuevas(respuesta, textos, extras.abreviaturas);
  if (nuevas.length > 0) {
    try {
      const { data, error } = await supabase.rpc("abreviaturas_proponer", { p_items: nuevas });
      if (error) console.warn(`[${FUNCION}] abreviaturas_proponer: ${error.message}`);
      else avisos = Number((data as { avisos_creados?: number } | null)?.avisos_creados ?? 0);
    } catch (e) {
      console.warn(`[${FUNCION}] abreviaturas_proponer:`, (e as Error)?.message ?? e);
    }
  }
  return {
    pendientes: lineas.length, textos: textos.length, propuestas: items.length, aplicado,
    ...(avisos > 0 ? { avisos_abreviaturas: avisos } : {}),
  };
}

/**
 * Abreviaturas y fichas de los proveedores de esta tanda. Si la tabla aún no
 * existe (migración sin aplicar) o falla, se sigue sin ellas: son una ayuda.
 */
export async function cargarExtras(supabase: Supa, textos: TextoPendiente[]): Promise<ExtrasPrompt> {
  const ids = [...new Set(textos.map((t) => t.proveedor_id).filter((x): x is number => typeof x === "number"))];
  if (ids.length === 0) return {};
  const extras: ExtrasPrompt = {};
  try {
    const { data, error } = await supabase
      .from("abreviaturas_proveedor")
      .select("proveedor_id, abreviatura, expansion, origen, veces, en_nombre")
      .in("proveedor_id", ids)
      .order("veces", { ascending: false })
      .limit(1000);
    if (error) console.warn(`[${FUNCION}] abreviaturas: ${error.message}`);
    else extras.abreviaturas = abreviaturasActivas((data ?? []) as AbreviaturaFila[]);
  } catch (e) {
    console.warn(`[${FUNCION}] abreviaturas:`, (e as Error)?.message ?? e);
  }
  try {
    const { data, error } = await supabase.from("proveedores").select("id, nombre, notas_ia").in("id", ids);
    if (error) console.warn(`[${FUNCION}] fichas: ${error.message}`);
    else extras.fichas = (data ?? []) as FichaProveedor[];
  } catch (e) {
    console.warn(`[${FUNCION}] fichas:`, (e as Error)?.message ?? e);
  }
  return extras;
}
