import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { normalizarCentro, type CentroModelos } from "@/lib/modelosIa";

// Sin tipos generados: las tablas son de 20261107500000 y la pantalla tiene que
// decir «falta la migración» en vez de romper si aún no está.
const sb = supabase as unknown as SupabaseClient;

export const CLAVE_MODELOS_IA = ["super-admin", "modelos-ia"] as const;

export type ResultadoCentro = { disponible: true; centro: CentroModelos } | { disponible: false };

function sinMigracion(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false;
  if (e.code === "PGRST202" || e.code === "42883" || e.code === "42P01") return true;
  return /ia_modelos_centro|ia_modelo_funcion/.test(e.message ?? "") && /does not exist|could not find|schema cache/i.test(e.message ?? "");
}

export function useCentroModelos() {
  return useQuery({
    queryKey: CLAVE_MODELOS_IA,
    queryFn: async (): Promise<ResultadoCentro> => {
      const { data, error } = await sb.rpc("ia_modelos_centro", { p_dias: 30 });
      if (error) {
        if (sinMigracion(error)) return { disponible: false };
        throw new Error(error.message || "No se pudo cargar el centro de modelos.");
      }
      return { disponible: true, centro: normalizarCentro(data) };
    },
    staleTime: 60_000,
  });
}

/** Mensaje legible del error de una Edge Function (el cuerpo trae { error }). */
async function mensajeFuncion(error: unknown, porDefecto: string): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const j = await ctx.json();
      if (typeof j?.error === "string") return j.error;
    } catch {
      // cuerpo no JSON
    }
  }
  return error instanceof Error && error.message ? error.message : porDefecto;
}

export interface CambioModeloFuncion {
  funcion: string;
  modelo: string | null;
  modelo_respaldo: string | null;
  notas: string | null;
}

export function useGuardarModeloFuncion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: CambioModeloFuncion) => {
      const { data, error } = await sb
        .from("ia_modelo_funcion")
        .update({ modelo: c.modelo, modelo_respaldo: c.modelo_respaldo, notas: c.notas })
        .eq("funcion", c.funcion)
        .select("funcion");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) throw new Error("No se ha guardado: solo un super admin puede cambiar el modelo.");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: CLAVE_MODELOS_IA }),
  });
}

export interface ResumenSincronizacion {
  total?: number;
  nuevos?: string[];
  retirados?: string[];
  en_uso_no_disponibles?: string[];
  en_uso_sin_precio?: string[];
  avisos?: number;
  primera_carga?: boolean;
}

export function useSincronizarModelos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<ResumenSincronizacion> => {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string } & ResumenSincronizacion>("ia-modelos-openai", {
        body: { accion: "sincronizar" },
      });
      if (error) throw new Error(await mensajeFuncion(error, "No se pudo leer la lista de OpenAI."));
      if (!data?.ok) throw new Error(data?.error ?? "No se pudo leer la lista de OpenAI.");
      return data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: CLAVE_MODELOS_IA }),
  });
}

export interface ResultadoPrueba {
  ok: boolean;
  modelo: string;
  latencia_ms?: number;
  respuesta?: string;
  error?: string;
  tokens?: { entrada: number | null; salida: number | null };
}

export function useProbarModelo() {
  return useMutation({
    mutationFn: async ({ modelo, funcion }: { modelo: string; funcion?: string }): Promise<ResultadoPrueba> => {
      const { data, error } = await supabase.functions.invoke<ResultadoPrueba>("ia-modelos-openai", {
        body: { accion: "probar", modelo, funcion },
      });
      if (error) return { ok: false, modelo, error: await mensajeFuncion(error, "La prueba no ha podido hacerse.") };
      return data ?? { ok: false, modelo, error: "Respuesta vacía" };
    },
  });
}
