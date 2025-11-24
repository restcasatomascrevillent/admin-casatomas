import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface HistorialAjuste {
  id: string;
  fecha: string;
  tipo_carta: "platos" | "bebidas" | "vinos";
  categoria: string;
  porcentaje: number;
  items_afectados: number;
  snapshot: Array<{
    id: string;
    nombre: string;
    precio_anterior: number;
    precio_nuevo: number;
  }>;
  created_at: string;
}

export function useHistorialAjustes() {
  const queryClient = useQueryClient();

  const { data: historial, isLoading } = useQuery({
    queryKey: ["historial-ajustes-precios"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("historial_ajustes_precios")
        .select("*")
        .order("fecha", { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data || []).map(item => ({
        ...item,
        snapshot: item.snapshot as any,
      })) as HistorialAjuste[];
    },
  });

  const guardarAjuste = useMutation({
    mutationFn: async (ajuste: Omit<HistorialAjuste, "id" | "created_at" | "fecha">) => {
      const { error } = await supabase
        .from("historial_ajustes_precios")
        .insert({
          tipo_carta: ajuste.tipo_carta,
          categoria: ajuste.categoria,
          porcentaje: ajuste.porcentaje,
          items_afectados: ajuste.items_afectados,
          snapshot: ajuste.snapshot,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["historial-ajustes-precios"] });
    },
  });

  const eliminarAjuste = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("historial_ajustes_precios")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["historial-ajustes-precios"] });
      toast.success("Entrada del historial eliminada");
    },
    onError: () => {
      toast.error("Error al eliminar entrada del historial");
    },
  });

  return {
    historial,
    isLoading,
    guardarAjuste,
    eliminarAjuste,
  };
}
