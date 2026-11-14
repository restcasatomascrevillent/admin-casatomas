import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { type FilaCostePorUso, normalizarCostePorUso } from "@/lib/costesServicios";

// Sin tipar: la RPC no está en types.ts (20261129153000) y la pantalla tiene que funcionar antes y después.
const sb = supabase as unknown as SupabaseClient;

export const CLAVE_COSTE_POR_USO = ["super-admin", "ia-coste-por-uso"] as const;

/** `disponible: false` si falta la migración 20261129153000 (sin la RPC). */
export type ResultadoCostePorUso = { disponible: true; filas: FilaCostePorUso[] } | { disponible: false };

const esSinMigracion = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || /ia_coste_por_uso/.test(e.message ?? ""));

/** IA función por función entre dos días (`AAAA-MM-DD`, ambos incluidos, hora de Madrid). */
export async function cargarCostePorUso(desde: string, hasta: string): Promise<ResultadoCostePorUso> {
  const { data, error } = await sb.rpc("ia_coste_por_uso", { p_desde: desde, p_hasta: hasta });
  if (error) {
    if (esSinMigracion(error)) return { disponible: false };
    throw new Error(error.message || "No se pudo cargar el gasto de IA por función.");
  }
  return { disponible: true, filas: normalizarCostePorUso(data) };
}

export function useCostePorUso(desde: string, hasta: string, habilitado = true) {
  return useQuery({
    queryKey: [...CLAVE_COSTE_POR_USO, desde, hasta],
    queryFn: () => cargarCostePorUso(desde, hasta),
    enabled: habilitado,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}
