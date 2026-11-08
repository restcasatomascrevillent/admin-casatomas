/**
 * Estado de la conexión con Instagram (Edge Function instagram-estado, GET;
 * nunca devuelve secretos), compartido por el diálogo «Conexión con Instagram»
 * y el indicador «● @cuenta» de la barra de pestañas. Se guarda 10 minutos en
 * TanStack Query; «Comprobar» lo vuelve a pedir.
 *
 * instagram-estado llama a Meta varias veces (2-5 s): por eso el indicador lo
 * monta con `activo = false` (solo lee lo que ya haya) y se apoya en la cuenta
 * guardada (cuentaGuardada.ts), que se actualiza con cada comprobación.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { comprobarConexion, type RespuestaEstado } from "./api";
import { guardarCuenta } from "./cuentaGuardada";

export const CLAVE_CONEXION = ["instagram_estado"] as const;

/** Comprobación completa (llama a Meta) que, además, recuerda la cuenta para el indicador. */
export async function comprobarYGuardar(): Promise<RespuestaEstado> {
  const e = await comprobarConexion();
  guardarCuenta(e);
  return e;
}

export function useConexionInstagram(activo = true) {
  const qc = useQueryClient();
  const consulta = useQuery({
    queryKey: CLAVE_CONEXION,
    queryFn: comprobarYGuardar,
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
    fijar: (e: RespuestaEstado | null) => {
      guardarCuenta(e);
      qc.setQueryData(CLAVE_CONEXION, e ?? undefined);
    },
  };
}
