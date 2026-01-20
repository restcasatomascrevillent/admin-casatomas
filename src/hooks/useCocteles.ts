import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Coctel {
  id: string;
  nombre: string | null;
  categoria: string | null;
  precio_eur: number | null;
  descripcion: string | null;
  ingredientes: string | null;
  preparacion: string | null;
  alergenos_oficiales: any;
  alergenos_notas: string | null;
  activado: boolean | null;
  orden: number | null;
  imagen_url: string | null;
  traducciones: any;
  nombre_en: string | null;
  categoria_en: string | null;
  descripcion_en: string | null;
  ingredientes_en: string | null;
  nombre_fr: string | null;
  categoria_fr: string | null;
  descripcion_fr: string | null;
  ingredientes_fr: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface NuevoCoctel {
  nombre: string;
  categoria: string;
  precio_eur: number;
  descripcion?: string;
  ingredientes?: string;
  preparacion?: string;
}

export function useCocteles() {
  const queryClient = useQueryClient();

  const { data: cocteles, isLoading } = useQuery({
    queryKey: ["cocteles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Cocteles")
        .select("*")
        .order("orden", { ascending: true });

      if (error) throw error;
      return data as Coctel[];
    },
  });

  const crearCoctel = useMutation({
    mutationFn: async (nuevoCoctel: NuevoCoctel) => {
      // Enviar al webhook de traducción
      const { data, error } = await supabase.functions.invoke('traducir-carta-auto', {
        body: {
          tipo: 'coctel',
          nombre: nuevoCoctel.nombre,
          categoria: nuevoCoctel.categoria,
          descripcion: nuevoCoctel.descripcion || '',
          ingredientes: nuevoCoctel.ingredientes || '',
          precio: nuevoCoctel.precio_eur,
        }
      });

      if (error) {
        console.error('Error enviando al webhook:', error);
        throw error;
      }

      console.log('Respuesta del webhook:', data);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cocteles"] });
      toast.success("Cóctel enviado correctamente");
    },
    onError: (error) => {
      toast.error("Error al enviar el cóctel");
      console.error(error);
    },
  });

  const actualizarCoctel = useMutation({
    mutationFn: async ({ id, ...cambios }: Partial<Coctel> & { id: string }) => {
      const { data, error } = await supabase
        .from("Cocteles")
        .update(cambios)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cocteles"] });
      toast.success("Cóctel actualizado");
    },
    onError: (error) => {
      toast.error("Error al actualizar el cóctel");
      console.error(error);
    },
  });

  const eliminarCoctel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("Cocteles")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cocteles"] });
      toast.success("Cóctel eliminado");
    },
    onError: (error) => {
      toast.error("Error al eliminar el cóctel");
      console.error(error);
    },
  });

  const toggleActivado = useMutation({
    mutationFn: async ({ id, activado }: { id: string; activado: boolean }) => {
      const { error } = await supabase
        .from("Cocteles")
        .update({ activado })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cocteles"] });
    },
    onError: (error) => {
      toast.error("Error al cambiar el estado");
      console.error(error);
    },
  });

  const categorias = cocteles
    ? Array.from(new Set(cocteles.map((c) => c.categoria).filter(Boolean)))
    : [];

  return {
    cocteles,
    isLoading,
    categorias,
    crearCoctel,
    actualizarCoctel,
    eliminarCoctel,
    toggleActivado,
  };
}
