import { useMemo } from "react";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { idsSalasPrivadasActivas } from "@/lib/reservas/salaPrivada";

/**
 * Ids de las salas privadas ACTIVAS (el Reservado de Casa Tomás). Están FUERA DE
 * AFORO (decisión del dueño, 2026-10-03): sus reservas no entran en las cifras
 * de ocupación ni de comensales. Sale de la caché compartida de salas
 * (`useEspaciosReserva`): ni una consulta más. Mientras las salas no han llegado
 * es una lista vacía (no se excluye nada).
 */
export function useIdsSalasPrivadas(): string[] {
  const { data } = useEspaciosReserva();
  return useMemo(() => idsSalasPrivadasActivas(data as Array<{ id?: string }> | undefined), [data]);
}
