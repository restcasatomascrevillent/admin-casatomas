import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { textoErrorCliente, textoSuscriptores } from "@/lib/newsletter/textos";

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

/**
 * Prueba segura por Resend Marketing: enviar-newsletter con
 * {prueba: true, newsletter: {...}} manda el Broadcast a un Segment que solo
 * tiene la dirección de prueba (delivered@resend.dev por defecto). No llega a
 * ningún cliente ni queda en el historial. Ver
 * supabase/functions/enviar-newsletter/prueba.ts.
 *
 * Los datos van ANIDADOS en `newsletter`, nunca en la raíz: una versión
 * anterior de enviar-newsletter (sin modo prueba) ignoraría `prueba` y con
 * tipo/titulo/mensaje en la raíz mandaría el newsletter a TODOS los
 * suscriptores. Así responde 400 y no sale nada (ver payloadDePrueba).
 */
export function cuerpoPrueba(payload: NewsletterPayload): { prueba: true; newsletter: NewsletterPayload } {
  return { prueba: true, newsletter: payload };
}

export function useEnviarPruebaNewsletter() {
  return useMutation({
    mutationFn: async (payload: NewsletterPayload) => {
      const { data, error } = await supabase.functions.invoke('enviar-newsletter', {
        body: cuerpoPrueba(payload),
      });
      if (error) {
        throw new Error(await mensajeErrorFuncion(error, 'Error al enviar la prueba'));
      }
      return data as RespuestaEnvio;
    },
    onSuccess: () => {
      toast.success('Prueba enviada. Solo llega a la dirección de pruebas del equipo, no a ningún cliente.');
    },
    onError: (error: Error) => {
      // El motivo técnico se queda en la consola; en pantalla, una frase para el personal.
      console.error('Prueba de newsletter:', error.message);
      toast.error(`No se pudo enviar la prueba. ${textoErrorCliente(error.message)}`);
    },
  });
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
        toast.warning(`Newsletter enviada a ${textoSuscriptores(data.exitosos ?? 0)}; a ${data.fallidos} no se pudo enviar.`);
      } else if (typeof data?.exitosos === 'number') {
        toast.success(`Newsletter enviada a ${textoSuscriptores(data.exitosos)}.`);
      } else {
        toast.success('Newsletter enviada correctamente.');
      }
    },
    onError: (error: Error) => {
      console.error('Envío de newsletter:', error.message);
      toast.error(`No se ha enviado la newsletter. ${textoErrorCliente(error.message)}`);
    },
    // También si falla: en modo Broadcast la función sincroniza ANTES de
    // decidir si envía (y puede negarse después, 409/502), así que la lista de
    // envío, las bajas reconciliadas y el historial pueden haber cambiado igual.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["newsletter-suscriptores"] });
      queryClient.invalidateQueries({ queryKey: ["newsletter-envios-historial"] });
      queryClient.invalidateQueries({ queryKey: ["newsletter-resend-estado"] });
    },
  });
}
