/**
 * «Estilo del feed» (12/11/2026): cómo monta la IA las imágenes de los posts
 * y carruseles. «Solo foto» (por defecto, como el feed real de la cuenta) o
 * «Con rótulos». Se guarda en instagram_ajustes (una fila; migración
 * 20261127100000_instagram_ajustes_estilo_feed.sql). Si no se puede leer (sin
 * la migración o sin permiso), vale el de por defecto: «Solo foto».
 * La tabla no está en src/integrations/supabase/types.ts: se consulta sin tipos.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ESTILO_FEED_POR_DEFECTO, ESTILOS_FEED, type EstiloFeed } from "@/lib/instagram/montar";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabla fuera de los tipos generados.
const sb = supabase as any;

export const CLAVE_ESTILO_FEED = ["instagram_ajustes", "estilo_feed"] as const;

export const NOMBRE_ESTILO_FEED: Record<EstiloFeed, string> = {
  solo_foto: "Solo foto",
  rotulos: "Con rótulos",
};

/** Valor guardado → EstiloFeed (lo desconocido, el de por defecto). */
export function estiloDesdeValor(v: unknown): EstiloFeed {
  return ESTILOS_FEED.includes(v as EstiloFeed) ? (v as EstiloFeed) : ESTILO_FEED_POR_DEFECTO;
}

/** Estilo guardado; el de por defecto si no se puede leer. Nunca lanza. */
export async function leerEstiloFeed(): Promise<EstiloFeed> {
  try {
    const { data, error } = await sb.from("instagram_ajustes").select("estilo_feed").eq("id", true).maybeSingle();
    if (error || !data) return ESTILO_FEED_POR_DEFECTO;
    return estiloDesdeValor(data.estilo_feed);
  } catch {
    return ESTILO_FEED_POR_DEFECTO;
  }
}

export async function guardarEstiloFeed(estilo: EstiloFeed): Promise<void> {
  const { data, error } = await sb.from("instagram_ajustes").update({ estilo_feed: estilo }).eq("id", true).select("id");
  if (error) throw new Error(error.message || "No se pudo guardar el estilo del feed");
  if (!data?.length) throw new Error("No se ha guardado: hace falta «Editar» en Marketing (o aplicar la migración de los ajustes de Instagram).");
}

/** Estilo del feed (mientras carga, el de por defecto) y su guardado. */
export function useEstiloFeed(activo = true) {
  const qc = useQueryClient();
  const consulta = useQuery({ queryKey: CLAVE_ESTILO_FEED, queryFn: leerEstiloFeed, staleTime: 60_000, enabled: activo });
  const guardar = useMutation({
    mutationFn: guardarEstiloFeed,
    onSuccess: (_, estilo) => qc.setQueryData(CLAVE_ESTILO_FEED, estilo),
  });
  return { estilo: consulta.data ?? ESTILO_FEED_POR_DEFECTO, cargando: consulta.isLoading, guardar };
}
