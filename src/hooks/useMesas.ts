import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Mesa {
  id: string;
  espacio_id: string;
  nombre: string;
  capacidad: number;
  forma: string;
  ancho: number;
  alto: number;
  pos_x: number;
  pos_y: number;
  rotacion: number;
  activa: boolean;
  created_at: string;
  updated_at: string;
}

export interface MesaInput {
  espacio_id: string;
  nombre: string;
  capacidad?: number;
  forma?: string;
  ancho?: number;
  alto?: number;
  pos_x?: number;
  pos_y?: number;
  rotacion?: number;
  activa?: boolean;
}

export function useMesas(espacioId?: string) {
  return useQuery({
    queryKey: ["mesas", espacioId],
    queryFn: async () => {
      let query = supabase
        .from("mesas")
        .select("*")
        .eq("activa", true)
        .order("nombre");
      
      if (espacioId) {
        query = query.eq("espacio_id", espacioId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Mesa[];
    },
    enabled: true,
  });
}

export function useCrearMesa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mesa: MesaInput) => {
      const { data, error } = await supabase
        .from("mesas")
        .insert(mesa)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
      toast.success("Mesa creada correctamente");
    },
    onError: (error) => {
      toast.error("Error al crear mesa");
      console.error(error);
    },
  });
}

export function useActualizarMesa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Mesa> & { id: string }) => {
      const { data, error } = await supabase
        .from("mesas")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
    },
    onError: (error) => {
      toast.error("Error al actualizar mesa");
      console.error(error);
    },
  });
}

export function useActualizarMesasSilent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mesas: Array<Partial<Mesa> & { id: string }>) => {
      const updates = mesas.map(({ id, ...data }) =>
        supabase.from("mesas").update(data).eq("id", id)
      );
      await Promise.all(updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
    },
  });
}

export function useEliminarMesa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("mesas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
      toast.success("Mesa eliminada correctamente");
    },
    onError: (error) => {
      toast.error("Error al eliminar mesa");
      console.error(error);
    },
  });
}
