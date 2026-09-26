import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { esErrorEsquemaPendiente } from "@/lib/reservas/propuestaCliente";

/** Las tres columnas de modo servicio (Fase 4): pueden no existir aún. */
const CAMPOS_MODO_SERVICIO = ["estancia_comida_minutos", "estancia_cena_minutos", "retraso_gracia_minutos"] as const;

export interface ConfiguracionReservas {
  id: string;
  minutos_corte_antes_servicio: number;
  max_reservas_por_telefono_dia: number;
  max_reservas_por_email_dia: number;
  max_comensales_por_reserva: number;
  min_comensales_por_reserva: number;
  dias_max_antelacion: number;
  telefono_obligatorio: boolean;
  email_obligatorio: boolean;
  auto_confirmar: boolean;
  /**
   * Minutos de estancia estimada por turno, usados por el modo servicio para
   * marcar una mesa ocupada como "por liberar". Columnas nuevas
   * (20260926150000_modo_servicio_config_y_salida.sql, sin aplicar todavía):
   * opcionales para que leer una fila vieja (o la migración aún sin aplicar)
   * no rompa nada — `useConfiguracionServicioSala` es quien aplica el default
   * si vienen `null`/`undefined`.
   */
  estancia_comida_minutos?: number | null;
  estancia_cena_minutos?: number | null;
  /** Minutos de margen tras la hora de la reserva antes de marcarla "retrasada". */
  retraso_gracia_minutos?: number | null;
  created_at: string;
  updated_at: string;
}

const DEFAULTS: Omit<ConfiguracionReservas, "id" | "created_at" | "updated_at"> = {
  minutos_corte_antes_servicio: 60,
  max_reservas_por_telefono_dia: 2,
  max_reservas_por_email_dia: 2,
  max_comensales_por_reserva: 12,
  min_comensales_por_reserva: 1,
  dias_max_antelacion: 60,
  telefono_obligatorio: true,
  email_obligatorio: false,
  auto_confirmar: false,
  estancia_comida_minutos: 105,
  estancia_cena_minutos: 120,
  retraso_gracia_minutos: 15,
};

export function useConfiguracionReservas() {
  return useQuery({
    queryKey: ["configuracion-reservas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("configuracion_reservas" as any)
        .select("*")
        .limit(1)
        .single();

      if (error) {
        // If no row exists, return defaults
        if (error.code === "PGRST116") {
          return DEFAULTS as ConfiguracionReservas;
        }
        throw error;
      }
      return data as unknown as ConfiguracionReservas;
    },
  });
}

export function useActualizarConfiguracionReservas() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Partial<Omit<ConfiguracionReservas, "id" | "created_at" | "updated_at">>) => {
      // Get the existing config id first
      const { data: existing } = await supabase
        .from("configuracion_reservas" as any)
        .select("id")
        .limit(1)
        .single();

      if (!existing) throw new Error("No se encontró la configuración");

      let { data, error } = await supabase
        .from("configuracion_reservas" as any)
        .update(updates)
        .eq("id", (existing as any).id)
        .select()
        .single();

      // Si la migración de modo servicio (20260926150000) todavía no está
      // aplicada, esas tres columnas no existen y el UPDATE entero falla
      // (PostgREST rechaza el body con una columna desconocida) — aunque el
      // usuario solo quisiera cambiar, por ejemplo, `dias_max_antelacion`. Se
      // reintenta sin ellas para no bloquear el resto del formulario.
      if (error && esErrorEsquemaPendiente(error) && CAMPOS_MODO_SERVICIO.some((campo) => campo in updates)) {
        const resto = { ...updates };
        for (const campo of CAMPOS_MODO_SERVICIO) delete (resto as Record<string, unknown>)[campo];
        ({ data, error } = await supabase
          .from("configuracion_reservas" as any)
          .update(resto)
          .eq("id", (existing as any).id)
          .select()
          .single());
      }

      if (error) throw error;
      return data as unknown as ConfiguracionReservas;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configuracion-reservas"] });
    },
  });
}
