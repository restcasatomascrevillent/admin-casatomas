import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CLAVE_PROGRAMACION } from "@/components/instagram/programar/useProgramacionInstagram";
import { CLAVE_AJUSTES_TAPAS, CLAVE_STORY_TAPAS, cancelarStoryTapas, guardarAjustesTapas, leerAjustesTapas, verStoryTapas } from "./api";
import type { AjustesStoryTapas } from "./storyTapas";

/** Ajustes de la story automática (null = sin Marketing o sin la migración). */
export function useAjustesStoryTapas() {
  const qc = useQueryClient();
  const consulta = useQuery({ queryKey: CLAVE_AJUSTES_TAPAS, queryFn: leerAjustesTapas, staleTime: 60_000 });
  const guardar = useMutation({
    mutationFn: (cambios: Partial<AjustesStoryTapas>) => guardarAjustesTapas(cambios),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CLAVE_AJUSTES_TAPAS }),
  });
  return { ajustes: consulta.data ?? null, cargando: consulta.isLoading, error: consulta.error, guardar };
}

/** La story de tapas de una semana (su lunes), al día con la programación. */
export function useStoryTapasSemana(semana: string | null) {
  return useQuery({
    queryKey: [...CLAVE_STORY_TAPAS, semana],
    queryFn: () => verStoryTapas(semana!),
    enabled: !!semana,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useCancelarStoryTapas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (semana: string) => cancelarStoryTapas(semana),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CLAVE_STORY_TAPAS });
      void qc.invalidateQueries({ queryKey: CLAVE_PROGRAMACION });
    },
  });
}
