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

export interface AsignacionArea {
  id: string;
  turno_id: string;
  area_id: string;
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

// Hook para obtener todos los turnos
export const useTurnos = () => {
  return useQuery({
    queryKey: ["turnos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vista_turnos_con_areas")
        .select("*")
        .order("fecha", { ascending: true })
        .order("hora_inicio", { ascending: true });

      if (error) throw error;
      return data;
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
    mutationFn: async (turno: Omit<Turno, "id" | "created_at" | "updated_at"> & { areas?: string[]; salas?: string[] }) => {
      const { areas, salas, ...turnoData } = turno;
      
      const { data, error } = await supabase
        .from("turnos" as any)
        .insert(turnoData)
        .select()
        .single();

      if (error || !data) throw error || new Error("No data returned");

      const turnoCreado = data as any;

      // Si hay áreas seleccionadas, crear las asignaciones
      if (areas && areas.length > 0) {
        const asignaciones = areas.map((area_id) => ({
          turno_id: turnoCreado.id,
          area_id: area_id,
        }));

        const { error: asignacionError } = await supabase
          .from("asignaciones_area")
          .insert(asignaciones);

        if (asignacionError) throw asignacionError;
      }

      // Si hay salas seleccionadas, crear las asignaciones
      if (salas && salas.length > 0) {
        const asignacionesSalas = salas.map((sala_id) => ({
          turno_id: turnoCreado.id,
          sala_id: sala_id,
        }));

        const { error: asignacionSalaError } = await supabase
          .from("asignaciones_sala")
          .insert(asignacionesSalas);

        if (asignacionSalaError) throw asignacionSalaError;
      }

      return turnoCreado;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["turnos"] });
      queryClient.invalidateQueries({ queryKey: ["turnos-completa"] });
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
    mutationFn: async ({ id, areas, salas, ...turno }: Partial<Turno> & { id: string; areas?: string[]; salas?: string[] }) => {
      const { data, error } = await supabase
        .from("turnos" as any)
        .update(turno)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      // Si hay áreas definidas, actualizar asignaciones
      if (areas !== undefined) {
        // Primero eliminar asignaciones existentes
        await supabase
          .from("asignaciones_area")
          .delete()
          .eq("turno_id", id);

        // Luego crear las nuevas asignaciones
        if (areas.length > 0) {
          const asignaciones = areas.map((area_id) => ({
            turno_id: id,
            area_id: area_id,
          }));

          const { error: asignacionError } = await supabase
            .from("asignaciones_area")
            .insert(asignaciones);

          if (asignacionError) throw asignacionError;
        }
      }

      // Si hay salas definidas, actualizar asignaciones
      if (salas !== undefined) {
        // Primero eliminar asignaciones existentes
        await supabase
          .from("asignaciones_sala")
          .delete()
          .eq("turno_id", id);

        // Luego crear las nuevas asignaciones
        if (salas.length > 0) {
          const asignacionesSalas = salas.map((sala_id) => ({
            turno_id: id,
            sala_id: sala_id,
          }));

          const { error: asignacionSalaError } = await supabase
            .from("asignaciones_sala")
            .insert(asignacionesSalas);

          if (asignacionSalaError) throw asignacionSalaError;
        }
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["turnos"] });
      queryClient.invalidateQueries({ queryKey: ["turnos-completa"] });
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
      queryClient.invalidateQueries({ queryKey: ["turnos-completa"] });
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
