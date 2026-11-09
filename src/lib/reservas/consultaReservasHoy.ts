// La consulta principal de «Reservas › Hoy» (09/11/2026): la usa `VistaHoy` y la precarga al abrir el panel
// (`precargaHoy.ts`), con la misma clave y la misma lectura. Módulo aparte y pequeño a propósito: `VistaHoy`
// no arrastra los hooks de la precarga.
import { supabase } from "@/integrations/supabase/client";
import { admiteReservas } from "@/lib/reservas/negocios";
import { COLUMNAS_RESERVAS_HOY } from "@/lib/reservas/vistaHoy";
import type { ReservaPlanoHoy } from "@/components/reservas/servicio/VistaPlanoHoy";

/**
 * Reservas de hoy de Casa Tomás (sin canceladas), la consulta principal de «Hoy» (`VistaHoy`). Clave
 * `["reservas-hoy", "pendientes-mesa", hoy]`: ver la explicación en `VistaHoy`.
 */
export const consultaReservasHoy = (hoy: string) => ({
  queryKey: ["reservas-hoy", "pendientes-mesa", hoy] as const,
  queryFn: async (): Promise<ReservaPlanoHoy[]> => {
    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `espacio_id` no está en los tipos generados.
      .from("reservas" as any)
      .select(COLUMNAS_RESERVAS_HOY)
      .eq("fecha", hoy)
      .neq("estado", "cancelada")
      .order("hora");
    if (error) throw error;
    // `ReservaPlanoHoy`: con `salida_at` si la columna existe (la vista Plano pinta las mesas con esta lista).
    return ((data ?? []) as unknown as ReservaPlanoHoy[]).filter((r) => admiteReservas(r.marca));
  },
});

