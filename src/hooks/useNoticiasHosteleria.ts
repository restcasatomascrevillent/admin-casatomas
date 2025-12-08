import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Noticia {
  id: string;
  titulo: string;
  fuente: string;
  fecha: string;
  categoria: string;
  enlace: string;
  descripcion: string | null;
}

export function useNoticiasHosteleria(categoria: string = "todas") {
  return useQuery({
    queryKey: ["noticias-hosteleria", categoria],
    queryFn: async () => {
      // Calcular fecha de hace 2 semanas
      const dosSemanasAtras = new Date();
      dosSemanasAtras.setDate(dosSemanasAtras.getDate() - 14);
      const fechaLimite = dosSemanasAtras.toISOString().split('T')[0];

      let query = supabase
        .from("noticias_hosteleria")
        .select("*")
        .gte("fecha", fechaLimite)
        .order("fecha", { ascending: false });

      // Filtrar por categoría si no es "todas"
      if (categoria !== "todas") {
        query = query.eq("categoria", categoria);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data || []) as Noticia[];
    },
    staleTime: 1000 * 60 * 5, // Cache por 5 minutos
  });
}
