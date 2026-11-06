// «Al instante» de Facturas › Análisis: diez respuestas que NO pasan por la IA.
//
// Vivían en el chat (chips «Al instante», quitados el 05/11/2026) y vuelven el
// 06/11/2026 a petición del dueño como una fila de chips DEBAJO de la gráfica
// del bloque «Explorar»: al pulsar uno, su resultado ocupa el hueco de la
// gráfica. Cada chip llama a una RPC SQL `*_agente` (las mismas que usa el
// chatbot como herramientas): 0 tokens, al instante.
//
// Este módulo es la parte pura (sin React): el catálogo, los argumentos de cada
// RPC (con el periodo de arriba cuando la RPC lo admite; ninguna separa por
// local), los tipos de lo que devuelven y su paso a `Exploracion` para que las
// gráficas salgan con la misma pieza que el explorador (GraficaExplorador).
import type { Agrupar, Exploracion, Medida, PuntoExploracion } from "./explorador";
import { argsSeriePrecios, UMBRAL_SUBIDA_POR_DEFECTO } from "./preguntasRapidas";
import { isoLocal } from "./periodoAnalisis";

// ─── Catálogo ───────────────────────────────────────────────────────────────

export type IdAlInstante =
  | "gasto-mes"
  | "gasto-por-mes"
  | "top-proveedores"
  | "productos-mas-comprados"
  | "por-revisar"
  | "con-avisos"
  | "sin-total"
  | "gasto-categoria"
  | "subidas-precio"
  | "evolucion-precio";

export interface ChipAlInstante {
  id: IdAlInstante;
  etiqueta: string;
  /** Lo que enseña (tooltip «Etiqueta: descripción» y subtítulo del resultado). */
  descripcion: string;
  /** RPC(s) que usa; informativo (documentación y pruebas). */
  rpc: string;
  /** ¿Respeta el periodo de arriba? «Gasto este mes» es siempre el mes en curso. */
  usaPeriodo: boolean;
  /** Antes de consultar hay que elegir un producto. */
  pide?: "producto";
}

export const CHIPS_AL_INSTANTE: ChipAlInstante[] = [
  {
    id: "gasto-mes",
    etiqueta: "Gasto este mes",
    descripcion: "El mes en curso frente al mes anterior completo (facturas y albaranes sin factura, IVA incluido)",
    rpc: "resumen_periodo_agente",
    usaPeriodo: false,
  },
  {
    id: "gasto-por-mes",
    etiqueta: "Gasto por mes",
    descripcion: "Lo gastado cada mes del periodo (facturas y albaranes sin factura, IVA incluido)",
    rpc: "resumen_periodo_agente · estadisticas_globales_agente",
    usaPeriodo: true,
  },
  {
    id: "top-proveedores",
    etiqueta: "Top proveedores",
    descripcion: "Los 10 proveedores con más gasto en el periodo (IVA incluido)",
    rpc: "ranking_agente",
    usaPeriodo: true,
  },
  {
    id: "productos-mas-comprados",
    etiqueta: "Productos más comprados",
    descripcion: "Lo que más se ha comprado en kilos, litros y unidades en el periodo, sin servicios",
    rpc: "ranking_agente",
    usaPeriodo: true,
  },
  {
    id: "por-revisar",
    etiqueta: "Por revisar",
    descripcion: "Facturas y albaranes del periodo sin verificar",
    rpc: "filtrar_documentos_agente",
    usaPeriodo: true,
  },
  {
    id: "con-avisos",
    etiqueta: "Con avisos",
    descripcion: "Documentos con avisos de lectura o de importes",
    rpc: "filtrar_documentos_agente",
    usaPeriodo: true,
  },
  {
    id: "sin-total",
    etiqueta: "Sin total",
    descripcion: "Documentos a los que no se les leyó el importe total",
    rpc: "filtrar_documentos_agente",
    usaPeriodo: true,
  },
  {
    id: "gasto-categoria",
    etiqueta: "Gasto por categoría",
    descripcion: "Gasto por categoría de producto en el periodo (base sin IVA)",
    rpc: "gasto_categorias_agente",
    usaPeriodo: true,
  },
  {
    id: "subidas-precio",
    etiqueta: "Qué ha subido de precio",
    descripcion: "La última compra de cada producto frente a su precio de referencia (sin IVA)",
    rpc: "variacion_precios_agente",
    usaPeriodo: true,
  },
  {
    id: "evolucion-precio",
    etiqueta: "Evolución de precio",
    descripcion: "El precio de un producto en el tiempo, una línea por proveedor (sin IVA)",
    rpc: "serie_precios_agente",
    usaPeriodo: true,
    pide: "producto",
  },
];

export const chipAlInstante = (id: IdAlInstante): ChipAlInstante => CHIPS_AL_INSTANTE.find((c) => c.id === id) ?? CHIPS_AL_INSTANTE[0];

/**
 * Los que ya están arriba, en los presets del explorador (06/11/2026, dueño:
 * «estás duplicando los botones»): «Gasto por mes» y «Top proveedores» son el
 * mismo preset; «Gasto por categoría» ≈ «Por familia»; «Evolución de precio» ≈
 * «Precio de un producto». No salen como botón; «Evolución de precio» se sigue
 * abriendo desde «Qué ha subido de precio».
 */
export const IDS_YA_EN_EL_EXPLORADOR: ReadonlySet<IdAlInstante> = new Set<IdAlInstante>(["gasto-por-mes", "top-proveedores", "gasto-categoria", "evolucion-precio"]);

/** Los botones que se ven bajo la gráfica. */
export const CHIPS_VISIBLES: ChipAlInstante[] = CHIPS_AL_INSTANTE.filter((c) => !IDS_YA_EN_EL_EXPLORADOR.has(c.id));

/** «Con avisos: Documentos con avisos de lectura o de importes». */
export const textoAyudaChip = (c: ChipAlInstante) => `${c.etiqueta}: ${c.descripcion}`;

// ─── Tipos de lo que devuelven las RPC (solo lo que se pinta) ───────────────
// Definiciones en supabase/migrations/20261106140000_chatbot_gasto_como_el_panel.sql
// (y 20261010170000_chatbot_ronda9.sql para ranking y serie). Las claves
// opcionales solo vienen cuando aplican (jsonb_strip_nulls).

export interface DocRef {
  id: number;
  tipo?: string;
  numero: string | null;
  proveedor: string | null;
  fecha: string | null;
}

export interface ListaDocs {
  n: number;
  docs: DocRef[];
}

export interface GastoTotal {
  importe: number;
  en_facturas?: number;
  en_albaranes_sin_factura?: number;
  documentos?: number;
}

export interface MesResumen {
  mes: string;
  facturas: number;
  gasto: number;
  sin_total?: number;
  deducidos?: number;
  albaranes?: number;
  fecha_dudosa?: number;
}

export interface ResumenPeriodo {
  error?: string;
  periodo?: { desde: string; hasta: string };
  sin_datos?: boolean;
  gasto_total?: GastoTotal;
  facturas?: { n: number; gasto: number; si_das_importes?: { sin_total?: ListaDocs; deducidos?: ListaDocs } };
  albaranes?: { n: number; valor: number; ya_facturados?: { n: number; valor: number } };
  meses?: MesResumen[];
  proveedores?: { proveedor: string; gasto?: number | null; facturas?: number; albaranes?: number }[];
  total_proveedores?: number;
}

export interface EstadisticasGlobales {
  error?: string;
  sin_datos?: boolean;
  meses?: MesResumen[];
  meses_truncado?: boolean;
}

export interface Ranking<F> {
  error?: string;
  filas: F[];
  total_filas: number;
  truncado: boolean;
  servicios_excluidos?: { n: number; nombres?: string[] };
  documentos_sin_total?: ListaDocs;
  documentos_deducidos?: ListaDocs;
}

export interface FilaGastoProveedor {
  proveedor: string;
  documentos: number;
  importe: number;
  sin_total?: number;
  deducidos?: number;
}

export interface FilaCantidadProducto {
  producto: string;
  cantidad?: number;
  unidad?: string | null;
  veces: number;
  importe?: number;
}

export interface AlertaCompacta {
  codigo: string;
  mensaje: string;
}

export interface DocumentoCompacto {
  id: number;
  tipo: string;
  numero: string | null;
  proveedor: string | null;
  fecha: string | null;
  total?: number | null;
  sin_total?: boolean;
  total_origen?: "deducido";
  iva_conocido?: boolean;
  fecha_dudosa?: boolean;
  alertas?: AlertaCompacta[];
}

export interface FiltroDocumentos {
  error?: string;
  filas: DocumentoCompacto[];
  total_filas: number;
  truncado: boolean;
  nota?: string;
}

export interface ImporteLineas {
  importe: number;
  lineas: number;
}

export interface GastoCategoria extends ImporteLineas {
  categoria: string;
  pct?: number;
  sub?: (ImporteLineas & { categoria: string })[];
}

export interface GastoCategorias {
  error?: string;
  total?: ImporteLineas & { documentos?: number };
  categorias?: GastoCategoria[];
  sin_categoria?: ImporteLineas;
  sin_clasificar?: ImporteLineas;
  avisos?: { sin_importe?: number; albaranes_ya_facturados?: number };
  sin_datos?: boolean;
}

export interface VariacionPrecio {
  producto: string;
  unidad?: string | null;
  precio: number;
  fecha?: string;
  proveedor?: string | null;
  tipo?: "albaran";
  variacion_pct: number;
  ref_precio: number;
  ref_compras?: number;
  ref_proveedor?: string | null;
  cambio_proveedor?: boolean;
  pocas_compras?: boolean;
  ref_antigua?: boolean;
}

export interface VariacionPrecios {
  error?: string;
  umbral_pct?: number;
  productos: VariacionPrecio[];
  total_productos?: number;
  truncado?: boolean;
  comparados?: number;
  avisos?: { sin_referencia?: number; sin_clasificar?: number };
  sin_datos?: boolean;
}

/** Grupo de «Productos más comprados»: kilos con kilos, litros con litros… */
export interface GrupoUnidad {
  unidad: string;
  titulo: string;
  ranking: Ranking<FilaCantidadProducto>;
}

export type DatosAlInstante =
  | { id: "gasto-mes"; actual: { mes: string; hasta: string; resumen: ResumenPeriodo }; anterior: { mes: string; resumen: ResumenPeriodo } }
  | { id: "gasto-por-mes"; meses: MesResumen[]; desde: string | null; hasta: string | null; truncado: boolean }
  | { id: "top-proveedores"; ranking: Ranking<FilaGastoProveedor> }
  | { id: "productos-mas-comprados"; grupos: GrupoUnidad[] }
  | { id: "por-revisar" | "con-avisos" | "sin-total"; lista: FiltroDocumentos }
  | { id: "gasto-categoria"; datos: GastoCategorias }
  | { id: "subidas-precio"; umbral: number; datos: VariacionPrecios }
  | { id: "evolucion-precio"; producto: string; serie: unknown };

// ─── Consultas ──────────────────────────────────────────────────────────────

/** Llama a una RPC por nombre y devuelve su JSON (o lanza el error). */
export type LlamarRpc = (funcion: string, args: Record<string, unknown>) => Promise<unknown>;

export interface ContextoAlInstante {
  /** Periodo de arriba (null = todo el histórico). */
  desde: string | null;
  hasta: string | null;
  /** «Hoy» de la pantalla (para «Gasto este mes»). */
  hoy: Date;
  /** «Evolución de precio»: el producto elegido. */
  producto?: { producto: string; unidad?: string | null } | null;
  /** Umbral de configuracion_facturas (null si no se puede leer). */
  umbralSubidaPrecio?: () => Promise<number | null>;
}

/** Error que las RPC devuelven dentro del JSON (`{error: "..."}`) en vez de lanzar. */
export function comprobarErrorRpc<T>(datos: T): T {
  const error = (datos as { error?: unknown } | null)?.error;
  if (typeof error === "string" && error) throw new Error(error);
  if (datos === null || datos === undefined) throw new Error("La consulta no ha devuelto nada.");
  return datos;
}

const dos = (n: number) => String(n).padStart(2, "0");
const finDeMes = (anio: number, mes: number) => `${anio}-${dos(mes)}-${dos(new Date(Date.UTC(anio, mes, 0)).getUTCDate())}`;

/** El mes en curso (hasta su último día) y el anterior, completos. */
export function rangosGastoMes(hoy: Date) {
  const a = hoy.getFullYear();
  const m = hoy.getMonth() + 1;
  const pa = m === 1 ? a - 1 : a;
  const pm = m === 1 ? 12 : m - 1;
  return {
    actual: { mes: `${a}-${dos(m)}`, desde: `${a}-${dos(m)}-01`, hasta: finDeMes(a, m), hoy: isoLocal(hoy) },
    anterior: { mes: `${pa}-${dos(pm)}`, desde: `${pa}-${dos(pm)}-01`, hasta: finDeMes(pa, pm) },
  };
}

/** Unidades de «Productos más comprados» (cada una, su ranking: no se suman kilos con litros). */
export const UNIDADES_PRODUCTOS: { unidad: string; titulo: string }[] = [
  { unidad: "kg", titulo: "En kilos" },
  { unidad: "l", titulo: "En litros" },
  { unidad: "ud", titulo: "En unidades" },
];
/** Productos por unidad. */
export const PRODUCTOS_POR_UNIDAD = 6;
/** Filas de las listas de documentos (máximo de filtrar_documentos_agente). */
export const LIMITE_DOCUMENTOS = 50;

const FILTRO_DOCS: Record<"por-revisar" | "con-avisos" | "sin-total", string> = {
  "por-revisar": "sin_verificar",
  "con-avisos": "con_alertas",
  "sin-total": "sin_total",
};

/** La consulta de un chip: la(s) RPC con sus argumentos y el periodo de arriba. */
export async function consultarAlInstante(id: IdAlInstante, llamar: LlamarRpc, ctx: ContextoAlInstante): Promise<DatosAlInstante> {
  const { desde, hasta } = ctx;
  switch (id) {
    case "gasto-mes": {
      const r = rangosGastoMes(ctx.hoy);
      const [actual, anterior] = await Promise.all([
        llamar("resumen_periodo_agente", { p_desde: r.actual.desde, p_hasta: r.actual.hasta }),
        llamar("resumen_periodo_agente", { p_desde: r.anterior.desde, p_hasta: r.anterior.hasta }),
      ]);
      return {
        id,
        actual: { mes: r.actual.mes, hasta: r.actual.hoy, resumen: comprobarErrorRpc(actual as ResumenPeriodo) },
        anterior: { mes: r.anterior.mes, resumen: comprobarErrorRpc(anterior as ResumenPeriodo) },
      };
    }
    case "gasto-por-mes": {
      // Con fechas, el resumen del periodo recorta los meses al rango; sin ellas
      // (todo el histórico), las estadísticas globales (los 24 meses más recientes).
      if (desde && hasta) {
        const r = comprobarErrorRpc((await llamar("resumen_periodo_agente", { p_desde: desde, p_hasta: hasta })) as ResumenPeriodo);
        const meses = r.meses ?? (r.sin_datos ? [] : [mesUnico(desde, r)]);
        return { id, meses, desde, hasta, truncado: false };
      }
      const e = comprobarErrorRpc((await llamar("estadisticas_globales_agente", {})) as EstadisticasGlobales);
      return { id, meses: e.sin_datos ? [] : e.meses ?? [], desde: null, hasta: null, truncado: !!e.meses_truncado };
    }
    case "top-proveedores": {
      const ranking = comprobarErrorRpc(
        (await llamar("ranking_agente", {
          p_criterio: "gasto_proveedor",
          p_tipo: null,
          p_limite: 10,
          p_desde: desde,
          p_hasta: hasta,
          p_orden: "desc",
        })) as Ranking<FilaGastoProveedor>,
      );
      return { id, ranking };
    }
    case "productos-mas-comprados": {
      const grupos = await Promise.all(
        UNIDADES_PRODUCTOS.map(async (u) => ({
          ...u,
          ranking: comprobarErrorRpc(
            (await llamar("ranking_agente", {
              p_criterio: "cantidad",
              p_limite: PRODUCTOS_POR_UNIDAD,
              p_desde: desde,
              p_hasta: hasta,
              p_orden: "desc",
              p_incluir_servicios: false,
              p_unidad: u.unidad,
            })) as Ranking<FilaCantidadProducto>,
          ),
        })),
      );
      return { id, grupos };
    }
    case "por-revisar":
    case "con-avisos":
    case "sin-total": {
      const lista = comprobarErrorRpc(
        (await llamar("filtrar_documentos_agente", {
          p_filtro: FILTRO_DOCS[id],
          p_desde: desde,
          p_hasta: hasta,
          p_orden: "fecha_desc",
          p_limite: LIMITE_DOCUMENTOS,
        })) as FiltroDocumentos,
      );
      return { id, lista };
    }
    case "gasto-categoria": {
      const datos = comprobarErrorRpc(
        (await llamar("gasto_categorias_agente", { p_categoria: null, p_desde: desde, p_hasta: hasta, p_tipo: null, p_agrupar: null })) as GastoCategorias,
      );
      return { id, datos };
    }
    case "subidas-precio": {
      const umbral = (await ctx.umbralSubidaPrecio?.()) ?? UMBRAL_SUBIDA_POR_DEFECTO;
      const datos = comprobarErrorRpc(
        (await llamar("variacion_precios_agente", {
          p_desde: desde,
          p_hasta: hasta,
          p_umbral_pct: umbral,
          p_categoria: null,
          p_producto: null,
          p_limite: 10,
          p_sentido: "subidas",
        })) as VariacionPrecios,
      );
      return { id, umbral, datos };
    }
    case "evolucion-precio": {
      const p = ctx.producto;
      if (!p?.producto?.trim()) throw new Error("Elige un producto.");
      // La RPC contesta {sin_datos:true, buscado} si no hay compras: se pinta tal cual.
      const serie = comprobarErrorRpc(await llamar("serie_precios_agente", { ...argsSeriePrecios(p), p_desde: desde, p_hasta: hasta }));
      return { id, producto: p.producto.trim(), serie };
    }
  }
}

/** El resumen de un periodo de un solo mes no trae `meses`: se hace a mano. */
function mesUnico(desde: string, r: ResumenPeriodo): MesResumen {
  return {
    mes: desde.slice(0, 7),
    facturas: r.facturas?.n ?? 0,
    gasto: gastoDeResumen(r),
    albaranes: r.albaranes?.n || undefined,
  };
}

/** Gasto como el panel: facturas + albaranes sin factura (o la suma, si la RPC aún no trae `gasto_total`). */
export function gastoDeResumen(r: ResumenPeriodo): number {
  if (r.gasto_total && Number.isFinite(r.gasto_total.importe)) return r.gasto_total.importe;
  return (r.facturas?.gasto ?? 0) + (r.albaranes?.valor ?? 0);
}

/** Documentos que suman en el gasto (facturas + albaranes sin factura). */
export const documentosDeResumen = (r: ResumenPeriodo): number => r.gasto_total?.documentos ?? (r.facturas?.n ?? 0) + (r.albaranes?.n ?? 0);

// ─── A `Exploracion` (para pintarlas con GraficaExplorador) ─────────────────

/** Los meses «AAAA-MM» de `a` a `b`, ambos incluidos. */
export function mesesEntre(a: string, b: string): string[] {
  const salida: string[] = [];
  let [y, m] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  while (y < yb || (y === yb && m <= mb)) {
    salida.push(`${y}-${dos(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (salida.length > 600) break;
  }
  return salida;
}

function exploracion(agrupar: Agrupar, medida: Medida, puntos: PuntoExploracion[], desde: string | null, hasta: string | null): Exploracion {
  const conValor = puntos.filter((p) => p.valor !== null);
  return {
    parametros: { desde, hasta, hastaEfectivo: null, medida, agrupar, desglose: null, porLineas: false, soloProductos: false, unidad: null },
    sinDatos: conValor.length === 0,
    total: {
      valor: conValor.reduce((s, p) => s + (p.valor ?? 0), 0),
      documentos: puntos.reduce((s, p) => s + p.documentos, 0),
      lineas: null,
      variacionPct: null,
    },
    anterior: null,
    unidades: null,
    series: [],
    puntos,
    resto: null,
  };
}

/**
 * «Gasto por mes»: un punto por mes, con los meses sin documentos a 0 (entre el
 * primero del periodo y el último que ya ha empezado; nunca meses futuros).
 */
export function exploracionGastoPorMes(d: Extract<DatosAlInstante, { id: "gasto-por-mes" }>, hoy: Date): Exploracion {
  const porMes = new Map(d.meses.map((m) => [m.mes, m]));
  const claves = [...porMes.keys()].sort();
  const mesHoy = isoLocal(hoy).slice(0, 7);
  const ultimo = claves[claves.length - 1];
  const inicio = d.desde ? d.desde.slice(0, 7) : claves[0];
  const finPeriodo = d.hasta ? d.hasta.slice(0, 7) : ultimo;
  // Hasta el mes en curso (o el último con documentos, si alguno lleva fecha futura).
  const tope = ultimo && ultimo > mesHoy ? ultimo : mesHoy;
  const fin = finPeriodo && finPeriodo < tope ? finPeriodo : tope;
  const meses = inicio && fin && inicio <= fin ? mesesEntre(inicio, fin) : claves;
  const puntos = meses.map<PuntoExploracion>((mes) => {
    const m = porMes.get(mes);
    return { clave: mes, etiqueta: mes, id: null, valor: m ? m.gasto : 0, documentos: m ? m.facturas + (m.albaranes ?? 0) : 0, desglose: null };
  });
  return exploracion("mes", "gasto", puntos, d.desde, d.hasta);
}

/** «Top proveedores»: barras horizontales, del que más al que menos. */
export function exploracionTopProveedores(ranking: Ranking<FilaGastoProveedor>, desde: string | null, hasta: string | null): Exploracion {
  const puntos = ranking.filas.map<PuntoExploracion>((f, i) => ({
    clave: `${i}-${f.proveedor}`,
    etiqueta: f.proveedor,
    id: null,
    valor: f.importe,
    documentos: f.documentos,
    desglose: null,
  }));
  return exploracion("proveedor", "gasto", puntos, desde, hasta);
}

/** «Gasto por categoría»: barras horizontales por categoría madre (base sin IVA). */
export function exploracionCategorias(datos: GastoCategorias, desde: string | null, hasta: string | null): Exploracion {
  const categorias = [...(datos.categorias ?? [])].sort((a, b) => b.importe - a.importe);
  const puntos = categorias.map<PuntoExploracion>((c) => ({
    clave: `cat-${c.categoria}`,
    etiqueta: c.categoria,
    id: null,
    valor: c.importe,
    documentos: c.lineas,
    desglose: null,
  }));
  return exploracion("familia", "base", puntos, desde, hasta);
}
