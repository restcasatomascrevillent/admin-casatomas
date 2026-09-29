import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";
import { toast } from "sonner";

export type ChatWebConfig = Tables<"chat_web_config">;
export type ChatWebConfigUpdate = Omit<TablesUpdate<"chat_web_config">, "id" | "updated_at">;
export type ChatWebUsoDiario = Tables<"chat_web_uso_diario">;

const QUERY_KEY = ["chatWebProteccion"] as const;
const DIAS_HISTORIAL = 7;
const ZONA_RESTAURANTE = "Europe/Madrid";

// ----------------------------------------------------------------------------
// chat_web_config y chat_web_uso_diario las crea la migración
// 20260926120000_chat_web_proteccion.sql. Mientras no esté aplicada,
// PostgREST responde "Could not find the table ... in the schema cache"
// (PGRST205) — en Postgres puro 42P01. Ese caso NO es un error de la
// pantalla: se expone como `noDisponible` para que la UI muestre una nota
// discreta en vez de un toast rojo o una pantalla rota (mismo patrón que
// esErrorTablaPlantillasFaltante en usePlantillasEmail.ts).
// ----------------------------------------------------------------------------
function esErrorTablaFaltante(error: unknown): boolean {
  const mensaje = String((error as { message?: string } | null)?.message ?? "");
  const codigo = String((error as { code?: string } | null)?.code ?? "");
  return codigo === "PGRST205" || codigo === "42P01" || /chat_web_config|chat_web_uso_diario/.test(mensaje);
}

/** Fecha YYYY-MM-DD en la zona del restaurante (no en UTC ni en la del navegador). */
export function fechaLocalISO(fecha: Date = new Date()): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_RESTAURANTE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
}

interface DatosProteccion {
  noDisponible: boolean;
  config: ChatWebConfig | null;
  uso: ChatWebUsoDiario[];
}

async function fetchProteccion(): Promise<DatosProteccion> {
  const desde = fechaLocalISO(new Date(Date.now() - (DIAS_HISTORIAL - 1) * 24 * 60 * 60 * 1000));

  const [cfg, uso] = await Promise.all([
    supabase.from("chat_web_config").select("*").maybeSingle(),
    supabase
      .from("chat_web_uso_diario")
      .select("*")
      .gte("dia", desde)
      .order("dia", { ascending: false })
      .limit(DIAS_HISTORIAL),
  ]);

  if (cfg.error) {
    if (esErrorTablaFaltante(cfg.error)) return { noDisponible: true, config: null, uso: [] };
    throw cfg.error;
  }
  if (uso.error) {
    if (esErrorTablaFaltante(uso.error)) return { noDisponible: true, config: cfg.data, uso: [] };
    throw uso.error;
  }
  return { noDisponible: false, config: cfg.data, uso: uso.data ?? [] };
}

export function useProteccionBotWeb() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchProteccion,
    // El consumo cambia mientras la pantalla está abierta: refresco suave.
    refetchInterval: 60_000,
  });

  const hoy = fechaLocalISO();
  const uso = query.data?.uso ?? [];
  const usoHoy = uso.find((u) => u.dia === hoy) ?? null;

  const updateConfig = useMutation({
    mutationFn: async (updates: ChatWebConfigUpdate) => {
      // Fila única (id = true), por eso el filtro fijo.
      const { data, error } = await supabase
        .from("chat_web_config")
        .update(updates)
        .eq("id", true)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      // Sin fila devuelta = RLS no dejó actualizar (o la fila no existe): no
      // fingir que se guardó.
      if (!data) throw new Error("No se actualizó la configuración (¿permisos de super admin o fila inexistente?).");
      return data;
    },
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previo = queryClient.getQueryData<DatosProteccion>(QUERY_KEY);
      if (previo?.config) {
        queryClient.setQueryData<DatosProteccion>(QUERY_KEY, {
          ...previo,
          config: { ...previo.config, ...updates },
        });
      }
      return { previo };
    },
    onError: (error: Error, _updates, contexto) => {
      if (contexto?.previo) queryClient.setQueryData(QUERY_KEY, contexto.previo);
      toast.error("No se pudo guardar la protección del bot", {
        description: esErrorTablaFaltante(error) ? "Falta aplicar la migración en la base de datos." : error.message,
      });
    },
    onSuccess: () => {
      toast.success("Protección del bot guardada", {
        description: "Los nuevos límites ya se aplican al chat de la web.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  return {
    config: query.data?.config ?? null,
    uso,
    usoHoy,
    noDisponible: query.data?.noDisponible ?? false,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    updateConfig,
  };
}
