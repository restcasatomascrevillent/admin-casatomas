import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { resumirOcupacionPorNegocio } from "@/lib/reservas/resumenNegocios";
import { normalizarMarca } from "@/lib/reservas/negocios";

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
  /** `caracteristicas->>'marca'`. Ver "Aforo por negocio" en `useDisponibilidad.ts`. */
  caracteristicas?: { marca?: string | null } | null;
}

interface ReservaParaResumen {
  estado: string;
  numero_comensales: number;
  marca?: string | null;
}

/**
 * Resumen agregado (una sola fila) de las reservas de HOY, tal cual lo
 * devuelve `vista_ocupacion_hoy` — SIN filtrar por negocio: la vista agrega
 * sobre `reservas` sin `GROUP BY` ni columna `marca`/`espacio_id` (ver
 * `supabase/migrations/20260919130000_fix_vista_ocupacion_hoy_estados.sql`),
 * así que no hay forma de filtrarla por marca en el cliente. NO usar esto
 * para ningún número que se presente como "del restaurante": mezcla
 * casa_tomas y touza. Hoy (sesión 2026-09-23) no tiene consumidores propios
 * — `useResumenOcupacionHoy` calcula sus totales aparte, ver más abajo.
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
 * Resumen de las reservas de HOY: total del grupo + desglose por negocio
 * (Casa Tomás / Touza · El Reservado, decisión del dueño 2026-09-24).
 * ------------------------------------------------------------
 * No usa `vista_ocupacion_hoy` (no expone `marca`): lee `reservas` de hoy y
 * `espacios_reserva` y agrega en JS con `resumirOcupacionPorNegocio`
 * (src/lib/reservas/resumenNegocios.ts). La capacidad de cada negocio es la
 * suma de SUS espacios activos (mismo criterio que el trigger de aforo): el
 * aforo de El Reservado nunca se suma al del restaurante en el % de ocupación
 * de un negocio.
 *
 * `marca` opcional: si se pasa, solo ese negocio (las cifras de nivel
 * superior son las suyas); sin ella, los dos.
 */
export function useResumenOcupacionHoy(marca?: string | null) {
  const marcaFiltro = marca ? normalizarMarca(marca) : null;
  const espaciosQuery = useQuery({
    queryKey: ["espacios_capacidad_total"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("espacios_reserva" as any)
        .select("capacidad_maxima, activa, caracteristicas");

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
        .select("estado, numero_comensales, marca")
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
  const resumen = reservas
    ? (() => {
        const todo = resumirOcupacionPorNegocio(reservas, espacios);
        if (!marcaFiltro) return todo;
        const propio = todo.porNegocio.find((n) => n.negocio.marca === marcaFiltro);
        const { negocio: _negocio, ...cifras } = propio ?? { negocio: null, ...resumirOcupacionPorNegocio([], []) };
        return { ...cifras, porNegocio: propio ? [propio] : [] };
      })()
    : null;

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
 * Todas las reservas de HOY (sin cancelar), para el plano 2D por espacio.
 *
 * Filtradas por negocio (marca): el plano de un espacio solo debe ofrecer
 * como "pendientes de asignar" y sumar reservas de SU negocio. Quien lo usa
 * pasa la marca del espacio que se está mirando (El Reservado => 'touza');
 * por defecto Casa Tomás.
 *
 * El nombre es heredado: NO filtra por `espacio_id` (devuelve las de TODOS
 * los espacios del negocio, asignadas o no) — quien consume esto filtra
 * luego localmente. No se ha tocado ese comportamiento: es una pregunta
 * distinta a la de esta sesión (filtrar por marca).
 */
export function useReservasHoyPorEspacio(marcaEspacio?: string | null) {
  const marca = normalizarMarca(marcaEspacio);
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
