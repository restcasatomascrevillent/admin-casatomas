/**
 * Historial de piezas de Instagram (tabla `instagram_piezas`, con RLS): las más
 * recientes primero. La tabla aún no está en `types.ts` (se actualiza a mano), así
 * que se consulta con el cliente sin tipos, como `trabajosVideo.ts`.
 */
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as unknown as SupabaseClient;

export type EstadoPieza = "borrador" | "generada" | "prueba_ok" | "publicada" | "error";

export interface PiezaInstagram {
  id: string;
  marca: string;
  plantilla: string;
  formato: string;
  datos: Record<string, unknown> | null;
  caption: string | null;
  estado: EstadoPieza;
  imagen_ruta: string | null;
  contenedor_id: string | null;
  media_id: string | null;
  permalink: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export const CLAVE_PIEZAS = ["instagram_piezas"] as const;
/** Tope del historial: suficiente para la lista y no carga cientos de filas. */
export const LIMITE_HISTORIAL = 60;

export function usePiezasInstagram() {
  return useQuery({
    queryKey: CLAVE_PIEZAS,
    queryFn: async (): Promise<PiezaInstagram[]> => {
      const { data, error } = await sb
        .from("instagram_piezas")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(LIMITE_HISTORIAL);
      if (error) throw error;
      return (data ?? []) as PiezaInstagram[];
    },
  });
}
