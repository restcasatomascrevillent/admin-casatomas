import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CLAVES_POR_CAMBIO } from "@/lib/reservas/clavesCache";
import { mensajeErrorAsignacion, turnoDeHora } from "@/lib/reservas/asignacionMesas";
import type { AjusteMesa } from "@/lib/reservas/piezasMesa";
import type { MesaOpcion } from "@/lib/reservas/hoyMovil";
import {
  CANAL_SIN_RESERVA,
  CANAL_SIN_RESERVA_RESPALDO,
  esErrorCanal,
  filaSinReserva,
} from "@/lib/reservas/sentarAhora";
import { CLAVE_AJUSTES_MESA, guardarAjustesServicio } from "@/hooks/useAjustesMesaServicio";

// «SIN RESERVA» (walk-in): crea una reserva de hoy, ya sentada («Llegó»), en la
// mesa elegida. Sin correo ni aviso al cliente (no se llama a
// notify-reservation-change) y sin teléfono, así que no hay lista negra que
// mirar. El trigger de aforo deja pasar una reserva que nace «completada».

export interface EntradaSinReserva {
  fecha: string;
  hora: string;
  personas: number;
  nombre?: string | null;
  mesa: MesaOpcion | null;
  /** Ajustes de piezas a guardar antes (propuesta aceptada). */
  cambios?: AjusteMesa[];
}

export interface ResultadoSinReserva {
  id: string;
  nombre: string;
  /** La reserva se creó pero la mesa no se pudo asignar (otro la cogió antes). */
  errorMesa: string | null;
}

export function useSentarSinReserva() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: EntradaSinReserva): Promise<ResultadoSinReserva> => {
      if (e.mesa && e.cambios?.length) {
        await guardarAjustesServicio(e.mesa.espacioId, e.fecha, turnoDeHora(e.hora), e.cambios);
      }
      const base = { fecha: e.fecha, hora: e.hora, personas: e.personas, nombre: e.nombre, espacioId: e.mesa?.espacioId ?? null };
      const insertar = (canal: string) =>
        supabase
          .from("reservas" as never)
          .insert(filaSinReserva({ ...base, canal }) as never)
          .select("id, nombre")
          .single();
      let res = await insertar(CANAL_SIN_RESERVA);
      if (res.error && esErrorCanal(res.error)) res = await insertar(CANAL_SIN_RESERVA_RESPALDO);
      if (res.error) throw res.error;
      const fila = res.data as unknown as { id: string; nombre: string };

      let errorMesa: string | null = null;
      if (e.mesa) {
        const { error } = await supabase.rpc("asignar_mesas_reserva", {
          p_reserva_id: fila.id,
          p_mesa_ids: [e.mesa.id],
        });
        if (error) errorMesa = mensajeErrorAsignacion(error);
      }
      return { id: fila.id, nombre: fila.nombre, errorMesa };
    },
    onSettled: () => {
      for (const clave of CLAVES_POR_CAMBIO.ocupacion) qc.invalidateQueries({ queryKey: [clave] });
      qc.invalidateQueries({ queryKey: [CLAVE_AJUSTES_MESA] });
    },
  });
}

/** «Deshacer» del aviso: la reserva sin reserva pasa a cancelada (el trigger le quita la mesa). */
export async function deshacerSinReserva(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("reservas" as never)
    .update({ estado: "cancelada" } as never)
    .eq("id", id)
    .select("id");
  return !error && ((data as unknown[] | null) ?? []).length > 0;
}
