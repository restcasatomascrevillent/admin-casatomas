import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { sumarCapacidadPorMarca, MARCA_POR_DEFECTO } from "./useDisponibilidad";

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
 * Aforo por negocio (marca) — bug de 2026-09-22, ver la nota "Aforo por
 * negocio" en `useDisponibilidad.ts`.
 * ------------------------------------------------------------
 * Antes este hook sacaba `totalReservas`/`totalComensales`/etc. de
 * `vista_ocupacion_hoy`, sumando (via `useOcupacionHoy`) sobre su única
 * fila sin filtrar por marca — la vista agrega TODAS las reservas de hoy,
 * de los dos negocios, en un solo total. La capacidad tampoco se filtraba:
 * sumaba `capacidad_maxima` de TODOS los espacios activos. Con "El
 * Reservado" (touza, 20 plazas) dado de alta, la pestaña "Hoy" de Reservas
 * mostraba "Capacidad Total: 170" y una "Ocupación del día" calculada sobre
 * comensales que podían incluir reservas de touza.
 *
 * La vista no se puede filtrar por marca desde aquí (no expone `espacio_id`
 * ni `marca` por fila, y está definida en `supabase/**`, fuera del
 * territorio de esta sesión), así que este hook deja de depender de ella:
 * lee `reservas` de hoy filtradas por `marca` directamente (mismo criterio
 * que `leerDatosDelDia` en `useDisponibilidad.ts`) y agrega en JS. La
 * capacidad reutiliza `sumarCapacidadPorMarca` del motor compartido.
 *
 * Por defecto `MARCA_POR_DEFECTO` (casa_tomas): es lo único que necesita
 * HOY el panel — sus pantallas de reservas son del restaurante.
 */
export function useResumenOcupacionHoy(marca: string = MARCA_POR_DEFECTO) {
  const espaciosQuery = useQuery({
    queryKey: ["espacios_capacidad_total", marca],
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
    queryKey: ["reservas_hoy_resumen", marca],
    queryFn: async () => {
      // Fecha LOCAL: `toISOString()` devuelve la fecha UTC y en Madrid (UTC+1/+2)
      // desplazaba el día en el tramo final del servicio.
      const today = format(new Date(), "yyyy-MM-dd");

      const { data, error } = await supabase
        .from("reservas" as any)
        .select("estado, numero_comensales")
        .eq("fecha", today)
        .eq("marca", marca);

      if (error) throw error;
      return (data ?? []) as unknown as ReservaParaResumen[];
    },
    refetchInterval: 60000,
  });

  const reservas = reservasQuery.data;
  const espacios = espaciosQuery.data ?? [];

  // Mismo criterio que el trigger `trg_validar_capacidad`: pendiente,
  // verificada y confirmada ocupan plaza; canceladas y no_show no cuentan
  // como "van a venir" (antes se usaban los totales SIN filtrar por estado,
  // y el panel prometía más comensales de los que iban a venir).
  const activas = (reservas ?? []).filter((r) =>
    ["pendiente", "verificada", "confirmada"].includes(r.estado),
  );
  const totalReservas = activas.length;
  const totalComensales = activas.reduce((acc, r) => acc + (Number(r.numero_comensales) || 0), 0);
  const reservasTodasEstados = reservas?.length ?? 0;
  const reservasCanceladas = (reservas ?? []).filter((r) => r.estado === "cancelada").length;
  const reservasConfirmadas = (reservas ?? []).filter((r) => r.estado === "confirmada").length;
  const reservasPendientes = (reservas ?? []).filter((r) => r.estado === "pendiente").length;

  const capacidadTotal = sumarCapacidadPorMarca(
    espacios
      .filter((espacio) => espacio.activa !== false)
      .map((espacio) => ({
        capacidad_maxima: Number(espacio.capacidad_maxima) || 0,
        marca: espacio.caracteristicas?.marca ?? null,
      })),
    marca,
  );

  const resumen = reservas
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
      }
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
 * Aforo por negocio (marca) — bug de 2026-09-22, ver `useDisponibilidad.ts`.
 * Antes no filtraba por marca: el plano de un espacio del restaurante (p.
 * ej. Comedor) podía ofrecer como "pendientes de asignar" o sumar en "Total
 * Comensales" reservas de otro negocio (touza). Por defecto
 * `MARCA_POR_DEFECTO`, igual que el resto del panel.
 *
 * El nombre es heredado: NO filtra por `espacio_id` (devuelve las de TODOS
 * los espacios del negocio, asignadas o no) — quien consume esto filtra
 * luego localmente. No se ha tocado ese comportamiento: es una pregunta
 * distinta a la de esta sesión (filtrar por marca).
 */
export function useReservasHoyPorEspacio(marca: string = MARCA_POR_DEFECTO) {
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
