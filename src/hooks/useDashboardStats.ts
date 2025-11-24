import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

export function useDashboardStats(startDate: Date, endDate: Date) {
  return useQuery({
    queryKey: ["dashboard-stats", format(startDate, "yyyy-MM-dd"), format(endDate, "yyyy-MM-dd")],
    queryFn: async () => {
      const start = format(startDate, "yyyy-MM-dd");
      const end = format(endDate, "yyyy-MM-dd");

      // Fetch hours data
      const { data: horasData } = await supabase
        .from("registro_horas")
        .select("*, trabajadores(nombre, apellidos, puesto)")
        .gte("fecha", start)
        .lte("fecha", end);

      // Fetch reservations
      const { data: reservasData } = await supabase
        .from("reservas")
        .select("*, espacios_reserva(nombre, capacidad_maxima)")
        .gte("fecha", start)
        .lte("fecha", end);

      // Fetch turnos
      const { data: turnosData } = await supabase
        .from("turnos")
        .select("*, trabajadores(nombre, apellidos, puesto)")
        .gte("fecha", start)
        .lte("fecha", end);

      return {
        horas: horasData || [],
        reservas: reservasData || [],
        turnos: turnosData || [],
      };
    },
  });
}

export function useActiveStaff() {
  return useQuery({
    queryKey: ["active-staff"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      
      const { data } = await supabase
        .from("registro_horas")
        .select("*, trabajadores(nombre, apellidos, puesto), turnos(hora_inicio, hora_fin)")
        .eq("fecha", today)
        .is("hora_salida", null);

      return data || [];
    },
    refetchInterval: 60000, // Refresh every minute
  });
}

export function useTodayReservations() {
  return useQuery({
    queryKey: ["today-reservations"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      
      const { data } = await supabase
        .from("reservas")
        .select("*, espacios_reserva(nombre, capacidad_maxima)")
        .eq("fecha", today);

      return data || [];
    },
  });
}
