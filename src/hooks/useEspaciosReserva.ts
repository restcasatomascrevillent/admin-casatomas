import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface EspacioReserva {
  id: string;
  nombre: string;
  descripcion: string | null;
  capacidad_maxima: number;
  caracteristicas: any;
  activa: boolean;
}

/**
 * TODAS las filas de `espacios_reserva`, también las salas de Touza que siguen
 * en la base de datos. Solo Casa Tomás admite reservas (decisión del dueño,
 * 2026-10-01): cada pantalla enseña y suma únicamente las salas que pasan
 * `salaAdmiteReservas` (`src/lib/reservas/negocios.ts`), que decide por
 * `caracteristicas.marca`, nunca por el nombre (hay dos «Terraza»).
 */
export const useEspaciosReserva = () => {
  return useQuery({
    queryKey: ["espacios_reserva"],
    queryFn: async () => {
      const { data, error } = await supabase
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
