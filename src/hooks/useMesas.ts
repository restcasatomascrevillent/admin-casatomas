import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Json } from "@/integrations/supabase/types";

export interface OriginalMesaData {
  id: string;
  nombre: string;
  capacidad: number;
  forma: "rectangular" | "circular";
  ancho: number;
  alto: number;
}

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
  is_merged: boolean;
  original_mesas: OriginalMesaData[] | null;
  etiqueta: string | null;
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
  is_merged?: boolean;
  original_mesas?: Json | null;
  etiqueta?: string | null;
}

export function useMesas(espacioId?: string) {
  return useQuery({
    queryKey: espacioId ? ["mesas", espacioId] : ["mesas"],
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
      
      // Convertir original_mesas de Json a OriginalMesaData[]
      return (data || []).map(mesa => ({
        ...mesa,
        original_mesas: mesa.original_mesas as unknown as OriginalMesaData[] | null,
      })) as Mesa[];
    },
    staleTime: 0, // Siempre considerar datos como stale para refetch
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
      // Convertir original_mesas a Json para Supabase
      const dbUpdates = {
        ...updates,
        original_mesas: updates.original_mesas as unknown as Json | null,
      };
      const { data, error } = await supabase
        .from("mesas")
        .update(dbUpdates)
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
      const updates = mesas.map(({ id, ...data }) => {
        // Convertir original_mesas a Json para Supabase
        const dbData = {
          ...data,
          original_mesas: data.original_mesas as unknown as Json | null,
        };
        return supabase.from("mesas").update(dbData).eq("id", id);
      });
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
