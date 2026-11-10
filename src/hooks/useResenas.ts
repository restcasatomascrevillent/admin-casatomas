import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import type { AjustesContestador, ResenaPanel } from "@/lib/resenas/contestador";

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
    // Todas, también las ocultas en la web (el panel las marca): antes solo se veían las publicadas y, en la demo,
    // con las 11 reseñas ocultas la página salía vacía.
    queryFn: async (): Promise<ResenaPanel[]> => {
      const { data, error } = await supabase
        .from("resenas")
        .select("*")
        .order("fecha", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ResenaPanel[];
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

/** Ajustes del contestador (una fila, solo super admin). `null` si la migración aún no está aplicada. */
export function useAjustesContestador() {
  return useQuery({
    queryKey: ["resenas-ajustes"],
    queryFn: async (): Promise<AjustesContestador | null> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("resenas_ajustes").select("*").eq("id", true).maybeSingle();
      if (error) return null;
      return (data ?? null) as AjustesContestador | null;
    },
  });
}
