import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCampanasActivas() {
  return useQuery({
    queryKey: ["campanas-activas"],
    queryFn: async () => {
      const { data } = await supabase
        .from("campanas_marketing")
        .select("*")
        .in("estado", ["activa", "pausada"])
        .order("fecha_inicio", { ascending: false });
      return data || [];
    },
  });
}
