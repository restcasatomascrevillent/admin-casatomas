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

      // Nota (2026-09-23): este hook fetchaba también `registro_horas` y
      // `turnos` (con join a `trabajadores`) para alimentar el widget
      // "Personas Activas" del Dashboard y el desglose de horas trabajadas.
      // Con la sección Personal retirada, el único consumidor que queda
      // (`GraficoReservasPorDia.tsx`) solo lee `data.reservas`, así que esa
      // parte se ha eliminado. Ver docs/funcionalidades/10-retirada-seccion-personal.md.
      return {
        // `as any[]`: mismo motivo que el `as any` de `.from(...)` de arriba
        // — `marca` no está en los tipos generados de Supabase para
        // `reservas`, y sin este cast final el resultado se queda tipado
        // como `SelectQueryError` y rompe a quien consuma `data.reservas`
        // (p. ej. `GraficoReservasPorDia.tsx`).
        reservas: (reservasData || []) as any[],
      };
    },
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
