/**
 * Estado de la conexión con Instagram (Edge Function instagram-estado, GET;
 * nunca devuelve secretos), compartido por el indicador «● @cuenta» de la
 * barra de pestañas y el editor (para decir en qué cuenta se publica). Se
 * pide una vez al entrar y se guarda 10 minutos; «Comprobar» lo vuelve a pedir.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { comprobarConexion, type RespuestaEstado } from "./api";

export const CLAVE_CONEXION = ["instagram_estado"] as const;

export function useConexionInstagram(activo = true) {
  const qc = useQueryClient();
  const consulta = useQuery({
    queryKey: CLAVE_CONEXION,
    queryFn: () => comprobarConexion(),
    enabled: activo,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return {
    estado: consulta.data ?? null,
    cargando: consulta.isLoading,
    comprobando: consulta.isFetching,
    error: (consulta.error as Error | null) ?? null,
    comprobar: () => consulta.refetch(),
    /** Guarda un resultado obtenido por otro lado (p. ej. al confirmar una publicación). */
    fijar: (e: RespuestaEstado | null) => qc.setQueryData(CLAVE_CONEXION, e ?? undefined),
  };
}
