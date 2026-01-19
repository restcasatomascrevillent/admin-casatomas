import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
      const bebidaId = crypto.randomUUID();

      // 1. Crear la bebida primero
      const { data, error } = await supabase
        .from("Bebidas")
        .insert([{
          ...nuevaBebida,
          activado: true,
          id: bebidaId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }])
        .select()
        .single();

      if (error) throw error;

      // 2. Llamar al webhook de traducción en background
      supabase.functions.invoke('traducir-carta-auto', {
        body: {
          tipo: 'bebida',
          nombre: nuevaBebida.nombre,
          descripcion: nuevaBebida.descripcion || '',
          categoria: nuevaBebida.categoria,
          tamano: nuevaBebida.tamano || '',
        }
      }).then(async ({ data: traducciones, error: tradError }) => {
        if (tradError) {
          console.error('Error en traducción automática:', tradError);
          return;
        }

        console.log('Traducciones recibidas:', traducciones);

        // Parsear respuesta del webhook
        const traduccion = Array.isArray(traducciones) ? traducciones[0] : traducciones;
        if (!traduccion) return;

        const updateData: Record<string, string | null> = {};

        // Inglés
        if (traduccion['traduccion ingles']) {
          const en = traduccion['traduccion ingles'];
          updateData.nombre_en = en.nombre || null;
          updateData.descripcion_en = en.descripcion || null;
          updateData.categoria_en = en.categoria || null;
        }

        // Francés
        if (traduccion['traduccion_fr']) {
          const fr = traduccion['traduccion_fr'];
          updateData.nombre_fr = fr.nombre || null;
          updateData.descripcion_fr = fr.descripcion || null;
          updateData.categoria_fr = fr['catégorie'] || fr.categoria || null;
        }

        if (Object.keys(updateData).length > 0) {
          const { error: updateError } = await supabase
            .from("Bebidas")
            .update(updateData)
            .eq("id", bebidaId);

          if (updateError) {
            console.error('Error guardando traducciones:', updateError);
          } else {
            console.log('Traducciones guardadas correctamente');
            queryClient.invalidateQueries({ queryKey: ["bebidas"] });
          }
        }
      });

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
