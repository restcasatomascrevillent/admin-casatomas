import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

/**
 * Negocio (marca) — las consultas de este fichero leen `reservas` sin
 * filtrar por `espacio_id`. Decisión del dueño 2026-09-24: el dashboard es
 * del GRUPO (Casa Tomás + Touza · El Reservado), así que por defecto
 * (`marca` null/undefined) cuentan los dos negocios; cada fila trae su
 * `marca` para que el widget desglose por negocio. Pasar una marca filtra a
 * ese negocio. El aforo (%) nunca se calcula sobre la suma de los dos: ver
 * `ReservasHoy.tsx` y `src/lib/reservas/resumenNegocios.ts`.
 */
export function useDashboardStats(startDate: Date, endDate: Date, marca?: string | null) {
  return useQuery({
    queryKey: ["dashboard-stats", format(startDate, "yyyy-MM-dd"), format(endDate, "yyyy-MM-dd"), marca ?? "all"],
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
      let consulta = supabase
        .from("reservas" as any)
        .select("*")
        .gte("fecha", start)
        .lte("fecha", end)
        .eq("estado", "confirmada");
      if (marca) consulta = consulta.eq("marca", marca);
      const { data: reservasData, error: reservasError } = await consulta;

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
export function useTodayReservations(marca?: string | null) {
  return useQuery({
    queryKey: ["today-reservations", marca ?? "all"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");

      // `as any` + cast final: ver la nota de `useDashboardStats` más arriba
      // (mismo "Type instantiation is excessively deep" al añadir
      // `.eq("marca", marca)` sobre `select("*")`).
      let consulta = supabase
        .from("reservas" as any)
        .select("*")
        .eq("fecha", today)
        .neq("estado", "cancelada");
      if (marca) consulta = consulta.eq("marca", marca);
      const { data, error } = await consulta;

      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

// Hook para solo reservas confirmadas de hoy (para métricas de ocupación)
export function useTodayConfirmedReservations(marca?: string | null) {
  return useQuery({
    queryKey: ["today-confirmed-reservations", marca ?? "all"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");

      let consulta = supabase
        .from("reservas" as any)
        .select("*")
        .eq("fecha", today)
        .eq("estado", "confirmada");
      if (marca) consulta = consulta.eq("marca", marca);
      const { data, error } = await consulta;

      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
