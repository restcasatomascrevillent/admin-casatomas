import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

export interface Vino {
  id: string;
  nombre: string | null;
  categoria: string | null;
  precio_eur: number | null;
  descripcion: string | null;
  denominacion_origen: string | null;
  ubicacion_pais: string | null;
  ubicacion_region: string | null;
  alergenos_oficiales: any;
  alergenos_inferidos: any;
  alergenos_notas: string | null;
  orden: string | null;
  activado: boolean | null;
  imagen_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface NuevoVino {
  nombre: string;
  categoria: string;
  precio_eur: number;
  descripcion?: string;
  denominacion_origen?: string;
  ubicacion_pais?: string;
  ubicacion_region?: string;
  alergenos_notas?: string;
  orden?: string;
  traducciones?: Json;
}

export function useVinos() {
  const queryClient = useQueryClient();

  const { data: vinos, isLoading } = useQuery({
    queryKey: ["vinos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Vinos")
        .select("*")
        .order("orden", { ascending: true });

      if (error) throw error;
      return data as Vino[];
    },
  });

  const crearVino = useMutation({
    mutationFn: async (nuevoVino: NuevoVino) => {
      const { data, error } = await supabase
        .from("Vinos")
        .insert([{
          ...nuevoVino,
          activado: true,
          id: crypto.randomUUID(),
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      toast.success("Vino añadido correctamente");
    },
    onError: (error) => {
      toast.error("Error al añadir el vino");
      console.error(error);
    },
  });

  const actualizarVino = useMutation({
    mutationFn: async ({ id, ...cambios }: Partial<Vino> & { id: string }) => {
      const { data, error } = await supabase
        .from("Vinos")
        .update(cambios)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      toast.success("Vino actualizado");
    },
    onError: (error) => {
      toast.error("Error al actualizar el vino");
      console.error(error);
    },
  });

  const eliminarVino = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("Vinos")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      toast.success("Vino eliminado");
    },
    onError: (error) => {
      toast.error("Error al eliminar el vino");
      console.error(error);
    },
  });

  const toggleActivado = useMutation({
    mutationFn: async ({ id, activado }: { id: string; activado: boolean }) => {
      const { error } = await supabase
        .from("Vinos")
        .update({ activado })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
    },
    onError: (error) => {
      toast.error("Error al cambiar el estado");
      console.error(error);
    },
  });

  const categorias = vinos
    ? Array.from(new Set(vinos.map((v) => v.categoria).filter(Boolean)))
    : [];

  return {
    vinos,
    isLoading,
    categorias,
    crearVino,
    actualizarVino,
    eliminarVino,
    toggleActivado,
  };
}
