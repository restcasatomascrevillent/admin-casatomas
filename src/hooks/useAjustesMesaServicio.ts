import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { AjusteMesa } from "@/lib/reservas/piezasMesa";

// Ajustes de piezas/picos/uniones de las mesas de una sala en un servicio
// (fecha + comida/cena). El plano base (`mesas`) no se toca. Lógica pura en
// `src/lib/reservas/piezasMesa.ts`.

export type TurnoServicio = "comida" | "cena";

export const CLAVE_AJUSTES_MESA = "ajustes_mesa_servicio";

export function useAjustesMesaServicio(espacioId: string, fecha: string, turno: TurnoServicio | null) {
  return useQuery({
    queryKey: [CLAVE_AJUSTES_MESA, espacioId, fecha, turno],
    enabled: !!espacioId && !!fecha && !!turno,
    queryFn: async (): Promise<AjusteMesa[]> => {
      const { data, error } = await supabase
        .from("ajustes_mesa_servicio")
        .select("mesa_id, piezas, picos, unida_a, plazas")
        .eq("espacio_id", espacioId)
        .eq("fecha", fecha)
        .eq("turno", turno as string);
      // Sin la migración aplicada la tabla no existe: se trabaja con el plano base.
      if (error) {
        console.warn("ajustes_mesa_servicio:", error.message);
        return [];
      }
      return (data ?? []).map((a) => ({
        mesaId: a.mesa_id,
        piezas: a.piezas,
        picos: a.picos,
        unidaA: a.unida_a,
        plazas: a.plazas,
      }));
    },
  });
}

/** Guarda de golpe (un solo upsert) el estado final de las mesas tocadas. */
export function useGuardarAjustesMesa(espacioId: string, fecha: string, turno: TurnoServicio | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cambios: AjusteMesa[]) => {
      if (!turno) throw new Error("Elige comida o cena para ajustar las mesas.");
      if (cambios.length === 0) return;
      const filas = cambios.map((c) => ({
        mesa_id: c.mesaId,
        espacio_id: espacioId,
        fecha,
        turno,
        piezas: c.piezas,
        picos: c.picos,
        unida_a: c.unidaA,
        plazas: c.plazas ?? null,
        updated_at: new Date().toISOString(),
      }));
      const { data, error } = await supabase
        .from("ajustes_mesa_servicio")
        .upsert(filas, { onConflict: "mesa_id,fecha,turno" })
        .select("id");
      if (error) throw error;
      if ((data ?? []).length !== filas.length) throw new Error("No se han podido guardar todos los cambios (permisos).");
    },
    onError: (e: Error) => toast.error(`No se ha podido ajustar la mesa: ${e.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: [CLAVE_AJUSTES_MESA, espacioId, fecha, turno] }),
  });
}

/**
 * «Volver al plano base»: borra TODOS los ajustes de ese servicio y sala. No
 * toca asignaciones. Con RLS sin permiso el DELETE no falla: devuelve 0 filas,
 * por eso se compara con las que había.
 */
export function useVolverAPlanoBase(espacioId: string, fecha: string, turno: TurnoServicio | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (esperadas: number) => {
      if (!turno) throw new Error("Elige comida o cena.");
      const { data, error } = await supabase
        .from("ajustes_mesa_servicio")
        .delete()
        .eq("espacio_id", espacioId)
        .eq("fecha", fecha)
        .eq("turno", turno)
        .select("id");
      if (error) throw error;
      if (esperadas > 0 && (data ?? []).length === 0) throw new Error("No tienes permiso para cambiar las mesas.");
      return (data ?? []).length;
    },
    onError: (e: Error) => toast.error(`No se ha podido volver al plano base: ${e.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: [CLAVE_AJUSTES_MESA, espacioId, fecha, turno] }),
  });
}
