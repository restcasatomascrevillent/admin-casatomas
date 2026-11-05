/**
 * Mejor hueco para programar una pieza de una marca: lee «Qué funciona» de la
 * lectura de métricas (la misma consulta y caché que la pestaña Métricas; no
 * llama a Meta) y calcula el día y la hora (mejorHueco.ts). Si las métricas
 * no están o fallan, mañana a las 13:00.
 */
import { useMemo } from "react";
import { useMetricasInstagram } from "@/components/instagram/metricas/useMetricasInstagram";
import { mejorHueco, type MejorHueco } from "./mejorHueco";

export function useMejorHueco(marca: string | null, desde?: string | null): MejorHueco {
  const { datos } = useMetricasInstagram(undefined, marca);
  const qf = datos?.queFunciona ?? null;
  // Se recalcula al cambiar los datos o el día pedido (no en cada render: «ahora» cambia).
  return useMemo(() => mejorHueco(qf, new Date(), desde), [qf, desde]);
}
