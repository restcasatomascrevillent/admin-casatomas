import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { paginarConsulta } from "@/lib/reservas/paginarConsulta";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import {
  resumirEventosCorreo,
  TIPOS_EVENTO_CORREO,
  type EventoCorreo,
  type ResumenCorreos,
} from "@/lib/newsletter/estadisticasCorreos";

/** Eventos archivados como mucho (tope de seguridad de la lectura por lotes). */
const LIMITE_EVENTOS = 50_000;

export interface EstadisticasCorreos extends ResumenCorreos {
  /** Había más eventos que el tope: las cifras son de los `LIMITE_EVENTOS` más recientes. */
  truncado: boolean;
}

/**
 * Estadísticas de los correos (pestaña Newsletter › Estadísticas): UNA lectura
 * de `email_eventos` y UNA cuenta (`resumirEventosCorreo`) de la que salen las
 * tarjetas, el desglose y la tendencia de 7 días, para que no puedan
 * contradecirse. Antes eran dos consultas con criterios distintos (correos
 * únicos para las cifras, eventos sueltos para la tendencia) y el componente
 * sumaba conjuntos que se solapan.
 *
 * Por lotes (`paginarConsulta`): PostgREST corta cada petición a 1.000 filas
 * sin avisar, y con ~3 eventos por correo las cifras se habrían quedado cortas
 * a partir de unos 300 correos. Se refresca sola cada minuto con la pestaña a
 * la vista (no hay realtime sobre `email_eventos`).
 */
export function useEstadisticasCorreos() {
  return useQuery({
    ...REFRESCO_PERIODICO,
    queryKey: ["email-eventos-resumen"],
    queryFn: async ({ signal }): Promise<EstadisticasCorreos> => {
      const { filas, truncado } = await paginarConsulta<EventoCorreo & { id: string }>(
        (primera, ultima, contar) =>
          supabase
            .from("email_eventos")
            .select("id, tipo_evento, email_id, timestamp_evento, created_at", contar ? { count: "exact" } : undefined)
            .in("tipo_evento", [...TIPOS_EVENTO_CORREO])
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(primera, ultima)
            .abortSignal(signal),
        { clave: (f) => f.id, signal, limiteFilas: LIMITE_EVENTOS },
      );
      return { ...resumirEventosCorreo(filas, { ahora: Date.now(), dias: 7 }), truncado };
    },
  });
}
