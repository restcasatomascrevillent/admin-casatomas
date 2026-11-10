// ============================================================================
// Escribir mesas con cambio local inmediato y quitar la mesa a quien la tenía
// prevista (desplazadas). Salió de `VistaHoyMovil.tsx` (10/11/2026) para que
// «Sin reserva» (`SentarSinReserva.tsx`) use exactamente lo mismo al sentar en
// una mesa prevista para otra reserva.
// ============================================================================

import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAsignarMesasReserva, type AsignacionConDetalles } from "@/hooks/useAsignacionesMesa";
import type { Mesa } from "@/hooks/useMesas";
import { CLAVES_POR_CAMBIO } from "@/lib/reservas/clavesCache";
import { reemplazarMesasEnLista, type Desplazamiento } from "@/lib/reservas/confirmarMesa";
import type { ReservaMesaServicio } from "@/lib/reservas/servicioSala";

/** Igual que `CLAVE_ASIGNACIONES_MESA` (useAsignacionesMesa.ts); aquí sin importarla para el cambio local. */
const CLAVE_ASIGNACIONES = "asignaciones_mesa";

/** Tras un error al escribir, se relee todo lo de ocupación. */
export function refrescarTrasError(qc: QueryClient) {
  for (const clave of CLAVES_POR_CAMBIO.ocupacion) void qc.invalidateQueries({ queryKey: [clave] });
}

/**
 * `asignar_mesas_reserva` con el cambio aplicado YA en la lista de asignaciones de hoy (la de esta vista),
 * para que la vista «Mesas» y las demás filas lo enseñen al momento; la invalidación del hook trae después
 * la verdad. Si falla (MESA_OCUPADA…), el propio hook avisa con el mensaje en español y aquí se relee todo.
 */
export function useAsignarConCambioLocal(fecha: string, mesas: readonly Mesa[]) {
  const qc = useQueryClient();
  const asignar = useAsignarMesasReserva();
  return useCallback(
    async (reservaId: string, mesaIds: string[], reserva?: ReservaMesaServicio) => {
      const mapa = new Map(mesas.map((m) => [m.id, m]));
      const datosReserva = reserva
        ? {
            id: reserva.id,
            nombre: reserva.nombre ?? "",
            hora: reserva.hora,
            numero_comensales: reserva.numero_comensales,
            estado: reserva.estado,
            fecha,
            salida_at: reserva.salida_at ?? null,
          }
        : null;
      qc.setQueriesData<AsignacionConDetalles[]>(
        { predicate: (q) => q.queryKey[0] === CLAVE_ASIGNACIONES && q.queryKey[1] === fecha && q.queryKey[2] == null },
        (antes) => (Array.isArray(antes) ? reemplazarMesasEnLista(antes, reservaId, mesaIds, { mesas: mapa, reserva: datosReserva }) : antes),
      );
      try {
        await asignar.mutateAsync({ reserva_id: reservaId, mesa_ids: mesaIds, silencioso: true });
      } catch (e) {
        refrescarTrasError(qc);
        throw e;
      }
    },
    [asignar, fecha, mesas, qc],
  );
}

/** Quitarles la mesa a las reservas desplazadas; si algo falla después, `deshacer` se las devuelve. */
export function useDesplazar(asignarLocal: ReturnType<typeof useAsignarConCambioLocal>) {
  return useCallback(
    async (desplazadas: readonly Desplazamiento[]) => {
      const hechas: Desplazamiento[] = [];
      for (const d of desplazadas) {
        await asignarLocal(d.reservaId, d.mesaIdsQuedan);
        hechas.push(d);
      }
      return async () => {
        for (const d of hechas) await asignarLocal(d.reservaId, d.mesaIdsAntes).catch(() => undefined);
      };
    },
    [asignarLocal],
  );
}
