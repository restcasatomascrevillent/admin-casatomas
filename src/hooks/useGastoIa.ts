import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DIAS_GASTO_IA, FUNCIONES_GASTO_IA, type FilaGastoIa, normalizarFilas } from "@/lib/facturas/gastoIa";

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
