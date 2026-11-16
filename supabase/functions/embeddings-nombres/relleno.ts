// ============================================================================
//  embeddings-nombres · lógica del relleno (testeable sin Deno)
// ----------------------------------------------------------------------------
//  Toma hasta LIMITE nombres de productos_nombre_embedding con embedding NULL
//  (los más antiguos primero), pide sus vectores a OpenAI en UNA llamada y los
//  guarda en lotes pequeños (guardarVectoresNombres).
// ============================================================================

import { guardarVectoresNombres, TABLA_NOMBRES } from "../procesar-factura/embeddingsNombres.ts";
import { textoEmbedding } from "../procesar-factura/guardado.ts";
import type { DatosNormalizados } from "../procesar-factura/extraccion.ts";
import { vec } from "../procesar-factura/openai.ts";

export const FUNCION = "embeddings-nombres";
export const MODELO = "text-embedding-3-small";
/** Nombres por ejecución: una sola llamada a OpenAI (admite hasta 2048 entradas). */
export const LIMITE = 500;

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  type FilaEmbedding = { index?: number; embedding: number[] };
  const datos = [...((json?.data ?? []) as FilaEmbedding[])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vectores = datos.map((d) => d.embedding);
  if (vectores.length !== textos.length) {
    throw new Error(`OpenAI devolvió ${vectores.length} vectores para ${textos.length} nombres`);
  }
  return vectores;
}

// ----------------------------------------------------------------------------
//  Vector de la CABECERA de factura (facturas.embedding), tras los nombres.
//  Mismo texto que al guardar (textoEmbedding de procesar-factura/guardado.ts),
//  reconstruido desde facturas + productos_factura. Una sola llamada a OpenAI.
// ----------------------------------------------------------------------------

/** Facturas por pasada. */
export const LIMITE_FACTURAS = 200;

interface FilaFactura {
  id: number;
  tipo: string | null;
  proveedor: string | null;
  fecha: string | null;
  total: number | null;
  resumen: string | null;
}

/** Objeto mínimo que espera textoEmbedding (solo lee estos campos). */
export function datosParaTexto(f: FilaFactura, nombres: string[]): DatosNormalizados {
  return {
    tipo: f.tipo,
    proveedor: f.proveedor ?? "",
    fecha: f.fecha,
    total: f.total,
    resumen: f.resumen,
    productos: nombres.map((nombre) => ({ nombre })),
  } as unknown as DatosNormalizados;
}

export async function rellenarFacturas(
  deps: DepsRelleno,
): Promise<{ facturasPendientes: number; facturasGuardadas: number; facturasFallidas: number }> {
  const limite = Math.max(1, Math.min(LIMITE_FACTURAS, deps.limite ?? LIMITE_FACTURAS));
  const { data, error } = await deps.supabase.from("facturas")
    .select("id,tipo,proveedor,fecha,total,resumen").is("embedding", null).order("id", { ascending: true }).limit(limite);
  if (error) throw new Error(`leer facturas pendientes: ${error.message}`);
  const filas: FilaFactura[] = data ?? [];
  if (filas.length === 0) return { facturasPendientes: 0, facturasGuardadas: 0, facturasFallidas: 0 };

  // Líneas solo de las que no traen resumen (con resumen el texto es el resumen).
  const sinResumen = filas.filter((f) => !f.resumen).map((f) => f.id);
  const nombresPor = new Map<number, string[]>();
  if (sinResumen.length > 0) {
    const l = await deps.supabase.from("productos_factura")
      .select("factura_id,nombre").in("factura_id", sinResumen)
      .order("orden", { ascending: true }).order("id", { ascending: true });
    if (l.error) throw new Error(`leer líneas: ${l.error.message}`);
    for (const r of (l.data ?? []) as { factura_id: number; nombre: string }[]) {
      const a = nombresPor.get(r.factura_id) ?? [];
      a.push(r.nombre);
      nombresPor.set(r.factura_id, a);
    }
  }
  const textos = filas.map((f) => textoParaEmbedding(textoEmbedding(datosParaTexto(f, nombresPor.get(f.id) ?? []))));
  const vectores = await deps.embed(textos);
  if (vectores.length !== filas.length) throw new Error(`OpenAI devolvió ${vectores.length} vectores para ${filas.length} facturas`);

  let guardadas = 0;
  let fallidas = 0;
  for (let i = 0; i < filas.length; i++) {
    try {
      const { error: e } = await deps.supabase.from("facturas").update({ embedding: vec(vectores[i]) }).eq("id", filas[i].id);
      if (e) throw new Error(e.message);
      guardadas++;
    } catch (e) {
      fallidas++;
      console.error(`[${FUNCION}] factura ${filas[i].id}: no se guardó el vector:`, (e as Error)?.message ?? e);
    }
  }
  return { facturasPendientes: filas.length, facturasGuardadas: guardadas, facturasFallidas: fallidas };
}
