/**
 * Acceso a Supabase de los encargos de Instagram: lecturas (RLS: el
 * restaurante ve todos, la agencia todos menos los borradores), las RPC de
 * estados (instagram_encargo_*), la subida de las entregas a los cubos y el
 * aviso Web Push (Edge Function notificar-video con { evento_id, tipo:
 * "encargo" }). Las tablas no están en src/integrations/supabase/types.ts: se
 * consultan sin tipos y se estrechan aquí. Ver docs/instagram-encargos.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  AJUSTES_POR_DEFECTO,
  ESTADOS_HUECO,
  type AdjuntoEncargo,
  type AjustesEncargos,
  type Encargo,
  type EntregaEncargo,
  type EventoEncargo,
  type MensajeEncargo,
} from "./logica";

const sb = supabase as unknown as SupabaseClient;
const BASE_SUPABASE = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");

export const CLAVE_ENCARGOS = ["instagram_encargos"] as const;
export const claveDetalle = (id: string) => [...CLAVE_ENCARGOS, "detalle", id] as const;
export const CLAVE_AJUSTES = [...CLAVE_ENCARGOS, "ajustes"] as const;
export const claveHuecos = (desde: string, hasta: string) => [...CLAVE_ENCARGOS, "huecos", desde, hasta] as const;

/** Mensaje claro de un error de PostgREST/RPC (el texto de la excepción SQL), o de la migración que falta. */
export function mensajeErrorEncargo(e: unknown): string {
  const m = (e as { message?: string; code?: string } | null) ?? {};
  const texto = m.message ?? "";
  if (m.code === "PGRST205" || m.code === "PGRST202" || m.code === "42P01" || /instagram_encargo/.test(texto) && /does not exist|not find|no existe|schema cache/i.test(texto)) {
    return "Los encargos aún no están activados en este Supabase (falta la migración 20261110100000_instagram_encargos).";
  }
  return texto || "No se pudo completar la acción";
}

export async function listarEncargos(): Promise<Encargo[]> {
  const { data, error } = await sb.from("instagram_encargos").select("*").order("updated_at", { ascending: false }).limit(300);
  if (error) throw error;
  return (data as Encargo[] | null) ?? [];
}

export interface DetalleEncargo {
  adjuntos: AdjuntoEncargo[];
  entregas: EntregaEncargo[];
  mensajes: MensajeEncargo[];
  eventos: EventoEncargo[];
}

export async function leerDetalle(id: string): Promise<DetalleEncargo> {
  const [a, e, m, ev] = await Promise.all([
    sb.from("instagram_encargo_adjuntos").select("*").eq("encargo_id", id).order("orden", { ascending: true }),
    sb.from("instagram_encargo_entregas").select("*").eq("encargo_id", id).order("version", { ascending: true }),
    sb.from("instagram_encargo_mensajes").select("*").eq("encargo_id", id).order("created_at", { ascending: true }),
    sb.from("instagram_encargo_eventos").select("*").eq("encargo_id", id).order("created_at", { ascending: true }),
  ]);
  for (const r of [a, e, m, ev]) if (r.error) throw r.error;
  return {
    adjuntos: (a.data as AdjuntoEncargo[] | null) ?? [],
    entregas: (e.data as EntregaEncargo[] | null) ?? [],
    mensajes: (m.data as MensajeEncargo[] | null) ?? [],
    eventos: (ev.data as EventoEncargo[] | null) ?? [],
  };
}

export async function leerAjustes(): Promise<AjustesEncargos> {
  try {
    const { data, error } = await sb.from("instagram_encargos_ajustes").select("plazo_dias_laborables, rondas_incluidas, cupo_mensual").maybeSingle();
    if (error || !data) return AJUSTES_POR_DEFECTO;
    return { ...AJUSTES_POR_DEFECTO, ...(data as Partial<AjustesEncargos>) };
  } catch {
    return AJUSTES_POR_DEFECTO;
  }
}

/**
 * Huecos de encargo del calendario (fecha deseada en [desde, hasta)). Nunca
 * lanza: sin la migración o sin permiso, el calendario sigue como antes.
 */
export type FilaHueco = Pick<Encargo, "id" | "numero" | "marca" | "titulo" | "formato" | "estado" | "fecha_deseada">;

export async function leerHuecos(desde: string, hasta: string): Promise<FilaHueco[]> {
  try {
    const { data, error } = await sb
      .from("instagram_encargos")
      .select("id,numero,marca,titulo,formato,estado,fecha_deseada")
      .in("estado", ESTADOS_HUECO as string[])
      .gte("fecha_deseada", desde)
      .lt("fecha_deseada", hasta)
      .order("fecha_deseada", { ascending: true })
      .limit(200);
    if (error) return [];
    return (data as FilaHueco[] | null) ?? [];
  } catch {
    return [];
  }
}

/** Pieza enlazada (vista previa de las automáticas y botón Programar). Solo la ve Marketing. */
export interface PiezaEnlazada {
  id: string;
  estado: string;
  tipo_medio: string | null;
  imagen_ruta: string | null;
  video_ruta: string | null;
  portada_ruta: string | null;
  caption: string | null;
  permalink: string | null;
  error: string | null;
  updated_at: string;
}

export async function leerPieza(id: string): Promise<PiezaEnlazada | null> {
  const { data, error } = await sb
    .from("instagram_piezas")
    .select("id,estado,tipo_medio,imagen_ruta,video_ruta,portada_ruta,caption,permalink,error,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  return (data as PiezaEnlazada | null) ?? null;
}

/** URL pública de un objeto de los cubos de Instagram (los dos son públicos: Meta los descarga). */
export function urlCubo(cubo: string | null | undefined, ruta: string | null | undefined, version?: string): string | null {
  if (!cubo || !ruta || !BASE_SUPABASE) return null;
  const url = `${BASE_SUPABASE}/storage/v1/object/public/${cubo}/${ruta.split("/").map(encodeURIComponent).join("/")}`;
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

export interface RespuestaEncargo {
  ok: boolean;
  eventoId: string | null;
  encargo?: Encargo;
  piezaId?: string;
  version?: number;
  rondaExtra?: boolean;
  borrado?: boolean;
}

/**
 * Llama a una RPC de encargos y, si dejó un evento, pide el aviso push a la
 * otra parte (sin esperar ni fallar si los avisos no están configurados).
 */
export async function llamarRpc(nombre: string, args: Record<string, unknown>, opciones: { avisar?: boolean } = {}): Promise<RespuestaEncargo> {
  const { data, error } = await sb.rpc(nombre, args);
  if (error) throw error;
  const r = (data ?? { ok: false, eventoId: null }) as RespuestaEncargo;
  if (r.eventoId && opciones.avisar !== false) void avisarEncargo(r.eventoId);
  return r;
}

export type ResultadoAviso = { ok: true; enviadas: number } | { ok: false; motivo: string };

/** Web Push a la otra parte (notificar-video, tipo «encargo»). Nunca lanza. */
export async function avisarEncargo(eventoId: string): Promise<ResultadoAviso> {
  try {
    const { data, error } = await sb.functions.invoke("notificar-video", { body: { evento_id: eventoId, tipo: "encargo" } });
    if (error) return { ok: false, motivo: (error as Error).message || "No se pudo avisar" };
    const d = (data ?? {}) as { ok?: boolean; enviadas?: number; error?: string };
    return d.ok ? { ok: true, enviadas: Number(d.enviadas ?? 0) } : { ok: false, motivo: d.error ?? "No se pudo avisar" };
  } catch (e) {
    return { ok: false, motivo: (e as Error)?.message || "No se pudo avisar" };
  }
}

/** Sube un fichero de entrega al cubo (sin sobrescribir). */
export async function subirFichero(cubo: string, ruta: string, archivo: Blob, tipo: string): Promise<void> {
  const { error } = await sb.storage.from(cubo).upload(ruta, archivo, { contentType: tipo, upsert: false });
  if (error) throw error;
}

/** Medidas de una imagen o de un vídeo en el navegador (null si no se pueden leer). */
export async function medidasFichero(archivo: File): Promise<{ ancho: number | null; alto: number | null; duracion: number | null }> {
  const nada = { ancho: null, alto: null, duracion: null };
  try {
    if (archivo.type.startsWith("image/") && typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(archivo);
      const r = { ancho: bmp.width, alto: bmp.height, duracion: null };
      bmp.close?.();
      return r;
    }
    if (archivo.type.startsWith("video/") && typeof document !== "undefined" && typeof URL.createObjectURL === "function") {
      const url = URL.createObjectURL(archivo);
      try {
        return await new Promise((ok) => {
          const v = document.createElement("video");
          v.preload = "metadata";
          const fin = (x: { ancho: number | null; alto: number | null; duracion: number | null }) => ok(x);
          v.onloadedmetadata = () => fin({ ancho: v.videoWidth || null, alto: v.videoHeight || null, duracion: Number.isFinite(v.duration) ? Math.round(v.duration * 100) / 100 : null });
          v.onerror = () => fin(nada);
          setTimeout(() => fin(nada), 8000);
          v.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } catch {
    /* sin medidas */
  }
  return nada;
}
