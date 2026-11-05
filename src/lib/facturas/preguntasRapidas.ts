// Utilidades de las RPC `*_agente` de Facturas (las mismas que usa el chatbot
// como herramientas): formato es-ES de precios y fechas, errores de RPC y los
// argumentos de la serie de precio de un producto.
//
// Antes era el módulo de las «preguntas rápidas» del chat (chips «Al
// instante»); con el tablero de Análisis (05/11/2026) esos chips desaparecen y
// aquí queda solo lo que siguen usando la gráfica de precio, la ficha de
// producto de Compras y el tablero.

const NBSP = " ";

/**
 * Número con punto de miles y coma decimal SIEMPRE («1.234,56»). Se hace a
 * mano porque `Intl` en es-ES no agrupa los números de 4 cifras («1234,56»).
 */
export function formatNumeroEs(n: number, decimales = 2, minimoDecimales = decimales): string {
  const factor = 10 ** decimales;
  const redondeado = Math.round(Math.abs(n) * factor) / factor;
  let [entera, dec = ""] = redondeado.toFixed(decimales).split(".");
  entera = entera.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  dec = dec.replace(/0+$/, "").padEnd(minimoDecimales, "0");
  const signo = n < 0 && redondeado !== 0 ? "-" : "";
  return `${signo}${entera}${dec ? `,${dec}` : ""}`;
}

/** "2026-10-03" → "03/10/2026" (sin pasar por Date: nada de husos). */
export function formatFechaEs(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Precio unitario: hasta 4 decimales, mínimo 2 («12,9» → «12,90 €/kg»). */
export const formatPrecioUnidad = (precio: number | null | undefined, unidad?: string | null): string =>
  precio === null || precio === undefined ? "—" : `${formatNumeroEs(precio, 4, 2)}${NBSP}€${unidad ? `/${unidad}` : ""}`;

/** «+12,5 %» / «−3 %». */
export const formatPorcentaje = (pct: number): string =>
  `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${formatNumeroEs(Math.abs(pct), 1, 0)}${NBSP}%`;

/** Umbral por defecto de «subida de precio» si no se puede leer configuracion_facturas. */
export const UMBRAL_SUBIDA_POR_DEFECTO = 10;

/**
 * La RPC no existe en la base de datos (migración sin aplicar). PostgREST
 * contesta PGRST202 («Could not find the function»); Postgres, 42883.
 */
export class RpcNoDisponibleError extends Error {
  constructor(funcion: string) {
    super(`La función ${funcion} todavía no existe en la base de datos.`);
    this.name = "RpcNoDisponibleError";
  }
}

export const esErrorRpcInexistente = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (error.code === "PGRST202" || error.code === "42883");

/** El producto (y, si se quiere, la unidad) de una serie de precio. */
export interface ParametrosEvolucionPrecio {
  producto: string;
  /** Opcional: solo compras en esa unidad (kg, l, ud…). */
  unidad?: string | null;
}

/** Argumentos de `serie_precios_agente` (sin límite de fechas: toda la historia). */
export const argsSeriePrecios = (p: ParametrosEvolucionPrecio) => ({
  p_texto: p.producto.trim(),
  p_desde: null,
  p_hasta: null,
  p_unidad: p.unidad?.trim() ? p.unidad.trim() : null,
});
