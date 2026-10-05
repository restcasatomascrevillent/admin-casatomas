import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type EstadoTrabajo, SELECT_TRABAJO, SONDEO_MS } from "@/lib/facturas/documentoLargo";

/**
 * Documentos largos que siguen leyéndose en segundo plano (últimas 24 h): si
 * el usuario cierra la pestaña mientras se procesan, al volver los ve aquí.
 * Si la tabla aún no existe (migración sin aplicar), devuelve [] sin error.
 */
export function useTrabajosOcrEnCurso() {
  return useQuery<EstadoTrabajo[]>({
    queryKey: ["ocr_trabajos_en_curso"],
    queryFn: async () => {
      const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from("ocr_trabajos")
        .select(SELECT_TRABAJO)
        .in("estado", ["pendiente", "pagina1", "paginas", "consolidando"])
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return [];
      return (data as unknown as EstadoTrabajo[]) ?? [];
    },
    refetchInterval: (q) => ((q.state.data?.length ?? 0) > 0 ? SONDEO_MS : 60_000),
    staleTime: 2000,
  });
}
