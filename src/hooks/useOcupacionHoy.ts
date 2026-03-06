import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OcupacionEspacio {
  espacio_id?: string;
  espacio_nombre?: string;
  capacidad_maxima?: number;
  total_reservas: number;
  total_comensales: number;
  porcentaje_ocupacion?: number;
  comensales_confirmados?: number;
  reservas_canceladas?: number;
  reservas_confirmadas?: number;
  reservas_pendientes?: number;
}

interface EspacioCapacidad {
  capacidad_maxima: number;
  activa: boolean;
}

export function useOcupacionHoy() {
  return useQuery({
    queryKey: ["ocupacion_hoy"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vista_ocupacion_hoy")
        .select("*");

      if (error) throw error;
      return (data ?? []) as unknown as OcupacionEspacio[];
    },
    refetchInterval: 60000, // Refrescar cada minuto
  });
}

export function useResumenOcupacionHoy() {
  const ocupacionQuery = useOcupacionHoy();
  const espaciosQuery = useQuery({
    queryKey: ["espacios_capacidad_total"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("espacios_reserva" as any)
        .select("capacidad_maxima, activa");

      if (error) throw error;
      return (data ?? []) as EspacioCapacidad[];
    },
    refetchInterval: 60000,
  });

  const ocupacion = ocupacionQuery.data;
  const espacios = espaciosQuery.data ?? [];

  const totalReservas = ocupacion?.reduce((acc, e) => acc + (e.total_reservas || 0), 0) || 0;
  const totalComensales = ocupacion?.reduce((acc, e) => acc + (e.total_comensales || 0), 0) || 0;
  const capacidadDesdeVista = ocupacion?.reduce((acc, e) => acc + (e.capacidad_maxima || 0), 0) || 0;
  const capacidadConfigurada = espacios
    .filter((espacio) => espacio.activa !== false)
    .reduce((acc, espacio) => acc + (espacio.capacidad_maxima || 0), 0);
  const capacidadTotal = capacidadConfigurada > 0 ? capacidadConfigurada : capacidadDesdeVista;

  const resumen = ocupacion
    ? {
        totalReservas,
        totalComensales,
        capacidadTotal,
        // Cálculo global correcto: comensales totales / capacidad total.
        porcentajeTotal: capacidadTotal > 0 ? Math.round((totalComensales / capacidadTotal) * 100) : 0,
        espacios: ocupacion,
      }
    : null;

  return {
    data: resumen,
    isLoading: ocupacionQuery.isLoading || espaciosQuery.isLoading,
    error: ocupacionQuery.error || espaciosQuery.error,
    refetch: async () => {
      await Promise.all([ocupacionQuery.refetch(), espaciosQuery.refetch()]);
    },
  };
}

export function useReservasHoyPorEspacio() {
  return useQuery({
    queryKey: ["reservas_hoy_todas"],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];

      const { data, error } = await supabase
        .from("reservas")
        .select("*")
        .eq("fecha", today)
        .neq("estado", "cancelada")
        .order("hora");

      if (error) throw error;
      return data;
    },
  });
}
