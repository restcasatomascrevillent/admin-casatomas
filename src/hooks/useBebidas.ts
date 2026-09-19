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

/** Llama a traducir-contenido; nunca lanza. Si falla, devuelve null y el
 * caller guarda la bebida igualmente sin traducción (ver informe, TAREA 2). */
async function traducirBebida(datos: {
  nombre: string;
  descripcion: string;
  categoria: string;
}): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.functions.invoke("traducir-contenido", {
      body: { tipo: "bebida", datos },
    });
    if (error || !data?.ok) {
      console.error("Traducción de bebida no disponible:", error || data?.error);
      return null;
    }
    return data.translations as Record<string, unknown>;
  } catch (err) {
    console.error("Error llamando a traducir-contenido:", err);
    return null;
  }
}

/** Avisa a rebuild-webs de que hay contenido nuevo. Nunca bloquea ni rompe el
 * guardado: si falla, solo se registra en consola (ver informe). */
function dispararRebuildWebs(origen: string) {
  supabase.functions
    .invoke("rebuild-webs", { body: { origen } })
    .catch((err) => console.error("rebuild-webs no disponible:", err));
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
      const traducciones = await traducirBebida({
        nombre: nuevaBebida.nombre,
        descripcion: nuevaBebida.descripcion || "",
        categoria: nuevaBebida.categoria,
      });

      const { data, error } = await supabase
        .from("Bebidas")
        .insert([
          {
            id: crypto.randomUUID(),
            nombre: nuevaBebida.nombre,
            categoria: nuevaBebida.categoria,
            precio_eur: nuevaBebida.precio_eur,
            tamano: nuevaBebida.tamano || null,
            orden: nuevaBebida.orden ?? 0,
            activado: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...(traducciones || {}),
          } as any,
        ])
        .select()
        .single();

      if (error) throw error;

      if (!traducciones) {
        toast.warning("Bebida guardada sin traducción automática. Revísala más tarde en inglés/francés.");
      }

      dispararRebuildWebs("bebida");

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas"] });
      toast.success("Bebida creada. Se publicará en la web en unos minutos.");
    },
    onError: (error) => {
      toast.error("Error al crear la bebida");
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
      dispararRebuildWebs("bebida");
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
      dispararRebuildWebs("bebida");
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
      dispararRebuildWebs("bebida");
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
      dispararRebuildWebs("bebida");
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
      dispararRebuildWebs("bebida");
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
