// ============================================================================
//  Precarga de «Reservas › Hoy» al abrir el panel (09/11/2026, mala cobertura)
// ----------------------------------------------------------------------------
//  Antes, las consultas de «Hoy» salían cuando se pintaba la pestaña: después
//  de validar la sesión, de leer rol y permisos y de bajar el fichero de la
//  página de Reservas, y el plano de la sala esperaba además a saber qué salas
//  había (mesas y plano de la sala, otro viaje en serie). Ahora, si se abre el
//  panel en /reservas, en cuanto la sesión está confirmada salen TODAS a la vez
//  (`App.tsx` › `PrecargaHoy`), con las mismas claves y lecturas que los hooks:
//  cuando la pestaña se monta, encuentra los datos o la petición ya en vuelo.
//
//  Si hay copia del día (`cacheOffline.ts`) se pinta ya con ella y esto es la
//  relectura. Ninguna precarga lanza: un fallo lo vuelve a intentar el hook.
// ============================================================================
import type { QueryClient } from "@tanstack/react-query";
import { consultaReservasHoy } from "@/lib/reservas/consultaReservasHoy";
import { hoyLocal } from "@/components/reservas/asignacionPlano";
import { consultaEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { consultaMesas } from "@/hooks/useMesas";
import { consultaAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { consultaAjustesMesaDia } from "@/hooks/useAjustesMesaServicio";
import { consultaConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { consultaSalasEvento } from "@/hooks/useSalaEvento";
import { precargarPlanosEspacio } from "@/hooks/usePlanosEspacio";

/**
 * Lanza a la vez todas las lecturas de «Hoy». No espera a nada ni lanza errores. Las que ya estén al día
 * en la caché no se repiten (`prefetchQuery` respeta `staleTime`).
 */
export function precargarHoy(qc: QueryClient, { escritorio = true, hoy = hoyLocal() }: { escritorio?: boolean; hoy?: string } = {}): void {
  const sinError = (p: Promise<unknown>) => void p.catch(() => undefined);
  sinError(qc.prefetchQuery(consultaReservasHoy(hoy)));
  sinError(qc.prefetchQuery(consultaEspaciosReserva));
  sinError(qc.prefetchQuery(consultaMesas()));
  sinError(qc.prefetchQuery(consultaAsignacionesMesa(hoy)));
  sinError(qc.prefetchQuery(consultaAjustesMesaDia(hoy)));
  sinError(qc.prefetchQuery(consultaConfiguracionReservas));
  sinError(qc.prefetchQuery(consultaSalasEvento(hoy, hoy)));
  // Los planos solo los pinta el escritorio/tablet (el plano de la derecha).
  if (escritorio) sinError(precargarPlanosEspacio(qc));
}
