import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUsuarioIdOpcional } from "@/hooks/useAuth";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { toast } from "sonner";

// «Reservas online comida / cena» de un día (vista Hoy). Tabla `servicios_bloqueados`
// (fecha, turno, motivo, created_at, created_by; PK fecha+turno): una fila = ese
// servicio NO admite reservas de la web ni del teléfono automático. Desde el panel
// se sigue pudiendo apuntar. Bloquear = insertar la fila; desbloquear = borrarla.
//
// Sin realtime (la tabla no está en la publicación): se relee cada minuto
// (`REFRESCO_PERIODICO`) y al volver a la pestaña. Si la tabla aún no existe
// (migración sin aplicar) el panel no se rompe: `disponible = false` y los
// interruptores salen desactivados.

export type TurnoBloqueable = "comida" | "cena";

export const CLAVE_SERVICIOS_BLOQUEADOS = "servicios_bloqueados";

// La tabla está en los tipos, pero se accede sin tipar para no depender de que el
// cliente generado la conozca en todos los entornos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabla = () => supabase.from(CLAVE_SERVICIOS_BLOQUEADOS as any) as any;

interface Estado {
  turnos: TurnoBloqueable[];
  disponible: boolean;
}

export function useServiciosBloqueados(fecha: string) {
  const qc = useQueryClient();
  const usuarioId = useUsuarioIdOpcional();
  const clave = [CLAVE_SERVICIOS_BLOQUEADOS, fecha];

  const { data } = useQuery<Estado>({
    ...REFRESCO_PERIODICO,
    queryKey: clave,
    enabled: !!fecha,
    queryFn: async () => {
      const { data, error } = await tabla().select("turno").eq("fecha", fecha);
      if (error) return { turnos: [], disponible: false };
      const turnos = ((data ?? []) as Array<{ turno: string }>)
        .map((f) => f.turno)
        .filter((t): t is TurnoBloqueable => t === "comida" || t === "cena");
      return { turnos, disponible: true };
    },
  });

  const mutacion = useMutation({
    mutationFn: async ({ turno, bloquear }: { turno: TurnoBloqueable; bloquear: boolean }) => {
      const { error } = bloquear
        ? await tabla().insert({ fecha, turno, created_by: usuarioId })
        : await tabla().delete().eq("fecha", fecha).eq("turno", turno);
      // 23505: ya estaba bloqueado (otra tablet): el resultado es el mismo.
      if (error && error.code !== "23505") throw error;
    },
    onMutate: async ({ turno, bloquear }) => {
      await qc.cancelQueries({ queryKey: clave });
      const anterior = qc.getQueryData<Estado>(clave);
      const turnos = new Set(anterior?.turnos ?? []);
      if (bloquear) turnos.add(turno);
      else turnos.delete(turno);
      qc.setQueryData<Estado>(clave, { turnos: [...turnos], disponible: true });
      return { anterior };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.anterior) qc.setQueryData(clave, ctx.anterior);
      toast.error("No se ha podido guardar el cambio. Inténtalo de nuevo.");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: clave });
    },
  });

  const cambiar = useCallback(
    (turno: TurnoBloqueable, bloquear: boolean) => mutacion.mutate({ turno, bloquear }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mutate` es estable
    [mutacion.mutate],
  );

  const bloqueados = data?.turnos ?? [];
  return {
    /** ¿Ese servicio está bloqueado para reservas online? */
    estaBloqueado: (turno: TurnoBloqueable) => bloqueados.includes(turno),
    cambiar,
    /** false si la tabla no existe todavía (migración sin aplicar) o aún no ha cargado. */
    disponible: data?.disponible ?? false,
    guardando: mutacion.isPending,
  };
}
