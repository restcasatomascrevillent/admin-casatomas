// Informe fijo «Subidas y proveedor» de Facturas › Análisis: una petición por
// bloque (RPC `informe_subidas_precio` e `informe_proveedor_mas_barato`,
// migración 20261207110000). Tardan unos segundos (recorren 27 meses de
// compras): se guardan 10 minutos. Si la migración no está aplicada, null.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { esErrorRpcInexistente } from "@/lib/facturas/preguntasRapidas";
import { normalizarBarato, normalizarSubidas, type InformeBarato, type InformeSubidas, type MesesInforme } from "@/lib/facturas/informeSubidas";

async function rpc(funcion: string, args: Record<string, unknown>) {
  const llamar = supabase.rpc as unknown as (
    this: typeof supabase,
    fn: string,
    a?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
  return llamar.call(supabase, funcion, args);
}

/** El error con su código de Postgres/PostgREST, para que la pantalla lo explique en castellano. */
function errorInforme(error: { message?: string; code?: string }, porDefecto: string): Error & { code?: string } {
  return Object.assign(new Error(error.message || porDefecto), { code: error.code });
}

export interface FiltrosInforme {
  proveedorId: number | null;
  familiaId: number | null;
  local: "casa_tomas" | "touza" | null;
}

const STALE = 10 * 60_000;

export function useInformeSubidas(meses: MesesInforme, f: FiltrosInforme, limite: number) {
  return useQuery({
    queryKey: ["facturas-informe-subidas", meses, f.proveedorId, f.familiaId, f.local, limite] as const,
    staleTime: STALE,
    retry: 1,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<InformeSubidas | null> => {
      const { data, error } = await rpc("informe_subidas_precio", {
        p_meses: meses,
        p_proveedor_id: f.proveedorId,
        p_familia_id: f.familiaId,
        p_local: f.local,
        p_limite: limite,
        p_desde: 0,
      });
      if (esErrorRpcInexistente(error)) return null;
      if (error) throw errorInforme(error, "No se han podido calcular las subidas de precio");
      return normalizarSubidas(data);
    },
  });
}

export function useInformeBarato(f: FiltrosInforme, limite: number) {
  return useQuery({
    queryKey: ["facturas-informe-barato", f.proveedorId, f.familiaId, f.local, limite] as const,
    staleTime: STALE,
    retry: 1,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<InformeBarato | null> => {
      const { data, error } = await rpc("informe_proveedor_mas_barato", {
        p_proveedor_id: f.proveedorId,
        p_familia_id: f.familiaId,
        p_local: f.local,
        p_limite: limite,
        p_desde: 0,
      });
      if (esErrorRpcInexistente(error)) return null;
      if (error) throw errorInforme(error, "No se ha podido calcular el proveedor más barato");
      return normalizarBarato(data);
    },
  });
}
