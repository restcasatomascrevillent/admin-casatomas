import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Turno {
  id: string;
  nombre: string;
  hora_inicio: string;
  hora_fin: string;
  dias_semana: number[];
  activo: boolean;
}

export interface Trabajador {
  id: string;
  nombre: string;
  apellidos: string;
  rol: string;
  activo: boolean;
}

export interface AsignacionTurno {
  id: string;
  turno_id: string;
  trabajador_id: string;
  sala_id: string | null;
  posicion_sala_id: string | null;
  fecha: string;
  notas: string | null;
  asignacion_automatica: boolean;
}

export const useTurnos = () => {
  return useQuery({
    queryKey: ["turnos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("turnos")
        .select("*")
        .eq("activo", true)
        .order("hora_inicio");
      
      if (error) throw error;
      return data as Turno[];
    },
  });
};

export const useTrabajadores = () => {
  return useQuery({
    queryKey: ["trabajadores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trabajadores")
        .select("*")
        .eq("activo", true)
        .order("nombre");
      
      if (error) throw error;
      return data as Trabajador[];
    },
  });
};

export const useAsignaciones = (fechaInicio: string, fechaFin: string) => {
  return useQuery({
    queryKey: ["asignaciones", fechaInicio, fechaFin],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asignaciones_turno")
        .select(`
          *,
          turno:turnos(nombre, hora_inicio, hora_fin),
          trabajador:trabajadores(nombre, apellidos, rol),
          sala:salas(nombre),
          posicion:posiciones_sala(nombre)
        `)
        .gte("fecha", fechaInicio)
        .lte("fecha", fechaFin);
      
      if (error) throw error;
      return data;
    },
  });
};

export const useCrearAsignacion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (asignacion: Omit<AsignacionTurno, "id" | "created_at" | "updated_at">) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuario no autenticado");

      const { data, error } = await supabase
        .from("asignaciones_turno")
        .insert({ ...asignacion, user_id: user.id })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asignaciones"] });
      toast.success("Asignación creada correctamente");
    },
    onError: (error: Error) => {
      toast.error("Error al crear asignación: " + error.message);
    },
  });
};

export const useEliminarAsignacion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("asignaciones_turno")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asignaciones"] });
      toast.success("Asignación eliminada correctamente");
    },
    onError: (error: Error) => {
      toast.error("Error al eliminar asignación: " + error.message);
    },
  });
};
