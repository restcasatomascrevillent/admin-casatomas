import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface NewsletterPayload {
  tipo: 'anuncio' | 'nuevo_menu' | 'oferta';
  titulo: string;
  mensaje: string;
  imagen_url?: string;
}

export function useEnviarNewsletter() {
  return useMutation({
    mutationFn: async (payload: NewsletterPayload) => {
      const { data, error } = await supabase.functions.invoke('enviar-newsletter', {
        body: payload,
      });

      if (error) {
        throw new Error(error.message || 'Error al enviar newsletter');
      }

      return data;
    },
    onSuccess: () => {
      toast.success('Newsletter enviado correctamente');
    },
    onError: (error: Error) => {
      toast.error(`Error: ${error.message}`);
    },
  });
}
