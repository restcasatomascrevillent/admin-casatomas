import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
      const platoId = crypto.randomUUID();
      
      // 1. Crear el plato primero
      const { data, error } = await supabase
        .from("Platos")
        .insert([{
          ...nuevoPlato,
          activado: true,
          expanded: isNovedades,
          id: platoId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }])
        .select()
        .single();

      if (error) throw error;

      // 2. Llamar al webhook de traducción en background
      // alergenos_oficiales puede ser un array de strings o un objeto con booleanos
      let alergenosArray: string[] = [];
      if (nuevoPlato.alergenos_oficiales) {
        if (Array.isArray(nuevoPlato.alergenos_oficiales)) {
          alergenosArray = nuevoPlato.alergenos_oficiales;
        } else if (typeof nuevoPlato.alergenos_oficiales === 'object') {
          alergenosArray = Object.keys(nuevoPlato.alergenos_oficiales).filter(k => nuevoPlato.alergenos_oficiales[k]);
        }
      }

      supabase.functions.invoke('traducir-carta-auto', {
        body: {
          tipo: 'plato',
          nombre: nuevoPlato.nombre,
          descripcion: nuevoPlato.descripcion || '',
          categoria: nuevoPlato.categoria,
          alergenos: alergenosArray,
        }
      }).then(async ({ data: traducciones, error: tradError }) => {
        if (tradError) {
          console.error('Error en traducción automática:', tradError);
          return;
        }

        console.log('Traducciones recibidas:', traducciones);

        // Parsear respuesta del webhook [{ "traduccion ingles": {...}, "traduccion_fr": {...} }]
        const traduccion = Array.isArray(traducciones) ? traducciones[0] : traducciones;
        if (!traduccion) return;

        const updateData: Record<string, string | null> = {};

        // Inglés
        if (traduccion['traduccion ingles']) {
          const en = traduccion['traduccion ingles'];
          updateData.nombre_en = en.nombre || null;
          updateData.descripcion_en = en.descripcion || null;
          updateData.categoria_en = en.categoria || null;
          updateData.alergenos_en = en.alergenos || null;
        }

        // Francés
        if (traduccion['traduccion_fr']) {
          const fr = traduccion['traduccion_fr'];
          updateData.nombre_fr = fr.nombre || null;
          updateData.descripcion_fr = fr.descripcion || null;
          updateData.categoria_fr = fr['catégorie'] || fr.categoria || null;
          updateData.alergenos_fr = fr.allergenes || fr.alergenos || null;
        }

        if (Object.keys(updateData).length > 0) {
          const { error: updateError } = await supabase
            .from("Platos")
            .update(updateData)
            .eq("id", platoId);

          if (updateError) {
            console.error('Error guardando traducciones:', updateError);
          } else {
            console.log('Traducciones guardadas correctamente');
            queryClient.invalidateQueries({ queryKey: ["platos"] });
          }
        }
      });

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
  };
}
