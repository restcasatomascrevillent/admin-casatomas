/**
 * Catálogo de fotos de Instagram = las estáticas (FOTOS de src/lib/instagram)
 * + las que suben los usuarios desde el panel (tabla `instagram_fotos`, con
 * RLS de la sección marketing). Mismo tipo `Foto` para las dos: las subidas
 * llevan `subida: true`. La tabla aún no está en `types.ts`: cliente sin tipos.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { combinarCatalogo, fotoDesdeFila, fotosDe, type FilaFotoSubida, type FormatoId, type Foto, type MarcaId } from "@/lib/instagram";

const sb = supabase as unknown as SupabaseClient;

export const CLAVE_FOTOS = ["instagram_fotos"] as const;
/** Tope de fotos subidas que se cargan (de sobra para una biblioteca de restaurante). */
export const LIMITE_FOTOS_SUBIDAS = 500;
export const COLUMNAS_FOTO = "id,marca,ruta,ancho,alto,tipo,descripcion,created_at";

/** Fotos subidas (las dos marcas), las más recientes primero. Las filas raras se descartan. */
export function useFotosSubidas() {
  return useQuery({
    queryKey: CLAVE_FOTOS,
    queryFn: async (): Promise<Foto[]> => {
      const { data, error } = await sb
        .from("instagram_fotos")
        .select(COLUMNAS_FOTO)
        .order("created_at", { ascending: false })
        .limit(LIMITE_FOTOS_SUBIDAS);
      if (error) throw error;
      return ((data ?? []) as FilaFotoSubida[]).map(fotoDesdeFila).filter((f): f is Foto => f !== null);
    },
    staleTime: 60_000,
  });
}

/**
 * Fotos de una marca (y, si se pide, solo las aptas para un formato) del
 * catálogo combinado, y el catálogo entero (para validarPieza y construirDocumento).
 * Si la tabla no responde, sigue funcionando con las estáticas.
 */
export function useFotosInstagram(marca: MarcaId, formato?: FormatoId) {
  const consulta = useFotosSubidas();
  const catalogo = useMemo(() => combinarCatalogo(consulta.data ?? []), [consulta.data]);
  const fotos = useMemo(() => fotosDe(marca, formato, catalogo), [marca, formato, catalogo]);
  return { fotos, catalogo, cargando: consulta.isLoading, error: consulta.error as Error | null };
}
