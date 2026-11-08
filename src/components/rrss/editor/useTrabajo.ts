/**
 * Datos de un trabajo del Editor IA: proyecto, archivos, última generación y
 * resultados (react-query). Mientras haya una generación viva se consulta cada
 * ~2 s; al acabar, se refrescan los resultados y se para.
 */
import { useEffect, useRef } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  generacionActiva,
  leerProyecto,
  leerUltimaGeneracion,
  listarArchivos,
  listarResultados,
  urlsFirmadas,
  type Archivo,
  type Generacion,
  type Proyecto,
  type Resultado,
} from "@/components/rrss/api";

export const INTERVALO_SEGUIMIENTO = 2000;

export const CLAVES = {
  proyectos: (origen: string) => ["rrss", "proyectos", origen] as const,
  proyecto: (id: string | null) => ["rrss", "proyecto", id] as const,
  archivos: (id: string | null) => ["rrss", "archivos", id] as const,
  generacion: (id: string | null) => ["rrss", "generacion", id] as const,
  resultados: (id: string | null) => ["rrss", "resultados", id] as const,
};

export const archivoEnCurso = (a: Pick<Archivo, "estado">) => a.estado === "subido" || a.estado === "analizando";

export function useTrabajo(id: string | null) {
  const qc = useQueryClient();
  const proyecto = useQuery<Proyecto | null>({ queryKey: CLAVES.proyecto(id), queryFn: () => leerProyecto(id as string), enabled: !!id });
  const archivos = useQuery<Archivo[]>({
    queryKey: CLAVES.archivos(id),
    queryFn: () => listarArchivos(id as string),
    enabled: !!id,
    refetchInterval: (q) => ((q.state.data ?? []).some(archivoEnCurso) ? INTERVALO_SEGUIMIENTO : false),
  });
  const generacion = useQuery<Generacion | null>({
    queryKey: CLAVES.generacion(id),
    queryFn: () => leerUltimaGeneracion(id as string),
    enabled: !!id,
    refetchInterval: (q) => (generacionActiva(q.state.data) ? INTERVALO_SEGUIMIENTO : false),
  });
  const resultados = useQuery<Resultado[]>({ queryKey: CLAVES.resultados(id), queryFn: () => listarResultados(id as string), enabled: !!id });

  // Al acabar una generación (o cambiar de trabajo con una viva), trae los resultados nuevos.
  const estabaActiva = useRef(false);
  const g = generacion.data;
  useEffect(() => {
    const activa = generacionActiva(g);
    if (estabaActiva.current && !activa) {
      void qc.invalidateQueries({ queryKey: CLAVES.resultados(id) });
      void qc.invalidateQueries({ queryKey: CLAVES.proyecto(id) });
    }
    estabaActiva.current = activa;
  }, [g, id, qc]);

  return { proyecto, archivos, generacion, resultados };
}

/** URL firmadas (1 h) de varias rutas del cubo; conserva las anteriores mientras llegan las nuevas. */
export function useUrls(rutas: (string | null | undefined)[]): Record<string, string> {
  const limpias = [...new Set(rutas.filter((r): r is string => !!r))].sort();
  const q = useQuery({
    queryKey: ["rrss", "urls", limpias.join("|")],
    queryFn: () => urlsFirmadas(limpias),
    enabled: limpias.length > 0,
    staleTime: 45 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
  return q.data ?? {};
}
