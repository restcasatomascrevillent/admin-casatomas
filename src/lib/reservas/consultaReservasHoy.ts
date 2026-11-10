// La consulta principal de «Reservas › Hoy» (09/11/2026): la usa `VistaHoy` y la precarga al abrir el panel
// (`precargaHoy.ts`), con la misma clave y la misma lectura. Módulo aparte y pequeño a propósito: `VistaHoy`
// no arrastra los hooks de la precarga.
import { supabase } from "@/integrations/supabase/client";
import { admiteReservas } from "@/lib/reservas/negocios";
import { COLUMNAS_RESERVAS_HOY, COLUMNAS_RESERVAS_HOY_CON_FUERA } from "@/lib/reservas/vistaHoy";
import { esErrorColumnasFueraInexistentes } from "@/lib/reservas/sentarFuera";
import type { ReservaPlanoHoy } from "@/components/reservas/servicio/VistaPlanoHoy";

/** null = aún no se sabe si existen las columnas de «Sentar fuera»; se descubre en la primera lectura. */
let columnasFueraDisponibles: boolean | null = null;
/** Solo para tests. */
export function __resetColumnasFueraParaTests() {
  columnasFueraDisponibles = null;
}

/**
 * Reservas de hoy de Casa Tomás (sin canceladas), la consulta principal de «Hoy» (`VistaHoy`). Clave
 * `["reservas-hoy", "pendientes-mesa", hoy]`: ver la explicación en `VistaHoy`.
 */
export const consultaReservasHoy = (hoy: string) => ({
  queryKey: ["reservas-hoy", "pendientes-mesa", hoy] as const,
  queryFn: async (): Promise<ReservaPlanoHoy[]> => {
    const leer = (columnas: string) =>
      supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `espacio_id` no está en los tipos generados.
        .from("reservas" as any)
        .select(columnas)
        .eq("fecha", hoy)
        .neq("estado", "cancelada")
        .order("hora");
    // Con las columnas de «Sentar fuera»; si la migración 20261122171500 aún no está, sin ellas (y se recuerda).
    let { data, error } = await leer(columnasFueraDisponibles === false ? COLUMNAS_RESERVAS_HOY : COLUMNAS_RESERVAS_HOY_CON_FUERA);
    if (error && columnasFueraDisponibles !== false && esErrorColumnasFueraInexistentes(error)) {
      columnasFueraDisponibles = false;
      ({ data, error } = await leer(COLUMNAS_RESERVAS_HOY));
    } else if (!error && columnasFueraDisponibles === null) {
      columnasFueraDisponibles = true;
    }
    if (error) throw error;
    // `ReservaPlanoHoy`: con `salida_at` si la columna existe (la vista Plano pinta las mesas con esta lista).
    return ((data ?? []) as unknown as ReservaPlanoHoy[]).filter((r) => admiteReservas(r.marca));
  },
});

