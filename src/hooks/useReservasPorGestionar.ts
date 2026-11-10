import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hoyMadrid } from "@/lib/cheques/caducidad";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { useReservasEnVivo } from "@/hooks/useReservasEnVivo";
import {
  construirItemsPorGestionar,
  ESTADOS_RESERVA_POR_GESTIONAR,
  type ItemPorGestionar,
  type ReservaPorGestionarFila,
  type SolicitudPorGestionarFila,
} from "@/lib/reservas/porGestionar";
import { ESTADOS_SOLICITUD_ABIERTA } from "@/lib/reservas/vistaUnificada";

/** Clave de la consulta. `useReservasEnVivo` la invalida con cada cambio de `reservas`. */
export const CLAVE_RESERVAS_POR_GESTIONAR = "reservas-por-gestionar";

const MAXIMO = 50;

/**
 * Lo que el equipo tiene que gestionar: reservas `pendiente`/`verificada` de hoy en adelante y
 * solicitudes del bot sin resolver. `habilitado=false` (sin permiso de Reservas) no pide nada ni
 * abre canales. Se mantiene al día con realtime (`useReservasEnVivo`) y el refresco periódico.
 * Las solicitudes no tienen canal propio aquí: las pone al día el refresco periódico y el foco.
 */
export function useReservasPorGestionar(habilitado: boolean) {
  useReservasEnVivo({ activo: habilitado });

  const consulta = useQuery({
    queryKey: [CLAVE_RESERVAS_POR_GESTIONAR],
    enabled: habilitado,
    ...REFRESCO_PERIODICO,
    queryFn: async (): Promise<ItemPorGestionar[]> => {
      const hoy = hoyMadrid();
      const [reservas, solicitudes] = await Promise.all([
        supabase
          .from("reservas")
          .select("id, nombre, fecha, hora, numero_comensales, estado, marca")
          .in("estado", [...ESTADOS_RESERVA_POR_GESTIONAR])
          .gte("fecha", hoy)
          .order("fecha", { ascending: true })
          .order("hora", { ascending: true })
          .limit(MAXIMO),
        supabase
          .from("solicitudes_pendientes")
          .select("id, nombre, fecha_solicitada, hora_solicitada, numero_comensales, motivo_rechazo, estado, marca")
          .in("estado", [...ESTADOS_SOLICITUD_ABIERTA])
          .order("created_at", { ascending: false })
          .limit(MAXIMO),
      ]);
      if (reservas.error) throw reservas.error;
      if (solicitudes.error) throw solicitudes.error;
      return construirItemsPorGestionar(
        (reservas.data ?? []) as unknown as ReservaPorGestionarFila[],
        (solicitudes.data ?? []) as unknown as SolicitudPorGestionarFila[],
        hoy,
      );
    },
  });

  const items = consulta.data ?? [];
  return { items, count: habilitado ? items.length : 0, loading: habilitado && consulta.isLoading };
}
