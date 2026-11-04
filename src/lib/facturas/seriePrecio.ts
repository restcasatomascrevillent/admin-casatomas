// Evolución de precio de un producto por proveedor (RPC `serie_precios_agente`).
//
// Parte pura (sin React) para poder probarla sola. El mismo JSON llega por dos
// caminos: la pregunta rápida «Evolución de precio» (RPC directa) y el chatbot
// (`adjuntos: [{tipo:'serie_precio', datos}]` de la Edge Function chat-facturas).

/** [fecha AAAA-MM-DD, precio sin IVA, índice en `proveedores`] */
export type PuntoSerie = [string, number, number];

export interface SeriePrecio {
  producto: string;
  unidad: string | null;
  proveedores: string[];
  puntos: PuntoSerie[];
  n: number;
  min: number | null;
  max: number | null;
  ultimo: number | null;
  variacion_pct: number | null;
}

export interface SerieSinDatos {
  sin_datos: true;
  buscado: string;
}

export type DatosSeriePrecio = SeriePrecio | SerieSinDatos;

export interface DocumentoCitado {
  id: number;
  tipo: string | null;
  numero: string | null;
  proveedor: string | null;
  fecha: string | null;
  drive_url: string | null;
  archivo_path: string | null;
}

export type AdjuntoChat =
  | { tipo: "serie_precio"; datos: DatosSeriePrecio }
  | { tipo: "documentos"; datos: DocumentoCitado[] };

const textoOnulo = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Valida la lista de documentos citados (de la respuesta o de la BD). */
export function normalizarDocumentos(entrada: unknown): DocumentoCitado[] {
  if (!Array.isArray(entrada)) return [];
  const salida: DocumentoCitado[] = [];
  for (const d of entrada) {
    if (!d || typeof d !== "object") continue;
    const r = d as Record<string, unknown>;
    if (typeof r.id !== "number" || !Number.isFinite(r.id)) continue;
    const doc = {
      id: r.id, tipo: textoOnulo(r.tipo), numero: textoOnulo(r.numero), proveedor: textoOnulo(r.proveedor),
      fecha: textoOnulo(r.fecha), drive_url: textoOnulo(r.drive_url), archivo_path: textoOnulo(r.archivo_path),
    };
    salida.push(doc);
  }
  return salida;
}

export const esSerieSinDatos = (d: DatosSeriePrecio): d is SerieSinDatos =>
  (d as SerieSinDatos).sin_datos === true;

const esNumero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numeroOnulo = (v: unknown): number | null => (esNumero(v) ? v : null);

/**
 * Valida el JSON de la RPC (o de un adjunto guardado en BD) y lo deja con la
 * forma exacta que pinta el gráfico. Devuelve null si no sirve para nada.
 * Los puntos mal formados se descartan; un índice de proveedor fuera de rango
 * se pinta como «Sin proveedor».
 */
export function normalizarSerie(entrada: unknown): DatosSeriePrecio | null {
  if (!entrada || typeof entrada !== "object") return null;
  const d = entrada as Record<string, unknown>;
  if (d.sin_datos === true) return { sin_datos: true, buscado: typeof d.buscado === "string" ? d.buscado : "" };
  if (!Array.isArray(d.puntos)) return null;

  const proveedores = Array.isArray(d.proveedores) ? d.proveedores.map((p) => String(p ?? "")) : [];
  const puntos: PuntoSerie[] = [];
  for (const p of d.puntos) {
    if (!Array.isArray(p) || typeof p[0] !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(p[0]) || !esNumero(p[1])) continue;
    const idx = Number.isInteger(p[2]) && p[2] >= 0 ? (p[2] as number) : 0;
    puntos.push([p[0].slice(0, 10), p[1], idx]);
  }
  if (puntos.length === 0) return { sin_datos: true, buscado: typeof d.producto === "string" ? d.producto : "" };
  puntos.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const precios = puntos.map((p) => p[1]);
  return {
    producto: typeof d.producto === "string" ? d.producto : "",
    unidad: typeof d.unidad === "string" && d.unidad ? d.unidad : null,
    proveedores,
    puntos,
    n: esNumero(d.n) ? d.n : puntos.length,
    min: numeroOnulo(d.min) ?? Math.min(...precios),
    max: numeroOnulo(d.max) ?? Math.max(...precios),
    ultimo: numeroOnulo(d.ultimo) ?? puntos[puntos.length - 1][1],
    variacion_pct: numeroOnulo(d.variacion_pct),
  };
}

/** Adjuntos de la respuesta del chat (o de la columna `adjuntos` de la BD): solo los válidos. */
export function normalizarAdjuntos(entrada: unknown): AdjuntoChat[] {
  if (!Array.isArray(entrada)) return [];
  const salida: AdjuntoChat[] = [];
  for (const a of entrada) {
    if (!a || typeof a !== "object") continue;
    const { tipo, datos } = a as { tipo?: unknown; datos?: unknown };
    if (tipo === "documentos") {
      const docs = normalizarDocumentos(datos);
      if (docs.length > 0) salida.push({ tipo: "documentos", datos: docs });
      continue;
    }
    if (tipo !== "serie_precio") continue;
    const serie = normalizarSerie(datos);
    if (serie) salida.push({ tipo: "serie_precio", datos: serie });
  }
  return salida;
}

/** Nombre del proveedor de un punto («Sin proveedor» si el índice no existe). */
export const nombreProveedor = (serie: SeriePrecio, idx: number): string => serie.proveedores[idx] || "Sin proveedor";

const dia = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

export interface FilaGrafico {
  /** ms UTC de la fecha (eje X numérico: el espacio entre compras es real). */
  t: number;
  fecha: string;
  /** `p0`, `p1`… → precio de ese proveedor en esa fecha. */
  [clave: string]: number | string;
}

/** Una fila por fecha con una columna por proveedor (para el LineChart). */
export function filasGrafico(serie: SeriePrecio): FilaGrafico[] {
  const porFecha = new Map<string, FilaGrafico>();
  for (const [fecha, precio, idx] of serie.puntos) {
    const fila = porFecha.get(fecha) ?? { t: dia(fecha), fecha };
    // Dos compras el mismo día al mismo proveedor: la última manda.
    fila[`p${idx}`] = precio;
    porFecha.set(fecha, fila);
  }
  return [...porFecha.values()].sort((a, b) => a.t - b.t);
}

/** Índices de proveedor que tienen al menos un punto (el resto no se dibuja). */
export function proveedoresUsados(serie: SeriePrecio): number[] {
  return [...new Set(serie.puntos.map((p) => p[2]))].sort((a, b) => a - b);
}
