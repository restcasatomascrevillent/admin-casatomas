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

      // Fetch turnos with worker info
      const { data: turnosData } = await supabase
        .from("turnos")
        .select("*, trabajadores(nombre, apellidos, puesto)")
        .gte("fecha", start)
        .lte("fecha", end);

      // Calculate hours from turnos if registro_horas is empty
      const horasFromTurnos = (turnosData || []).map((turno: any) => {
        const [horaInicioH, horaInicioM] = turno.hora_inicio.split(':').map(Number);
        const [horaFinH, horaFinM] = turno.hora_fin.split(':').map(Number);
        const horasTrabajadas = (horaFinH + horaFinM / 60) - (horaInicioH + horaInicioM / 60);
        
        return {
          id: turno.id,
          trabajador_id: turno.trabajador_id,
          fecha: turno.fecha,
          hora_entrada: turno.hora_inicio,
          hora_salida: turno.hora_fin,
          horas_trabajadas: horasTrabajadas > 0 ? horasTrabajadas : horasTrabajadas + 24,
          trabajadores: turno.trabajadores,
        };
      });

      return {
        horas: horasData && horasData.length > 0 ? horasData : horasFromTurnos,
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
      const now = new Date();
      const currentTime = format(now, "HH:mm:ss");
      
      // First try registro_horas for actual clocked-in staff
      const { data: registroData } = await supabase
        .from("registro_horas")
        .select("*, trabajadores(nombre, apellidos, puesto), turnos(hora_inicio, hora_fin)")
        .eq("fecha", today)
        .is("hora_salida", null);

      if (registroData && registroData.length > 0) {
        return registroData;
      }

      // Fallback to turnos - get today's scheduled shifts
      const { data: turnosData } = await supabase
        .from("turnos")
        .select("*, trabajadores(nombre, apellidos, puesto)")
        .eq("fecha", today)
        .lte("hora_inicio", currentTime)
        .gte("hora_fin", currentTime);

      // Transform turnos to match expected format
      return (turnosData || []).map((turno: any) => ({
        id: turno.id,
        trabajador_id: turno.trabajador_id,
        fecha: turno.fecha,
        hora_entrada: turno.hora_inicio,
        hora_salida: null,
        trabajadores: turno.trabajadores,
        turnos: {
          hora_inicio: turno.hora_inicio,
          hora_fin: turno.hora_fin,
        },
      }));
    },
    refetchInterval: 60000,
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
        .eq("fecha", today)
        .neq("estado", "cancelada");

      return data || [];
    },
  });
}
