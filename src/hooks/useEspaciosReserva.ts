import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { filtrarEspaciosPorMarca, MARCA_POR_DEFECTO } from "@/hooks/useDisponibilidad";

export interface EspacioReserva {
  id: string;
  nombre: string;
  descripcion: string | null;
  capacidad_maxima: number;
  caracteristicas: any;
  activa: boolean;
}

/**
 * Espacios de reserva de Casa Tomás. Touza no tiene reservas (decisión del
 * dueño, 2026-09-23): un espacio etiquetado con otra marca en
 * `caracteristicas->>'marca'` (p. ej. "El Reservado") no se enseña en
 * ninguna pantalla de reservas (Kanban, turnos, verificación, Espacios). Un
 * espacio sin etiqueta cuenta como Casa Tomás (mismo criterio que el
 * trigger de aforo, ver `filtrarEspaciosPorMarca`). No se tocan los datos.
 */
export const useEspaciosReserva = () => {
  return useQuery({
    queryKey: ["espacios_reserva"],
    queryFn: async () => {
      const { data, error} = await supabase
        .from("espacios_reserva" as any)
        .select("*")
        .order("nombre");

      if (error) throw error;
      const filas = (data ?? []) as unknown as EspacioReserva[];
      return filtrarEspaciosPorMarca(
        filas.map((fila) => ({ fila, capacidad_maxima: fila.capacidad_maxima, marca: fila.caracteristicas?.marca ?? null })),
        MARCA_POR_DEFECTO,
      ).map(({ fila }) => fila) as any;
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
      // 1. Eliminar todas las mesas del espacio
      const { error: errorMesas } = await supabase
        .from("mesas")
        .delete()
        .eq("espacio_id", id);
      
      if (errorMesas) throw new Error("Error al eliminar mesas: " + errorMesas.message);

      // 2. Eliminar el plano del espacio
      const { error: errorPlano } = await supabase
        .from("planos_espacio")
        .delete()
        .eq("espacio_id", id);
      
      if (errorPlano) throw new Error("Error al eliminar plano: " + errorPlano.message);

      // 3. Finalmente eliminar el espacio
      const { error } = await supabase
        .from("espacios_reserva")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["espacios_reserva"] });
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
      queryClient.invalidateQueries({ queryKey: ["planos_espacio"] });
      toast.success("Espacio y todos sus elementos eliminados correctamente");
    },
    onError: (error: Error) => {
      toast.error("Error al eliminar espacio: " + error.message);
    },
  });
};
