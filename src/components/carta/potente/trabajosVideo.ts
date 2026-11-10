/**
 * Acceso a Supabase de «Mandar a un dispositivo potente» (tabla
 * trabajos_video, RPC reclamar/terminar/soltar, bucket `platos/pendientes/`
 * y la Edge Function notificar-video). Ver docs/video-dispositivo-potente.md.
 *
 * Todo funciona sin la migración aplicada: las lecturas devuelven
 * `{ disponible: false }` y la UI oculta el aviso.
 *
 * El botón «Mandar a un dispositivo potente» se quitó el 10/11/2026 a
 * petición del dueño: el panel ya no crea trabajos nuevos. Queda la lectura
 * (etiqueta «Vídeo pendiente» de los que hubiera) y el procesado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { describirDispositivo, esErrorSinMigracion, type TrabajoVideo } from "./colaPendientes";

// trabajos_video y suscripciones_push aún no están en types.ts (generado).
const sb = supabase as unknown as SupabaseClient;

export const BUCKET_BRUTO = "platos";
const COLUMNAS =
  "id, plato_id, ruta_original, tema, estado, creado_por, dispositivo_origen, procesado_por, dispositivo_proceso, reclamado_en, intentos, error, created_at, Platos(nombre)";

export class ErrorSinMigracionTrabajos extends Error {
  constructor() {
    super("Falta aplicar la migración de «Mandar a un dispositivo potente» (tabla trabajos_video).");
    this.name = "ErrorSinMigracionTrabajos";
  }
}

function lanzar(error: unknown): never {
  if (esErrorSinMigracion(error)) throw new ErrorSinMigracionTrabajos();
  throw error;
}

export type LecturaTrabajos = { disponible: true; trabajos: TrabajoVideo[] } | { disponible: false };

/** Trabajos vivos (pendiente/procesando), opcionalmente de un plato. */
export async function trabajosVivos(platoId?: string): Promise<LecturaTrabajos> {
  let consulta = sb.from("trabajos_video").select(COLUMNAS).in("estado", ["pendiente", "procesando"]).order("created_at");
  if (platoId) consulta = consulta.eq("plato_id", platoId);
  const { data, error } = await consulta;
  if (error) {
    if (esErrorSinMigracion(error)) return { disponible: false };
    throw error;
  }
  return { disponible: true, trabajos: (data ?? []) as unknown as TrabajoVideo[] };
}

/** Reclama un trabajo concreto (o el más antiguo). null si ya lo cogió otro. */
export async function reclamarTrabajo(id?: string): Promise<TrabajoVideo | null> {
  const { data, error } = await sb.rpc("reclamar_trabajo_video", { p_id: id ?? null, p_dispositivo: describirDispositivo() });
  if (error) lanzar(error);
  const fila = (Array.isArray(data) ? data[0] : data) as TrabajoVideo | undefined;
  return fila ?? null;
}

export async function terminarTrabajo(id: string, ok: boolean, mensaje?: string): Promise<void> {
  const { error } = await sb.rpc("terminar_trabajo_video", { p_id: id, p_ok: ok, p_error: ok ? null : (mensaje ?? null) });
  if (error) lanzar(error);
}

export async function soltarTrabajo(id: string): Promise<void> {
  const { error } = await sb.rpc("soltar_trabajo_video", { p_id: id });
  if (error) lanzar(error);
}

export async function descargarBruto(ruta: string): Promise<Blob> {
  const { data, error } = await sb.storage.from(BUCKET_BRUTO).download(ruta);
  if (error || !data) throw error ?? new Error("No se pudo descargar el vídeo pendiente");
  return data;
}

export async function borrarBruto(ruta: string): Promise<void> {
  await sb.storage.from(BUCKET_BRUTO).remove([ruta]).catch(() => undefined);
}

/** `video_url` actual del plato (para borrar el fichero anterior al guardar el nuevo). */
export async function videoActualPlato(platoId: string): Promise<string | null> {
  const { data } = await sb.from("Platos").select("video_url").eq("id", platoId).maybeSingle();
  return ((data as { video_url?: string | null } | null)?.video_url ?? null) || null;
}

/**
 * Pide a la Edge Function notificar-video que avise (Web Push) al que grabó
 * el vídeo. Nunca lanza: si la función no está desplegada o no hay VAPID, el
 * vídeo ya está guardado y solo se pierde el aviso.
 */
export async function notificarTrabajo(id: string): Promise<{ ok: boolean; enviadas?: number; motivo?: string }> {
  try {
    const { data, error } = await sb.functions.invoke("notificar-video", { body: { trabajo_id: id } });
    if (error) return { ok: false, motivo: error.message };
    return { ok: true, enviadas: (data as { enviadas?: number } | null)?.enviadas ?? 0 };
  } catch (e) {
    return { ok: false, motivo: (e as Error)?.message };
  }
}
