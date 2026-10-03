import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { agruparSuscriptores, type SuscriptorNewsletter } from "@/lib/newsletter/bajas";

export type NewsletterSuscriptor = SuscriptorNewsletter;

// Las bajas llegan solas (enlace del correo, botón one-click del cliente de
// correo, queja de spam o rebote vía resend-webhook): nadie del personal las
// teclea. Para que el panel las refleje sin recargar se vuelve a consultar
// cada minuto y al volver a la pestaña — mismo criterio que el resto del panel
// mientras la publicación de Realtime no incluya estas tablas.
const REFRESCO_MS = 60_000;

export function useNewsletterSuscriptores() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["newsletter-suscriptores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("newsletter_suscriptores")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as SuscriptorNewsletter[];
    },
    refetchInterval: REFRESCO_MS,
    refetchOnWindowFocus: true,
  });

  const { activos, bajas } = useMemo(() => agruparSuscriptores(data ?? []), [data]);

  return {
    /** Solo los activos: son los únicos que reciben envíos. */
    suscriptores: activos,
    totalSuscriptores: activos.length,
    bajas,
    totalBajas: bajas.length,
    isLoading,
    error,
    refetch,
  };
}
