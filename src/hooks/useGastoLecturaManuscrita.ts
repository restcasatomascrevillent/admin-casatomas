import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { CAMBIO_POR_DEFECTO } from "@/lib/servicios";
import { resumirLecturaManuscrita, type FilaGastoFuncion } from "@/lib/reservas/gastoLecturaManuscrita";

/**
 * Gasto de leer las reservas escritas a mano: este mes y los últimos 30 días.
 * Sale de `ia_coste_por_funcion` (lo apunta la Edge Function en `ia_uso`).
 */
export function useGastoLecturaManuscrita(eurPorUsd: number = CAMBIO_POR_DEFECTO, habilitado = true) {
  const hoy = new Date();
  const hasta = format(hoy, "yyyy-MM-dd");
  const desdeMes = format(startOfMonth(hoy), "yyyy-MM-dd");
  const desde30 = format(subDays(hoy, 29), "yyyy-MM-dd");
  return useQuery({
    queryKey: ["gasto-lectura-manuscrita", { desdeMes, desde30, hasta, eurPorUsd }],
    enabled: habilitado,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const pedir = async (desde: string) => {
        const { data, error } = await supabase.rpc("ia_coste_por_funcion", { p_desde: desde, p_hasta: hasta });
        if (error) throw error;
        return (data ?? []) as FilaGastoFuncion[];
      };
      const [mes, ultimos30] = await Promise.all([pedir(desdeMes), pedir(desde30)]);
      return { mes: resumirLecturaManuscrita(mes, eurPorUsd), ultimos30: resumirLecturaManuscrita(ultimos30, eurPorUsd) };
    },
  });
}
