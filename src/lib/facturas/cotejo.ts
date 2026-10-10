// ============================================================================
//  Facturas › cotejo de una factura con sus albaranes — cuentas puras
// ----------------------------------------------------------------------------
//  El cálculo vive en SQL (`cotejo_factura_albaranes`, migración
//  20261010110000_albaranes_factura_cotejo); aquí solo se lee su jsonb sin
//  convertir NULL en 0, se separan discrepancias de líneas que cuadran y se
//  decide el color de cada diferencia. Importes SIN IVA.
// ============================================================================

export type EstadoCotejo = "ok" | "precio_distinto" | "cantidad_distinta" | "solo_albaran" | "solo_factura";

export interface LadoCotejo {
  cantidad: number | null;
  importe: number | null;
  precio: number | null;
  lineas: number;
}

export interface ProductoCotejo {
  clave: string;
  producto: string;
  producto_id: number | null;
  unidad: string | null;
  en_albaranes: LadoCotejo | null;
  en_factura: LadoCotejo | null;
  diferencia_cantidad: number | null;
  diferencia_importe: number | null;
  diferencia_precio_pct: number | null;
  estado: EstadoCotejo;
}

export interface AlbaranCotejo {
  id: number;
  numero: string;
  fecha: string | null;
  total: number | null;
  base: number | null;
  lineas: number;
  citado_en_factura: boolean;
  origen: "auto" | "manual" | null;
}

export interface CitadoSinAlbaran {
  numero: string;
  lineas: number;
  importe: number | null;
}

export interface CitadoSinVincular {
  id: number;
  numero: string;
  fecha: string | null;
  factura_id: number | null;
}

export interface ResumenCotejo {
  albaranes: number;
  suma_albaranes: number | null;
  total_factura_base: number | null;
  diferencia: number | null;
  base_citada_sin_albaran: number | null;
  diferencia_sin_explicar: number | null;
  productos_ok: number;
  productos_con_diferencias: number;
}

export interface Cotejo {
  modo: "factura" | "por_referencia" | "por_producto";
  albaranes: AlbaranCotejo[];
  albaranes_no_subidos: CitadoSinAlbaran[];
  albaranes_sin_vincular: CitadoSinVincular[];
  resumen: ResumenCotejo;
  productos: ProductoCotejo[];
}

const ESTADOS: EstadoCotejo[] = ["ok", "precio_distinto", "cantidad_distinta", "solo_albaran", "solo_factura"];

/** numeric de PostgREST: número o texto; NULL sigue siendo null (nunca 0). */
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

const leerLado = (v: unknown): LadoCotejo | null => {
  if (v === null || v === undefined) return null;
  const o = obj(v);
  return { cantidad: num(o.cantidad), importe: num(o.importe), precio: num(o.precio), lineas: num(o.lineas) ?? 0 };
};

/**
 * Lee el jsonb de `cotejo_factura_albaranes`. null si la RPC devolvió un
 * `{error}` o algo que no es un cotejo.
 */
export function leerCotejo(raw: unknown): Cotejo | null {
  const o = obj(raw);
  if ("error" in o || !("resumen" in o)) return null;
  const r = obj(o.resumen);
  const modo = o.modo === "por_referencia" || o.modo === "por_producto" ? o.modo : "factura";
  return {
    modo,
    albaranes: lista(o.albaranes).map((x) => {
      const a = obj(x);
      return {
        id: num(a.id) ?? 0,
        numero: texto(a.numero),
        fecha: a.fecha ? texto(a.fecha) : null,
        total: num(a.total),
        base: num(a.base),
        lineas: num(a.lineas) ?? 0,
        citado_en_factura: a.citado_en_factura === true,
        origen: a.origen === "auto" || a.origen === "manual" ? a.origen : null,
      };
    }),
    albaranes_no_subidos: lista(o.albaranes_no_subidos).map((x) => {
      const a = obj(x);
      return { numero: texto(a.numero), lineas: num(a.lineas) ?? 0, importe: num(a.importe) };
    }),
    albaranes_sin_vincular: lista(o.albaranes_sin_vincular).map((x) => {
      const a = obj(x);
      return { id: num(a.id) ?? 0, numero: texto(a.numero), fecha: a.fecha ? texto(a.fecha) : null, factura_id: num(a.factura_id) };
    }),
    resumen: {
      albaranes: num(r.albaranes) ?? 0,
      suma_albaranes: num(r.suma_albaranes),
      total_factura_base: num(r.total_factura_base),
      diferencia: num(r.diferencia),
      base_citada_sin_albaran: num(r.base_citada_sin_albaran),
      diferencia_sin_explicar: num(r.diferencia_sin_explicar),
      productos_ok: num(r.productos_ok) ?? 0,
      productos_con_diferencias: num(r.productos_con_diferencias) ?? 0,
    },
    productos: lista(o.productos).map((x) => {
      const p = obj(x);
      const estado = ESTADOS.includes(p.estado as EstadoCotejo) ? (p.estado as EstadoCotejo) : "ok";
      return {
        clave: texto(p.clave),
        producto: texto(p.producto),
        producto_id: num(p.producto_id),
        unidad: p.unidad ? texto(p.unidad) : null,
        en_albaranes: leerLado(p.en_albaranes),
        en_factura: leerLado(p.en_factura),
        diferencia_cantidad: num(p.diferencia_cantidad),
        diferencia_importe: num(p.diferencia_importe),
        diferencia_precio_pct: num(p.diferencia_precio_pct),
        estado,
      };
    }),
  };
}

const ORDEN_ESTADO: Record<EstadoCotejo, number> = {
  cantidad_distinta: 0,
  solo_factura: 1,
  precio_distinto: 2,
  solo_albaran: 3,
  ok: 4,
};

/** Discrepancias primero (las más caras arriba) y aparte las líneas que cuadran. */
export function separarProductos(productos: ProductoCotejo[]): { discrepancias: ProductoCotejo[]; ok: ProductoCotejo[] } {
  const discrepancias = productos
    .filter((p) => p.estado !== "ok")
    .sort(
      (a, b) =>
        ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] ||
        Math.abs(b.diferencia_importe ?? 0) - Math.abs(a.diferencia_importe ?? 0),
    );
  return { discrepancias, ok: productos.filter((p) => p.estado === "ok") };
}

export type Tono = "ok" | "aviso" | "alerta";

/** Clase de texto de cada tono (verde · ámbar · rojo), legible también en modo oscuro. */
export const CLASE_TONO: Record<Tono, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  aviso: "text-amber-700 dark:text-amber-400",
  alerta: "text-red-700 dark:text-red-400",
};

/**
 * Color de una diferencia de importes: verde si cabe en el redondeo (±1 % de
 * la base o ±0,50 €), ámbar hasta el 5 %, rojo por encima. Sin datos, ámbar.
 */
export function tonoDiferencia(diferencia: number | null, base: number | null): Tono {
  if (diferencia === null) return "aviso";
  const d = Math.abs(diferencia);
  const b = Math.abs(base ?? 0);
  if (d <= 0.5 || (b > 0 && d <= b * 0.01)) return "ok";
  if (b > 0 && d <= b * 0.05) return "aviso";
  return "alerta";
}

/** Rojo lo que se cobra de más o sin respaldo; ámbar lo que conviene mirar. */
export const tonoEstado = (e: EstadoCotejo): Tono =>
  e === "ok" ? "ok" : e === "cantidad_distinta" || e === "solo_factura" ? "alerta" : "aviso";

export const ETIQUETA_ESTADO: Record<EstadoCotejo, string> = {
  ok: "Cuadra",
  precio_distinto: "Precio distinto",
  cantidad_distinta: "Cantidad distinta",
  solo_albaran: "Solo en albarán",
  solo_factura: "Solo en factura",
};

const fmt = (n: number, dec = 2) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: dec }).format(n);
const conSigno = (n: number, dec = 2) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt(Math.abs(n), dec)}`;

/** «+1 ud», «−2,5 kg», «+5,29 % precio», «Solo en factura»… lo que cambia, en corto. */
export function textoDiferencia(p: ProductoCotejo): string {
  switch (p.estado) {
    case "cantidad_distinta":
      return `${conSigno(p.diferencia_cantidad ?? 0, 3)}${p.unidad ? ` ${p.unidad}` : ""} en factura`;
    case "precio_distinto":
      return `${conSigno(p.diferencia_precio_pct ?? 0)} % precio`;
    default:
      return ETIQUETA_ESTADO[p.estado];
  }
}

/** «10 ud · 17,25 €» (cantidad y precio unitario de un lado), o «—». */
export function textoLado(l: LadoCotejo | null, unidad: string | null): string {
  if (!l) return "—";
  const cant = l.cantidad === null ? "—" : `${fmt(l.cantidad, 3)}${unidad ? ` ${unidad}` : ""}`;
  const precio = l.precio === null ? "sin precio" : `${fmt(l.precio, 2)} €`;
  return `${cant} · ${precio}`;
}
