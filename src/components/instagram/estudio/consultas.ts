/**
 * Consultas del Estudio de Instagram (clave, función y tiempos de TanStack
 * Query) en un solo sitio, para que el Estudio y el prefetch de la página
 * usen exactamente las mismas claves (docs/instagram-rendimiento.md).
 *
 * Al abrir /instagram se lanzan todas a la vez (sin cascadas) y nada llama a
 * Meta ni a la IA:
 *  · calendario: 3 consultas PostgREST en paralelo (programaciones,
 *    publicadas, borradores con fecha);
 *  · encargos: 1 consulta (instagram_encargos);
 *  · cifras: 1 consulta (instagram_metricas_cuenta), sin la Edge Function;
 *  · fechas señaladas: 1 RPC (marketing_fechas_entre).
 */
import type { QueryClient } from "@tanstack/react-query";
import type { MarcaId } from "@/lib/instagram";
import { hoyMadrid, inicioSemana, madridAUtc, sumarDias } from "@/components/instagram/programar/logica";
import { opcionesCalendarioInstagram } from "@/components/instagram/programar/useProgramacionInstagram";
import { opcionesEncargos } from "@/components/instagram/encargos/useEncargos";
import { opcionesFechasSemana } from "@/components/instagram/campanas/SugerenciaSemana";
import { CLAVE_METRICAS, debeReintentar } from "@/components/instagram/metricas/useMetricasInstagram";
import { leerResumenEstudio, type ResumenEstudio } from "@/components/instagram/metricas/resumenEstudio";
import { igUserIdGuardado, leerCuentaGuardada } from "@/components/marketing/instagram/cuentaGuardada";
import type { FiltroMarca } from "@/components/instagram/BarraInstagram";

/** Semana actual y un mes por delante (una sola consulta para la semana y las próximas). */
export function rangoEstudio(hoy = hoyMadrid()): { lunes: string; desde: Date; hasta: Date } {
  const lunes = inicioSemana(hoy);
  return { lunes, desde: madridAUtc(lunes, "00:00") as Date, hasta: madridAUtc(sumarDias(hoy, 31), "00:00") as Date };
}

/** Marca de la sugerencia: con «Las dos», Casa Tomás. */
export const marcaSugerencia = (marca: FiltroMarca): MarcaId => (marca === "todas" ? "casa-tomas" : marca);

/** Cifras del Estudio: 5 min frescas, 30 min en caché; al cambiar de marca se sigue viendo la anterior. */
export function opcionesMetricasEstudio(marca: FiltroMarca) {
  const m = marca === "todas" ? null : marca;
  return {
    // Bajo CLAVE_METRICAS: «Actualizar ahora» de Métricas también las refresca.
    queryKey: [...CLAVE_METRICAS, "estudio", marca] as const,
    queryFn: (): Promise<ResumenEstudio> => leerResumenEstudio(m, igUserIdGuardado(m, leerCuentaGuardada()?.cuenta)),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: debeReintentar,
  };
}

/** Pide por adelantado todo lo del Estudio (no hace nada con lo que ya está fresco en caché). */
export function prefetchEstudio(qc: QueryClient, marca: FiltroMarca, hoy = hoyMadrid()): Promise<unknown> {
  const r = rangoEstudio(hoy);
  return Promise.allSettled([
    qc.prefetchQuery(opcionesCalendarioInstagram(r.desde, r.hasta)),
    qc.prefetchQuery(opcionesEncargos()),
    qc.prefetchQuery(opcionesMetricasEstudio(marca)),
    qc.prefetchQuery(opcionesFechasSemana(marcaSugerencia(marca), r.lunes)),
  ]);
}
