import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Vino {
  id: string;
  nombre: string | null;
  categoria: string | null;
  precio_eur: number | null;
  descripcion: string | null;
  ingredientes: string | null;
  denominacion_origen: string | null;
  ubicacion_pais: string | null;
  ubicacion_region: string | null;
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

export interface NuevoVino {
  nombre: string;
  categoria: string;
  precio_eur: number;
  descripcion?: string;
  ingredientes?: string;
  denominacion_origen?: string;
  ubicacion_pais?: string;
  ubicacion_region?: string;
  alergenos_notas?: string;
  orden?: string;
}

/**
 * Llama a traducir-contenido; nunca lanza. Si falla, devuelve null y el
 * caller guarda el vino igualmente sin traducción (ver informe, TAREA 2).
 *
 * OJO (TAREA 4): a diferencia de Platos/Bebidas/Cocteles, la tabla Vinos NO
 * tiene columnas descripcion_en/descripcion_fr ni denominacion_origen_en/fr.
 * El código anterior (y el propio nodo "Nueva Fila Vino" de n8n) escribía
 * descripcion_en/fr igualmente, lo que Postgrest rechaza con "column does
 * not exist" y tumbaba el UPDATE ENTERO — ninguna traducción se guardaba
 * nunca, ni siquiera nombre_en/categoria_en, que sí tienen columna. La
 * función traducir-contenido (ver prompts.ts) ya devuelve solo las columnas
 * que existen de verdad en Vinos, así que aquí no hace falta filtrar nada.
 */
async function traducirVino(datos: {
  nombre: string;
  descripcion: string;
  ingredientes: string;
  categoria: string;
  ubicacion_pais: string;
  ubicacion_region: string;
  alergenos_notas: string;
}): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.functions.invoke("traducir-contenido", {
      body: { tipo: "vino", datos },
    });
    if (error || !data?.ok) {
      console.error("Traducción de vino no disponible:", error || data?.error);
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

export function useVinos() {
  const queryClient = useQueryClient();

  const { data: vinos, isLoading } = useQuery({
    queryKey: ["vinos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Vinos")
        .select("*")
        .order("orden", { ascending: true });

      if (error) throw error;
      return data as unknown as Vino[];
    },
  });

  const crearVino = useMutation({
    mutationFn: async (nuevoVino: NuevoVino) => {
      // 1. Traducir primero (columnas ya filtradas a lo que existe en Vinos).
      const traducciones = await traducirVino({
        nombre: nuevoVino.nombre,
        descripcion: nuevoVino.descripcion || "",
        ingredientes: nuevoVino.ingredientes || "",
        categoria: nuevoVino.categoria,
        ubicacion_pais: nuevoVino.ubicacion_pais || "",
        ubicacion_region: nuevoVino.ubicacion_region || "",
        alergenos_notas: nuevoVino.alergenos_notas || "",
      });

      // 2. Insertar directamente (antes: solo esto, sin traducción — el resto
      // del flujo viejo dependía de un webhook de n8n roto). Un solo INSERT,
      // sin el UPDATE en segundo plano que fallaba por la columna inexistente.
      const { data, error } = await supabase
        .from("Vinos")
        .insert([
          {
            id: crypto.randomUUID(),
            nombre: nuevoVino.nombre,
            categoria: nuevoVino.categoria,
            precio_eur: nuevoVino.precio_eur,
            descripcion: nuevoVino.descripcion || null,
            ingredientes: nuevoVino.ingredientes || null,
            denominacion_origen: nuevoVino.denominacion_origen || null,
            ubicacion_pais: nuevoVino.ubicacion_pais || null,
            ubicacion_region: nuevoVino.ubicacion_region || null,
            alergenos_notas: nuevoVino.alergenos_notas || null,
            orden: nuevoVino.orden ?? "0",
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
        toast.warning("Vino guardado sin traducción automática. Revísalo más tarde en inglés/francés.");
      }

      dispararRebuildWebs("vino");

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      toast.success("Vino añadido. Se publicará en la web en unos minutos.");
    },
    onError: (error) => {
      toast.error("Error al añadir el vino");
      console.error(error);
    },
  });

  const actualizarVino = useMutation({
    mutationFn: async ({ id, ...cambios }: Partial<Vino> & { id: string }) => {
      const { data, error } = await supabase
        .from("Vinos")
        .update(cambios as any)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      toast.success("Vino actualizado");
      dispararRebuildWebs("vino");
    },
    onError: (error) => {
      toast.error("Error al actualizar el vino");
      console.error(error);
    },
  });

  const eliminarVino = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("Vinos")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      toast.success("Vino eliminado");
      dispararRebuildWebs("vino");
    },
    onError: (error) => {
      toast.error("Error al eliminar el vino");
      console.error(error);
    },
  });

  const toggleActivado = useMutation({
    mutationFn: async ({ id, activado }: { id: string; activado: boolean }) => {
      const { error } = await supabase
        .from("Vinos")
        .update({ activado })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      dispararRebuildWebs("vino");
    },
    onError: (error) => {
      toast.error("Error al cambiar el estado");
      console.error(error);
    },
  });

  const toggleExpanded = useMutation({
    mutationFn: async ({ id, expanded }: { id: string; expanded: boolean }) => {
      const { error } = await supabase
        .from("Vinos")
        .update({ expanded } as any)
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
    },
    onError: (error) => {
      toast.error("Error al cambiar el estado de expandido");
      console.error(error);
    },
  });

  const toggleRestaurante = useMutation({
    mutationFn: async ({ id, restaurante }: { id: string; restaurante: boolean }) => {
      const { error } = await supabase
        .from("Vinos")
        .update({ restaurante })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      dispararRebuildWebs("vino");
    },
    onError: (error) => {
      toast.error("Error al cambiar visibilidad Restaurante");
      console.error(error);
    },
  });

  const toggleTouza = useMutation({
    mutationFn: async ({ id, touza }: { id: string; touza: boolean }) => {
      const { error } = await supabase
        .from("Vinos")
        .update({ touza })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      dispararRebuildWebs("vino");
    },
    onError: (error) => {
      toast.error("Error al cambiar visibilidad Touza");
      console.error(error);
    },
  });

  const categorias = vinos
    ? Array.from(new Set(vinos.map((v) => v.categoria).filter(Boolean))) as string[]
    : [];

  const denominaciones = vinos
    ? Array.from(new Set(vinos.map((v) => v.denominacion_origen).filter(Boolean))) as string[]
    : [];

  const regiones = vinos
    ? Array.from(new Set(vinos.map((v) => v.ubicacion_region).filter(Boolean))) as string[]
    : [];

  const paises = vinos
    ? Array.from(new Set(vinos.map((v) => v.ubicacion_pais).filter(Boolean))) as string[]
    : [];

  return {
    vinos,
    isLoading,
    categorias,
    denominaciones,
    regiones,
    paises,
    crearVino,
    actualizarVino,
    eliminarVino,
    toggleExpanded,
    toggleRestaurante,
    toggleTouza,
  };
}
