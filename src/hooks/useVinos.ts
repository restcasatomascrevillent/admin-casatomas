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
      const vinoId = crypto.randomUUID();

      // 1. Crear el vino primero
      const { data, error } = await supabase
        .from("Vinos")
        .insert([{
          ...nuevoVino,
          activado: true,
          id: vinoId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }])
        .select()
        .single();

      if (error) throw error;

      // 2. Llamar al webhook de traducción en background
      supabase.functions.invoke('traducir-carta-auto', {
        body: {
          tipo: 'vino',
          nombre: nuevoVino.nombre,
          descripcion: nuevoVino.descripcion || '',
          ingredientes: nuevoVino.ingredientes || '',
          categoria: nuevoVino.categoria,
          ubicacion_pais: nuevoVino.ubicacion_pais || '',
          ubicacion_region: nuevoVino.ubicacion_region || '',
          alergenos_notas: nuevoVino.alergenos_notas || '',
        }
      }).then(async ({ data: traducciones, error: tradError }) => {
        if (tradError) {
          console.error('Error en traducción automática:', tradError);
          return;
        }

        console.log('Traducciones recibidas:', traducciones);

        // Parsear respuesta del webhook
        const traduccion = Array.isArray(traducciones) ? traducciones[0] : traducciones;
        if (!traduccion) return;

        const updateData: Record<string, string | null> = {};

        // Inglés
        if (traduccion['traduccion ingles']) {
          const en = traduccion['traduccion ingles'];
          updateData.nombre_en = en.nombre || null;
          updateData.descripcion_en = en.descripcion || null;
          updateData.categoria_en = en.categoria || null;
          updateData.alergenos_en = en.alergenos_notas || en.alergenos || null;
          updateData.ubicacion_pais_en = en.ubicacion_pais || null;
          updateData.ubicacion_region_en = en.ubicacion_region || null;
        }

        // Francés
        if (traduccion['traduccion_fr']) {
          const fr = traduccion['traduccion_fr'];
          updateData.nombre_fr = fr.nombre || null;
          updateData.descripcion_fr = fr.descripcion || null;
          updateData.categoria_fr = fr['catégorie'] || fr.categoria || null;
          updateData.alergenos_fr = fr.allergenes_notes || fr.alergenos_notas || null;
          updateData.ubicacion_pais_fr = fr.ubicacion_pais || fr['pays'] || null;
          updateData.ubicacion_region_fr = fr.ubicacion_region || fr['région'] || null;
        }

        if (Object.keys(updateData).length > 0) {
          const { error: updateError } = await supabase
            .from("Vinos")
            .update(updateData)
            .eq("id", vinoId);

          if (updateError) {
            console.error('Error guardando traducciones:', updateError);
          } else {
            console.log('Traducciones guardadas correctamente');
            queryClient.invalidateQueries({ queryKey: ["vinos"] });
          }
        }
      });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      toast.success("Vino añadido correctamente");
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
