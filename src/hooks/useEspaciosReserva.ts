import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { salaAdmiteReservas } from "@/lib/reservas/negocios";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

export interface EspacioReserva {
  id: string;
  nombre: string;
  descripcion: string | null;
  capacidad_maxima: number;
  caracteristicas: any;
  activa: boolean;
}

/**
 * Las salas de CASA TOMÁS (`salaAdmiteReservas`, `src/lib/reservas/negocios.ts`).
 * Touza no admite reservas ni gestiona espacios ni mesas con este sistema
 * (decisión del dueño, 2026-10-01; 2026-10-03: «nunca»): sus tres salas siguen
 * en la base de datos (desactivadas) hasta que se aplique la migración
 * `20261003120000_touza_retirar_espacios_reserva.sql`. Este es el hook de
 * lectura de la lista de salas del panel, así que ninguna pantalla que lo use
 * (selectores de sala, Espacios, plano, mesas, asignación…) puede ofrecerlas ni
 * abrirlas por id; los demás hooks que leen la tabla por su cuenta aplican la
 * misma regla en su queryFn. La regla decide por `caracteristicas.marca`, nunca por el
 * nombre (hay dos «Terraza»). Los filtros que cada pantalla aplica además se
 * quedan como segunda red.
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
      return ((data ?? []) as any[]).filter((e) => salaAdmiteReservas(e)) as any;
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
      toast.error("Error al crear espacio: " + mensajeUsuario(error, "inténtalo de nuevo"));
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
      toast.error("Error al actualizar espacio: " + mensajeUsuario(error, "inténtalo de nuevo"));
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
      toast.error("Error al eliminar espacio: " + mensajeUsuario(error, "inténtalo de nuevo"));
    },
  });
};
