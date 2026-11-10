// ============================================================================
// useCambiarPersonas — cambiar el número de personas de una reserva desde «Hoy»
// ----------------------------------------------------------------------------
// 10/11/2026, petición del dueño: «en Hoy se tiene que poder cambiar el número
// de personas también, intuitivamente». Escribe SOLO `numero_comensales`, igual
// que la edición de reservas (`FormularioReserva`): mismo mínimo de la
// configuración, mismo `update … select("id")` (RLS sin filas = sin permiso) y
// mismo mensaje de error (`mensajeErrorEdicion`: el trigger de aforo dice «No hay
// aforo suficiente…»). Refresca lo mismo que la edición (`CLAVES_POR_CAMBIO.ocupacion`).
// Aviso con «Deshacer». Si la reserva tiene mesa y ya no cabe, avisa (no bloquea).
// ============================================================================

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { CLAVES_POR_CAMBIO } from "@/lib/reservas/clavesCache";
import { ErrorSinFilasEdicion, mensajeErrorEdicion } from "@/lib/reservas/edicionReserva";

export interface ReservaPersonas {
  id: string;
  nombre?: string | null;
  numero_comensales: number;
}

/** Texto del aviso si `personas` no caben en las mesas de la reserva (`plazas` = suma), o `null`. */
export function avisoNoCaben(personas: number, plazas: number | null): string | null {
  if (!plazas || personas <= plazas) return null;
  return `Son ${personas} y su mesa es de ${plazas}: quizá haya que juntar mesas o cambiarla.`;
}

/** Plazas de las mesas que tiene la reserva (0 si no tiene). Si falla la lectura, `null`: sin aviso. */
async function plazasDeSusMesas(reservaId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from("asignaciones_mesa")
      .select("mesas(capacidad)")
      .eq("reserva_id", reservaId);
    if (error) return null;
    return ((data ?? []) as Array<{ mesas: { capacidad: number | null } | null }>).reduce(
      (s, a) => s + (Number(a.mesas?.capacidad) || 0),
      0,
    );
  } catch {
    return null;
  }
}

export function useCambiarPersonas() {
  const qc = useQueryClient();
  const { data: config } = useConfiguracionReservas();
  const minimo = config?.min_comensales_por_reserva ?? 1;

  const cambiar = useCallback(
    async (reserva: ReservaPersonas, personas: number, { silencioso = false }: { silencioso?: boolean } = {}): Promise<boolean> => {
      const anterior = Number(reserva.numero_comensales) || 0;
      if (!Number.isInteger(personas) || personas < minimo) {
        toast.error(`Mínimo ${minimo} comensal(es)`);
        return false;
      }
      if (personas === anterior) return true;
      try {
        const { data, error } = await supabase
          .from("reservas")
          .update({ numero_comensales: personas })
          .eq("id", reserva.id)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new ErrorSinFilasEdicion();
      } catch (e) {
        toast.error(mensajeErrorEdicion(e));
        return false;
      } finally {
        for (const clave of [...CLAVES_POR_CAMBIO.ocupacion, "reserva-edicion"]) void qc.invalidateQueries({ queryKey: [clave] });
      }
      if (silencioso) return true;
      const nombre = reserva.nombre?.trim() || "Reserva";
      const deshacer = {
        label: "Deshacer",
        onClick: () => void cambiar({ ...reserva, numero_comensales: personas }, anterior, { silencioso: true }),
      };
      const aviso = personas > anterior ? avisoNoCaben(personas, await plazasDeSusMesas(reserva.id)) : null;
      if (aviso) toast.warning(`${nombre}: ${anterior} → ${personas} personas`, { description: aviso, action: deshacer });
      else toast.success(`${nombre}: ${anterior} → ${personas} personas`, { action: deshacer });
      return true;
    },
    [qc, minimo],
  );
  return cambiar;
}
