// ============================================================================
//  Coste de LEER cada documento (10-oct-2026)
// ----------------------------------------------------------------------------
//  El extractor (procesar-factura + ocr-trabajo) es la mayor partida de IA. El
//  coste de leer UN documento es la suma de todas sus llamadas a OpenAI:
//  visión, relecturas, pie, contador y embeddings. Se guarda en
//  `facturas.coste_lectura_usd` (+ `lectura_llamadas`, `lectura_modelo`) para
//  poder sacar la media, la mediana y el documento más caro
//  (RPC estadisticas_lectura, migración 20261010120000).
//
//  De dónde sale el coste según el camino:
//   · síncrono: el acumulador del cliente de OpenAI de la petición.
//   · segundo plano: `ocr_trabajos.coste_usd` / `.llamadas` (lo suman las
//     piezas: ocr_cerrar_pagina y ocr_sumar_gasto) + los embeddings de la
//     consolidación.
//   · «sustituir»: lo del trabajo (la lectura que se acepta) + los embeddings
//     de la sustitución. Sustituye al coste anterior de esa factura.
//
//  NADA DE ESTO PUEDE ROMPER LA LECTURA: todo es best-effort. Si la migración
//  no está aplicada (faltan las columnas o la RPC) solo queda un console.warn.
// ============================================================================

import { totalesUso, type UsoAcumulado } from "./openai.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface CosteLectura {
  usd: number;
  /** null = no se sabe (trabajos anteriores a la columna `llamadas`). */
  llamadas: number | null;
  modelo: string | null;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Coste de lo que ha hecho un cliente de OpenAI (visión + embeddings). */
export function costeDeCliente(uso: UsoAcumulado, modelo: string | null): CosteLectura {
  const t = totalesUso(uso);
  return { usd: t.usd, llamadas: t.llamadas, modelo };
}

/** Suma dos costes. `llamadas` es null si alguno de los dos no la conoce. */
export function sumarCostes(a: CosteLectura, b: CosteLectura): CosteLectura {
  return {
    usd: r6(a.usd + b.usd),
    llamadas: a.llamadas === null || b.llamadas === null ? null : a.llamadas + b.llamadas,
    modelo: a.modelo ?? b.modelo,
  };
}

/**
 * Lo que lleva gastado un trabajo de OCR (suma de sus piezas). Si la columna
 * `llamadas` no existe aún, se lee solo el coste y `llamadas` queda en null.
 */
export async function leerCosteTrabajo(supabase: Supa, trabajoId: string): Promise<CosteLectura> {
  try {
    let { data, error } = await supabase.from("ocr_trabajos").select("coste_usd, modelo, llamadas").eq("id", trabajoId).single();
    let conLlamadas = !error;
    if (error) {
      ({ data, error } = await supabase.from("ocr_trabajos").select("coste_usd, modelo").eq("id", trabajoId).single());
      conLlamadas = false;
    }
    if (error || !data) return { usd: 0, llamadas: null, modelo: null };
    const llamadas = conLlamadas && data.llamadas !== undefined && data.llamadas !== null ? Math.round(num(data.llamadas)) : null;
    return { usd: num(data.coste_usd), llamadas: llamadas === 0 ? null : llamadas, modelo: data.modelo ?? null };
  } catch (e) {
    console.warn("[coste-lectura] no se pudo leer el coste del trabajo:", e);
    return { usd: 0, llamadas: null, modelo: null };
  }
}

/** Escribe el coste de leer una factura. Nunca lanza. */
export async function guardarCosteLectura(supabase: Supa, facturaId: number, c: CosteLectura): Promise<void> {
  try {
    const { error } = await supabase.from("facturas").update({
      coste_lectura_usd: r6(c.usd),
      lectura_llamadas: c.llamadas,
      lectura_modelo: c.modelo,
    }).eq("id", facturaId);
    if (error) console.warn("[coste-lectura] no se pudo guardar el coste de la factura (¿migración sin aplicar?):", error.message);
  } catch (e) {
    console.warn("[coste-lectura] no se pudo guardar el coste de la factura:", e);
  }
}

/**
 * Suma al trabajo el coste y las llamadas de una lectura (ocr_sumar_gasto).
 * Se usa con el coste de los intentos que FALLARON (OpenAI los factura y, si
 * no, se perdían al reintentar) y con el recuento de llamadas de los que
 * acabaron bien (su coste ya lo suma ocr_cerrar_pagina). Nunca lanza.
 */
export async function sumarGastoTrabajo(supabase: Supa, trabajoId: string, uso: UsoAcumulado, conCoste: boolean): Promise<void> {
  const llamadas = uso.llamadas + uso.llamadasEmbeddings;
  const coste = conCoste ? totalesUso(uso).usd : 0;
  if (llamadas === 0 && coste === 0) return;
  try {
    const { error } = await supabase.rpc("ocr_sumar_gasto", { p_trabajo_id: trabajoId, p_coste: coste, p_llamadas: llamadas });
    if (error) console.warn("[coste-lectura] ocr_sumar_gasto (¿migración sin aplicar?):", error.message);
  } catch (e) {
    console.warn("[coste-lectura] ocr_sumar_gasto:", e);
  }
}
