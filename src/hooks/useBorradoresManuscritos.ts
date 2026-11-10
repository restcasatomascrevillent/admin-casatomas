import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Borradores del libro de reservas: lo escrito a mano y guardado sin interpretar
// (10/11/2026, «guardar y ya luego se interpretan, por si no da tiempo»).
// Tabla `reservas_borradores_manuscritos` (migración 20261122180000), aún fuera de
// los tipos generados: se accede sin tipar y se tipa aquí.

export interface BorradorManuscrito {
  id: string;
  fecha: string;
  imagen: string;
  created_at: string;
}

export const CLAVE_BORRADORES_MANUSCRITOS = "reservas-borradores-manuscritos";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabla = () => (supabase as any).from("reservas_borradores_manuscritos");

/** Todos los borradores pendientes (de cualquier día), del más antiguo al más nuevo. */
export function useBorradoresPendientes(activo = true) {
  return useQuery({
    queryKey: [CLAVE_BORRADORES_MANUSCRITOS],
    enabled: activo,
    refetchInterval: 60_000,
    queryFn: async (): Promise<BorradorManuscrito[]> => {
      const { data, error } = await tabla()
        .select("id, fecha, imagen, created_at")
        .eq("estado", "pendiente")
        .order("fecha", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as BorradorManuscrito[];
    },
  });
}

export function useGuardarBorrador() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ fecha, imagen }: { fecha: string; imagen: string }) => {
      const { error } = await tabla().insert({ fecha, imagen });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: [CLAVE_BORRADORES_MANUSCRITOS] }),
  });
}

/** Marca un borrador como pasado a limpio (con su reserva) o descartado. */
export function useResolverBorrador() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, estado, reservaId }: { id: string; estado: "pasado" | "descartado"; reservaId?: string | null }) => {
      const { error } = await tabla()
        .update({ estado, reserva_id: reservaId ?? null, resuelto_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: [CLAVE_BORRADORES_MANUSCRITOS] }),
  });
}
