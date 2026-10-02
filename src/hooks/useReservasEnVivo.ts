import { createContext, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CLAVES_POR_CAMBIO } from "@/lib/reservas/clavesCache";
import { crearInvalidacionDiferida, nombreCanalUnico, vigilarCanal } from "@/lib/realtimeCanal";

// ============================================================================
// RESERVAS EN VIVO: la suscripción de las pantallas que no tenían
// ----------------------------------------------------------------------------
// El kanban de «Hoy», la franja «Pendientes de mesa», la línea de estados y el
// Calendario no se enteraban de lo que cambiaba en otro dispositivo (solo al
// volver a la pestaña). Este hook escucha INSERT/UPDATE/DELETE de `reservas` y
// de `asignaciones_mesa` (dar o quitar mesa solo escribe ahí: `asignar_mesas_
// reserva`), cada tabla en su canal, y refresca las consultas que salen de ellas.
//
// QUÉ REFRESCA: lo mismo que un cambio de ocupación hecho desde el panel
// (`CLAVES_POR_CAMBIO.ocupacion`, clavesCache.ts; incluye `asignaciones_mesa` y
// `resumen-asignacion-dia`) MENOS la Lista (`reservas-lista`): la Lista renuncia
// a realtime a propósito (relee todo el histórico por lotes; ver
// ListaReservasAvanzada). `invalidateQueries` solo vuelve a pedir las consultas
// montadas: el resto quedan caducadas sin coste.
//
// INVALIDACIÓN DIFERIDA (`crearInvalidacionDiferida`, realtimeCanal.ts): 1 s tras
// el último evento y como mucho 5 s tras el primero pendiente. Una ráfaga corta
// = UNA invalidación; la carga de la demo (861 filas en un minuto) = una cada 5 s.
//
// RECONEXIÓN: Realtime no reenvía lo perdido mientras el canal estaba caído
// (red, tablet dormida): al recuperarse (SUBSCRIBED a partir del segundo) se
// invalida igual. El primero no: las consultas se acaban de pedir al montar.
//
// SIN la migración 20261001200000 ninguna de las dos tablas está en la
// publicación y no llega nada: lo dice una vez por tabla el aviso `[realtime]`
// de la consola y quedan el refresco periódico (`REFRESCO_PERIODICO`) y el del
// foco de TanStack Query.
//
// Dónde se monta: `VistaHoy` (pestaña Hoy) y `CalendarioOcupacion`, que además
// envuelven su contenido en `ReservasEnVivoContexto`: las rejillas de salas de
// dentro («Disponibilidad por cuartos») no abren otro canal a `reservas`. La
// pestaña Asignación ya tiene la suya (`useReservasPorAsignar`) y la Lista no lo
// quiere.
// ============================================================================

/** Prefijo de los canales; el nombre lleva además la tabla y un número propio de cada suscripción. */
export const PREFIJO_CANAL_RESERVAS_EN_VIVO = "reservas-en-vivo";

/** Las tablas que escucha, cada una en su canal. */
export const TABLAS_RESERVAS_EN_VIVO = ["reservas", "asignaciones_mesa"] as const;

/** Lo que se refresca al llegar un cambio: lo de un cambio de ocupación, sin la Lista. */
export const CLAVES_RESERVAS_EN_VIVO: readonly string[] = CLAVES_POR_CAMBIO.ocupacion.filter(
  (clave) => clave !== "reservas-lista",
);

const PRIMERAS_POSICIONES_EN_VIVO = new Set<unknown>(CLAVES_RESERVAS_EN_VIVO);

/** ¿La refresca un cambio llegado por realtime? Mira la primera posición de la clave. */
export function seRefrescaEnVivo(queryKey: readonly unknown[]): boolean {
  return PRIMERAS_POSICIONES_EN_VIVO.has(queryKey[0]);
}

/**
 * `true` dentro de una pantalla que ya monta `useReservasEnVivo` (la pone su componente alrededor
 * de lo que pinta). `useOcupacionSalasDia` la mira para no abrir un segundo canal a `reservas`:
 * su clave (`ocupacion-salas-dia`) ya la refresca este hook.
 */
export const ReservasEnVivoContexto = createContext(false);

export function useReservasEnVivo(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    // UNA llamada para todas las claves: TanStack Query marca y vuelve a pedir en una sola pasada.
    const diferida = crearInvalidacionDiferida(() => {
      void queryClient.invalidateQueries({ predicate: (consulta) => seRefrescaEnVivo(consulta.queryKey) });
    });

    const canales = TABLAS_RESERVAS_EN_VIVO.map((tabla) => {
      const nombre = nombreCanalUnico(`${PREFIJO_CANAL_RESERVAS_EN_VIVO}-${tabla}`);
      const vigilancia = vigilarCanal(nombre, {
        tabla,
        alSuscribirse: (vez) => {
          if (vez > 1) diferida.programar();
        },
      });
      const canal = supabase
        .channel(nombre)
        .on("system", {}, vigilancia.alMensajeSistema)
        .on("postgres_changes", { event: "*", schema: "public", table: tabla }, diferida.programar)
        .subscribe(vigilancia.alCambiarEstado);
      return { canal, vigilancia };
    });

    return () => {
      diferida.cancelar();
      for (const { canal, vigilancia } of canales) {
        vigilancia.cerrar();
        supabase.removeChannel(canal);
      }
    };
  }, [queryClient]);
}
