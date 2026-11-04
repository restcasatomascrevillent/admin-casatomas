/**
 * Datos de la pestaña «Métricas» (TanStack Query, como el resto del panel):
 * la lectura (no llama a Meta, se refresca cada 5 min como mucho) y la
 * captura «Actualizar ahora» (llama a Meta y, al acabar, vuelve a leer;
 * también si falla, para que se vea la última captura con su error).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { capturarMetricas, ErrorMetricas, leerMetricas } from "./api";
import type { DatosMetricas, ResultadoCaptura } from "./tipos";

export const CLAVE_METRICAS = ["instagram", "metricas"] as const;

export interface ApiMetricas {
  leer: () => Promise<DatosMetricas>;
  capturar: () => Promise<ResultadoCaptura>;
}

const API_POR_DEFECTO: ApiMetricas = { leer: () => leerMetricas(), capturar: () => capturarMetricas() };

/** No se reintenta lo que no se arregla solo (sesión, permisos, función sin desplegar). */
export function debeReintentar(intentos: number, error: unknown): boolean {
  if (error instanceof ErrorMetricas && ["sesion", "sin_permiso", "no_desplegada", "configuracion", "permiso_insights"].includes(error.tipo)) {
    return false;
  }
  return intentos < 2;
}

export function useMetricasInstagram(api: ApiMetricas = API_POR_DEFECTO) {
  const qc = useQueryClient();
  const consulta = useQuery({
    queryKey: CLAVE_METRICAS,
    queryFn: api.leer,
    staleTime: 5 * 60_000,
    retry: debeReintentar,
  });
  const captura = useMutation({
    mutationFn: api.capturar,
    onSettled: () => qc.invalidateQueries({ queryKey: CLAVE_METRICAS }),
  });
  return {
    datos: consulta.data ?? null,
    cargando: consulta.isLoading,
    actualizandoLectura: consulta.isFetching,
    error: (consulta.error as Error | null) ?? null,
    recargar: consulta.refetch,
    capturar: captura.mutate,
    capturarAsync: captura.mutateAsync,
    capturando: captura.isPending,
    errorCaptura: (captura.error as Error | null) ?? null,
    resultadoCaptura: captura.data ?? null,
  };
}
