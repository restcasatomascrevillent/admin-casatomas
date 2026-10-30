import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

export interface AreaTrabajo {
  id: string;
  nombre: string;
  descripcion?: string;
  tipo?: string;
  activa: boolean;
  created_at: string;
  updated_at: string;
}

// Hook para obtener todas las áreas de trabajo
export const useAreasTrabajo = () => {
  return useQuery({
    queryKey: ["areas-trabajo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("areas_trabajo")
        .select("*")
        .order("nombre");

      if (error) throw error;
      return data as AreaTrabajo[];
    },
  });
};

// Hook para obtener áreas activas
export const useAreasTrabajoActivas = () => {
  return useQuery({
    queryKey: ["areas-trabajo", "activas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("areas_trabajo")
        .select("*")
        .eq("activa", true)
        .order("nombre");

      if (error) throw error;
      return data as AreaTrabajo[];
    },
  });
};

// Hook para crear área de trabajo
export const useCrearAreaTrabajo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (area: Omit<AreaTrabajo, "id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase
        .from("areas_trabajo")
        .insert(area)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["areas-trabajo"] });
      toast.success("Área de trabajo creada correctamente");
    },
    onError: (error: any) => {
      toast.error("Error al crear área de trabajo: " + mensajeUsuario(error, "inténtalo de nuevo"));
    },
  });
};

// Hook para actualizar área de trabajo
export const useActualizarAreaTrabajo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...area }: Partial<AreaTrabajo> & { id: string }) => {
      const { data, error } = await supabase
        .from("areas_trabajo")
        .update(area)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["areas-trabajo"] });
      toast.success("Área de trabajo actualizada correctamente");
    },
    onError: (error: any) => {
      toast.error("Error al actualizar área de trabajo: " + mensajeUsuario(error, "inténtalo de nuevo"));
    },
  });
};

// Hook para eliminar área de trabajo
export const useEliminarAreaTrabajo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("areas_trabajo")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["areas-trabajo"] });
      toast.success("Área de trabajo eliminada correctamente");
    },
    onError: (error: any) => {
      toast.error("Error al eliminar área de trabajo: " + mensajeUsuario(error, "inténtalo de nuevo"));
    },
  });
};
