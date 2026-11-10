import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hoyMadrid } from "@/lib/cheques/caducidad";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { useReservasPorGestionar, CLAVE_RESERVAS_POR_GESTIONAR } from "@/hooks/useReservasPorGestionar";
import { esCambioPropio } from "@/lib/reservas/cambiosPropios";
import { detectarNuevas, type AlertaNueva, type CancelacionFila } from "@/lib/avisosEnVivo/detectar";
import { avisosEnVivo } from "@/lib/avisosEnVivo/preferencias";

/** Estado compartido de los avisos en vivo (sonido y cuántos han saltado sin mirarse). */
export function useEstadoAvisosEnVivo() {
  return useSyncExternalStore(avisosEnVivo.suscribir, avisosEnVivo.leer, avisosEnVivo.leer);
}

/** Inicio de esta sesión del panel: solo cuentan las cancelaciones posteriores. */
const INICIO_SESION = new Date().toISOString();

/**
 * Detecta lo nuevo que gestionar (reservas web/teléfono pendientes o verificadas, solicitudes del
 * asistente, cancelaciones de clientes) a partir de «Por gestionar» y de una consulta pequeña de
 * cancelaciones posteriores a abrir el panel. Ambas comparten la primera posición de clave
 * `reservas-por-gestionar`: las refresca el realtime de `useReservasEnVivo` y el sondeo periódico.
 * `alAvisar` recibe solo lo nuevo, una vez por sesión.
 */
export function useAvisosEnVivo(habilitado: boolean, alAvisar: (nuevas: AlertaNueva[]) => void) {
  const { items, listo: porGestionarListo } = useReservasPorGestionar(habilitado);
  const canceladas = useQuery({
    queryKey: [CLAVE_RESERVAS_POR_GESTIONAR, "canceladas", INICIO_SESION],
    enabled: habilitado,
    ...REFRESCO_PERIODICO,
    queryFn: async (): Promise<CancelacionFila[]> => {
      const { data, error } = await supabase
        .from("reservas")
        .select("id, nombre, fecha, hora, numero_comensales, canal")
        .eq("estado", "cancelada")
        .gte("updated_at", INICIO_SESION)
        .gte("fecha", hoyMadrid())
        .limit(50);
      if (error) throw error;
      return (data ?? []) as CancelacionFila[];
    },
  });

  const avisados = useRef<Set<string>>(new Set());
  const listo = useRef(false);
  const alAvisarRef = useRef(alAvisar);
  useEffect(() => {
    alAvisarRef.current = alAvisar;
  }, [alAvisar]);
  const datosListos = habilitado && porGestionarListo && canceladas.isSuccess;

  useEffect(() => {
    if (!datosListos) return;
    const { nuevas, avisados: siguiente } = detectarNuevas({
      porGestionar: items,
      canceladas: canceladas.data ?? [],
      avisados: avisados.current,
      primeraVez: !listo.current,
      esPropio: (id) => esCambioPropio(id),
    });
    avisados.current = siguiente;
    listo.current = true;
    if (nuevas.length > 0) alAvisarRef.current(nuevas);
  }, [datosListos, items, canceladas.data]);

  return { cuantasPorGestionar: habilitado ? items.length : 0 };
}
