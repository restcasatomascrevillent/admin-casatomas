// ============================================================================
//  Embeddings por NOMBRE de producto (migración 20261203100000)
// ----------------------------------------------------------------------------
//  Antes cada línea de productos_factura guardaba su propio vector (calculado
//  solo de su nombre). Ahora hay uno por nombre en productos_nombre_embedding
//  (clave = el nombre tal cual, halfvec(1536)). Un trigger crea la fila con
//  embedding NULL al insertar una línea con un nombre nuevo; aquí se calculan
//  SOLO los nombres que aún no tienen vector y se guardan.
//
//  Lo usan procesar-factura / ocr-trabajo / importar-factura-historica al
//  guardar (no rompe el guardado si falla: el cron embeddings-nombres lo
//  completa) y la Edge Function embeddings-nombres (relleno por lotes).
// ============================================================================

import { vec } from "./openai.ts";

export const TABLA_NOMBRES = "productos_nombre_embedding";
/** Filas por UPSERT: 50 vectores de 1536 floats ≈ 1,5 MB de JSON. */
export const LOTE_ESCRITURA = 50;
/** Nombres por consulta `in (...)` (la URL de PostgREST tiene límite). */
const LOTE_LECTURA = 100;

// deno-lint-ignore no-explicit-any
type Supa = any;

/** Nombres distintos (tal cual, sin normalizar) y no vacíos. */
export function nombresUnicos(nombres: ReadonlyArray<string | null | undefined>): string[] {
  const vistos = new Set<string>();
  for (const n of nombres) {
    if (typeof n === "string" && n.trim() !== "") vistos.add(n);
  }
  return [...vistos];
}

/** De `nombres`, los que todavía no tienen vector guardado. */
export async function nombresSinVector(supabase: Supa, nombres: string[]): Promise<string[]> {
  const unicos = nombresUnicos(nombres);
  const con = new Set<string>();
  for (let i = 0; i < unicos.length; i += LOTE_LECTURA) {
    const lote = unicos.slice(i, i + LOTE_LECTURA);
    const { data, error } = await supabase.from(TABLA_NOMBRES)
      .select("nombre").in("nombre", lote).not("embedding", "is", null);
    if (error) throw new Error(`leer ${TABLA_NOMBRES}: ${error.message}`);
    for (const f of data ?? []) con.add(f.nombre);
  }
  return unicos.filter((n) => !con.has(n));
}

/** Guarda (upsert por nombre) los vectores, en lotes pequeños. */
export async function guardarVectoresNombres(supabase: Supa, nombres: string[], vectores: number[][]): Promise<number> {
  if (nombres.length !== vectores.length) {
    throw new Error(`embeddings: ${nombres.length} nombres y ${vectores.length} vectores`);
  }
  const ahora = new Date().toISOString();
  let n = 0;
  for (let i = 0; i < nombres.length; i += LOTE_ESCRITURA) {
    const filas = nombres.slice(i, i + LOTE_ESCRITURA).map((nombre, j) => ({
      nombre,
      embedding: vec(vectores[i + j]),
      actualizado_en: ahora,
    }));
    const { error } = await supabase.from(TABLA_NOMBRES).upsert(filas, { onConflict: "nombre" });
    if (error) throw new Error(`guardar ${TABLA_NOMBRES}: ${error.message}`);
    n += filas.length;
  }
  return n;
}

/**
 * Al guardar un documento: calcula y guarda el vector de los nombres de sus
 * líneas que aún no lo tienen. NUNCA lanza: si falla (OpenAI, tabla sin
 * migrar…), lo deja pendiente para el cron embeddings-nombres.
 */
export async function asegurarVectoresNombres(
  ctx: { supabase: Supa; openai: { embed(input: string | string[]): Promise<number[][]> } },
  nombres: ReadonlyArray<string | null | undefined>,
): Promise<{ calculados: number; error: string | null }> {
  try {
    const faltan = await nombresSinVector(ctx.supabase, nombresUnicos(nombres));
    if (faltan.length === 0) return { calculados: 0, error: null };
    const vectores = await ctx.openai.embed(faltan);
    const n = await guardarVectoresNombres(ctx.supabase, faltan, vectores);
    return { calculados: n, error: null };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.warn(`[embeddings-nombres] se deja para el cron: ${msg}`);
    return { calculados: 0, error: msg };
  }
}
