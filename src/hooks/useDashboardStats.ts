import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { MARCA_POR_DEFECTO } from "./useDisponibilidad";

/**
 * Aforo por negocio (marca) — bug de 2026-09-22, ver `useDisponibilidad.ts`.
 * ------------------------------------------------------------
 * Las consultas de este fichero leen `reservas` sin filtrar por
 * `espacio_id`, así que si no se filtra por `marca` cuentan también las
 * reservas de otros negocios (hoy, "El Reservado"/touza) en widgets que se
 * presentan como del restaurante. Por defecto `MARCA_POR_DEFECTO`
 * (casa_tomas): es lo único que necesita HOY el panel, igual que
 * `useDisponibilidad.ts`.
 */
export function useDashboardStats(startDate: Date, endDate: Date, marca: string = MARCA_POR_DEFECTO) {
  return useQuery({
    queryKey: ["dashboard-stats", format(startDate, "yyyy-MM-dd"), format(endDate, "yyyy-MM-dd"), marca],
    queryFn: async () => {
      const start = format(startDate, "yyyy-MM-dd");
      const end = format(endDate, "yyyy-MM-dd");

      // Fetch hours data
      const { data: horasData, error: horasError } = await supabase
        .from("registro_horas")
        .select("*, trabajadores(nombre, apellidos, puesto)")
        .gte("fecha", start)
        .lte("fecha", end);

      if (horasError) throw horasError;

      // Fetch reservations - solo confirmadas para métricas
      //
      // `as any` en `.from(...)`: el filtro `.eq("marca", marca)` añadido
      // junto con `select("*")` y la cadena de filtros hacía que TypeScript
      // fallara con "Type instantiation is excessively deep" al inferir el
      // tipo del query builder de Supabase. Mismo recurso que ya usa
      // `useDisponibilidad.ts` para `reservas`/`espacios_reserva`.
      const { data: reservasData, error: reservasError } = await supabase
        .from("reservas" as any)
        .select("*")
        .gte("fecha", start)
        .lte("fecha", end)
        .eq("estado", "confirmada")
        .eq("marca", marca);

      if (reservasError) throw reservasError;

      // Fetch turnos with worker info
      const { data: turnosData, error: turnosError } = await supabase
        .from("turnos")
        .select("*, trabajadores(nombre, apellidos, puesto)")
        .gte("fecha", start)
        .lte("fecha", end);

      if (turnosError) throw turnosError;

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
        // `as any[]`: mismo motivo que el `as any` de `.from(...)` de arriba
        // — `marca` no está en los tipos generados de Supabase para
        // `reservas`, y sin este cast final el resultado se queda tipado
        // como `SelectQueryError` y rompe a quien consuma `data.reservas`
        // (p. ej. `GraficoReservasPorDia.tsx`).
        reservas: (reservasData || []) as any[],
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
      const { data: registroData, error: registroError } = await supabase
        .from("registro_horas")
        .select("*, trabajadores(nombre, apellidos, puesto), turnos(hora_inicio, hora_fin)")
        .eq("fecha", today)
        .is("hora_salida", null);

      if (registroError) throw registroError;

      if (registroData && registroData.length > 0) {
        return registroData;
      }

      // Fallback to turnos - get today's scheduled shifts
      const { data: turnosData, error: turnosError } = await supabase
        .from("turnos")
        .select("*, trabajadores(nombre, apellidos, puesto)")
        .eq("fecha", today)
        .lte("hora_inicio", currentTime)
        .gte("hora_fin", currentTime);

      if (turnosError) throw turnosError;

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

// Hook para todas las reservas de hoy (para mostrar en widgets informativos)
export function useTodayReservations(marca: string = MARCA_POR_DEFECTO) {
  return useQuery({
    queryKey: ["today-reservations", marca],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");

      // `as any` + cast final: ver la nota de `useDashboardStats` más arriba
      // (mismo "Type instantiation is excessively deep" al añadir
      // `.eq("marca", marca)` sobre `select("*")`).
      const { data, error } = await supabase
        .from("reservas" as any)
        .select("*")
        .eq("fecha", today)
        .neq("estado", "cancelada")
        .eq("marca", marca);

      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

// Hook para solo reservas confirmadas de hoy (para métricas de ocupación)
export function useTodayConfirmedReservations(marca: string = MARCA_POR_DEFECTO) {
  return useQuery({
    queryKey: ["today-confirmed-reservations", marca],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");

      const { data, error } = await supabase
        .from("reservas" as any)
        .select("*")
        .eq("fecha", today)
        .eq("estado", "confirmada")
        .eq("marca", marca);

      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
