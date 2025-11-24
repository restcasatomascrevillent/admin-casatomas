import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Noticia {
  titulo: string;
  fuente: string;
  fecha: string;
  categoria: string;
  enlace: string;
  descripcion?: string;
}

export function useNoticiasHosteleria(categoria: string = "todas") {
  return useQuery({
    queryKey: ["noticias-hosteleria", categoria],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("fetch-noticias-hosteleria", {
        body: { categoria },
      });

      if (error) throw error;

      return (data?.noticias || []) as Noticia[];
    },
    staleTime: 1000 * 60 * 30, // Cache por 30 minutos
  });
}
