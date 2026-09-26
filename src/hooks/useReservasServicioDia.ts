import { useEffect, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CLAVE_ASIGNACIONES_MESA } from "@/hooks/useAsignacionesMesa";
import type { ReservaMesaServicio } from "@/lib/reservas/servicioSala";

// ============================================================================
// RESERVAS DE UN DÍA PARA EL MODO SERVICIO
// ----------------------------------------------------------------------------
// Trae justo los campos que `servicioSala.ts` necesita para calcular el
// estado de cada mesa — en particular `llegada_at` y `salida_at`, que
// `useAsignacionesMesa` / `useOcupacionSalasDia` NO piden porque no los
// necesitan. Ninguna de las dos columnas está garantizada todavía
// (20260923180000_reservas_llegada.sql y
// 20260926150000_modo_servicio_config_y_salida.sql, ambas sin aplicar a
// 2026-09-26): se piden con `as any` y, si el SELECT fallase por columna
// inexistente, aquí se prefiere no reintentar recortando el select (a
// diferencia de useAccionesServicioReserva con el UPDATE) — el modo servicio
// sin esas dos columnas no puede calcular nada útil, así que el error se deja
// subir y lo enseña React Query como error de carga.
//
// REALTIME: dos suscripciones, mismo patrón que `useOcupacionSalasDia`
// (nombre de canal único por instancia con `useId`, para que dos pantallas
// montadas a la vez no se pisen el canal y el desmontaje de una no cierre la
// de la otra):
//   · `reservas` filtradas por `fecha` — llegada, liberación, cambios de
//     estado o de sala en cualquier reserva del día.
//   · `asignaciones_mesa`, sin filtro de servidor (Realtime de Supabase no
//     deja filtrar por una columna de otra tabla): mover una reserva de mesa
//     desde este mismo componente ya invalida por la mutación, así que esta
//     suscripción cubre sobre todo cambios hechos por OTRA pestaña/persona.
// ============================================================================

export const CLAVE_RESERVAS_SERVICIO_DIA = "reservas-servicio-dia";

export function useReservasServicioDia(fecha: string | null | undefined, espacioId?: string | null) {
  const queryClient = useQueryClient();
  const idCanal = useId();

  const query = useQuery({
    queryKey: [CLAVE_RESERVAS_SERVICIO_DIA, fecha, espacioId ?? null],
    enabled: !!fecha,
    queryFn: async (): Promise<ReservaMesaServicio[]> => {
      let q = (supabase.from("reservas" as any) as any)
        .select(
          "id, nombre, hora, numero_comensales, estado, espacio_id, telefono, email, importante, llegada_at, salida_at",
        )
        .eq("fecha", fecha);
      if (espacioId) q = q.eq("espacio_id", espacioId);

      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id as string,
        nombre: (r.nombre as string | null) ?? null,
        hora: String(r.hora),
        numero_comensales: Number(r.numero_comensales) || 0,
        estado: r.estado as string,
        espacio_id: (r.espacio_id as string | null) ?? null,
        telefono: (r.telefono as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        importante: (r.importante as boolean | null) ?? null,
        llegada_at: (r.llegada_at as string | null) ?? null,
        salida_at: (r.salida_at as string | null) ?? null,
      }));
    },
  });

  useEffect(() => {
    if (!fecha) return;
    const canal = supabase
      .channel(`servicio-sala-reservas-${fecha}-${idCanal}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservas", filter: `fecha=eq.${fecha}` },
        () => {
          queryClient.invalidateQueries({ queryKey: [CLAVE_RESERVAS_SERVICIO_DIA, fecha] });
        },
      )
      .subscribe();
    const canalAsignaciones = supabase
      .channel(`servicio-sala-asignaciones-${fecha}-${idCanal}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "asignaciones_mesa" }, () => {
        queryClient.invalidateQueries({ queryKey: [CLAVE_ASIGNACIONES_MESA] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
      supabase.removeChannel(canalAsignaciones);
    };
  }, [fecha, idCanal, queryClient]);

  return query;
}
