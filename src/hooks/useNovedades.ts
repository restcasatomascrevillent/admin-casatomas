import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { camposSinTraducir, normalizarTraduccionNovedad } from "@/lib/traduccion-novedad";

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
  imagen_url?: string | null;
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

  // Los avisos (toast) los muestra quien llama: antes el hook y el editor
  // mostraban cada uno el suyo y cada guardado salía dos veces.
  const { data: novedades = [], isLoading, isError, error, refetch } = useQuery({
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

      // Traducción automática al crear — SOLO como red de seguridad.
      //
      // El editor (EditorNovedadesWeb) ya traduce antes de guardar y manda
      // las columnas *_en/*_fr rellenas. Antes este hook traducía SIEMPRE
      // tras el insert y machacaba cualquier traducción que viniera del
      // editor (incluidas las corregidas a mano). Ahora solo actúa si la
      // fila llega sin traducción, p. ej. si el traductor falló en el editor.
      //
      // 'traducir-contenido' (tipo 'novedad') SOLO traduce y devuelve
      // {ok, translations}; la escritura en la tabla la hace este hook.
      // No bloqueante: si falla, la novedad queda creada en español.
      if (!data.titulo_en && !data.titulo_fr) {
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

          const t = !tradError && tradRes?.ok ? normalizarTraduccionNovedad(tradRes.translations) : null;
          // Igual que el editor: una traducción a medias no se guarda.
          const faltan = t ? camposSinTraducir(data, t) : [];
          if (faltan.length > 0) {
            console.error("Traducción de la novedad incompleta, no se guarda:", faltan);
          } else if (t) {
            const { error: updateError } = await supabase
              .from("novedades")
              .update({
                titulo_en: t.titulo_en || null,
                titulo_fr: t.titulo_fr || null,
                descripcion_en: t.descripcion_en || null,
                descripcion_fr: t.descripcion_fr || null,
                badge_text_en: t.badge_text_en || null,
                badge_text_fr: t.badge_text_fr || null,
                bullets_en: t.bullets_en.length ? t.bullets_en : null,
                bullets_fr: t.bullets_fr.length ? t.bullets_fr : null,
                tags_en: t.tags_en.length ? t.tags_en : null,
                tags_fr: t.tags_fr.length ? t.tags_fr : null,
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
        }
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novedades"] });
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
    },
  });

  const eliminarNovedad = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("novedades").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novedades"] });
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

  /**
   * Guarda un nuevo orden. Recibe los ids en el orden deseado y escribe
   * `orden` = posición. La web pública ordena por destacado DESC, orden ASC.
   */
  const reordenar = useMutation({
    mutationFn: async (idsOrdenados: string[]) => {
      const resultados = await Promise.all(
        idsOrdenados.map((id, index) =>
          supabase.from("novedades").update({ orden: index }).eq("id", id)
        )
      );
      const fallo = resultados.find((r) => r.error);
      if (fallo?.error) throw fallo.error;
    },
    onSettled: () => {
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
    isError,
    error,
    refetch,
    crearNovedad,
    actualizarNovedad,
    eliminarNovedad,
    toggleActivo,
    toggleDestacado,
    reordenar,
  };
}
