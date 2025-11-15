import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Sala {
  id: string;
  nombre: string;
  descripcion: string | null;
  capacidad_maxima: number;
  caracteristicas: any;
  activa: boolean;
}

export const useSalas = () => {
  return useQuery({
    queryKey: ["salas"],
    queryFn: async () => {
      const { data, error} = await supabase
        .from("salas")
        .select("*")
        .order("nombre");
      
      if (error) throw error;
      return data;
    },
  });
};

export const useCrearSala = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sala: Omit<Sala, "id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase
        .from("salas")
        .insert(sala)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salas"] });
      toast.success("Sala creada correctamente");
    },
    onError: (error: Error) => {
      toast.error("Error al crear sala: " + error.message);
    },
  });
};

export const useActualizarSala = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...sala }: Partial<Sala> & { id: string }) => {
      const { data, error } = await supabase
        .from("salas")
        .update(sala)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salas"] });
      toast.success("Sala actualizada correctamente");
    },
    onError: (error: Error) => {
      toast.error("Error al actualizar sala: " + error.message);
    },
  });
};

export const useEliminarSala = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("salas")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salas"] });
      toast.success("Sala eliminada correctamente");
    },
    onError: (error: Error) => {
      toast.error("Error al eliminar sala: " + error.message);
    },
  });
};
