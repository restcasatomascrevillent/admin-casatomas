import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { combinarAlergenos, parseAlergenos } from "@/lib/alergenos";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";

export interface Plato {
  id: string;
  nombre: string | null;
  categoria: string | null;
  precio_eur: number | null;
  descripcion: string | null;
  ingredientes: string | null;
  unidad: string | null;
  alergenos_oficiales: any;
  alergenos_inferidos: any;
  alergenos_notas: string | null;
  orden: string | null;
  activado: boolean | null;
  expanded: boolean | null;
  imagen_url: string | null;
  imagen_posicion_y: number | null;
  touza: boolean | null;
  restaurante: boolean | null;
  featured: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface NuevoPlato {
  nombre: string;
  categoria: string;
  precio_eur: number;
  descripcion?: string;
  ingredientes?: string;
  unidad?: string;
  alergenos_oficiales?: any;
  alergenos_notas?: string;
  orden?: string;
}

/**
 * Deja la lista de alérgenos en el vocabulario canónico (ver
 * `src/lib/alergenos.ts`): acepta snake_case antiguo, acentos, mayúsculas y
 * singular/plural, y devuelve siempre la misma forma sin duplicados. Es la
 * última barrera antes de escribir en BD, para que ningún formulario cuele
 * `frutos_cascara` junto a `frutos de cáscara`.
 */
function normalizarAlergenos(alergenos_oficiales: unknown): string[] {
  return combinarAlergenos(parseAlergenos(alergenos_oficiales));
}

/** Llama a traducir-contenido; nunca lanza. Si falla, devuelve null y el
 * caller guarda el plato igualmente sin traducción (ver informe, TAREA 2). */
async function traducirPlato(datos: {
  nombre: string;
  descripcion: string;
  ingredientes: string;
  categoria: string;
  alergenos: string[];
}): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.functions.invoke("traducir-contenido", {
      body: { tipo: "plato", datos },
    });
    if (error || !data?.ok) {
      console.error("Traducción de plato no disponible:", error || data?.error);
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
  notificarGuardadoYPublicacion("plato", mensajeBase);
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
      return data as unknown as Plato[];
    },
  });

  const crearPlato = useMutation({
    mutationFn: async (nuevoPlato: NuevoPlato) => {
      const alergenosArray = normalizarAlergenos(nuevoPlato.alergenos_oficiales);

      // 1. Traducir primero (no escribe nada; solo devuelve las columnas *_en/*_fr).
      const traducciones = await traducirPlato({
        nombre: nuevoPlato.nombre,
        descripcion: nuevoPlato.descripcion || "",
        ingredientes: nuevoPlato.ingredientes || "",
        categoria: nuevoPlato.categoria,
        alergenos: alergenosArray,
      });

      // 2. El panel escribe su propia carta directamente contra Supabase (RLS detrás).
      const { data, error } = await supabase
        .from("Platos")
        .insert([
          {
            id: crypto.randomUUID(),
            nombre: nuevoPlato.nombre,
            categoria: nuevoPlato.categoria,
            precio_eur: nuevoPlato.precio_eur,
            descripcion: nuevoPlato.descripcion || null,
            ingredientes: nuevoPlato.ingredientes || null,
            unidad: nuevoPlato.unidad || null,
            alergenos_oficiales: alergenosArray.length > 0 ? alergenosArray : null,
            alergenos_notas: nuevoPlato.alergenos_notas || null,
            orden: nuevoPlato.orden ?? "0",
            activado: true,
            expanded: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...(traducciones || {}),
          } as any,
        ])
        .select()
        .single();

      if (error) throw error;

      if (!traducciones) {
        toast.warning("Plato guardado sin traducción automática. Revísala más tarde en inglés/francés.");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      avisar("Plato creado");
    },
    onError: (error) => {
      toast.error("Error al crear el plato");
      console.error(error);
    },
  });

  const actualizarPlato = useMutation({
    mutationFn: async ({ id, ...cambios }: Partial<Plato> & { id: string }) => {
      // Si la edición toca alérgenos, se guarda en vocabulario canónico.
      if ("alergenos_oficiales" in cambios) {
        const normalizados = normalizarAlergenos(cambios.alergenos_oficiales);
        cambios.alergenos_oficiales = normalizados.length > 0 ? normalizados : null;
      }

      const { data, error } = await supabase
        .from("Platos")
        .update(cambios as any)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      avisar("Plato actualizado");
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
      avisar("Plato eliminado");
    },
    onError: (error) => {
      toast.error("Error al eliminar el plato");
      console.error(error);
    },
  });

  const toggleActivado = useMutation({
    mutationFn: async ({ id, activado }: { id: string; activado: boolean; nombre?: string }) => {
      const { error } = await supabase
        .from("Platos")
        .update({ activado })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_data, { activado, nombre }) => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      avisar(
        activado
          ? `${nombre || "Plato"} vuelve a estar activo`
          : `${nombre || "Plato"} despublicado: deja de verse en la web`,
      );
    },
    onError: (error) => {
      toast.error("Error al cambiar el estado");
      console.error(error);
    },
  });

  const toggleExpanded = useMutation({
    mutationFn: async ({ id, expanded }: { id: string; expanded: boolean; nombre?: string }) => {
      const { error } = await supabase
        .from("Platos")
        .update({ expanded })
        .eq("id", id);

      if (error) throw error;
    },
    // `expanded` se prerenderiza en la carta web, así que también hay que
    // republicar (antes no se hacía y el cambio no llegaba nunca a la web).
    onSuccess: (_data, { expanded, nombre }) => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      avisar(
        `${nombre || "Plato"} se mostrará ${expanded ? "expandido" : "normal"} en la carta web`,
      );
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
      avisar("Todas las fotos expandidas");
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
      avisar("Todas las fotos contraídas");
    },
    onError: (error) => {
      toast.error("Error al contraer las fotos");
      console.error(error);
    },
  });

  const toggleRestaurante = useMutation({
    mutationFn: async ({ id, restaurante }: { id: string; restaurante: boolean }) => {
      const { error } = await supabase
        .from("Platos")
        .update({ restaurante })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
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
        .from("Platos")
        .update({ touza })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      avisar("Visibilidad en Touza actualizada");
    },
    onError: (error) => {
      toast.error("Error al cambiar visibilidad Touza");
      console.error(error);
    },
  });

  const categorias = platos
    ? Array.from(new Set(platos.map((p) => p.categoria).filter(Boolean)))
    : [];

  const unidades = platos
    ? Array.from(new Set(platos.map((p) => p.unidad).filter(Boolean)))
    : [];

  return {
    platos,
    isLoading,
    categorias,
    unidades,
    crearPlato,
    actualizarPlato,
    eliminarPlato,
    toggleActivado,
    toggleExpanded,
    expandirTodos,
    contraerTodos,
    toggleRestaurante,
    toggleTouza,
  };
}
