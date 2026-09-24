import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export function useResenas() {
  const queryClient = useQueryClient();

  // Suscripción en tiempo real — refresca automáticamente cuando llegan reseñas nuevas
  useEffect(() => {
    const channel = supabase
      .channel("resenas-cambios")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "resenas" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["resenas"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

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

export function useConfigGooglePlaces() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("config-google-places")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "config_google_places" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["config-google-places"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ["config-google-places"],
    queryFn: async () => {
      const { data } = await supabase
        .from("config_google_places")
        .select("*")
        .single();
      return data;
    },
  });
}
