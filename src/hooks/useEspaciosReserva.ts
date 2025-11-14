import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface EspacioReserva {
  id: string;
  nombre: string;
  descripcion: string | null;
  capacidad_maxima: number;
  numero_mesas: number;
  caracteristicas: any;
  activa: boolean;
}

export const useEspaciosReserva = () => {
  return useQuery({
    queryKey: ["espacios_reserva"],
    queryFn: async () => {
      const { data, error} = await supabase
        .from("espacios_reserva" as any)
        .select("*")
        .order("nombre");
      
      if (error) throw error;
      return data as any;
    },
  });
};

export const useCrearEspacio = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (espacio: Omit<EspacioReserva, "id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase
        .from("espacios_reserva" as any)
        .insert(espacio)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["espacios_reserva"] });
      toast.success("Espacio creado correctamente");
    },
    onError: (error: Error) => {
      toast.error("Error al crear espacio: " + error.message);
    },
  });
};

export const useActualizarEspacio = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...espacio }: Partial<EspacioReserva> & { id: string }) => {
      const { data, error } = await supabase
        .from("espacios_reserva" as any)
        .update(espacio)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["espacios_reserva"] });
      toast.success("Espacio actualizado correctamente");
    },
    onError: (error: Error) => {
      toast.error("Error al actualizar espacio: " + error.message);
    },
  });
};

export const useEliminarEspacio = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("espacios_reserva" as any)
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["espacios_reserva"] });
      toast.success("Espacio eliminado correctamente");
    },
    onError: (error: Error) => {
      toast.error("Error al eliminar espacio: " + error.message);
    },
  });
};
