import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DIAS_GASTO_IA,
  FUNCIONES_GASTO_IA,
  type FilaGastoIa,
  type GastoReal,
  normalizarFilas,
  normalizarGastoReal,
} from "@/lib/facturas/gastoIa";

type ClienteRpc = { rpc: unknown };

/**
 * Llama a la RPC y normaliza las filas. `rpc` es un método de SupabaseClient
 * que usa `this`: se invoca con `.call(cliente, …)`. Sacarlo a una constante y
 * llamarlo suelto lanza «Cannot read properties of undefined» (el monitor se
 * quedaba en «sin datos todavía» aunque la RPC respondiera bien).
 */
export async function cargarGastoIa(cliente: ClienteRpc): Promise<FilaGastoIa[]> {
  // La RPC no está en types.ts (se actualiza a mano): llamada sin tipar.
  const rpc = cliente.rpc as (
    this: ClienteRpc,
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  const { data, error } = await rpc.call(cliente, "gasto_ia_resumen", {
    p_funciones: [...FUNCIONES_GASTO_IA],
    p_dias: DIAS_GASTO_IA,
  });
  if (error) {
    console.warn("[gasto-ia] sin resumen:", error.message ?? error);
    return [];
  }
  return normalizarFilas(data);
}

/**
 * Gasto de IA de Facturas en los últimos 30 días (`gasto_ia_resumen`, solo
 * agregados; basta con poder ver Facturas). Una sola consulta para las dos
 * pestañas (IA y Cargar): la misma clave de caché.
 *
 * Si la RPC aún no existe (migración 20261008110000 sin aplicar) o no hay
 * permiso, devuelve [] y el monitor dice «sin datos todavía»: un dato de coste
 * nunca puede romper la pantalla de Facturas.
 */
export function useGastoIa(habilitado = true) {
  return useQuery({
    queryKey: ["facturas", "gasto_ia_resumen", DIAS_GASTO_IA],
    enabled: habilitado,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: () => cargarGastoIa(supabase),
  });
}

type RespuestaRpc = { data: unknown; error: { message?: string } | null };
type RpcFn = (this: ClienteRpc, fn: string, args?: Record<string, unknown>) => PromiseLike<RespuestaRpc>;

/**
 * Gasto REAL de OpenAI por proceso + tipo de cambio del BCE
 * (`gasto_ia_real_resumen` y `tipo_cambio_usd_eur_actual`, migración
 * 20261008150000). Devuelve null si la RPC no existe todavía, falla o aún no
 * hay datos reales: entonces el monitor sigue con el estimado de `ia_uso`.
 * Si solo falla el tipo de cambio, se usa el 0,92 por defecto.
 * `rpc` se invoca con `.call(cliente, …)` (usa `this`; suelto se rompe).
 */
export async function cargarGastoIaReal(cliente: ClienteRpc): Promise<GastoReal | null> {
  const rpc = cliente.rpc as RpcFn;
  try {
    const { data, error } = await rpc.call(cliente, "gasto_ia_real_resumen", { p_dias: DIAS_GASTO_IA });
    if (error) return null;
    let tipo: unknown = null;
    try {
      const t = await rpc.call(cliente, "tipo_cambio_usd_eur_actual");
      tipo = t.error ? null : t.data;
    } catch {
      tipo = null;
    }
    return normalizarGastoReal(data, tipo);
  } catch {
    return null;
  }
}

/** Gasto real de OpenAI (30 días). null = no disponible: usar el estimado. */
export function useGastoIaReal(habilitado = true) {
  return useQuery({
    queryKey: ["facturas", "gasto_ia_real_resumen", DIAS_GASTO_IA],
    enabled: habilitado,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: () => cargarGastoIaReal(supabase),
  });
}
