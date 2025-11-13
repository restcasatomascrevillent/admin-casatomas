import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Sala {
  id: string;
  nombre: string;
  descripcion: string | null;
  capacidad_maxima: number;
  numero_mesas: number;
  caracteristicas: any;
  activa: boolean;
}

export interface PosicionSala {
  id: string;
  sala_id: string;
  nombre: string;
  descripcion: string | null;
  capacidad_comensales: number;
  orden_prioridad: number;
  activa: boolean;
}

export const useSalas = () => {
  return useQuery({
    queryKey: ["salas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("salas")
        .select("*")
        .order("nombre");
      
      if (error) throw error;
      return data;
    },
  });
};

export const usePosicionesSala = (salaId: string | null) => {
  return useQuery({
    queryKey: ["posiciones_sala", salaId],
    queryFn: async () => {
      if (!salaId) return [];
      
      const { data, error } = await supabase
        .from("posiciones_sala")
        .select("*")
        .eq("sala_id", salaId)
        .order("orden_prioridad");
      
      if (error) throw error;
      return data;
    },
    enabled: !!salaId,
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
      queryClient.invalidateQueries({ queryKey: ["posiciones_sala"] });
      toast.success("Sala eliminada correctamente");
    },
    onError: (error: Error) => {
      toast.error("Error al eliminar sala: " + error.message);
    },
  });
};

export const useCrearPosicion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (posicion: Omit<PosicionSala, "id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase
        .from("posiciones_sala")
        .insert(posicion)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["posiciones_sala", variables.sala_id] });
      toast.success("Posición creada correctamente");
    },
    onError: (error: Error) => {
      toast.error("Error al crear posición: " + error.message);
    },
  });
};

export const useActualizarPosicion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, sala_id, ...posicion }: Partial<PosicionSala> & { id: string; sala_id: string }) => {
      const { data, error } = await supabase
        .from("posiciones_sala")
        .update(posicion)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["posiciones_sala", variables.sala_id] });
      toast.success("Posición actualizada correctamente");
    },
    onError: (error: Error) => {
      toast.error("Error al actualizar posición: " + error.message);
    },
  });
};

export const useEliminarPosicion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, sala_id }: { id: string; sala_id: string }) => {
      const { error } = await supabase
        .from("posiciones_sala")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["posiciones_sala", variables.sala_id] });
      toast.success("Posición eliminada correctamente");
    },
    onError: (error: Error) => {
      toast.error("Error al eliminar posición: " + error.message);
    },
  });
};
