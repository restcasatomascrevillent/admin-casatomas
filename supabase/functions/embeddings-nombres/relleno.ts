// ============================================================================
//  embeddings-nombres · lógica del relleno (testeable sin Deno)
// ----------------------------------------------------------------------------
//  Toma hasta LIMITE nombres de productos_nombre_embedding con embedding NULL
//  (los más antiguos primero), pide sus vectores a OpenAI en UNA llamada y los
//  guarda en lotes pequeños (guardarVectoresNombres).
// ============================================================================

import { guardarVectoresNombres, TABLA_NOMBRES } from "../procesar-factura/embeddingsNombres.ts";

export const FUNCION = "embeddings-nombres";
export const MODELO = "text-embedding-3-small";
/** Nombres por ejecución: una sola llamada a OpenAI (admite hasta 2048 entradas). */
export const LIMITE = 500;

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface DepsRelleno {
  supabase: Supa;
  /** Devuelve un vector por texto, en el mismo orden. Una llamada a OpenAI. */
  embed: (textos: string[]) => Promise<number[][]>;
  limite?: number;
}

/** Texto que se manda a OpenAI: el nombre tal cual (un nombre vacío no se admite). */
export function textoParaEmbedding(nombre: string): string {
  return nombre.trim() === "" ? "(sin nombre)" : nombre;
}

export async function rellenarPendientes(deps: DepsRelleno): Promise<{ pendientes: number; guardados: number }> {
  const limite = Math.max(1, Math.min(LIMITE, deps.limite ?? LIMITE));
  const { data, error } = await deps.supabase.from(TABLA_NOMBRES)
    .select("nombre").is("embedding", null).order("creado_en", { ascending: true }).limit(limite);
  if (error) throw new Error(`leer pendientes: ${error.message}`);
  const nombres: string[] = (data ?? []).map((f: { nombre: string }) => f.nombre);
  if (nombres.length === 0) return { pendientes: 0, guardados: 0 };
  const vectores = await deps.embed(nombres.map(textoParaEmbedding));
  const guardados = await guardarVectoresNombres(deps.supabase, nombres, vectores);
  return { pendientes: nombres.length, guardados };
}

/** Llamada a /v1/embeddings con todas las entradas a la vez. */
export async function embedOpenAI(
  textos: string[],
  opts: { apiKey: string; fetch?: typeof fetch; alUsar?: (usage: unknown) => void },
): Promise<number[][]> {
  const f = opts.fetch ?? fetch;
  const res = await f("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({ model: MODELO, input: textos }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  opts.alUsar?.(json?.usage);
  // deno-lint-ignore no-explicit-any
  const datos = [...(json?.data ?? [])].sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
  // deno-lint-ignore no-explicit-any
  const vectores = datos.map((d: any) => d.embedding as number[]);
  if (vectores.length !== textos.length) {
    throw new Error(`OpenAI devolvió ${vectores.length} vectores para ${textos.length} nombres`);
  }
  return vectores;
}
