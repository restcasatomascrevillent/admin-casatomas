import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { resumirOcupacion } from "@/lib/reservas/resumenOcupacion";
import { MARCA_POR_DEFECTO } from "@/lib/reservas/negocios";

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
  id?: string;
  nombre?: string;
  capacidad_maxima: number;
  activa: boolean;
  /** `caracteristicas->>'marca'`: solo cuentan las salas de Casa Tomás (`salaAdmiteReservas`). */
  caracteristicas?: { marca?: string | null } | null;
}

interface ReservaParaResumen {
  estado: string;
  numero_comensales: number;
  marca?: string | null;
  espacio_id?: string | null;
}

/**
 * Resumen agregado (una sola fila) de las reservas de HOY, tal cual lo
 * devuelve `vista_ocupacion_hoy` — SIN filtrar por negocio: la vista agrega
 * sobre `reservas` sin `GROUP BY` ni columna `marca`/`espacio_id` (ver
 * `supabase/migrations/20260919130000_fix_vista_ocupacion_hoy_estados.sql`),
 * así que no hay forma de filtrarla por marca en el cliente. NO usar esto
 * para ningún número que se presente como "del restaurante": cuenta también
 * las reservas que queden de otro negocio. Hoy (sesión 2026-09-23) no tiene
 * consumidores propios — `useResumenOcupacionHoy` calcula sus totales aparte,
 * ver más abajo.
 */
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

/**
 * Resumen de las reservas de HOY de Casa Tomás (la franja de cifras de la
 * pestaña «Hoy»).
 * ------------------------------------------------------------
 * No usa `vista_ocupacion_hoy` (no expone `marca`): lee `reservas` de hoy y
 * `espacios_reserva` y agrega en JS con `resumirOcupacion`
 * (src/lib/reservas/resumenOcupacion.ts). Touza no admite reservas (decisión
 * del dueño, 2026-10-01): sus reservas y salas se ignoran. La capacidad es la
 * suma de las salas activas de Casa Tomás (mismo criterio que el trigger).
 */
export function useResumenOcupacionHoy() {
  const espaciosQuery = useQuery({
    queryKey: ["espacios_capacidad_total"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("espacios_reserva" as any)
        .select("id, nombre, capacidad_maxima, activa, caracteristicas");

      if (error) throw error;
      return (data ?? []) as unknown as EspacioCapacidad[];
    },
    refetchInterval: 60000,
  });

  const reservasQuery = useQuery({
    queryKey: ["reservas_hoy_resumen"],
    queryFn: async () => {
      // Fecha LOCAL: `toISOString()` devuelve la fecha UTC y en Madrid (UTC+1/+2)
      // desplazaba el día en el tramo final del servicio.
      const today = format(new Date(), "yyyy-MM-dd");

      const { data, error } = await supabase
        .from("reservas" as any)
        .select("estado, numero_comensales, marca, espacio_id")
        .eq("fecha", today);

      if (error) throw error;
      return (data ?? []) as unknown as ReservaParaResumen[];
    },
    refetchInterval: 60000,
  });

  const reservas = reservasQuery.data;
  const espacios = espaciosQuery.data ?? [];

  // Mismo criterio que antes: pendiente, verificada, confirmada y
  // 'completada' (ya sentados, ver src/lib/reservas/servicioSala.ts) cuentan;
  // canceladas y no_show no. El trigger de aforo NO cuenta 'completada' y así
  // se queda (decisión del dueño 2026-09-23: todo se reserva con antelación y
  // el día se bloquea la víspera, así que no se revende el hueco).
  const resumen = reservas ? resumirOcupacion(reservas, espacios) : null;

  return {
    data: resumen,
    isLoading: reservasQuery.isLoading || espaciosQuery.isLoading,
    isError: reservasQuery.isError || espaciosQuery.isError,
    error: reservasQuery.error || espaciosQuery.error,
    refetch: async () => {
      await Promise.all([reservasQuery.refetch(), espaciosQuery.refetch()]);
    },
  };
}

/**
 * Todas las reservas de HOY (sin cancelar) de Casa Tomás, para el plano 2D.
 * Touza no admite reservas (decisión del dueño, 2026-10-01): solo la marca de
 * Casa Tomás (antes se pasaba la marca de la sala que se miraba).
 *
 * El nombre es heredado: NO filtra por `espacio_id` (devuelve las de TODOS
 * los espacios, asignadas o no) — quien consume esto filtra luego
 * localmente. Hoy no tiene consumidores (el plano usa `useReservasDeSala`).
 */
export function useReservasHoyPorEspacio() {
  const marca = MARCA_POR_DEFECTO;
  return useQuery({
    queryKey: ["reservas_hoy_todas", marca],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");

      // `as any` + cast final: `.eq("marca", marca)` sobre `select("*")`
      // hace que TypeScript falle con "Type instantiation is excessively
      // deep" al inferir el tipo del query builder de Supabase (`marca` no
      // está en los tipos generados para `reservas`). Mismo recurso que ya
      // usa `useDisponibilidad.ts` y `useDashboardStats.ts`.
      const { data, error } = await supabase
        .from("reservas" as any)
        .select("*")
        .eq("fecha", today)
        .neq("estado", "cancelada")
        .eq("marca", marca)
        .order("hora");

      if (error) throw error;
      return data as any[];
    },
  });
}
