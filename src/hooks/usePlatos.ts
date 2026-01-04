import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

export interface Plato {
  id: string;
  nombre: string | null;
  categoria: string | null;
  precio_eur: number | null;
  descripcion: string | null;
  unidad: string | null;
  alergenos_oficiales: any;
  alergenos_inferidos: any;
  alergenos_notas: string | null;
  orden: string | null;
  activado: boolean | null;
  expanded: boolean | null;
  imagen_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface NuevoPlato {
  nombre: string;
  categoria: string;
  precio_eur: number;
  descripcion?: string;
  unidad?: string;
  alergenos_oficiales?: any;
  alergenos_notas?: string;
  orden?: string;
  traducciones?: Json;
}

export function usePlatos() {
  const queryClient = useQueryClient();

  const { data: platos, isLoading } = useQuery({
    queryKey: ["platos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Platos")
        .select("*")
        // Orden estable: si hay orden duplicado o null, evitamos reordenamientos al refrescar
        .order("orden", { ascending: true })
        .order("id", { ascending: true });

      if (error) throw error;
      return data as Plato[];
    },
  });

  const crearPlato = useMutation({
    mutationFn: async (nuevoPlato: NuevoPlato) => {
      const isNovedades = nuevoPlato.categoria === "Novedades del día";
      const { data, error } = await supabase
        .from("Platos")
        .insert([{
          ...nuevoPlato,
          activado: true,
          expanded: isNovedades,
          id: crypto.randomUUID(),
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      toast.success("Plato añadido correctamente");
    },
    onError: (error) => {
      toast.error("Error al añadir el plato");
      console.error(error);
    },
  });

  const actualizarPlato = useMutation({
    mutationFn: async ({ id, ...cambios }: Partial<Plato> & { id: string }) => {
      const { data, error } = await supabase
        .from("Platos")
        .update(cambios)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      toast.success("Plato actualizado");
    },
    onError: (error) => {
      toast.error("Error al actualizar el plato");
      console.error(error);
    },
  });

  const eliminarPlato = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("Platos")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      toast.success("Plato eliminado");
    },
    onError: (error) => {
      toast.error("Error al eliminar el plato");
      console.error(error);
    },
  });

  const toggleActivado = useMutation({
    mutationFn: async ({ id, activado }: { id: string; activado: boolean }) => {
      const { error } = await supabase
        .from("Platos")
        .update({ activado })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
    },
    onError: (error) => {
      toast.error("Error al cambiar el estado");
      console.error(error);
    },
  });

  const toggleExpanded = useMutation({
    mutationFn: async ({ id, expanded }: { id: string; expanded: boolean }) => {
      const { error } = await supabase
        .from("Platos")
        .update({ expanded })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
    },
    onError: (error) => {
      toast.error("Error al cambiar el estado de expandido");
      console.error(error);
    },
  });

  const expandirTodos = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("Platos")
        .update({ expanded: true })
        .in("id", ids);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      toast.success("Todas las fotos expandidas");
    },
    onError: (error) => {
      toast.error("Error al expandir las fotos");
      console.error(error);
    },
  });

  const contraerTodos = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("Platos")
        .update({ expanded: false })
        .in("id", ids);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      toast.success("Todas las fotos contraídas");
    },
    onError: (error) => {
      toast.error("Error al contraer las fotos");
      console.error(error);
    },
  });

  const categorias = platos
    ? Array.from(new Set(platos.map((p) => p.categoria).filter(Boolean)))
    : [];

  return {
    platos,
    isLoading,
    categorias,
    crearPlato,
    actualizarPlato,
    eliminarPlato,
    toggleActivado,
    toggleExpanded,
    expandirTodos,
    contraerTodos,
  };
}
