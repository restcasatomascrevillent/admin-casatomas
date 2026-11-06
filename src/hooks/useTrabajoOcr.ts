import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type EstadoTrabajo, SELECT_TRABAJO, SONDEO_MS, trabajoParado } from "@/lib/facturas/documentoLargo";

export const ESTADOS_EN_CURSO = ["pendiente", "pagina1", "paginas", "consolidando"] as const;

/**
 * Documentos que el servidor tiene «en curso» (últimas 24 h), con `limite_at`.
 * `usuarioId`: solo los que subió ese usuario (la cola en segundo plano los
 * ADOPTA al recargar la página). OJO: puede traer trabajos PARADOS (pasaron
 * su límite y el cron no los cerró): la cola los enseña como «Parado en el
 * servidor» y no como «Leyendo…» (ver `trabajoParado`). Si la tabla aún no
 * existe (migración sin aplicar) o falla la lectura, devuelve [] sin error.
 */
export async function leerTrabajosOcrEnCurso(usuarioId?: string): Promise<EstadoTrabajo[]> {
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  let q = supabase.from("ocr_trabajos").select(SELECT_TRABAJO).in("estado", [...ESTADOS_EN_CURSO]);
  if (usuarioId) q = q.eq("creado_por", usuarioId);
  const { data, error } = await q.gte("created_at", desde).order("created_at", { ascending: false }).limit(10);
  if (error) return [];
  return (data as unknown as EstadoTrabajo[]) ?? [];
}

/**
 * Documentos que siguen leyéndose DE VERDAD en segundo plano (de cualquier
 * usuario con acceso a Facturas; sin los parados), con sondeo mientras haya alguno.
 */
export function useTrabajosOcrEnCurso() {
  return useQuery<EstadoTrabajo[]>({
    queryKey: ["ocr_trabajos_en_curso"],
    queryFn: async () => (await leerTrabajosOcrEnCurso()).filter((t) => !trabajoParado(t)),
    refetchInterval: (q) => ((q.state.data?.length ?? 0) > 0 ? SONDEO_MS : 60_000),
    staleTime: 2000,
  });
}
