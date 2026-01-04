import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

export interface Bebida {
  id: string;
  nombre: string | null;
  categoria: string | null;
  precio_eur: number | null;
  descripcion: string | null;
  tamano: string | null;
  orden: number | null;
  activado: boolean | null;
  imagen_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface NuevaBebida {
  nombre: string;
  categoria: string;
  precio_eur: number;
  descripcion?: string;
  tamano?: string;
  orden?: number;
  traducciones?: Json;
}

export function useBebidas() {
  const queryClient = useQueryClient();

  const { data: bebidas, isLoading } = useQuery({
    queryKey: ["bebidas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Bebidas")
        .select("*")
        .order("orden", { ascending: true });

      if (error) throw error;
      return data as Bebida[];
    },
  });

  const crearBebida = useMutation({
    mutationFn: async (nuevaBebida: NuevaBebida) => {
      // Mapear traducciones a columnas específicas
      const traduccionesData: Record<string, string | null> = {};
      if (nuevaBebida.traducciones && typeof nuevaBebida.traducciones === 'object') {
        const trad = nuevaBebida.traducciones as Record<string, Record<string, string>>;
        
        // Inglés
        if (trad['traduccion ingles']) {
          traduccionesData.nombre_en = trad['traduccion ingles'].nombre || null;
          traduccionesData.descripcion_en = trad['traduccion ingles'].descripcion || null;
          traduccionesData.categoria_en = trad['traduccion ingles'].categoria || null;
        }
        
        // Francés
        if (trad['traduccion_fr']) {
          traduccionesData.nombre_fr = trad['traduccion_fr'].nombre || null;
          traduccionesData.descripcion_fr = trad['traduccion_fr'].descripcion || null;
          traduccionesData.categoria_fr = trad['traduccion_fr']['catégorie'] || trad['traduccion_fr'].categoria || null;
        }
      }

      const { data, error } = await supabase
        .from("Bebidas")
        .insert([{
          ...nuevaBebida,
          ...traduccionesData,
          activado: true,
          id: crypto.randomUUID(),
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas"] });
      toast.success("Bebida añadida correctamente");
    },
    onError: (error) => {
      toast.error("Error al añadir la bebida");
      console.error(error);
    },
  });

  const actualizarBebida = useMutation({
    mutationFn: async ({ id, ...cambios }: Partial<Bebida> & { id: string }) => {
      const { data, error } = await supabase
        .from("Bebidas")
        .update(cambios)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas"] });
      toast.success("Bebida actualizada");
    },
    onError: (error) => {
      toast.error("Error al actualizar la bebida");
      console.error(error);
    },
  });

  const eliminarBebida = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("Bebidas")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas"] });
      toast.success("Bebida eliminada");
    },
    onError: (error) => {
      toast.error("Error al eliminar la bebida");
      console.error(error);
    },
  });

  const toggleActivado = useMutation({
    mutationFn: async ({ id, activado }: { id: string; activado: boolean }) => {
      const { error } = await supabase
        .from("Bebidas")
        .update({ activado })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas"] });
    },
    onError: (error) => {
      toast.error("Error al cambiar el estado");
      console.error(error);
    },
  });

  const categorias = bebidas
    ? Array.from(new Set(bebidas.map((b) => b.categoria).filter(Boolean)))
    : [];

  return {
    bebidas,
    isLoading,
    categorias,
    crearBebida,
    actualizarBebida,
    eliminarBebida,
    toggleActivado,
  };
}
