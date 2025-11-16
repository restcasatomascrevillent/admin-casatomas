import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Trabajador {
  id: string;
  nombre: string;
  apellidos: string;
  telefono: string;
  email: string | null;
  puesto: string;
  fecha_contratacion: string;
  activo: boolean;
  salario_hora: number | null;
  notas: string | null;
  foto_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Turno {
  id: string;
  trabajador_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  estado: string;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

export interface AsignacionSala {
  id: string;
  turno_id: string;
  sala_id: string;
  created_at: string;
}

export interface RegistroHoras {
  id: string;
  trabajador_id: string;
  turno_id: string | null;
  fecha: string;
  hora_entrada: string;
  hora_salida: string | null;
  horas_trabajadas: number | null;
  notas: string | null;
  created_at: string;
}

// Hook para obtener todos los trabajadores
export const useTrabajadores = () => {
  return useQuery({
    queryKey: ["trabajadores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trabajadores" as any)
        .select("*")
        .order("nombre");

      if (error) throw error;
      return data as any as Trabajador[];
    },
  });
};

// Hook para obtener trabajadores activos
export const useTrabajadoresActivos = () => {
  return useQuery({
    queryKey: ["trabajadores", "activos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trabajadores" as any)
        .select("*")
        .eq("activo", true)
        .order("nombre");

      if (error) throw error;
      return data as any as Trabajador[];
    },
  });
};

// Hook para crear trabajador
export const useCrearTrabajador = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (trabajador: Omit<Trabajador, "id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase
        .from("trabajadores" as any)
        .insert(trabajador)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trabajadores"] });
      toast.success("Trabajador creado correctamente");
    },
    onError: (error: any) => {
      toast.error("Error al crear trabajador: " + error.message);
    },
  });
};

// Hook para actualizar trabajador
export const useActualizarTrabajador = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...trabajador }: Partial<Trabajador> & { id: string }) => {
      const { data, error } = await supabase
        .from("trabajadores" as any)
        .update(trabajador)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trabajadores"] });
      toast.success("Trabajador actualizado correctamente");
    },
    onError: (error: any) => {
      toast.error("Error al actualizar trabajador: " + error.message);
    },
  });
};

// Hook para eliminar trabajador
export const useEliminarTrabajador = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("trabajadores" as any)
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trabajadores"] });
      toast.success("Trabajador eliminado correctamente");
    },
    onError: (error: any) => {
      toast.error("Error al eliminar trabajador: " + error.message);
    },
  });
};

// Hook para obtener turnos
export const useTurnos = (fecha?: string) => {
  return useQuery({
    queryKey: ["turnos", fecha],
    queryFn: async () => {
      let query = supabase
        .from("turnos" as any)
        .select("*")
        .order("fecha", { ascending: false })
        .order("hora_inicio");

      if (fecha) {
        query = query.eq("fecha", fecha);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as any as Turno[];
    },
  });
};

// Hook para obtener vista de turnos completa
export const useTurnosCompleta = (fecha?: string) => {
  return useQuery({
    queryKey: ["vista_turnos_completa", fecha],
    queryFn: async () => {
      let query = supabase
        .from("vista_turnos_completa" as any)
        .select("*")
        .order("fecha", { ascending: false })
        .order("hora_inicio");

      if (fecha) {
        query = query.eq("fecha", fecha);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data;
    },
  });
};

// Hook para crear turno
export const useCrearTurno = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (turno: Omit<Turno, "id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase
        .from("turnos" as any)
        .insert(turno)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["turnos"] });
      queryClient.invalidateQueries({ queryKey: ["vista_turnos_completa"] });
      toast.success("Turno creado correctamente");
    },
    onError: (error: any) => {
      toast.error("Error al crear turno: " + error.message);
    },
  });
};

// Hook para actualizar turno
export const useActualizarTurno = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...turno }: Partial<Turno> & { id: string }) => {
      const { data, error } = await supabase
        .from("turnos" as any)
        .update(turno)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["turnos"] });
      queryClient.invalidateQueries({ queryKey: ["vista_turnos_completa"] });
      toast.success("Turno actualizado correctamente");
    },
    onError: (error: any) => {
      toast.error("Error al actualizar turno: " + error.message);
    },
  });
};

// Hook para eliminar turno
export const useEliminarTurno = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("turnos" as any)
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["turnos"] });
      queryClient.invalidateQueries({ queryKey: ["vista_turnos_completa"] });
      toast.success("Turno eliminado correctamente");
    },
    onError: (error: any) => {
      toast.error("Error al eliminar turno: " + error.message);
    },
  });
};

// Hook para asignar sala a turno
export const useAsignarSala = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (asignacion: Omit<AsignacionSala, "id" | "created_at">) => {
      const { data, error } = await supabase
        .from("asignaciones_sala" as any)
        .insert(asignacion)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vista_turnos_completa"] });
      toast.success("Sala asignada correctamente");
    },
    onError: (error: any) => {
      toast.error("Error al asignar sala: " + error.message);
    },
  });
};

// Hook para registrar entrada/salida
export const useRegistrarHoras = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (registro: Omit<RegistroHoras, "id" | "created_at" | "horas_trabajadas">) => {
      const { data, error } = await supabase
        .from("registro_horas" as any)
        .insert(registro)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["registro_horas"] });
      toast.success("Horas registradas correctamente");
    },
    onError: (error: any) => {
      toast.error("Error al registrar horas: " + error.message);
    },
  });
};
