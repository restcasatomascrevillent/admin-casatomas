import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Novedad {
  id: string;
  titulo: string;
  descripcion: string | null;
  imagen_url: string | null;
  tipo: "item_carta" | "anuncio";
  tipo_asociacion: "plato" | "vino" | "bebida" | "seccion" | null;
  plato_id: string | null;
  vino_id: string | null;
  bebida_id: string | null;
  seccion: string | null;
  fecha_inicio: string;
  fecha_fin: string | null;
  activo: boolean;
  destacado: boolean;
  orden: number;
  titulo_en: string | null;
  titulo_fr: string | null;
  descripcion_en: string | null;
  descripcion_fr: string | null;
  badge_text: string | null;
  badge_text_en: string | null;
  badge_text_fr: string | null;
  icono: string | null;
  bullets: string[] | null;
  bullets_en: string[] | null;
  bullets_fr: string[] | null;
  tags: string[] | null;
  tags_en: string[] | null;
  tags_fr: string[] | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface NuevaNovedad {
  titulo?: string;
  descripcion?: string;
  imagen_url?: string;
  tipo: "item_carta" | "anuncio";
  tipo_asociacion?: "plato" | "vino" | "bebida" | "seccion" | null;
  plato_id?: string | null;
  vino_id?: string | null;
  bebida_id?: string | null;
  seccion?: string | null;
  fecha_inicio?: string;
  fecha_fin?: string | null;
  activo?: boolean;
  destacado?: boolean;
  orden?: number;
  titulo_en?: string | null;
  titulo_fr?: string | null;
  descripcion_en?: string | null;
  descripcion_fr?: string | null;
  badge_text?: string | null;
  icono?: string | null;
  bullets?: string[] | null;
  tags?: string[] | null;
}

export function useNovedades() {
  const queryClient = useQueryClient();

  const { data: novedades = [], isLoading } = useQuery({
    queryKey: ["novedades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("novedades")
        .select("*")
        .order("destacado", { ascending: false })
        .order("orden", { ascending: true })
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Novedad[];
    },
  });

  const novedadesActivas = novedades.filter((n) => {
    if (!n.activo) return false;
    const hoy = new Date().toISOString().split("T")[0];
    if (n.fecha_inicio > hoy) return false;
    if (n.fecha_fin && n.fecha_fin < hoy) return false;
    return true;
  });

  const crearNovedad = useMutation({
    mutationFn: async (novedad: NuevaNovedad) => {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("novedades")
        .insert({
          ...novedad,
          titulo: novedad.titulo || "",
          created_by: userData?.user?.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novedades"] });
      toast.success("Novedad creada correctamente");
    },
    onError: (error) => {
      toast.error("Error al crear la novedad: " + error.message);
    },
  });

  const actualizarNovedad = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Novedad> & { id: string }) => {
      const { data, error } = await supabase
        .from("novedades")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novedades"] });
      toast.success("Novedad actualizada correctamente");
    },
    onError: (error) => {
      toast.error("Error al actualizar la novedad: " + error.message);
    },
  });

  const eliminarNovedad = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("novedades").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novedades"] });
      toast.success("Novedad eliminada correctamente");
    },
    onError: (error) => {
      toast.error("Error al eliminar la novedad: " + error.message);
    },
  });

  const toggleActivo = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await supabase
        .from("novedades")
        .update({ activo })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novedades"] });
    },
  });

  const toggleDestacado = useMutation({
    mutationFn: async ({ id, destacado }: { id: string; destacado: boolean }) => {
      const { error } = await supabase
        .from("novedades")
        .update({ destacado })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novedades"] });
    },
  });

  return {
    novedades,
    novedadesActivas,
    isLoading,
    crearNovedad,
    actualizarNovedad,
    eliminarNovedad,
    toggleActivo,
    toggleDestacado,
  };
}
