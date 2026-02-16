import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface AsignacionMesa {
  id: string;
  reserva_id: string;
  mesa_id: string;
  created_at: string;
}

export interface AsignacionConDetalles extends AsignacionMesa {
  reservas: {
    id: string;
    nombre: string;
    hora: string;
    numero_comensales: number;
    estado: string;
  };
  mesas: {
    id: string;
    nombre: string;
    capacidad: number;
  };
}

export function useAsignacionesMesa(fecha?: string, espacioId?: string) {
  return useQuery({
    queryKey: ["asignaciones_mesa", fecha, espacioId],
    queryFn: async () => {
      let query = supabase
        .from("asignaciones_mesa")
        .select(`
          *,
          reservas!inner (
            id,
            nombre,
            hora,
            numero_comensales,
            estado,
            fecha
          ),
          mesas!inner (
            id,
            nombre,
            capacidad,
            espacio_id
          )
        `);

      const { data, error } = await query;
      if (error) throw error;

      // Filtrar por fecha y espacio en JS ya que el join es complejo
      let filtered = data || [];
      
      if (fecha) {
        filtered = filtered.filter((a: any) => a.reservas.fecha === fecha);
      }
      
      if (espacioId) {
        filtered = filtered.filter((a: any) => a.mesas.espacio_id === espacioId);
      }

      return filtered as AsignacionConDetalles[];
    },
    enabled: true,
  });
}

export function useCrearAsignacion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ reserva_id, mesa_id }: { reserva_id: string; mesa_id: string }) => {
      const { data, error } = await supabase
        .from("asignaciones_mesa")
        .insert({ reserva_id, mesa_id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asignaciones_mesa"] });
    },
    onError: (error) => {
      toast.error("Error al asignar mesa");
      console.error(error);
    },
  });
}

export function useEliminarAsignacion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("asignaciones_mesa")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asignaciones_mesa"] });
    },
  });
}

export function useAsignarMesasAutomatico() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (asignaciones: Array<{ reserva_id: string; mesa_id: string }>) => {
      // Primero eliminar asignaciones existentes para estas reservas
      const reservaIds = asignaciones.map(a => a.reserva_id);
      await supabase
        .from("asignaciones_mesa")
        .delete()
        .in("reserva_id", reservaIds);

      // Insertar nuevas asignaciones
      const { error } = await supabase
        .from("asignaciones_mesa")
        .insert(asignaciones);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asignaciones_mesa"] });
      toast.success("Mesas asignadas correctamente");
    },
    onError: (error) => {
      toast.error("Error al asignar mesas automáticamente");
      console.error(error);
    },
  });
}
