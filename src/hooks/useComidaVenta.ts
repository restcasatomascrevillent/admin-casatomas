import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface ComidaVenta {
  id: string;
  nombre: string;
  categoria: string | null;
  precio_eur: number | null;
  precio_coste: number | null;
  descripcion: string | null;
  imagen_url: string | null;
  stock: number | null;
  peso: string | null;
  activado: boolean | null;
  featured: boolean | null;
  orden: number | null;
  origen: string | null;
  nombre_en: string | null;
  nombre_fr: string | null;
  descripcion_en: string | null;
  descripcion_fr: string | null;
  categoria_en: string | null;
  categoria_fr: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export type ComidaVentaInsert = Omit<ComidaVenta, "id" | "created_at" | "updated_at">;

export function useComidaVenta() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: comidas = [], isLoading } = useQuery({
    queryKey: ["comida-venta"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ComidaVENTA")
        .select("*")
        .order("orden", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as ComidaVenta[];
    },
  });

  const categorias = [...new Set(comidas.map((c) => c.categoria).filter(Boolean))] as string[];
  const origenes = [...new Set(comidas.map((c) => c.origen).filter(Boolean))] as string[];

  const addComida = useMutation({
    mutationFn: async (comida: ComidaVentaInsert) => {
      const { data, error } = await supabase
        .from("ComidaVENTA")
        .insert([{ ...comida, id: crypto.randomUUID() }])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comida-venta"] });
      toast({ title: "Producto añadido correctamente" });
    },
    onError: (error) => {
      toast({ title: "Error al añadir producto", description: error.message, variant: "destructive" });
    },
  });

  const updateComida = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ComidaVenta> & { id: string }) => {
      const { error } = await supabase
        .from("ComidaVENTA")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comida-venta"] });
      toast({ title: "Producto actualizado" });
    },
    onError: (error) => {
      toast({ title: "Error al actualizar", description: error.message, variant: "destructive" });
    },
  });

  const deleteComida = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ComidaVENTA").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comida-venta"] });
      toast({ title: "Producto eliminado" });
    },
    onError: (error) => {
      toast({ title: "Error al eliminar", description: error.message, variant: "destructive" });
    },
  });

  const toggleActivado = (id: string, activado: boolean) => {
    updateComida.mutate({ id, activado });
  };

  const toggleFeatured = (id: string, featured: boolean) => {
    updateComida.mutate({ id, featured });
  };

  return {
    comidas,
    isLoading,
    categorias,
    origenes,
    addComida,
    updateComida,
    deleteComida,
    toggleActivado,
    toggleFeatured,
  };
}
