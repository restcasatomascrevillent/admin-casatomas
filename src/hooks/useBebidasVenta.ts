import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface BebidaVenta {
  id: string;
  nombre: string;
  categoria: string | null;
  precio_eur: number | null;
  precio_coste: number | null;
  descripcion: string | null;
  imagen_url: string | null;
  stock: number | null;
  activado: boolean | null;
  featured: boolean | null;
  orden: number | null;
  denominacion_origen: string | null;
  ubicacion_pais: string | null;
  ubicacion_region: string | null;
  nombre_en: string | null;
  nombre_fr: string | null;
  descripcion_en: string | null;
  descripcion_fr: string | null;
  categoria_en: string | null;
  categoria_fr: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export type BebidaVentaInsert = Omit<BebidaVenta, "id" | "created_at" | "updated_at">;

export function useBebidasVenta() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: bebidas = [], isLoading } = useQuery({
    queryKey: ["bebidas-venta"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("BebidasVENTA")
        .select("*")
        .order("orden", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as BebidaVenta[];
    },
  });

  const categorias = [...new Set(bebidas.map((b) => b.categoria).filter(Boolean))] as string[];
  const paises = [...new Set(bebidas.map((b) => b.ubicacion_pais).filter(Boolean))] as string[];
  const regiones = [...new Set(bebidas.map((b) => b.ubicacion_region).filter(Boolean))] as string[];
  const denominaciones = [...new Set(bebidas.map((b) => b.denominacion_origen).filter(Boolean))] as string[];

  const addBebida = useMutation({
    mutationFn: async (bebida: BebidaVentaInsert) => {
      const { data, error } = await supabase
        .from("BebidasVENTA")
        .insert([{ ...bebida, id: crypto.randomUUID() }])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas-venta"] });
      toast({ title: "Bebida añadida correctamente" });
    },
    onError: (error) => {
      toast({ title: "Error al añadir bebida", description: error.message, variant: "destructive" });
    },
  });

  const updateBebida = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<BebidaVenta> & { id: string }) => {
      const { error } = await supabase
        .from("BebidasVENTA")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas-venta"] });
      toast({ title: "Bebida actualizada" });
    },
    onError: (error) => {
      toast({ title: "Error al actualizar", description: error.message, variant: "destructive" });
    },
  });

  const deleteBebida = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("BebidasVENTA").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas-venta"] });
      toast({ title: "Bebida eliminada" });
    },
    onError: (error) => {
      toast({ title: "Error al eliminar", description: error.message, variant: "destructive" });
    },
  });

  const toggleActivado = (id: string, activado: boolean) => {
    updateBebida.mutate({ id, activado });
  };

  const toggleFeatured = (id: string, featured: boolean) => {
    updateBebida.mutate({ id, featured });
  };

  return {
    bebidas,
    isLoading,
    categorias,
    paises,
    regiones,
    denominaciones,
    addBebida,
    updateBebida,
    deleteBebida,
    toggleActivado,
    toggleFeatured,
  };
}
