import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CONFIG_BOT_WEB_QUERY_KEY, type DraftBotWeb } from "@/hooks/useConfigBotWeb";
import {
  IDIOMAS_TRADUCIDOS,
  camposATraducir,
  construirUpdateTraducido,
  type CatalogosCarta,
  type IdiomaTraducido,
} from "@/components/bot/traduccionBot";

interface RespuestaCampos {
  ok?: boolean;
  error?: string;
  traducciones?: Partial<Record<IdiomaTraducido, Record<string, string>>>;
}

const CONTEXTO =
  "Configuración del asistente virtual (chat) de la web del restaurante Casa Tomás: mensaje de bienvenida, instrucciones internas con horario/contacto/dirección y frases de estilo.";

// Genera las filas EN/FR de configBotWeb a partir de la fila ES ya guardada.
// Primero traduce TODO y construye los dos UPDATE; solo si ambos están
// completos escribe en la base de datos, así un fallo de OpenAI nunca deja
// EN/FR a medias ni con textos vacíos.
async function traducirYGuardar(draftEs: DraftBotWeb, catalogos: CatalogosCarta): Promise<void> {
  const { data, error } = await supabase.functions.invoke("traducir-contenido", {
    body: { campos: camposATraducir(draftEs), destino: IDIOMAS_TRADUCIDOS, contexto: CONTEXTO },
  });
  if (error) throw new Error(`No se pudo contactar con el traductor: ${error.message}`);
  const res = data as RespuestaCampos | null;
  if (!res?.ok || !res.traducciones) {
    throw new Error(res?.error || "El traductor no devolvió traducciones");
  }

  const updates = IDIOMAS_TRADUCIDOS.map((idioma) => ({
    idioma,
    update: construirUpdateTraducido(draftEs, res.traducciones?.[idioma], idioma, catalogos),
  }));

  for (const { idioma, update } of updates) {
    const { data: filas, error: updError } = await supabase
      .from("configBotWeb")
      .update(update)
      .eq("idioma", idioma)
      .select("id");
    if (updError) throw new Error(`No se pudo guardar la traducción ${idioma.toUpperCase()}: ${updError.message}`);
    if (!filas || filas.length === 0) {
      const { error: insError } = await supabase.from("configBotWeb").insert({ ...update, idioma });
      if (insError) throw new Error(`No se pudo crear la fila ${idioma.toUpperCase()}: ${insError.message}`);
    }
  }
}

export function useTraduccionBotWeb() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ draftEs, catalogos }: { draftEs: DraftBotWeb; catalogos: CatalogosCarta }) =>
      traducirYGuardar(draftEs, catalogos),
    onSuccess: () => {
      toast.success("Traducido a inglés y francés", {
        description: "El asistente de la web ya responde en los tres idiomas.",
      });
    },
    onError: (error: Error) => {
      toast.error("La traducción falló", {
        description: `El español sí se ha guardado. Inglés y francés siguen con la versión anterior; pulsa "Reintentar traducción". ${error.message}`,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: CONFIG_BOT_WEB_QUERY_KEY });
    },
  });
}
