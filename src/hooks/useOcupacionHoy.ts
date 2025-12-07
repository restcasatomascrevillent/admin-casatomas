import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OcupacionEspacio {
  espacio_id: string;
  espacio_nombre: string;
  capacidad_maxima: number;
  total_reservas: number;
  total_comensales: number;
  porcentaje_ocupacion: number;
}

export function useOcupacionHoy() {
  return useQuery({
    queryKey: ["ocupacion_hoy"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vista_ocupacion_hoy")
        .select("*");

      if (error) throw error;
      return data as OcupacionEspacio[];
    },
    refetchInterval: 60000, // Refrescar cada minuto
  });
}

export function useResumenOcupacionHoy() {
  const { data: ocupacion, ...rest } = useOcupacionHoy();

  const resumen = ocupacion
    ? {
        totalReservas: ocupacion.reduce((acc, e) => acc + (e.total_reservas || 0), 0),
        totalComensales: ocupacion.reduce((acc, e) => acc + (e.total_comensales || 0), 0),
        capacidadTotal: ocupacion.reduce((acc, e) => acc + (e.capacidad_maxima || 0), 0),
        porcentajeTotal:
          ocupacion.length > 0
            ? Math.round(
                ocupacion.reduce((acc, e) => acc + (e.porcentaje_ocupacion || 0), 0) /
                  ocupacion.length
              )
            : 0,
        espacios: ocupacion,
      }
    : null;

  return { data: resumen, ...rest };
}

export function useReservasHoyPorEspacio(espacioId?: string) {
  return useQuery({
    queryKey: ["reservas_hoy_espacio", espacioId],
    queryFn: async () => {
      if (!espacioId) return [];

      const today = new Date().toISOString().split("T")[0];

      const { data, error } = await supabase
        .from("reservas")
        .select(`
          *,
          espacios_reserva!reservas_sala_id_fkey (nombre)
        `)
        .eq("sala_id", espacioId)
        .eq("fecha", today)
        .neq("estado", "cancelada")
        .order("hora");

      if (error) throw error;
      return data;
    },
    enabled: !!espacioId,
  });
}
