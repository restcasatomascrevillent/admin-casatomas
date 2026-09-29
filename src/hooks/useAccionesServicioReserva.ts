// ============================================================================
// Acciones de servicio sobre una reserva: mover de espacio, marcar llegada,
// "no se presentó" y deshacer.
// ----------------------------------------------------------------------------
// · Update optimista sobre TODAS las listas de reservas cacheadas por React
//   Query (Kanban, "Reservas de hoy", lista completa) con rollback si falla.
// · NINGUNA de estas acciones invoca `notify-reservation-change`: mover de
//   sala o registrar la llegada no son cambios que se comuniquen al cliente,
//   y 'completada' / 'no_show' no tienen plantilla de correo
//   (emails-reserva: tipoEmailParaEstado). Deshacer vuelve a 'confirmada'
//   también SIN correo — el cliente ya tenía su confirmación.
// · `llegada_at` es opcional: si la migración 20260923_reservas_llegada.sql
//   no está aplicada, el primer UPDATE falla con "columna inexistente", se
//   recuerda y se reintenta sin ella (ver servicioSala.ts).
// Reglas puras en `src/lib/reservas/servicioSala.ts`.
// ============================================================================

import { useCallback, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  ESTADO_LLEGADA,
  ESTADO_NO_SHOW,
  ESTADO_TRAS_DESHACER,
  aplicarCambioReserva,
  esErrorColumnaLlegadaInexistente,
  mensajeErrorServicio,
  puedeMoverReserva,
  type ReservaServicio,
} from "@/lib/reservas/servicioSala";

/** Prefijos de las consultas que contienen listas de filas de `reservas`. */
export const CLAVES_LISTAS_RESERVAS = ["reservas-kanban", "reservas-hoy", "reservas-lista"] as const;

/** Consultas derivadas (contadores, ocupación) que hay que refrescar después. */
const CLAVES_DERIVADAS = [
  "reservas_hoy_resumen",
  "reservas_hoy_todas",
  "ocupacion_hoy",
  "today-reservations",
  "today-confirmed-reservations",
  "dashboard-stats",
  "reservas_mes",
  // Rejilla "Ocupación de salas" (useOcupacionSalasDia): mover de sala o
  // marcar llegada cambia la ocupación por sala.
  "ocupacion-salas-dia",
];

// null = aún no se sabe; se descubre en el primer UPDATE que la incluya.
let columnaLlegadaDisponible: boolean | null = null;
/** Solo para tests. */
export function __resetColumnaLlegadaParaTests() {
  columnaLlegadaDisponible = null;
}

type CambiosReserva = Partial<Pick<ReservaServicio, "estado" | "espacio_id" | "llegada_at">>;

/**
 * Escritura sin filas afectadas: RLS la ha filtrado en silencio (o la reserva
 * ya no existe). Mismo criterio que `useCambiarSalaReserva`.
 */
export class ErrorSinFilasReserva extends Error {
  constructor() {
    super("no tienes permiso para cambiar esta reserva, o ya no existe.");
    this.name = "ErrorSinFilasReserva";
  }
}

async function escribirReserva(id: string, cambios: CambiosReserva) {
  const payload: Record<string, unknown> = { ...cambios };
  if ("llegada_at" in payload && columnaLlegadaDisponible === false) {
    delete payload.llegada_at;
  }

  // `.select("id")`: con RLS, una escritura denegada NO da error, devuelve 0
  // filas. Sin comprobarlo, la pantalla diría "hecho" sin haberlo guardado.
  // `as any`: `llegada_at` no está (todavía) en los tipos generados.
  const actualizar = () => supabase.from("reservas" as any).update(payload).eq("id", id).select("id");
  let { data, error } = await actualizar();

  if (error && "llegada_at" in payload && esErrorColumnaLlegadaInexistente(error)) {
    columnaLlegadaDisponible = false;
    delete payload.llegada_at;
    ({ data, error } = await actualizar());
  } else if (!error && "llegada_at" in payload) {
    columnaLlegadaDisponible = true;
  }

  if (error) throw error;
  if (!data || (data as unknown[]).length === 0) throw new ErrorSinFilasReserva();
}

export function useAccionesServicioReserva() {
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
   * Aplica `cambios` en local (optimista), escribe en BD y, si falla,
   * restaura exactamente lo que había en cada caché.
   */
  const ejecutar = useCallback(
    async (id: string, cambios: CambiosReserva, accion: string): Promise<boolean> => {
      marcar(id, true);
      const snapshots: [QueryKey, unknown][] = [];
      for (const clave of CLAVES_LISTAS_RESERVAS) {
        await queryClient.cancelQueries({ queryKey: [clave] });
        snapshots.push(...queryClient.getQueriesData({ queryKey: [clave] }));
        queryClient.setQueriesData({ queryKey: [clave] }, (old: unknown) =>
          Array.isArray(old) ? aplicarCambioReserva(old as { id: string }[], id, cambios as never) : old,
        );
      }

      try {
        await escribirReserva(id, cambios);
        return true;
      } catch (error) {
        for (const [key, data] of snapshots) queryClient.setQueryData(key, data);
        console.error(`[servicio-reserva] Error al ${accion}:`, error);
        toast.error(mensajeErrorServicio(error, accion));
        return false;
      } finally {
        marcar(id, false);
        for (const clave of [...CLAVES_LISTAS_RESERVAS, ...CLAVES_DERIVADAS]) {
          queryClient.invalidateQueries({ queryKey: [clave] });
        }
      }
    },
    [queryClient],
  );

  const moverEspacio = useCallback(
    async (reserva: ReservaServicio, destinoId: string | null, nombreDestino: string) => {
      if (!puedeMoverReserva(reserva.estado)) {
        toast.error("Esta reserva no se puede mover.");
        return false;
      }
      const origen = reserva.espacio_id ?? null;
      const ok = await ejecutar(reserva.id, { espacio_id: destinoId }, "mover la reserva");
      if (ok) {
        toast.success(`${reserva.nombre || "Reserva"} → ${nombreDestino}`, {
          duration: 10_000,
          action: {
            label: "Deshacer",
            onClick: () => {
              void ejecutar(reserva.id, { espacio_id: origen }, "deshacer el movimiento");
            },
          },
        });
      }
      return ok;
    },
    [ejecutar],
  );

  const marcarLlegada = useCallback(
    async (reserva: ReservaServicio) => {
      const estadoPrevio = reserva.estado;
      const ok = await ejecutar(
        reserva.id,
        { estado: ESTADO_LLEGADA, llegada_at: new Date().toISOString() },
        "registrar la llegada",
      );
      if (ok) {
        toast.success(`${reserva.nombre || "Cliente"} ha llegado`, {
          duration: 10_000,
          action: {
            label: "Deshacer",
            onClick: () => {
              void ejecutar(reserva.id, { estado: estadoPrevio, llegada_at: null }, "deshacer la llegada");
            },
          },
        });
      }
      return ok;
    },
    [ejecutar],
  );

  /** Deshacer "llegó" o "no se presentó" más tarde: vuelve a 'confirmada'. */
  const deshacerLlegadaONoShow = useCallback(
    async (reserva: ReservaServicio) => {
      const ok = await ejecutar(
        reserva.id,
        { estado: ESTADO_TRAS_DESHACER, llegada_at: null },
        reserva.estado === ESTADO_NO_SHOW ? "quitar el «no se presentó»" : "deshacer la llegada",
      );
      if (ok) toast.success("Reserva devuelta a «Confirmada»");
      return ok;
    },
    [ejecutar],
  );

  const marcarNoShow = useCallback(
    async (reserva: ReservaServicio) => {
      const estadoPrevio = reserva.estado;
      const ok = await ejecutar(
        reserva.id,
        { estado: ESTADO_NO_SHOW, llegada_at: null },
        "marcar «no se presentó»",
      );
      if (ok) {
        toast.success(`${reserva.nombre || "Reserva"}: no se presentó`, {
          duration: 10_000,
          action: {
            label: "Deshacer",
            onClick: () => {
              void ejecutar(reserva.id, { estado: estadoPrevio }, "deshacer el «no se presentó»");
            },
          },
        });
      }
      return ok;
    },
    [ejecutar],
  );

  return {
    moverEspacio,
    marcarLlegada,
    marcarNoShow,
    deshacerLlegadaONoShow,
    estaEnCurso: (id: string) => enCurso.has(id),
  };
}
