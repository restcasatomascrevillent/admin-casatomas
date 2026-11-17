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
//  14/11/2026 (dueño): además del precio de la carta (con IVA), el de venta sin IVA
//  y la compra «sin IVA (base)» y «con IVA» (IVA de la línea; si no lo trae, 21 %
//  en vinos y 10 % en platos). Fuera la columna «Categoría» (el rótulo largo tipo
//  «VINOS TINTOS — RIBERA DEL DUERO»): las filas siguen ordenadas por categoría.
//  17/11/2026 (dueño: «hay información mal, por ejemplo Fefiñanes; si hay compra de
//  varias añadas aunque no esté en carta, añádelo»). El catálogo de compras tiene un
//  producto por añada («Fefiñanes 2023», «Fefiñanes 2025») y el vino solo se enlaza a
//  uno (`vino_producto`): el «Fefiñanes 2024» de la carta salía con el precio del 2025
//  sin decirlo y la compra del 2023 no salía. Ahora, en vinos, se juntan los productos
//  del catálogo con el mismo nombre sin la añada y, si hay compras de varias añadas (o
//  de una que no es la de la carta), sale una subfila por añada con su última compra,
//  diciendo cuál es la de la carta; debajo, la tabla «Compras por añada» con el
//  proveedor. La fila del vino no cambia (la compra del producto enlazado, la del margen).
// ============================================================================
import { supabase } from "@/integrations/supabase/client";
import { fmt, normalizarMargenes } from "@/lib/analisis/margenesCarta";
import type { ContextoInforme } from "../registro";
import { CLAVE_SUBFILA, esSubfila, nombreArchivoInforme, type ColumnaInforme, type FilaInforme, type ResultadoInformeTabla } from "../tabla";

export type TipoCartaFacturas = "vinos" | "platos";

/** Fila de «Vinos» o «Platos» (las columnas que usa el informe). */
export interface ArticuloCarta {
  id: string;
  nombre: string | null;
  categoria: string | null;
  precio_eur: number | null;
  activado: boolean | null;
  imagen_url: string | null;
  /** Solo vinos: la añada de la carta (no vale si `sin_anada`). */
  anada?: number | string | null;
  sin_anada?: boolean | null;
}

/** Producto de compra vinculado a un vino (la botella) o a un plato (un ingrediente del escandallo). */
export interface VinculoCompra {
  articuloId: string;
  productoId: number;
  /** Nombre en el catálogo de productos. */
  producto: string | null;
  /** Orden en el escandallo (el primero es el principal); 0 en vinos. */
  orden: number;
  /** Categoría del producto en el catálogo (para buscar sus otras añadas). */
  categoriaId?: number | null;
}

/** Producto del catálogo de compras (para juntar las añadas de un mismo vino). */
export interface ProductoCatalogo {
  id: number;
  nombre: string | null;
}

/** Línea de compra con su documento (productos_factura + facturas). */
export interface LineaCompra {
  id: number;
  producto_id: number | null;
  /** Nombre en la factura (de ahí sale la añada comprada). */
  nombre?: string | null;
  cantidad: number | string | null;
  unidad: string | null;
  total: number | string | null;
  /** IVA de la línea (%). */
  iva_pct?: number | string | null;
  facturas: { fecha: string | null; tipo: string | null; local: string | null; total: number | string | null; facturado_en_id: number | null; proveedor?: string | null } | null;
}

export interface UltimaCompra {
  /** Base sin IVA de la línea / cantidad. */
  eurUd: number;
  /** Unidad en que se compra («botella», «caja», «kg»…). */
  unidad: string;
  /** IVA de la línea (%), si la factura lo trae. */
  ivaPct: number | null;
  /** `YYYY-MM-DD`. */
  fecha: string;
  proveedor?: string | null;
}

/** La última compra de una añada de un vino (`anada` null: la factura no dice la añada). */
export interface CompraAnada extends UltimaCompra {
  anada: number | null;
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

/** La última compra válida de cada grupo de líneas (fecha más reciente; a igualdad, la última línea). */
function ultimasPor<K>(lineas: readonly LineaCompra[], clave: (l: LineaCompra) => K): Map<K, UltimaCompra> {
  const mejor = new Map<K, LineaCompra>();
  for (const l of lineas) {
    if (!lineaValida(l)) continue;
    const k = clave(l);
    const actual = mejor.get(k);
    const fecha = l.facturas!.fecha as string;
    const fechaActual = actual?.facturas?.fecha ?? "";
    if (!actual || fecha > fechaActual || (fecha === fechaActual && l.id > actual.id)) mejor.set(k, l);
  }
  const res = new Map<K, UltimaCompra>();
  for (const [k, l] of mejor) {
    res.set(k, {
      eurUd: Math.round(((num(l.total) as number) / (num(l.cantidad) as number)) * 10000) / 10000,
      unidad: l.unidad?.trim().toLowerCase() || "ud",
      ivaPct: num(l.iva_pct),
      fecha: (l.facturas!.fecha as string).slice(0, 10),
      proveedor: l.facturas!.proveedor?.trim() || null,
    });
  }
  return res;
}

/** La última compra de cada producto (fecha más reciente; a igualdad, la última línea). */
export function ultimasCompras(lineas: readonly LineaCompra[]): Map<number, UltimaCompra> {
  return ultimasPor(lineas, (l) => l.producto_id as number);
}

// ─── Añadas (17/11/2026) ────────────────────────────────────────────────────

/** Añada en un nombre («Fefiñanes 2025 (cód. 198068)» → 2025). Los mismos años que `vinos_coste_carta_datos`. */
export function anadaDe(texto: string | null | undefined): number | null {
  const m = /\b(19[5-9]\d|20[0-4]\d)\b/.exec(texto ?? "");
  return m ? Number(m[1]) : null;
}

/** Nombre sin tildes, añadas ni signos («Fefiñanes 2025» → «fefinanes»), como `vinos_coste_nombre_base`. */
export function nombreSinAnada(nombre: string | null | undefined): string {
  return (nombre ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(19[5-9]\d|20[0-4]\d)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Añada de la carta: la del vino o, si no la tiene, la de su nombre. */
export function anadaCarta(a: Pick<ArticuloCarta, "nombre" | "anada" | "sin_anada">): number | null {
  const n = a.sin_anada ? null : num(a.anada);
  return n !== null && n > 0 ? n : anadaDe(a.nombre);
}

/**
 * De cada producto enlazado a un vino, los productos del catálogo que son el mismo vino en otra
 * añada (mismo nombre sin la añada), él incluido.
 */
export function productosMismoVino(vinculos: readonly VinculoCompra[], catalogo: readonly ProductoCatalogo[]): Map<number, number[]> {
  const porNombre = new Map<string, number[]>();
  for (const p of catalogo) {
    const base = nombreSinAnada(p.nombre);
    if (base) porNombre.set(base, [...(porNombre.get(base) ?? []), p.id]);
  }
  const res = new Map<number, number[]>();
  for (const v of vinculos) {
    const iguales = porNombre.get(nombreSinAnada(v.producto)) ?? [];
    res.set(v.productoId, [...new Set([v.productoId, ...iguales])]);
  }
  return res;
}

/**
 * Por vino, la última compra de CADA añada (la más reciente primero; sin añada, al final), mirando su
 * producto enlazado y los del mismo vino en otra añada. La añada es la del nombre en la factura y, si
 * no la dice, la del producto del catálogo.
 */
export function comprasPorAnada(
  vinculos: readonly VinculoCompra[],
  catalogo: readonly ProductoCatalogo[],
  lineas: readonly LineaCompra[],
): Map<string, CompraAnada[]> {
  const nombres = new Map<number, string | null>(catalogo.map((p) => [p.id, p.nombre]));
  for (const v of vinculos) if (!nombres.has(v.productoId)) nombres.set(v.productoId, v.producto);
  const porProducto = new Map<number, LineaCompra[]>();
  for (const l of lineas) {
    if (l.producto_id === null) continue;
    porProducto.set(l.producto_id, [...(porProducto.get(l.producto_id) ?? []), l]);
  }
  const familias = productosMismoVino(vinculos, catalogo);
  const res = new Map<string, CompraAnada[]>();
  for (const v of vinculos) {
    const suyas = (familias.get(v.productoId) ?? []).flatMap((id) => porProducto.get(id) ?? []);
    const ultimas = ultimasPor(suyas, (l) => anadaDe(l.nombre) ?? anadaDe(nombres.get(l.producto_id as number)));
    res.set(
      v.articuloId,
      [...ultimas].map(([anada, c]) => ({ ...c, anada })).sort((a, b) => (b.anada ?? 0) - (a.anada ?? 0)),
    );
  }
  return res;
}

/**
 * ¿Hay que enseñar las añadas? Sí con compras de varias, o de una sola que no es la de la carta
 * (la fila del vino llevaría el precio de otra añada sin decirlo).
 */
function anadasQueSeEnsenan(a: ArticuloCarta, anadas: readonly CompraAnada[] | undefined): readonly CompraAnada[] {
  if (!anadas?.length) return [];
  if (anadas.length > 1) return anadas;
  const carta = anadaCarta(a);
  return carta !== null && anadas[0].anada !== null && anadas[0].anada !== carta ? anadas : [];
}

/** «2026-10-12» → «12/10/2026». */
const fechaCorta = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const siNo = (v: boolean) => (v ? "Sí" : "No");
const tieneFoto = (a: Pick<ArticuloCarta, "imagen_url">) => !!a.imagen_url?.trim();

const TEXTOS: Record<TipoCartaFacturas, { titulo: string; singular: string; plural: string; columna: string }> = {
  vinos: { titulo: "Vinos: facturas y carta", singular: "vino", plural: "vinos", columna: "Vino" },
  platos: { titulo: "Platos: facturas y carta", singular: "plato", plural: "platos", columna: "Plato" },
};

/** IVA supuesto de la compra cuando la línea no lo trae: vino 21 %, comida 10 %. */
export const IVA_COMPRA_SUPUESTO: Record<TipoCartaFacturas, number> = { vinos: 21, platos: 10 };
/** IVA de la carta si no se puede leer de Facturas › Márgenes. */
export const IVA_CARTA_POR_DEFECTO = 10;

/**
 * Columnas: nombre, (ingrediente), carta con y sin IVA, compra sin y con IVA, (margen), unidad, fecha,
 * activo y foto. Sin «Categoría» (14/11/2026). Anchos para que quepan en la diapositiva.
 */
export function columnasCartaFacturas(tipo: TipoCartaFacturas): ColumnaInforme[] {
  return [
    { id: "nombre", etiqueta: TEXTOS[tipo].columna, tipo: "texto" },
    ...(tipo === "platos" ? [{ id: "producto", etiqueta: "Ingrediente", tipo: "texto" as const, ancho: 170 }] : []),
    { id: "precio", etiqueta: "Carta con IVA", tipo: "precio", ancho: 100 },
    { id: "venta", etiqueta: "Venta sin IVA", tipo: "precio", ancho: 100 },
    { id: "compra", etiqueta: "Compra sin IVA (base)", tipo: "precio", ancho: 105 },
    { id: "compra_iva", etiqueta: "Compra con IVA", tipo: "precio", ancho: 100 },
    ...(tipo === "vinos" ? [{ id: "margen", etiqueta: "Margen (lo que ganas)", tipo: "texto" as const, ancho: 150 }] : []),
    { id: "unidad", etiqueta: "Unidad", tipo: "texto", ancho: 85 },
    { id: "fecha", etiqueta: "Fecha", tipo: "fecha", ancho: 110 },
    { id: "activo", etiqueta: "Activo", tipo: "texto", ancho: 75 },
    { id: "foto", etiqueta: "Foto", tipo: "texto", ancho: 65 },
  ];
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;

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
  ivaCartaPct: number = IVA_CARTA_POR_DEFECTO,
  anadas: ReadonlyMap<string, readonly CompraAnada[]> = new Map(),
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
    .flatMap((a) => {
      const v = principal.get(a.id);
      const c = v ? compras.get(v.productoId) : undefined;
      const precio = num(a.precio_eur);
      const ivaCompra = c ? (c.ivaPct ?? IVA_COMPRA_SUPUESTO[tipo]) : null;
      const conIva = (x: UltimaCompra) => redondear2(x.eurUd * (1 + (x.ivaPct ?? IVA_COMPRA_SUPUESTO[tipo]) / 100));
      const nombre = a.nombre?.trim() || "(sin nombre)";
      const carta = anadaCarta(a);
      // Una subfila por añada comprada (17/11/2026): `vino`, `anada`, `en_carta` y `proveedor` son para «Compras por añada».
      const subfilas: FilaInforme[] = anadasQueSeEnsenan(a, anadas.get(a.id)).map((x) => {
        const enCarta = x.anada === null || carta === null ? null : x.anada === carta;
        return {
          nombre: x.anada === null ? "Sin añada en la factura" : `Añada ${x.anada}${enCarta === null ? "" : enCarta ? " · la de la carta" : " · no está en carta"}`,
          vino: nombre,
          anada: x.anada === null ? "Sin añada" : String(x.anada),
          en_carta: enCarta === null ? null : siNo(enCarta),
          compra: x.eurUd,
          compra_iva: conIva(x),
          unidad: x.unidad,
          fecha: fechaCorta(x.fecha),
          proveedor: x.proveedor ?? null,
          [CLAVE_SUBFILA]: 1,
        };
      });
      const fila: FilaInforme = {
        nombre,
        // Sin ningún producto en su escandallo, se dice (antes, «—» sin explicar por qué).
        ...(tipo === "platos" ? { producto: v ? v.producto : FALTA_ESCANDALLO } : {}),
        precio,
        venta: precio !== null && precio > 0 ? redondear2(precio / (1 + ivaCartaPct / 100)) : null,
        compra: c ? c.eurUd : null,
        compra_iva: c && ivaCompra !== null ? conIva(c) : null,
        ...(tipo === "vinos" ? { margen: textoMargen(margenes.get(a.id)) } : {}),
        unidad: c ? c.unidad : null,
        fecha: c ? fechaCorta(c.fecha) : null,
        activo: siNo(a.activado === true),
        foto: siNo(tieneFoto(a)),
      };
      return [fila, ...subfilas];
    });
}

/** Columnas de «Compras por añada»: lo de las subfilas y el proveedor (no cabe en la tabla principal). */
const COLUMNAS_ANADAS: ColumnaInforme[] = [
  { id: "vino", etiqueta: "Vino de la carta", tipo: "texto" },
  { id: "anada", etiqueta: "Añada comprada", tipo: "texto", ancho: 110 },
  { id: "en_carta", etiqueta: "En carta", tipo: "texto", ancho: 80 },
  { id: "compra", etiqueta: "Compra sin IVA (base)", tipo: "precio", ancho: 105 },
  { id: "compra_iva", etiqueta: "Compra con IVA", tipo: "precio", ancho: 100 },
  { id: "unidad", etiqueta: "Unidad", tipo: "texto", ancho: 85 },
  { id: "fecha", etiqueta: "Fecha", tipo: "fecha", ancho: 110 },
  { id: "proveedor", etiqueta: "Proveedor", tipo: "texto", ancho: 260 },
];

export interface DatosCartaFacturas {
  articulos: readonly ArticuloCarta[];
  vinculos: readonly VinculoCompra[];
  compras: ReadonlyMap<number, UltimaCompra>;
  /** Solo vinos: multiplicador de Facturas › Márgenes por id de vino. */
  margenes?: MargenesVinos;
  /** IVA de la carta (%), el de Facturas › Márgenes. */
  ivaCartaPct?: number;
  /** Solo vinos: la última compra de cada añada por id de vino (`comprasPorAnada`). */
  anadas?: ReadonlyMap<string, readonly CompraAnada[]>;
}

/** El informe como tabla. Función pura (se prueba sin Supabase). */
export function informeCartaFacturas(tipo: TipoCartaFacturas, datos: DatosCartaFacturas, ctx: ContextoInforme): ResultadoInformeTabla {
  const t = TEXTOS[tipo];
  if (datos.articulos.length === 0) return { vacio: true, motivo: `No hay ${t.plural} en la carta.` };
  const todas = filasCartaFacturas(tipo, datos.articulos, datos.vinculos, datos.compras, datos.margenes, datos.ivaCartaPct, datos.anadas);
  // Las subfilas (añadas compradas) no son vinos: no cuentan en los totales.
  const filas = todas.filter((f) => !esSubfila(f));
  const porAnada = todas.filter(esSubfila).map(({ [CLAVE_SUBFILA]: _sub, ...f }) => f);
  const vinosConAnadas = new Set(porAnada.map((f) => f.vino)).size;
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
      `. Precio de carta frente a la última compra ${deQue}.` +
      (vinosConAnadas > 0 ? ` De ${vinosConAnadas} ${vinosConAnadas === 1 ? "vino" : "vinos"} se enseña la compra de cada añada.` : ""),
    textoPeriodo: `Carta a ${fechaCorta(ctx.hoy)}`,
    tablas: [
      {
        titulo: t.titulo,
        columnas: columnasCartaFacturas(tipo),
        filas: todas,
        nota:
          `Carta con IVA: lo que paga el cliente. Venta sin IVA: lo que te queda al quitar el IVA (${fmt(datos.ivaCartaPct ?? IVA_CARTA_POR_DEFECTO, 0)} %). ` +
          `Compra: última factura o albarán de Casa Tomás, por la unidad en que se compra, sin IVA (base) y con IVA (el de la factura; si no lo dice, ${IVA_COMPRA_SUPUESTO[tipo]} %). ` +
          "«—»: sin compra vinculada (se vincula en Facturas › Márgenes)." +
          (tipo === "vinos"
            ? " Margen: el de Facturas › Márgenes con la última factura: cuántas veces cobras lo que pagas (venta sin IVA ÷ coste sin IVA, en el formato de la carta) y el beneficio, en % del precio de venta sin IVA."
            : " «Falta el escandallo»: el plato no tiene ingredientes; se añaden en Facturas › Márgenes.") +
          (porAnada.length > 0
            ? " Filas sangradas: si del vino se han comprado varias añadas (o una que no es la de la carta), la última compra de cada una; la fila del vino lleva la del producto enlazado."
            : ""),
      },
      ...(porAnada.length > 0
        ? [
            {
              titulo: "Compras por añada",
              columnas: COLUMNAS_ANADAS,
              filas: porAnada,
              nota:
                "Vinos con compras de varias añadas, o de una que no es la de la carta: la última compra de cada añada, esté o no en la carta. " +
                "Se juntan los productos de las facturas con el mismo nombre sin la añada. «Sin añada»: la factura no la dice.",
            },
          ]
        : []),
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
  // `anada` y `sin_anada` (solo vinos) no están en types.ts.
  const columnas = "id, nombre, categoria, precio_eur, activado, imagen_url" + (tipo === "vinos" ? ", anada, sin_anada" : "");
  const { data, error } = (await supabase.from((tipo === "vinos" ? "Vinos" : "Platos") as "Vinos").select(columnas)) as unknown as Respuesta;
  if (error) throw fallo(error, `los ${tipo}`);
  return (data ?? []) as ArticuloCarta[];
}

/** vino_producto y escandallo_platos no están en types.ts (migración 20261115200000). */
async function leerVinculos(tipo: TipoCartaFacturas): Promise<VinculoCompra[]> {
  const tabla = tipo === "vinos" ? "vino_producto" : "escandallo_platos";
  const columnas = tipo === "vinos" ? "vino_id, producto_id, productos_catalogo(nombre, categoria_id)" : "plato_id, producto_id, orden, productos_catalogo(nombre)";
  // Orden del escandallo de Márgenes (orden, id): el primero es el ingrediente principal.
  const { data, error } = (await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla fuera de los tipos generados
    .from(tabla as any)
    .select(columnas)
    .order(tipo === "vinos" ? "vino_id" : "orden", { ascending: true })
    .order(tipo === "vinos" ? "producto_id" : "id", { ascending: true })) as unknown as Respuesta;
  if (error) throw fallo(error, "los productos vinculados");
  type Fila = { vino_id?: string; plato_id?: string; producto_id: number; orden?: number | null; productos_catalogo?: { nombre: string | null; categoria_id?: number | null } | null };
  return ((data ?? []) as Fila[])
    .map((f) => ({
      articuloId: String(tipo === "vinos" ? f.vino_id : f.plato_id),
      productoId: Number(f.producto_id),
      producto: f.productos_catalogo?.nombre ?? null,
      orden: f.orden ?? 0,
      categoriaId: f.productos_catalogo?.categoria_id ?? null,
    }))
    .filter((v) => v.articuloId && Number.isFinite(v.productoId));
}

/** Los productos del catálogo de esas categorías (las de los vinos enlazados), para juntar sus añadas. */
async function leerCatalogo(categorias: number[]): Promise<ProductoCatalogo[]> {
  if (categorias.length === 0) return [];
  const productos: ProductoCatalogo[] = [];
  for (let pagina = 0; pagina < PAGINAS_MAXIMAS; pagina++) {
    const desde = pagina * POR_PAGINA;
    const { data, error } = await supabase
      .from("productos_catalogo")
      .select("id, nombre")
      .in("categoria_id", categorias)
      .order("id", { ascending: true })
      .range(desde, desde + POR_PAGINA - 1);
    if (error) throw fallo(error, "los productos del catálogo");
    const lote = (data ?? []) as ProductoCatalogo[];
    productos.push(...lote);
    if (lote.length < POR_PAGINA) break;
  }
  return productos;
}

/** Las líneas de compra de esos productos, por tandas (PostgREST corta cada petición a 1.000 filas). */
async function leerLineasCompra(productos: number[]): Promise<LineaCompra[]> {
  if (productos.length === 0) return [];
  const lineas: LineaCompra[] = [];
  for (let pagina = 0; pagina < PAGINAS_MAXIMAS; pagina++) {
    const desde = pagina * POR_PAGINA;
    const { data, error } = await supabase
      .from("productos_factura")
      .select("id, producto_id, nombre, cantidad, unidad, total, iva_pct, facturas!inner(fecha, tipo, local, total, facturado_en_id, proveedor)")
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
async function leerMargenes(): Promise<{ vinos: MargenesVinos; ivaCartaPct: number }> {
  const vacio = { vinos: new Map() as MargenesVinos, ivaCartaPct: IVA_CARTA_POR_DEFECTO };
  try {
    const llamar = supabase.rpc as unknown as (this: typeof supabase, fn: string, a?: Record<string, unknown>) => PromiseLike<Respuesta>;
    const { data, error } = await llamar.call(supabase, "margenes_carta", { p_hoy: null });
    if (error) return vacio;
    const m = normalizarMargenes(data);
    const iva = m.config.ivaPct;
    return { vinos: new Map(m.vinos.map((v) => [v.id, v.multiplicador])), ivaCartaPct: Number.isFinite(iva) && iva >= 0 ? iva : IVA_CARTA_POR_DEFECTO };
  } catch {
    return vacio;
  }
}

export async function obtenerInformeCartaFacturas(tipo: TipoCartaFacturas, ctx: ContextoInforme): Promise<ResultadoInformeTabla> {
  const [articulos, vinculos, m] = await Promise.all([leerArticulos(tipo), leerVinculos(tipo), leerMargenes()]);
  const margenes = tipo === "vinos" ? m.vinos : (new Map() as MargenesVinos);
  // Solo las compras de los productos que cuentan (en platos, el ingrediente principal).
  const principales = [...vinculosPrincipales(vinculos).values()];
  // Vinos: también las de los productos del mismo vino en otra añada (17/11/2026).
  const catalogo = tipo === "vinos" ? await leerCatalogo([...new Set(principales.map((v) => v.categoriaId).filter((c): c is number => typeof c === "number"))]) : [];
  const productos = tipo === "vinos" ? [...productosMismoVino(principales, catalogo).values()].flat() : principales.map((v) => v.productoId);
  const lineas = await leerLineasCompra([...new Set(productos)]);
  const anadas = tipo === "vinos" ? comprasPorAnada(principales, catalogo, lineas) : undefined;
  return informeCartaFacturas(tipo, { articulos, vinculos, compras: ultimasCompras(lineas), margenes, ivaCartaPct: m.ivaCartaPct, anadas }, ctx);
}
