import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensajeErrorFuncion } from "@/hooks/useEnviarNewsletter";
import { textoErrorCliente } from "@/lib/newsletter/textos";
import {
  agruparEstadisticas,
  mensajeSincronizacion,
  type EstadisticasBroadcast,
  type EstadoResend,
  type FilaEstadistica,
  type ResultadoSincronizacion,
} from "@/lib/newsletter/resend";

// Newsletter por Resend Marketing (fase 2). El estado y la sincronización los
// da la función newsletter-sync-resend; el historial sale de newsletter_envios
// y las estadísticas de los eventos que archiva resend-webhook.
// Ver docs/funcionalidades/newsletter-resend-marketing.md.

export const CLAVE_ESTADO_RESEND = ["newsletter-resend-estado"] as const;
export const CLAVE_HISTORIAL_ENVIOS = ["newsletter-envios-historial"] as const;

/** Estado de la conexión con Resend (canal, contactos usados, última sincronización). Sin sondeo: al montar y al volver a la pestaña. */
export function useEstadoResend() {
  return useQuery({
    queryKey: CLAVE_ESTADO_RESEND,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("newsletter-sync-resend", { body: { accion: "estado" } });
      if (error) throw new Error(await mensajeErrorFuncion(error, "No se pudo consultar el estado de la lista de envío"));
      return data as EstadoResend;
    },
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

export function useSincronizarResend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("newsletter-sync-resend", { body: { accion: "sincronizar" } });
      if (error) throw new Error(await mensajeErrorFuncion(error, "No se pudo actualizar la lista de envío"));
      return data as ResultadoSincronizacion;
    },
    onSuccess: (data) => {
      const m = mensajeSincronizacion(data);
      if (m.tipo === "ok") toast.success(m.texto);
      else if (m.tipo === "aviso") toast.warning(m.texto);
      else toast.error(m.texto);
    },
    onError: (error: Error) => {
      console.error('Actualizar lista de envío:', error.message);
      toast.error(textoErrorCliente(error.message, 'No se pudo actualizar la lista de envío. Inténtalo de nuevo y, si sigue igual, avisa al equipo técnico.'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: CLAVE_ESTADO_RESEND });
      queryClient.invalidateQueries({ queryKey: ["newsletter-suscriptores"] });
    },
  });
}

export interface EnvioNewsletter {
  id: string;
  asunto: string;
  created_at: string;
  total_destinatarios: number;
  estado: string | null;
  tipo_newsletter: string | null;
  canal: "transaccional" | "broadcast";
  resend_broadcast_id: string | null;
  estadisticas: EstadisticasBroadcast | null;
}

const COLUMNAS = "id, asunto, created_at, total_destinatarios, estado, tipo_newsletter";

/** Últimos envíos con su canal y, para los Broadcasts, entregas/aperturas/clics/rebotes. */
export function useHistorialEnvios(limite = 15) {
  return useQuery({
    queryKey: [...CLAVE_HISTORIAL_ENVIOS, limite],
    queryFn: async (): Promise<EnvioNewsletter[]> => {
      let filas: Record<string, unknown>[] = [];
      const conCanal = await supabase
        .from("newsletter_envios")
        .select(`${COLUMNAS}, canal, resend_broadcast_id`)
        .order("created_at", { ascending: false })
        .limit(limite);
      if (conCanal.error) {
        // Migración 20261003193000 sin aplicar: el historial se ve igual, todo como envío directo.
        const sinCanal = await supabase.from("newsletter_envios").select(COLUMNAS).order("created_at", { ascending: false }).limit(limite);
        if (sinCanal.error) throw sinCanal.error;
        filas = (sinCanal.data ?? []) as unknown as Record<string, unknown>[];
      } else {
        filas = (conCanal.data ?? []) as unknown as Record<string, unknown>[];
      }

      const ids = filas.map((f) => f.resend_broadcast_id).filter((v): v is string => typeof v === "string" && v.length > 0);
      let stats = new Map<string, EstadisticasBroadcast>();
      if (ids.length) {
        const { data, error } = await supabase.rpc("newsletter_estadisticas_broadcasts", { p_broadcast_ids: ids });
        if (!error) stats = agruparEstadisticas((data ?? []) as FilaEstadistica[]);
      }

      return filas.map((f) => {
        const broadcastId = typeof f.resend_broadcast_id === "string" ? f.resend_broadcast_id : null;
        return {
          id: String(f.id),
          asunto: String(f.asunto ?? ""),
          created_at: String(f.created_at),
          total_destinatarios: Number(f.total_destinatarios) || 0,
          estado: (f.estado as string | null) ?? null,
          tipo_newsletter: (f.tipo_newsletter as string | null) ?? null,
          canal: f.canal === "broadcast" ? "broadcast" : "transaccional",
          resend_broadcast_id: broadcastId,
          estadisticas: broadcastId ? stats.get(broadcastId) ?? null : null,
        };
      });
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
