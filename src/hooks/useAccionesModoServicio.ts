import { useCallback, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CLAVE_RESERVAS_SERVICIO_DIA } from "@/hooks/useReservasServicioDia";
import { CLAVE_ASIGNACIONES_MESA } from "@/hooks/useAsignacionesMesa";
import { CLAVE_OCUPACION_SALAS_DIA } from "@/hooks/useOcupacionSalasDia";

// ============================================================================
// ACCIONES DEL MODO SERVICIO — liberar mesa y deshacer.
// ----------------------------------------------------------------------------
// "Ha llegado" (antes «Sentar»: marcar llegada) reutiliza `useAccionesServicioReserva.marcarLlegada`
// tal cual — no hay nada de servicio-específico ahí. "Mover a otra mesa"
// reutiliza `useAsignarMesasReserva` (RPC atómico, ya valida el
// `uq_asignaciones_mesa_mesa_fecha_turno` en servidor). Lo que SÍ es propio de
// esta pantalla es "Liberar" / "Deshacer liberar": tocan `reservas.salida_at`,
// una columna que no existía antes de esta fase.
//
// CONCURRENCIA (dos camareros con la tablet a la vez): el UPDATE lleva la
// condición previa en el propio `.eq()/.is()` — no es "leer, decidir en JS,
// escribir", que tendría ventana de carrera. Si la fila ya no cumple la
// condición (alguien ya liberó, o alguien ya deshizo antes que tú), el UPDATE
// afecta 0 filas: `.select()` sobre un UPDATE sin match devuelve `data: []`
// (sin error), así que se distingue de un fallo real y se avisa con un toast
// específico en vez del genérico de error, y se refresca la query para que la
// pantalla muestre el estado real inmediatamente.
// ============================================================================

/** Reserva mínima que necesitan estas acciones. */
export interface ReservaAccionModoServicio {
  id: string;
  nombre?: string | null;
}

function invalidarTodo(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: [CLAVE_RESERVAS_SERVICIO_DIA] });
  queryClient.invalidateQueries({ queryKey: [CLAVE_ASIGNACIONES_MESA] });
  queryClient.invalidateQueries({ queryKey: [CLAVE_OCUPACION_SALAS_DIA] });
}

export function useAccionesModoServicio() {
  const queryClient = useQueryClient();
  const [enCurso, setEnCurso] = useState<Set<string>>(new Set());

  const marcar = (id: string, activo: boolean) =>
    setEnCurso((prev) => {
      const next = new Set(prev);
      if (activo) next.add(id);
      else next.delete(id);
      return next;
    });

  /**
   * Pone `salida_at = null` SOLO si hoy tiene un valor (nadie lo había
   * deshecho ya). 0 filas afectadas = otra persona se adelantó: se avisa y se
   * refresca, sin tratarlo como error. Declarada ANTES de `liberarMesa` para
   * que el toast de "Deshacer" de esa acción pueda referenciarla.
   */
  const deshacerLiberarMesa = useCallback(
    async (reserva: ReservaAccionModoServicio) => {
      marcar(reserva.id, true);
      try {
        const { data, error } = await (supabase.from("reservas" as any) as any)
          .update({ salida_at: null })
          .eq("id", reserva.id)
          .not("salida_at", "is", null)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) {
          toast.warning("Otra persona ya actualizó esta mesa. Se ha refrescado el plano.");
          invalidarTodo(queryClient);
          return false;
        }
        toast.success("Mesa vuelta a ocupada");
        invalidarTodo(queryClient);
        return true;
      } catch (error) {
        console.error("[modo-servicio] Error al deshacer la liberación:", error);
        toast.error(mensajeErrorServicioSala(error, "deshacer la liberación"));
        return false;
      } finally {
        marcar(reserva.id, false);
      }
    },
    [queryClient],
  );

  /**
   * Pone `salida_at = ahora` SOLO si hoy está a `null` (nadie la había
   * liberado ya). Misma lógica de 0-filas que `deshacerLiberarMesa`.
   */
  const liberarMesa = useCallback(
    async (reserva: ReservaAccionModoServicio) => {
      marcar(reserva.id, true);
      try {
        const { data, error } = await (supabase.from("reservas" as any) as any)
          .update({ salida_at: new Date().toISOString() })
          .eq("id", reserva.id)
          .is("salida_at", null)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) {
          toast.warning("Otra persona ya actualizó esta mesa. Se ha refrescado el plano.");
          invalidarTodo(queryClient);
          return false;
        }
        // LIMITACIÓN CONOCIDA (MVP): "Deshacer" solo existe mientras este toast
        // está en pantalla (10 s). Una vez se cierra, la mesa pasa a "libre" y
        // `estadoMesaServicio` ya no la relaciona con esta reserva (ver
        // `ocupaMesaServicio` en servicioSala.ts), así que no hay UI para
        // deshacer una liberación antigua sin ir a la reserva desde otra
        // pantalla (lista/Kanban) y quitarle manualmente `salida_at`. Un
        // "Liberadas recientemente" en la hoja de la mesa cubriría esto; se
        // deja fuera del MVP a propósito (dueño, 2026-09-26).
        toast.success(`${reserva.nombre || "Mesa"}: liberada`, {
          duration: 10_000,
          action: {
            label: "Deshacer",
            onClick: () => {
              void deshacerLiberarMesa(reserva);
            },
          },
        });
        invalidarTodo(queryClient);
        return true;
      } catch (error) {
        console.error("[modo-servicio] Error al liberar mesa:", error);
        toast.error(mensajeErrorServicioSala(error, "liberar la mesa"));
        return false;
      } finally {
        marcar(reserva.id, false);
      }
    },
    [queryClient, deshacerLiberarMesa],
  );

  return {
    liberarMesa,
    deshacerLiberarMesa,
    estaEnCurso: (id: string) => enCurso.has(id),
  };
}

/** Mensaje legible; distingue la columna `salida_at` sin migrar del resto. */
function mensajeErrorServicioSala(error: unknown, accion: string): string {
  const e = (error ?? {}) as { code?: string; message?: string };
  const texto = String(e.message ?? "");
  if (texto.includes("salida_at") && (e.code === "42703" || e.code === "PGRST204" || /does not exist|schema cache/i.test(texto))) {
    return "El modo servicio aún no está disponible: falta aplicar la migración de base de datos.";
  }
  return `No se pudo ${accion}${e.message ? `: ${e.message}` : "."}`;
}
