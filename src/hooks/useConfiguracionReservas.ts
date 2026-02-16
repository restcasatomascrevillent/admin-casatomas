import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

      const { data, error } = await supabase
        .from("configuracion_reservas" as any)
        .update(updates)
        .eq("id", (existing as any).id)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as ConfiguracionReservas;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configuracion-reservas"] });
    },
  });
}
