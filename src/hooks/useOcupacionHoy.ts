import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

export interface OcupacionEspacio {
  espacio_id?: string;
  espacio_nombre?: string;
  capacidad_maxima?: number;
  /** Todas las reservas del dia, canceladas incluidas. */
  total_reservas: number;
  /** Todos los comensales del dia, canceladas incluidas. */
  total_comensales: number;
  porcentaje_ocupacion?: number;
  comensales_confirmados?: number;
  reservas_canceladas?: number;
  reservas_confirmadas?: number;
  reservas_pendientes?: number;
  reservas_verificadas?: number;
  reservas_completadas?: number;
  reservas_no_show?: number;
  /** Reservas que ocupan plaza: pendiente + verificada + confirmada. */
  reservas_activas?: number;
  /** Comensales que ocupan plaza: pendiente + verificada + confirmada. */
  comensales_activos?: number;
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
      return (data ?? []) as unknown as EspacioCapacidad[];
    },
    refetchInterval: 60000,
  });

  const ocupacion = ocupacionQuery.data;
  const espacios = espaciosQuery.data ?? [];

  // `reservas_activas` / `comensales_activos` excluyen canceladas y no_show, con el mismo
  // criterio que el trigger `trg_validar_capacidad`. Antes se usaban `total_*`, que
  // incluyen las canceladas: el panel prometia mas comensales de los que iban a venir.
  const totalReservas = ocupacion?.reduce((acc, e) => acc + (e.reservas_activas ?? e.total_reservas ?? 0), 0) || 0;
  const totalComensales = ocupacion?.reduce((acc, e) => acc + (e.comensales_activos ?? e.total_comensales ?? 0), 0) || 0;
  const reservasTodasEstados = ocupacion?.reduce((acc, e) => acc + (e.total_reservas || 0), 0) || 0;
  const reservasCanceladas = ocupacion?.reduce((acc, e) => acc + (e.reservas_canceladas || 0), 0) || 0;
  const reservasConfirmadas = ocupacion?.reduce((acc, e) => acc + (e.reservas_confirmadas || 0), 0) || 0;
  const reservasPendientes = ocupacion?.reduce((acc, e) => acc + (e.reservas_pendientes || 0), 0) || 0;
  const capacidadDesdeVista = ocupacion?.reduce((acc, e) => acc + (e.capacidad_maxima || 0), 0) || 0;
  const capacidadConfigurada = espacios
    .filter((espacio) => espacio.activa !== false)
    .reduce((acc, espacio) => acc + (espacio.capacidad_maxima || 0), 0);
  const capacidadTotal = capacidadConfigurada > 0 ? capacidadConfigurada : capacidadDesdeVista;

  const resumen = ocupacion
    ? {
        totalReservas,
        totalComensales,
        reservasTodasEstados,
        reservasCanceladas,
        reservasConfirmadas,
        reservasPendientes,
        capacidadTotal,
        // Ocupación global del día: comensales que ocupan plaza / capacidad total.
        porcentajeTotal: capacidadTotal > 0 ? Math.round((totalComensales / capacidadTotal) * 100) : 0,
        espacios: ocupacion,
      }
    : null;

  return {
    data: resumen,
    isLoading: ocupacionQuery.isLoading || espaciosQuery.isLoading,
    isError: ocupacionQuery.isError || espaciosQuery.isError,
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
      // Fecha LOCAL: `toISOString()` devuelve la fecha UTC y en Madrid (UTC+1/+2)
      // desplazaba el día en el tramo final del servicio.
      const today = format(new Date(), "yyyy-MM-dd");

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
