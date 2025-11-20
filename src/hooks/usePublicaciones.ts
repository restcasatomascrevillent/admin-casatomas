import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function usePublicaciones() {
  return useQuery({
    queryKey: ["publicaciones"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("publicaciones_redes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      return data;
    },
  });
}
