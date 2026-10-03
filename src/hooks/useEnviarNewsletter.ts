import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface NewsletterPayload {
  tipo: 'anuncio' | 'nuevo_menu' | 'oferta';
  titulo: string;
  mensaje: string;
  imagen_url?: string;
}

interface RespuestaEnvio {
  success?: boolean;
  message?: string;
  error?: string;
  exitosos?: number;
  fallidos?: number;
}

/**
 * Ante un 4xx/5xx supabase-js solo da "Edge Function returned a non-2xx status
 * code"; el motivo real (sin permiso de Marketing, límite de la cuota de Resend,
 * remitente sin verificar...) viene en el cuerpo, en `error.context`.
 */
export async function mensajeErrorFuncion(error: unknown, porDefecto: string): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      const cuerpo = (await (ctx as Response).clone().json()) as RespuestaEnvio;
      if (cuerpo?.error) return cuerpo.error;
    } catch {
      // cuerpo no JSON: se usa el mensaje genérico
    }
  }
  const msg = (error as { message?: unknown } | null)?.message;
  return typeof msg === "string" && msg ? msg : porDefecto;
}

export function useEnviarNewsletter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: NewsletterPayload) => {
      const { data, error } = await supabase.functions.invoke('enviar-newsletter', {
        body: payload,
      });

      if (error) {
        throw new Error(await mensajeErrorFuncion(error, 'Error al enviar newsletter'));
      }

      return data as RespuestaEnvio;
    },
    onSuccess: (data) => {
      if (data?.fallidos) {
        toast.warning(`Newsletter enviado a ${data.exitosos ?? 0} suscriptores; ${data.fallidos} no se pudieron enviar`);
      } else {
        toast.success(data?.message || 'Newsletter enviado correctamente');
      }
      queryClient.invalidateQueries({ queryKey: ["newsletter-suscriptores"] });
      // Historial y estado de Resend (useResendMarketing): el envío por Broadcast sincroniza antes.
      queryClient.invalidateQueries({ queryKey: ["newsletter-envios-historial"] });
      queryClient.invalidateQueries({ queryKey: ["newsletter-resend-estado"] });
    },
    onError: (error: Error) => {
      toast.error(`Error: ${error.message}`);
    },
  });
}
