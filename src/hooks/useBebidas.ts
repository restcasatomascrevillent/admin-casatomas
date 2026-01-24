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
  touza: boolean | null;
  restaurante: boolean | null;
  featured: boolean | null;
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
      // Solo enviar al webhook, sin insertar en base de datos
      const { data, error } = await supabase.functions.invoke('traducir-carta-auto', {
        body: {
          tipo: 'bebida',
          nombre: nuevaBebida.nombre,
          categoria: nuevaBebida.categoria,
          tamano: nuevaBebida.tamano || '',
          precio: nuevaBebida.precio_eur,
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
      queryClient.invalidateQueries({ queryKey: ["bebidas"] });
      toast.success("Bebida enviada correctamente");
    },
    onError: (error) => {
      toast.error("Error al enviar la bebida");
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

  const toggleRestaurante = useMutation({
    mutationFn: async ({ id, restaurante }: { id: string; restaurante: boolean }) => {
      const { error } = await supabase
        .from("Bebidas")
        .update({ restaurante })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas"] });
    },
    onError: (error) => {
      toast.error("Error al cambiar visibilidad Restaurante");
      console.error(error);
    },
  });

  const toggleTouza = useMutation({
    mutationFn: async ({ id, touza }: { id: string; touza: boolean }) => {
      const { error } = await supabase
        .from("Bebidas")
        .update({ touza })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas"] });
    },
    onError: (error) => {
      toast.error("Error al cambiar visibilidad Touza");
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
    toggleRestaurante,
    toggleTouza,
  };
}
