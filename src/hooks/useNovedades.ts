import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Novedad {
  id: string;
  titulo: string;
  descripcion: string | null;
  imagen_url: string | null;
  imagen_posicion_y: number | null;
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
  imagen_posicion_y?: number;
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
  badge_text_en?: string | null;
  badge_text_fr?: string | null;
  icono?: string | null;
  bullets?: string[] | null;
  bullets_en?: string[] | null;
  bullets_fr?: string[] | null;
  tags?: string[] | null;
  tags_en?: string[] | null;
  tags_fr?: string[] | null;
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

      // Traducción automática al crear.
      //
      // Antes: 'traducir-novedad-auto', que era un proxy al webhook
      // /webhook/traducciones de n8n. Era n8n quien ESCRIBÍA las traducciones
      // en la fila (por eso aquí se descartaba la respuesta).
      // Ahora: 'traducir-contenido' (tipo 'novedad'), que SOLO traduce y
      // devuelve {ok, translations}. Como ya no hay nadie detrás que escriba,
      // la escritura en la tabla la hace este hook — si no, la traducción se
      // calcularía y se tiraría.
      //
      // Se mantiene el carácter no bloqueante del original: si la traducción
      // falla, la novedad queda creada en español y no se rompe el flujo.
      try {
        const { data: tradRes, error: tradError } = await supabase.functions.invoke(
          'traducir-contenido',
          {
            body: {
              tipo: 'novedad',
              datos: {
                titulo: data.titulo,
                descripcion: data.descripcion,
                badge_text: data.badge_text,
                bullets: data.bullets,
                tags: data.tags,
              },
            },
          }
        );

        const t = !tradError && tradRes?.ok ? tradRes.translations : null;
        if (t) {
          const { error: updateError } = await supabase
            .from("novedades")
            .update({
              titulo_en: t.titulo_en,
              titulo_fr: t.titulo_fr,
              descripcion_en: t.descripcion_en,
              descripcion_fr: t.descripcion_fr,
              badge_text_en: t.badge_text_en,
              badge_text_fr: t.badge_text_fr,
              bullets_en: t.bullets_en,
              bullets_fr: t.bullets_fr,
              tags_en: t.tags_en,
              tags_fr: t.tags_fr,
            })
            .eq("id", data.id);
          if (updateError) {
            console.error("Error al guardar las traducciones de la novedad:", updateError);
          }
        } else if (tradError) {
          console.error("Error al traducir la novedad:", tradError);
        }
      } catch (tradException) {
        console.error("Error al traducir la novedad:", tradException);
        // No bloqueamos el flujo si la traducción falla
      }

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
