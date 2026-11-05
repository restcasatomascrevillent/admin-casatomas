/**
 * Historial de piezas de Instagram (tabla `instagram_piezas`, con RLS): las más
 * recientes primero. Tipos de `src/integrations/supabase/types.ts` (a mano,
 * fase 0 de Instagram): solo se estrechan `estado` y `datos`.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type EstadoPieza = "borrador" | "generada" | "prueba_ok" | "publicada" | "error";

/**
 * Fila de instagram_piezas. alt_text (20261107000000) e imagen_borrada_at
 * (20261107010000) faltan mientras sus migraciones no estén aplicadas.
 */
export type PiezaInstagram = Omit<Tables<"instagram_piezas">, "estado" | "datos" | "alt_text" | "imagen_borrada_at" | "drive_id" | "publicada_at"> & {
  estado: EstadoPieza;
  datos: Record<string, unknown> | null;
  alt_text?: string | null;
  imagen_borrada_at?: string | null;
  drive_id?: string | null;
  publicada_at?: string | null;
};

export const CLAVE_PIEZAS = ["instagram_piezas"] as const;
/** Tope del historial: suficiente para la lista y no carga cientos de filas. */
export const LIMITE_HISTORIAL = 60;

export function usePiezasInstagram() {
  return useQuery({
    queryKey: CLAVE_PIEZAS,
    queryFn: async (): Promise<PiezaInstagram[]> => {
      const { data, error } = await supabase
        .from("instagram_piezas")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(LIMITE_HISTORIAL);
      if (error) throw error;
      return (data ?? []) as PiezaInstagram[];
    },
  });
}
