import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SalaPublica {
  id: string;
  nombre: string;
  descripcion: string | null;
  capacidad_maxima: number;
  numero_mesas: number;
  caracteristicas: any;
}

export const useSalasPublicas = () => {
  return useQuery({
    queryKey: ["salas-publicas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("salas" as any)
        .select("*")
        .eq("activa", true)
        .order("nombre");
      
      if (error) throw error;
      return data as any;
    },
  });
};
