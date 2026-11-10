// ============================================================================
// CIERRES DE RESERVAS en el panel (encargo del dueño, 2026-10-13)
// ----------------------------------------------------------------------------
// Lunes (todo el día) y domingo noche no se cogen reservas por la web
// ni por teléfono (los jueves cerraban hasta el 2026-11-10: ya abren); desde el
// calendario se cierra/abre un día o un servicio.
// La regla es la RPC `servicios_cerrados_reserva` (migración
// 20261013120000_cierres_reserva.sql), la misma que usan reservas-web y el bot.
// La lógica pura está en `supabase/functions/_shared/cierres.ts`.
//
// Mientras la migración no esté aplicada: se enseña la regla por defecto y
// guardar un cambio falla con un aviso claro (`esquemaPendiente`).
// ============================================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { esErrorEsquemaPendiente } from "@/lib/reservas/propuestaCliente";
import {
  cambioCierre,
  cierreSemanalDesde,
  normalizarServiciosCerrados,
  serviciosCerradosPorSemana,
  type ServicioCerrado,
  type TurnoServicio,
} from "../../supabase/functions/_shared/cierres";
import { useConfiguracionReservas } from "./useConfiguracionReservas";

export const CLAVE_CIERRES = "cierres_reserva";

export interface CierresRango {
  cierres: ServicioCerrado[];
  /** `true` = la RPC no existe aún: se enseña la regla por defecto y no se puede guardar. */
  esquemaPendiente: boolean;
}

// La tabla y la RPC aún no están en los tipos generados (`types.ts`).
type ErrorPg = { code?: string | null; message?: string | null } | null;
type ClienteSinTipos = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: ErrorPg }>;
  from: (tabla: string) => {
    delete: () => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ error: ErrorPg }> } };
    upsert: (fila: Record<string, unknown>, opciones: { onConflict: string }) => Promise<{ error: ErrorPg }>;
  };
};
const cliente = supabase as unknown as ClienteSinTipos;

export async function leerCierres(desde: string, hasta: string): Promise<CierresRango> {
  const { data, error } = await cliente.rpc("servicios_cerrados_reserva", {
    p_desde: desde,
    p_hasta: hasta,
  });
  if (error) {
    if (esErrorEsquemaPendiente(error)) {
      return { cierres: serviciosCerradosPorSemana(desde, hasta), esquemaPendiente: true };
    }
    throw error;
  }
  return { cierres: normalizarServiciosCerrados(data), esquemaPendiente: false };
}

/** Servicios cerrados entre dos fechas (YYYY-MM-DD). */
export function useCierresReserva(desde: string | null, hasta: string | null) {
  return useQuery({
    queryKey: [CLAVE_CIERRES, desde, hasta],
    enabled: !!desde && !!hasta,
    staleTime: 60_000,
    queryFn: () => leerCierres(desde as string, hasta as string),
  });
}

/**
 * Deja un servicio cerrado o abierto ese día. Si coincide con la regla
 * semanal, borra la excepción; si no, la guarda (`abierto` true/false).
 */
export function useCambiarCierre() {
  const queryClient = useQueryClient();
  const { data: configuracion } = useConfiguracionReservas();
  return useMutation({
    mutationFn: async ({
      fecha,
      turnos,
      cerrar,
      motivo,
    }: {
      fecha: string;
      turnos: readonly TurnoServicio[];
      cerrar: boolean;
      motivo?: string | null;
    }) => {
      const semanal = cierreSemanalDesde(configuracion);
      for (const turno of turnos) {
        const cambio = cambioCierre(fecha, turno, cerrar, semanal);
        const tabla = cliente.from("cierres_reserva");
        const { error } =
          cambio.tipo === "borrar"
            ? await tabla.delete().eq("fecha", fecha).eq("turno", turno)
            : await tabla.upsert(
                { fecha, turno, abierto: cambio.abierto, motivo: motivo?.trim() || null },
                { onConflict: "fecha,turno" },
              );
        if (error) {
          if (esErrorEsquemaPendiente(error) || /cierres_reserva/.test(error.message ?? "")) {
            throw new Error(
              "Falta aplicar la migración de cierres (20261013120000_cierres_reserva.sql). Hasta entonces rigen los cierres por defecto.",
            );
          }
          throw error;
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [CLAVE_CIERRES] });
    },
  });
}
