import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface PlanoEspacio {
  id: string;
  espacio_id: string;
  ancho: number;
  alto: number;
  metros_cuadrados: number | null;
  configuracion: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export function usePlanoEspacio(espacioId?: string) {
  return useQuery({
    queryKey: ["planos_espacio", espacioId],
    queryFn: async () => {
      if (!espacioId) return null;

      const { data, error } = await supabase
        .from("planos_espacio")
        .select("*")
        .eq("espacio_id", espacioId)
        .maybeSingle();

      if (error) throw error;
      return data as PlanoEspacio | null;
    },
    enabled: !!espacioId,
  });
}

export function useCrearPlano() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (plano: Partial<PlanoEspacio> & { espacio_id: string }) => {
      const { data, error } = await supabase
        .from("planos_espacio")
        .insert(plano)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planos_espacio"] });
    },
    onError: (error) => {
      toast.error("Error al crear plano");
      console.error(error);
    },
  });
}

export function useActualizarPlano() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PlanoEspacio> & { id: string }) => {
      const { data, error } = await supabase
        .from("planos_espacio")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planos_espacio"] });
    },
    onError: (error) => {
      toast.error("Error al actualizar plano");
      console.error(error);
    },
  });
}

export function useCrearOActualizarPlano() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (plano: Partial<PlanoEspacio> & { espacio_id: string }) => {
      // Primero intentar buscar si existe
      const { data: existing } = await supabase
        .from("planos_espacio")
        .select("id")
        .eq("espacio_id", plano.espacio_id)
        .maybeSingle();

      if (existing) {
        const { data, error } = await supabase
          .from("planos_espacio")
          .update(plano)
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from("planos_espacio")
          .insert(plano)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planos_espacio"] });
    },
    onError: (error) => {
      toast.error("Error al guardar plano");
      console.error(error);
    },
  });
}
