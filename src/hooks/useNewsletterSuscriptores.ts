import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface NewsletterSuscriptor {
  id: string;
  email: string;
  nombre: string | null;
  activo: boolean;
  created_at: string;
}

export function useNewsletterSuscriptores() {
  const { data: suscriptores, isLoading, error, refetch } = useQuery({
    queryKey: ["newsletter-suscriptores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("newsletter_suscriptores")
        .select("*")
        .eq("activo", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as NewsletterSuscriptor[];
    },
  });

  return {
    suscriptores: suscriptores ?? [],
    totalSuscriptores: suscriptores?.length ?? 0,
    isLoading,
    error,
    refetch,
  };
}

export function useNewsletterEnvios() {
  const { data: envios, isLoading, error, refetch } = useQuery({
    queryKey: ["newsletter-envios"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("newsletter_envios")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) throw error;
      return data;
    },
  });

  return {
    envios: envios ?? [],
    isLoading,
    error,
    refetch,
  };
}
