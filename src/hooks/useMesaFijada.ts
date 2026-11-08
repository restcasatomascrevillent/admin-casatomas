// ============================================================================
// «Fijar mesa» de una reserva (07/11/2026)
// ----------------------------------------------------------------------------
// `reservas.mesa_fijada` (migración 20261107120000): «gente que quiere esa mesa
// y el restaurante lo sabe». Con la mesa fijada, ni «Organizar» ni «Recalcular
// mesas» la mueven y, al sentar a otro, no se le puede quitar.
// Escribe con la RLS de siempre (`reservas_update_seccion`: «Editar» en
// Reservas). Las pantallas solo enseñan la acción con ese permiso.
// ============================================================================

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CLAVES_POR_CAMBIO } from "@/lib/reservas/clavesCache";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

/** Claves a refrescar: las listas de reservas (candado) y las asignaciones (llevan `mesa_fijada` de su reserva). */
const CLAVES = [...CLAVES_POR_CAMBIO.importante, "asignaciones_mesa", "reservas-servicio-dia"];

export function useFijarMesa() {
  const qc = useQueryClient();
  return useCallback(
    /** Devuelve si se ha guardado. `silencioso` = sin toast de éxito (la pantalla avisa a su manera). */
    async (reserva: { id: string; nombre?: string | null }, fijar: boolean, opciones: { silencioso?: boolean } = {}) => {
      const { error } = await supabase
        .from("reservas")
        .update({ mesa_fijada: fijar } as never)
        .eq("id", reserva.id);
      if (error) {
        toast.error(mensajeUsuario(error));
        return false;
      }
      for (const clave of new Set(CLAVES)) void qc.invalidateQueries({ queryKey: [clave] });
      if (!opciones.silencioso) {
        const quien = reserva.nombre?.trim() || "la reserva";
        toast.success(fijar ? `Mesa fijada para ${quien}` : `${quien}: mesa sin fijar`);
      }
      return true;
    },
    [qc],
  );
}
