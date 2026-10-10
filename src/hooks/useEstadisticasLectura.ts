import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type EstadisticasLectura, normalizarEstadisticasLectura } from "@/lib/facturas/costeLectura";

type ClienteRpc = { rpc: unknown };
type RespuestaRpc = { data: unknown; error: { message?: string } | null };

/**
 * Estadísticas del coste de LEER documentos (`estadisticas_lectura`, migración
 * 20261010120000; basta con poder ver Facturas). `rpc` usa `this`: se invoca
 * con `.call(cliente, …)`. Devuelve null si la RPC no existe todavía, falla o
 * no hay documentos medidos: un dato de coste nunca puede romper la pantalla.
 */
export async function cargarEstadisticasLectura(cliente: ClienteRpc, dias: number): Promise<EstadisticasLectura | null> {
  const rpc = cliente.rpc as (this: ClienteRpc, fn: string, args: Record<string, unknown>) => PromiseLike<RespuestaRpc>;
  try {
    const { data, error } = await rpc.call(cliente, "estadisticas_lectura", { p_dias: dias });
    if (error) {
      console.warn("[coste-lectura] sin estadísticas:", error.message ?? error);
      return null;
    }
    return normalizarEstadisticasLectura(data);
  } catch (e) {
    console.warn("[coste-lectura] sin estadísticas:", e);
    return null;
  }
}

/** Estadísticas de lectura de los últimos `dias` días naturales (hoy incluido). */
export function useEstadisticasLectura(dias: number, habilitado = true) {
  return useQuery({
    queryKey: ["facturas", "estadisticas_lectura", dias],
    enabled: habilitado,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: () => cargarEstadisticasLectura(supabase, dias),
  });
}

export interface CosteLecturaFactura {
  costeUsd: number;
  llamadas: number | null;
  modelo: string | null;
}

/**
 * Coste de leer UNA factura (`facturas.coste_lectura_usd`). null = sin dato
 * (documento anterior a la medición) o columna aún sin migrar.
 */
export async function leerCosteLecturaFactura(cliente: unknown, id: number): Promise<CosteLecturaFactura | null> {
  try {
    const desde = (cliente as { from: (t: string) => unknown }).from;
    const tabla = desde.call(cliente, "facturas") as {
      select: (c: string) => {
        eq: (c: string, v: number) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
      };
    };
    const { data, error } = await tabla.select("coste_lectura_usd, lectura_llamadas, lectura_modelo").eq("id", id).maybeSingle();
    if (error || !data) return null;
    const f = data as Record<string, unknown>;
    const usd = f.coste_lectura_usd === null || f.coste_lectura_usd === undefined ? NaN : Number(f.coste_lectura_usd);
    if (!Number.isFinite(usd)) return null;
    const ll = f.lectura_llamadas === null || f.lectura_llamadas === undefined ? NaN : Number(f.lectura_llamadas);
    return { costeUsd: usd, llamadas: Number.isFinite(ll) ? ll : null, modelo: typeof f.lectura_modelo === "string" ? f.lectura_modelo : null };
  } catch {
    return null;
  }
}

export function useCosteLecturaFactura(id: number | null | undefined) {
  return useQuery({
    queryKey: ["facturas", "coste_lectura", id],
    enabled: typeof id === "number" && id > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: () => leerCosteLecturaFactura(supabase, id as number),
  });
}
