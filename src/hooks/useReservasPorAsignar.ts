import { useEffect, useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { esGradoAsignacion, esTurno, gradoDeReserva, turnoDeHora } from "@/lib/reservas/asignacionMesas";
import { normalizarMarca } from "@/lib/reservas/negocios";
import { CLAVE_RESUMEN_ASIGNACION_DIA, type FilaAsignacionDia } from "@/hooks/useResumenAsignacionDia";
import { estadosDePartida } from "@/lib/reservas/accionesEjecutables";
import { clavesAInvalidar } from "@/lib/reservas/clavesCache";
import { ErrorSinFilasReserva, escribirReserva } from "@/lib/reservas/escribirReserva";
import { etiquetaEstadoReserva } from "@/lib/reservas/estadosReserva";

// ============================================================================
// RESERVAS POR ASIGNAR — panel "Asignación" (reservas-sin-salas, Fase B)
// ----------------------------------------------------------------------------
// Lee `vista_asignacion_dia` (una fila por reserva activa, con sus mesas ya
// contadas en SQL) sobre un RANGO de días. `useResumenAsignacionDia` hace lo
// mismo para un solo día; el panel necesita la ventana de N horas (hasta una
// semana) más lo que venga después.
//
// La clave de caché empieza por `CLAVE_RESUMEN_ASIGNACION_DIA` a propósito:
// las mutaciones de mesas ya invalidan ese prefijo, así que sentar una reserva
// desde el plano refresca también este panel sin tocar esos hooks.
// ============================================================================

export type { FilaAsignacionDia };

export function useReservasPorAsignar(desde: string, hasta: string, opciones?: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  const idCanal = useId();
  const enabled = !!desde && !!hasta && (opciones?.enabled ?? true);
  const queryKey = [CLAVE_RESUMEN_ASIGNACION_DIA, "rango", desde, hasta] as const;

  const query = useQuery({
    queryKey,
    enabled,
    queryFn: async (): Promise<FilaAsignacionDia[]> => {
      const { data, error } = await supabase
        .from("vista_asignacion_dia")
        .select("*")
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: true })
        .order("hora", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).filter(Boolean).map(normalizarFila);
    },
  });

  // Realtime: una reserva nueva, un cambio de sala (también el "Deshacer" de
  // otra pantalla) o una mesa asignada desde el plano mueven la reserva de
  // grupo. Nombre de canal único por instancia (ver useOcupacionSalasDia).
  useEffect(() => {
    if (!enabled) return;
    const refrescar = () =>
      queryClient.invalidateQueries({ queryKey: [CLAVE_RESUMEN_ASIGNACION_DIA, "rango"] });
    const canal = supabase
      .channel(`reservas-por-asignar-${idCanal}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "reservas" }, refrescar)
      .on("postgres_changes", { event: "*", schema: "public", table: "asignaciones_mesa" }, refrescar)
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [enabled, idCanal, queryClient]);

  return query;
}

/**
 * Error de escritura sin filas afectadas: la RLS la ha filtrado en silencio, la reserva ya no existe
 * o —la escritura va condicionada a que siga ocupando sitio— otra persona la cambió antes (la
 * canceló, o no vino). El nombre es el de siempre (el panel comprueba `instanceof`); el MENSAJE
 * dice la causa cuando se ha podido averiguar.
 */
export class ErrorSinPermisoSala extends Error {
  constructor(mensaje = MENSAJE_SALA_NO_SE_SABE) {
    super(mensaje);
    this.name = "ErrorSinPermisoSala";
  }
}

const MENSAJE_SALA_NO_SE_SABE =
  "No tienes permiso para cambiar la sala de esta reserva, o la reserva ya no existe o ya ha cambiado de estado.";

/** Qué decirle al personal según por qué no se ha tocado ninguna fila (`escribirReserva` relee el estado). */
function mensajeDeSala(error: ErrorSinFilasReserva): string {
  switch (error.motivo) {
    case "estado_cambiado":
      return `La reserva ya ha cambiado de estado (ahora está «${etiquetaEstadoReserva(error.estadoActual)}») y no se ha cambiado la sala. Se ha refrescado la pantalla.`;
    case "sin_permiso":
      return "No tienes permiso para cambiar la sala de esta reserva.";
    case "sin_permiso_o_inexistente":
      return "No tienes permiso para cambiar la sala de esta reserva, o la reserva ya no existe.";
    default:
      return MENSAJE_SALA_NO_SE_SABE;
  }
}

/**
 * Cambia la sala de una reserva. Es una decisión INTERNA: no invoca
 * `notify-reservation-change` ni ningún otro envío, así que el cliente no
 * recibe correo (mismo criterio que `useAccionesServicioReserva`).
 *
 * Es el mismo cambio que «Mover a…» del kanban (`useAccionesServicioReserva.moverEspacio`)
 * y comparte con él la escritura (`escribirReserva`: pide la fila de vuelta y va
 * condicionada a que la reserva siga ocupando sitio, o sea, no cancelada ni «No vino»)
 * y la lista de claves a refrescar (`clavesCache.ts`). Lo único propio de aquí es que es
 * una mutación de React Query, sin actualización optimista y sin avisos: el panel pone
 * los suyos.
 *
 * OJO: el trigger `trg_reservas_sincronizar_asignaciones` BORRA las mesas
 * asignadas cuando cambia la sala. Quien llama tiene que pedir confirmación
 * antes si la reserva ya tiene mesas.
 *
 * Nunca pone la sala a NULL: `espacioId` es obligatorio.
 */
export function useCambiarSalaReserva() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ reservaId, espacioId }: { reservaId: string; espacioId: string }) => {
      if (!reservaId || !espacioId) throw new Error("Falta la reserva o la sala");
      try {
        // Con RLS, una escritura denegada NO da error, devuelve 0 filas: `escribirReserva`
        // lo trata como error para que la pantalla no diga «guardado» sin haberlo.
        const filas = await escribirReserva(reservaId, { espacio_id: espacioId }, { desdeEstados: estadosDePartida("mover") });
        return filas[0];
      } catch (error) {
        if (error instanceof ErrorSinFilasReserva) throw new ErrorSinPermisoSala(mensajeDeSala(error));
        throw error;
      }
    },
    onSettled: () => {
      for (const clave of clavesAInvalidar({ espacio_id: null })) {
        queryClient.invalidateQueries({ queryKey: [clave] });
      }
    },
  });
}

/**
 * Saneado de una fila de la vista. Mismas reglas que `useResumenAsignacionDia`
 * (allí no está exportado): las columnas de una vista llegan todas nullable, y
 * `turno`/`grado` se recalculan con la lógica pura si no son válidos.
 */
function normalizarFila(fila: Record<string, unknown>): FilaAsignacionDia {
  const hora = String(fila.hora ?? "");
  const espacioId = fila.espacio_id ? String(fila.espacio_id) : null;
  const mesasAsignadas = entero(fila.mesas_asignadas);
  return {
    reserva_id: String(fila.reserva_id ?? ""),
    fecha: String(fila.fecha ?? ""),
    hora,
    turno: esTurno(fila.turno) ? fila.turno : turnoDeHora(hora),
    nombre: String(fila.nombre ?? ""),
    numero_comensales: entero(fila.numero_comensales),
    estado: String(fila.estado ?? ""),
    marca: normalizarMarca(fila.marca as string | null),
    espacio_id: espacioId,
    espacio_nombre: fila.espacio_nombre ? String(fila.espacio_nombre) : null,
    mesas_asignadas: mesasAsignadas,
    plazas_asignadas: entero(fila.plazas_asignadas),
    mesas_nombres: Array.isArray(fila.mesas_nombres) ? (fila.mesas_nombres as string[]).filter(Boolean) : [],
    grado: esGradoAsignacion(fila.grado)
      ? fila.grado
      : gradoDeReserva({ espacio_id: espacioId, mesas_asignadas: mesasAsignadas }),
  };
}

const entero = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};
