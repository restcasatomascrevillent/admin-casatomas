import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface ChatbotConfigItem {
  id: string;
  clave: string;
  valor: string;
  descripcion: string | null;
  updated_at: string;
}

export function useChatbotConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: configs, isLoading } = useQuery({
    queryKey: ["chatbot_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chatbot_config")
        .select("*")
        .order("clave");
      if (error) throw error;
      return data as ChatbotConfigItem[];
    },
  });

  const updateConfig = useMutation({
    mutationFn: async ({ clave, valor }: { clave: string; valor: string }) => {
      const { error } = await supabase
        .from("chatbot_config")
        .update({ valor })
        .eq("clave", clave);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chatbot_config"] });
      toast({ title: "Configuración guardada" });
    },
    onError: (error) => {
      toast({ title: "Error al guardar", description: error.message, variant: "destructive" });
    },
  });

  const getConfigValue = (clave: string) => {
    return configs?.find((c) => c.clave === clave)?.valor ?? "";
  };

  return { configs, isLoading, updateConfig, getConfigValue };
}
