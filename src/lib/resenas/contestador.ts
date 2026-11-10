/**
 * Reseñas Google · contestador (lado del panel). Lógica pura y llamada a la Edge Function
 * `resenas-contestador`, que es la única que habla con la IA y con Google.
 */
import { supabase } from "@/integrations/supabase/client";
import { ErrorNegocio } from "@/lib/mensaje-usuario";

export type EstadoRespuesta = "pendiente" | "propuesta" | "aprobada" | "publicada" | "error";
export type FiltroResenas = "por_responder" | "aprobadas" | "respondidas" | "todas";

export interface ResenaPanel {
  id: string;
  nombre_cliente: string;
  valoracion: number;
  comentario: string | null;
  fecha: string;
  fuente: string | null;
  estado: string | null;
  respuesta: string | null;
  fecha_respuesta: string | null;
  respuesta_propuesta?: string | null;
  respuesta_estado?: EstadoRespuesta | null;
  respuesta_origen?: string | null;
  respuesta_modelo?: string | null;
  respuesta_automatica?: boolean | null;
  respuesta_error?: string | null;
  gbp_review_name?: string | null;
  google_maps_uri?: string | null;
}

export interface AjustesContestador {
  proponer_automatico: boolean;
  autorespuesta_activa: boolean;
  autorespuesta_estrellas: number[];
  autorespuesta_sin_texto: boolean;
  firma: string;
  indicaciones: string;
  gbp_ubicacion?: string | null;
  gbp_ubicacion_nombre?: string | null;
  gbp_email?: string | null;
  gbp_ultima_sincronizacion?: string | null;
  gbp_ultimo_error?: string | null;
  ultimo_ciclo?: string | null;
}

export interface EstadoContestador {
  ia: boolean;
  google: {
    configurada: boolean;
    conectada: boolean;
    email?: string | null;
    ubicacion?: string | null;
    ubicacion_nombre?: string | null;
    ultima_sincronizacion?: string | null;
    ultimo_error?: string | null;
    redirect_uri?: string | null;
  };
}

/** Estado de la respuesta, también para filas de antes de la migración (sin `respuesta_estado`). */
export function estadoDe(r: ResenaPanel): EstadoRespuesta {
  if (r.respuesta && r.respuesta.trim()) return "publicada";
  return r.respuesta_estado ?? "pendiente";
}

export const ETIQUETA_ESTADO: Record<EstadoRespuesta, string> = {
  pendiente: "Sin respuesta",
  propuesta: "Propuesta lista",
  aprobada: "Aprobada · falta publicar",
  publicada: "Respondida",
  error: "Error al publicar",
};

/** Clases (fondo suave + texto) por estado, con el estilo de chips del panel. */
export const TONO_ESTADO: Record<EstadoRespuesta, string> = {
  pendiente: "bg-muted text-muted-foreground",
  propuesta: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  aprobada: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  publicada: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  error: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

export function filtrar(lista: ResenaPanel[], filtro: FiltroResenas): ResenaPanel[] {
  if (filtro === "todas") return lista;
  return lista.filter((r) => {
    const e = estadoDe(r);
    if (filtro === "por_responder") return e === "pendiente" || e === "propuesta" || e === "error";
    if (filtro === "aprobadas") return e === "aprobada";
    return e === "publicada";
  });
}

export function contar(lista: ResenaPanel[]): Record<FiltroResenas, number> {
  return {
    por_responder: filtrar(lista, "por_responder").length,
    aprobadas: filtrar(lista, "aprobadas").length,
    respondidas: filtrar(lista, "respondidas").length,
    todas: lista.length,
  };
}

/** Enlace para abrir la reseña en Google (o las reseñas de la ficha si no hay enlace directo). */
export function enlaceGoogle(r: Pick<ResenaPanel, "google_maps_uri">, placeId?: string | null): string | null {
  if (r.google_maps_uri && /^https:\/\//.test(r.google_maps_uri)) return r.google_maps_uri;
  if (placeId && /^[A-Za-z0-9_-]{10,}$/.test(placeId)) return `https://search.google.com/local/reviews?placeid=${encodeURIComponent(placeId)}`;
  return null;
}

export const MAX_RESPUESTA = 4096;

/** Llama a la Edge Function y convierte sus errores `{ error, mensaje }` en errores de negocio legibles. */
export async function llamarContestador<T = Record<string, unknown>>(cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("resenas-contestador", { body: cuerpo });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let j: { mensaje?: string; error?: string } | null = null;
    try {
      j = ctx && typeof ctx.json === "function" ? await ctx.clone().json() : null;
    } catch {
      j = null;
    }
    if (j?.mensaje) throw new ErrorNegocio(j.mensaje);
    if (ctx && (ctx as Response).status === 404) throw new ErrorNegocio("El contestador aún no está desplegado en este Supabase (función resenas-contestador).");
    throw error;
  }
  return data as T;
}
