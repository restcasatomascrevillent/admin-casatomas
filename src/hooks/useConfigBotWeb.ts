import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface ConfigBotWeb {
  id: string;
  tono: string;
  mensaje_bienvenida: string;
  platos_recomendados: string;
  vinos_recomendados: string;
  instrucciones_extra: string;
  frases_personalizadas: string;
  created_at: string;
  updated_at: string;
}

export type ConfigBotWebUpdate = Partial<Omit<ConfigBotWeb, "id" | "created_at" | "updated_at">>;
const BOT_TRANSLATIONS_WEBHOOK_URL = "https://n8npersonal.miguelbenito.space/webhook/traducciones";

const fetchConfigRow = async () => {
  const { data, error } = await supabase
    .from("configBotWeb")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as ConfigBotWeb | null) ?? null;
};

export function useConfigBotWeb() {
  const { toast } = useToast();

  const { data: config, isLoading } = useQuery({
    queryKey: ["configBotWeb"],
    queryFn: fetchConfigRow,
  });

  const updateConfig = useMutation({
    mutationFn: async (updates: ConfigBotWebUpdate) => {
      const webhookPayload = {
        ...updates,
        tipo: "bot",
      };
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(BOT_TRANSLATIONS_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Webhook error ${response.status}: ${errorText || "No response body"}`);
      }
    },
    onSuccess: () => {
      toast({ title: "Configuración enviada al webhook" });
    },
    onError: (error) => {
      toast({
        title: "Error al enviar webhook",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return { config, isLoading, updateConfig };
}
