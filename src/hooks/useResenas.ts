import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useResenas() {
  return useQuery({
    queryKey: ["resenas"],
    queryFn: async () => {
      const { data } = await supabase
        .from("resenas")
        .select("*")
        .eq("estado", "publicada")
        .order("fecha", { ascending: false });
      return data || [];
    },
  });
}

export function useResenasRecientes(limit = 5) {
  return useQuery({
    queryKey: ["resenas-recientes", limit],
    queryFn: async () => {
      const { data } = await supabase
        .from("resenas")
        .select("*")
        .eq("estado", "publicada")
        .order("fecha", { ascending: false })
        .limit(limit);
      return data || [];
    },
  });
}
