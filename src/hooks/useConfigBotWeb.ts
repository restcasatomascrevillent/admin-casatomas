import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

export type IdiomaBotWeb = "es" | "en" | "fr";

export const IDIOMAS_BOT: IdiomaBotWeb[] = ["es", "en", "fr"];

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

// Estado de edición en memoria para UN idioma. platos/vinos viven como array
// para la UI de selección (checkboxes); en BD son texto separado por comas,
// que es como buildSystemPrompt (supabase/functions/chat-web/index.ts) los
// interpola literalmente en el prompt — la conversión ida/vuelta vive en
// configToDraft/draftToUpdate para que el resto de la pantalla no tenga que
// pensar en el formato de almacenamiento.
export interface DraftBotWeb {
  tono: string;
  mensaje_bienvenida: string;
  platos: string[];
  vinos: string[];
  instrucciones_extra: string;
  frases_personalizadas: string;
}

function splitLista(texto: string | null | undefined): string[] {
  return (texto ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function configToDraft(config: ConfigBotWeb | null | undefined): DraftBotWeb {
  return {
    tono: config?.tono ?? "",
    mensaje_bienvenida: config?.mensaje_bienvenida ?? "",
    platos: splitLista(config?.platos_recomendados),
    vinos: splitLista(config?.vinos_recomendados),
    instrucciones_extra: config?.instrucciones_extra ?? "",
    frases_personalizadas: config?.frases_personalizadas ?? "",
  };
}

export function draftToUpdate(draft: DraftBotWeb): ConfigBotWebUpdate {
  return {
    tono: draft.tono,
    mensaje_bienvenida: draft.mensaje_bienvenida,
    platos_recomendados: draft.platos.join(", "),
    vinos_recomendados: draft.vinos.join(", "),
    instrucciones_extra: draft.instrucciones_extra,
    frases_personalizadas: draft.frases_personalizadas,
  };
}

export function draftsIguales(a: DraftBotWeb, b: DraftBotWeb): boolean {
  return (
    a.tono === b.tono &&
    a.mensaje_bienvenida === b.mensaje_bienvenida &&
    a.instrucciones_extra === b.instrucciones_extra &&
    a.frases_personalizadas === b.frases_personalizadas &&
    a.platos.length === b.platos.length &&
    a.platos.every((p, i) => p === b.platos[i]) &&
    a.vinos.length === b.vinos.length &&
    a.vinos.every((v, i) => v === b.vinos[i])
  );
}

export const CONFIG_BOT_WEB_QUERY_KEY = ["configBotWeb"] as const;
const QUERY_KEY = CONFIG_BOT_WEB_QUERY_KEY;

// La tabla configBotWeb tiene 3 filas, una por idioma (es/en/fr) — la lee
// supabase/functions/chat-web filtrando por `idioma`. En el panel solo se
// edita la fila ES; EN/FR las genera useTraduccionBotWeb (traducir-contenido,
// modo "campos") justo después de guardar ES. Se piden las 3 de una vez para
// mostrar el estado y el contenido de las traducciones.
async function fetchTodasLasFilas(): Promise<ConfigBotWeb[]> {
  const { data, error } = await supabase.from("configBotWeb").select("*");
  if (error) throw error;
  return (data as ConfigBotWeb[] | null) ?? [];
}

export function useConfigBotWeb() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchTodasLasFilas,
  });

  const configs: Record<IdiomaBotWeb, ConfigBotWeb | null> = { es: null, en: null, fr: null };
  for (const row of query.data ?? []) {
    if (row.idioma === "es" || row.idioma === "en" || row.idioma === "fr") {
      configs[row.idioma] = row;
    }
  }

  const updateConfig = useMutation({
    mutationFn: async ({ idioma, updates }: { idioma: IdiomaBotWeb; updates: ConfigBotWebUpdate }) => {
      // Escritura directa a Supabase. Antes esto hacía POST a un webhook de
      // n8n (n8npersonal.miguelbenito.space) que el CSP de vercel.json ya no
      // permite llamar desde el navegador, así que "Guardar" no persistía
      // nada. configBotWeb es la tabla que de verdad lee chat-web.
      const existing = configs[idioma];
      if (existing?.id) {
        const { error } = await supabase.from("configBotWeb").update(updates).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("configBotWeb").insert({ ...updates, idioma });
        if (error) throw error;
      }
      return idioma;
    },
    onSuccess: (idioma) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success(idioma === "es" ? "Español guardado" : `Configuración ${idioma.toUpperCase()} guardada`, {
        description: "El asistente de la web ya responde con estos textos.",
      });
    },
    onError: (error: Error, variables) => {
      toast.error(`No se pudo guardar (${variables.idioma.toUpperCase()})`, { description: mensajeUsuario(error) });
    },
  });

  return {
    configs,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    updateConfig,
  };
}
