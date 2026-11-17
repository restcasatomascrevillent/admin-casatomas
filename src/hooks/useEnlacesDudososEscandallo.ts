// Ingredientes de un plato marcados por el servidor como «el producto enlazado no
// parece coincidir con la nota» (escandallo_platos.revisar_enlace, migración
// 20261207231500). La tabla no está en types.ts, de ahí el cast.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Consulta = {
  select: (c: string) => {
    eq: (c: string, v: unknown) => {
      eq: (c: string, v: unknown) => PromiseLike<{ data: { id: number }[] | null; error: { message?: string } | null }>;
    };
  };
};

export function useEnlacesDudososEscandallo(platoId: string | null) {
  return useQuery({
    queryKey: ["analisis", "escandallo-enlaces-dudosos", platoId],
    enabled: !!platoId,
    staleTime: 60_000,
    queryFn: async () => {
      const tabla = (supabase.from as unknown as (t: string) => Consulta)("escandallo_platos");
      const { data, error } = await tabla.select("id").eq("plato_id", platoId).eq("revisar_enlace", true);
      if (error) return new Set<number>(); // sin la migración, simplemente no avisa
      return new Set((data ?? []).map((f) => f.id));
    },
  });
}
