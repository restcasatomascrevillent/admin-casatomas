// Alertas vigentes de Facturas (RPC `facturas_alertas_activas`, migración
// 20261107300000). Una sola petición por local (sin periodo): la tarjeta
// «Requiere atención» enseña todas y cada gráfica se queda con las suyas. Las
// genera un cron una vez al día, así que con 10 minutos de caché basta. Si la
// migración no está aplicada, no hay alertas (y no es un error que enseñar).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { esErrorRpcInexistente } from "@/lib/facturas/preguntasRapidas";
import { normalizarAlertas, type AlertaFacturas } from "@/lib/facturas/alertas";

async function rpc(funcion: string, args: Record<string, unknown>) {
  const llamar = supabase.rpc as unknown as (
    this: typeof supabase,
    fn: string,
    a?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
  return llamar.call(supabase, funcion, args);
}

export function consultaAlertasFacturas(local: "casa_tomas" | "touza" | null) {
  return {
    queryKey: ["facturas-alertas", local] as const,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<AlertaFacturas[]> => {
      const { data, error } = await rpc("facturas_alertas_activas", { p_desde: null, p_hasta: null, p_local: local });
      if (esErrorRpcInexistente(error)) return [];
      if (error) throw new Error(error.message || "No se han podido cargar las alertas");
      return normalizarAlertas(data);
    },
  };
}

export function useAlertasFacturas(local: "casa_tomas" | "touza" | null) {
  return useQuery({ ...consultaAlertasFacturas(local), retry: 1 });
}
