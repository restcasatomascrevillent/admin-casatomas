import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";

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
  touza: boolean | null;
  restaurante: boolean | null;
  featured: boolean | null;
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

/** Llama a traducir-contenido; nunca lanza. Si falla, devuelve null y el
 * caller guarda el cóctel igualmente sin traducción (ver informe, TAREA 2).
 * NOTA: "coctel" no existía como tipo en el switch de n8n (TraducirIA.json),
 * así que hasta ahora nunca se traducía NI se insertaba nada en Cocteles;
 * de ahí 0/13 cócteles traducidos. */
async function traducirCoctel(datos: {
  nombre: string;
  descripcion: string;
  ingredientes: string;
  categoria: string;
}): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.functions.invoke("traducir-contenido", {
      body: { tipo: "coctel", datos },
    });
    if (error || !data?.ok) {
      console.error("Traducción de cóctel no disponible:", error || data?.error);
      return null;
    }
    return data.translations as Record<string, unknown>;
  } catch (err) {
    console.error("Error llamando a traducir-contenido:", err);
    return null;
  }
}

/** Avisa a rebuild-webs de que hay contenido nuevo y cuenta al usuario si el
 * cambio se ha publicado o solo se ha guardado (ver `src/lib/rebuild-webs.ts`).
 * Nunca bloquea ni rompe el guardado. */
function avisar(mensajeBase: string) {
  notificarGuardadoYPublicacion("coctel", mensajeBase);
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
      const traducciones = await traducirCoctel({
        nombre: nuevoCoctel.nombre,
        descripcion: nuevoCoctel.descripcion || "",
        ingredientes: nuevoCoctel.ingredientes || "",
        categoria: nuevoCoctel.categoria,
      });

      const { data, error } = await supabase
        .from("Cocteles")
        .insert([
          {
            id: crypto.randomUUID(),
            nombre: nuevoCoctel.nombre,
            categoria: nuevoCoctel.categoria,
            precio_eur: nuevoCoctel.precio_eur,
            descripcion: nuevoCoctel.descripcion || null,
            ingredientes: nuevoCoctel.ingredientes || null,
            preparacion: nuevoCoctel.preparacion || null,
            activado: true,
            orden: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...(traducciones || {}),
          } as any,
        ])
        .select()
        .single();

      if (error) throw error;

      if (!traducciones) {
        toast.warning("Cóctel guardado sin traducción automática. Revísalo más tarde en inglés/francés.");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cocteles"] });
      avisar("Cóctel creado");
    },
    onError: (error) => {
      toast.error("Error al crear el cóctel");
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
      avisar("Cóctel actualizado");
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
      avisar("Cóctel eliminado");
    },
    onError: (error) => {
      toast.error("Error al eliminar el cóctel");
      console.error(error);
    },
  });

  const toggleActivado = useMutation({
    mutationFn: async ({ id, activado }: { id: string; activado: boolean; nombre?: string }) => {
      const { error } = await supabase
        .from("Cocteles")
        .update({ activado })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_data, { activado, nombre }) => {
      queryClient.invalidateQueries({ queryKey: ["cocteles"] });
      avisar(
        activado
          ? `${nombre || "Cóctel"} vuelve a estar activo`
          : `${nombre || "Cóctel"} despublicado: deja de verse en la web`,
      );
    },
    onError: (error) => {
      toast.error("Error al cambiar el estado");
      console.error(error);
    },
  });

  const toggleRestaurante = useMutation({
    mutationFn: async ({ id, restaurante }: { id: string; restaurante: boolean }) => {
      const { error } = await supabase
        .from("Cocteles")
        .update({ restaurante })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cocteles"] });
      avisar("Visibilidad en Restaurante actualizada");
    },
    onError: (error) => {
      toast.error("Error al cambiar visibilidad Restaurante");
      console.error(error);
    },
  });

  const toggleTouza = useMutation({
    mutationFn: async ({ id, touza }: { id: string; touza: boolean }) => {
      const { error } = await supabase
        .from("Cocteles")
        .update({ touza })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cocteles"] });
      avisar("Visibilidad en Touza actualizada");
    },
    onError: (error) => {
      toast.error("Error al cambiar visibilidad Touza");
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
    toggleRestaurante,
    toggleTouza,
  };
}
