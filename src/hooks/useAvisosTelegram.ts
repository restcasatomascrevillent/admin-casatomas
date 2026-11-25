import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Sin tipos generados: las tablas son de 20261126001000 (y los chats por canal de 20261216100000); la
// tarjeta tiene que decir «falta la migración» en vez de romper si aún no está.
const sb = supabase as unknown as SupabaseClient;

/** chat_id válido: número (grupos: -100…) o @canal. Igual que el CHECK de la tabla. */
export const chatIdValido = (v: string): boolean => /^(-?[0-9]{1,20}|@[A-Za-z0-9_]{5,32})$/.test(v.trim());

export const CLAVE_AVISOS_TELEGRAM = ["super-admin", "avisos-telegram"] as const;

/** Los chats por canal (20261216100000). Vacíos: Reservas, Facturas y Resúmenes usan chat_id; Fallos no se envía. */
export const CHATS_CANAL = [
  { campo: "chat_reservas", etiqueta: "Reservas", ayuda: "Reservas nuevas y canceladas de hoy y mañana. Vacío: el chat general." },
  { campo: "chat_facturas", etiqueta: "Facturas y márgenes", ayuda: "Precios, márgenes, albaranes y el resto de avisos al momento. Vacío: el chat general." },
  { campo: "chat_resumenes", etiqueta: "Resúmenes", ayuda: "Resumen diario, cierre del día y semanal. Vacío: el chat general." },
  { campo: "chat_fallos", etiqueta: "Fallos técnicos", ayuda: "Solo para desarrolladores (llevan emails y preguntas del chatbot). Vacío: no se envían." },
] as const;
export type CampoChat = "chat_id" | (typeof CHATS_CANAL)[number]["campo"];

export const MIGRACION_BASE = "20261126001000_avisos_telegram";
export const MIGRACION_CANALES = "20261216100000_telegram_canales";
export const MIGRACION_FACTURAS = "20261222100000_telegram_facturas";

export interface ConfigAvisosTelegram {
  activo: boolean;
  /** Chat general: el de Reservas, Facturas y Resúmenes si no tienen el suyo. */
  chat_id: string | null;
  chat_reservas: string | null;
  chat_facturas: string | null;
  chat_resumenes: string | null;
  chat_fallos: string | null;
  hora_resumen: number;
  tipos_al_momento: string[];
  silencio_activo: boolean;
  silencio_desde: number;
  silencio_hasta: number;
  resumen_ultimo_dia: string | null;
  /** 25/11/2026 (20261222100000): cierre del día (facturas subidas y avisos del día) a cierre_hora, en Resúmenes. */
  cierre_activo: boolean;
  cierre_hora: number;
}

export interface EnvioTelegram {
  tipo: string;
  enviado_en: string;
  ok: boolean;
  error: string | null;
}

export type EstadoAvisosTelegram =
  | { disponible: false; migracion: string }
  | { disponible: true; config: ConfigAvisosTelegram; ultimoEnvio: EnvioTelegram | null; ultimoError: EnvioTelegram | null };

export type CambiosAvisosTelegram = Partial<Omit<ConfigAvisosTelegram, "resumen_ultimo_dia">>;

/** Qué migración falta según el error de la lectura (null si el error es otro). */
function migracionQueFalta(e: { code?: string; message?: string } | null): string | null {
  if (!e) return null;
  const m = e.message ?? "";
  if (e.code === "42P01" || e.code === "PGRST205") return MIGRACION_BASE;
  if (/cierre_(activo|hora)/.test(m)) return MIGRACION_FACTURAS;
  if (e.code === "42703" || /chat_(reservas|facturas|resumenes|fallos)/.test(m)) return MIGRACION_CANALES;
  if (/avisos_telegram/.test(m) && /does not exist|could not find|schema cache/i.test(m)) return MIGRACION_BASE;
  return null;
}

export function useAvisosTelegram() {
  return useQuery({
    queryKey: CLAVE_AVISOS_TELEGRAM,
    queryFn: async (): Promise<EstadoAvisosTelegram> => {
      const { data, error } = await sb
        .from("avisos_telegram_config")
        .select("activo, chat_id, chat_reservas, chat_facturas, chat_resumenes, chat_fallos, hora_resumen, tipos_al_momento, silencio_activo, silencio_desde, silencio_hasta, resumen_ultimo_dia, cierre_activo, cierre_hora")
        .eq("id", true)
        .maybeSingle();
      if (error) {
        const migracion = migracionQueFalta(error);
        if (migracion) return { disponible: false, migracion };
        throw new Error(error.message || "No se pudo leer la configuración de Telegram.");
      }
      if (!data) throw new Error("Solo un super admin puede ver la configuración de Telegram.");
      const [ok, mal] = await Promise.all([
        sb.from("avisos_telegram_envios").select("tipo, enviado_en, ok, error").eq("ok", true).order("enviado_en", { ascending: false }).limit(1),
        sb.from("avisos_telegram_envios").select("tipo, enviado_en, ok, error").eq("ok", false).order("enviado_en", { ascending: false }).limit(1),
      ]);
      return {
        disponible: true,
        config: data as ConfigAvisosTelegram,
        ultimoEnvio: (ok.data?.[0] as EnvioTelegram | undefined) ?? null,
        ultimoError: (mal.data?.[0] as EnvioTelegram | undefined) ?? null,
      };
    },
    staleTime: 30_000,
  });
}

export function useGuardarAvisosTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cambios: CambiosAvisosTelegram) => {
      const { data, error } = await sb.from("avisos_telegram_config").update(cambios).eq("id", true).select("id");
      if (error) {
        if (/chat_/.test(error.message)) throw new Error("Algún chat no es válido: un número (los grupos empiezan por -100) o @nombre_del_canal.");
        throw new Error(error.message);
      }
      if (!data || data.length === 0) throw new Error("No se ha guardado: solo un super admin puede cambiar Telegram.");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: CLAVE_AVISOS_TELEGRAM }),
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

export interface ResultadoPruebaTelegram {
  ok: boolean;
  error?: string;
  sin_configurar?: boolean;
  /** Una prueba por chat distinto, con los canales que recibe (20261216100000). */
  resultados?: { canales: string[]; ok: boolean; error?: string }[];
}

export function useProbarTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<ResultadoPruebaTelegram> => {
      const { data, error } = await supabase.functions.invoke<ResultadoPruebaTelegram>("avisos-telegram", { body: { accion: "probar" } });
      if (error) return { ok: false, error: await mensajeFuncion(error, "No se pudo enviar la prueba.") };
      return data ?? { ok: false, error: "Respuesta vacía" };
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: CLAVE_AVISOS_TELEGRAM }),
  });
}
