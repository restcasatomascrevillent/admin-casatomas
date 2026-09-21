import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type IdiomaBotWeb = "es" | "en" | "fr";

export interface ConfigBotWeb {
  id: string;
  idioma: string;
  tono: string;
  mensaje_bienvenida: string;
  platos_recomendados: string;
  vinos_recomendados: string;
  instrucciones_extra: string;
  frases_personalizadas: string;
  created_at: string;
  updated_at: string;
}

export type ConfigBotWebUpdate = Partial<Omit<ConfigBotWeb, "id" | "idioma" | "created_at" | "updated_at">>;

const DEFAULT_IDIOMA: IdiomaBotWeb = "es";

// La tabla configBotWeb tiene 3 filas, una por idioma (es/en/fr) — la lee
// supabase/functions/chat-web filtrando por `idioma`. Antes esta query pedía
// "la fila más antigua" sin filtrar por idioma; ahora pide la fila del
// idioma indicado.
const fetchConfigRow = async (idioma: string) => {
  const { data, error } = await supabase
    .from("configBotWeb")
    .select("*")
    .eq("idioma", idioma)
    .maybeSingle();

  if (error) throw error;
  return (data as ConfigBotWeb | null) ?? null;
};

export function useConfigBotWeb(idioma: IdiomaBotWeb = DEFAULT_IDIOMA) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ["configBotWeb", idioma],
    queryFn: () => fetchConfigRow(idioma),
  });

  const updateConfig = useMutation({
    mutationFn: async (updates: ConfigBotWebUpdate) => {
      // Escritura directa a Supabase. Antes esto hacía POST a un webhook de
      // n8n (n8npersonal.miguelbenito.space) que el CSP de vercel.json ya no
      // permite llamar desde el navegador, así que "Guardar" no persistía
      // nada. configBotWeb es la tabla que de verdad usa el bot.
      if (config?.id) {
        const { error } = await supabase
          .from("configBotWeb")
          .update(updates)
          .eq("id", config.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("configBotWeb")
          .insert({ ...updates, idioma });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configBotWeb", idioma] });
      toast({ title: "Configuración guardada" });
    },
    onError: (error) => {
      toast({
        title: "Error al guardar la configuración",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return { config, isLoading, updateConfig };
}
