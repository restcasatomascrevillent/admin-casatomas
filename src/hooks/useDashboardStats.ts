import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { admiteReservas } from "@/lib/reservas/negocios";

/**
 * Negocio (marca) — las consultas de este fichero leen `reservas` sin
 * filtrar por `espacio_id`. Solo Casa Tomás admite reservas (decisión del
 * dueño, 2026-10-01: Touza no se reserva), así que las filas de otro negocio
 * que queden en la base de datos se descartan con `admiteReservas` antes de
 * llegar a ningún widget del dashboard: ni se enseñan ni se cuentan. (Antes el
 * dashboard era del grupo y desglosaba por negocio.)
 */
const soloQueAdmitenReservas = (filas: unknown): any[] =>
  ((filas ?? []) as any[]).filter((r) => admiteReservas(r?.marca));

export function useDashboardStats(startDate: Date, endDate: Date) {
  return useQuery({
    queryKey: ["dashboard-stats", format(startDate, "yyyy-MM-dd"), format(endDate, "yyyy-MM-dd")],
    queryFn: async () => {
      const start = format(startDate, "yyyy-MM-dd");
      const end = format(endDate, "yyyy-MM-dd");

      // Fetch reservations - solo confirmadas para métricas
      //
      // `as any` en `.from(...)`: `select("*")` con la cadena de filtros hacía
      // que TypeScript fallara con "Type instantiation is excessively deep" al
      // inferir el tipo del query builder de Supabase. Mismo recurso que ya usa
      // `useDisponibilidad.ts` para `reservas`/`espacios_reserva`.
      const { data: reservasData, error: reservasError } = await supabase
        .from("reservas" as any)
        .select("*")
        .gte("fecha", start)
        .lte("fecha", end)
        .eq("estado", "confirmada");

      if (reservasError) throw reservasError;

      // Nota (2026-09-23): este hook fetchaba también `registro_horas` y
      // `turnos` (con join a `trabajadores`) para alimentar el widget
      // "Personas Activas" del Dashboard y el desglose de horas trabajadas.
      // Con la sección Personal retirada, el único consumidor que queda
      // (`GraficoReservasPorDia.tsx`) solo lee `data.reservas`, así que esa
      // parte se ha eliminado. Ver docs/funcionalidades/10-retirada-seccion-personal.md.
      return {
        // `any[]`: `marca` no está en los tipos generados de Supabase para
        // `reservas`, y sin este cast final el resultado se queda tipado
        // como `SelectQueryError` y rompe a quien consuma `data.reservas`
        // (p. ej. `GraficoReservasPorDia.tsx`).
        reservas: soloQueAdmitenReservas(reservasData),
      };
    },
  });
}

// Hook para todas las reservas de hoy (para mostrar en widgets informativos)
export function useTodayReservations() {
  return useQuery({
    queryKey: ["today-reservations"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");

      // `as any` + cast final: ver la nota de `useDashboardStats` más arriba.
      const { data, error } = await supabase
        .from("reservas" as any)
        .select("*")
        .eq("fecha", today)
        .neq("estado", "cancelada");

      if (error) throw error;
      return soloQueAdmitenReservas(data);
    },
  });
}

// Hook para solo reservas confirmadas de hoy (para métricas de ocupación)
export function useTodayConfirmedReservations() {
  return useQuery({
    queryKey: ["today-confirmed-reservations"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");

      const { data, error } = await supabase
        .from("reservas" as any)
        .select("*")
        .eq("fecha", today)
        .eq("estado", "confirmada");

      if (error) throw error;
      return soloQueAdmitenReservas(data);
    },
  });
}
