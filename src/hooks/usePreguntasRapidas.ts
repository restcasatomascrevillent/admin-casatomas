// Lecturas compartidas de las RPC `*_agente` (sin IA).
//
// Antes este fichero era el hook de las «preguntas rápidas» del chat (chips
// «Al instante»), que desaparecen con el tablero de Facturas › Análisis
// (05/11/2026). Quedan las dos lecturas que usa Compras (useCompras.ts).
import { supabase } from "@/integrations/supabase/client";
import { esErrorRpcInexistente, RpcNoDisponibleError } from "@/lib/facturas/preguntasRapidas";

/** Llama a una RPC por nombre y devuelve su JSON (o lanza el error). */
export type LlamarRpc = (funcion: string, args: Record<string, unknown>) => Promise<unknown>;

/** supabase.rpc sin los tipos generados (no todas las *_agente están en types.ts). */
export const llamarRpcSupabase: LlamarRpc = async (funcion, args) => {
  const rpc = supabase.rpc as unknown as (
    this: typeof supabase,
    fn: string,
    a?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
  const { data, error } = await rpc.call(supabase, funcion, args);
  if (esErrorRpcInexistente(error)) throw new RpcNoDisponibleError(funcion);
  if (error) throw new Error(error.message || "Error en la consulta");
  return data;
};

/**
 * Umbral de «subida de precio» configurado en Facturas › Productos
 * (`configuracion_facturas`, migración 20261007170000). null si no se puede
 * leer (tabla aún sin crear, sin fila o error): se usa el de por defecto.
 */
export const leerUmbralSubidaPrecio = async (): Promise<number | null> => {
  try {
    // types.ts (a mano) no conoce aún la tabla.
    const tabla = (supabase.from as unknown as (t: string) => {
      select: (c: string) => { limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }> };
    })("configuracion_facturas");
    const { data, error } = await tabla.select("umbral_subida_precio_pct").limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const n = Number((data[0] as { umbral_subida_precio_pct?: unknown }).umbral_subida_precio_pct);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
};
