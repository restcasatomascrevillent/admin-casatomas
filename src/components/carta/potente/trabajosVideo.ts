/**
 * Acceso a Supabase de «Mandar a un dispositivo potente» (tabla
 * trabajos_video, RPC reclamar/terminar/soltar, bucket `platos/pendientes/`
 * y la Edge Function notificar-video). Ver docs/video-dispositivo-potente.md.
 *
 * Todo funciona sin la migración aplicada: las lecturas devuelven
 * `{ disponible: false }` y la UI oculta el botón y el aviso.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  describirDispositivo,
  esErrorSinMigracion,
  extensionBruto,
  MAX_BYTES_BRUTO,
  tipoMimeBruto,
  type TrabajoVideo,
} from "./colaPendientes";

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

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Sube el vídeo en bruto a `pendientes/` y crea el trabajo. Si algo falla no deja el fichero huérfano. */
export async function mandarAPotente(opts: { platoId: string; archivo: Blob & { name?: string }; tema: string; userId: string }): Promise<TrabajoVideo> {
  const { platoId, archivo, tema, userId } = opts;
  if (archivo.size > MAX_BYTES_BRUTO)
    throw new Error(`El vídeo pesa ${Math.round(archivo.size / 1048576)} MB; el máximo es ${MAX_BYTES_BRUTO / 1048576} MB. Graba solo 3–4 s.`);
  if (archivo.size === 0) throw new Error("El vídeo está vacío");
  const ext = extensionBruto(archivo);
  const ruta = `pendientes/${uuid()}.${ext}`;
  const almacen = sb.storage.from(BUCKET_BRUTO);
  const { error: eSubida } = await almacen.upload(ruta, archivo, { upsert: false, contentType: tipoMimeBruto(ext) });
  if (eSubida) throw eSubida;
  const { data, error } = await sb
    .from("trabajos_video")
    .insert({ plato_id: platoId, ruta_original: ruta, tema, creado_por: userId, dispositivo_origen: describirDispositivo() })
    .select(COLUMNAS)
    .single();
  if (error) {
    await almacen.remove([ruta]).catch(() => undefined);
    if ((error as { code?: string }).code === "23505") throw new Error("Este plato ya tiene un vídeo pendiente.");
    lanzar(error);
  }
  return data as unknown as TrabajoVideo;
}

/**
 * Cambio de fondo en un dispositivo potente: copia (en el servidor) el
 * original guardado a `pendientes/` y crea el trabajo con el tema nuevo. Al
 * terminar, el dispositivo potente devuelve el bruto a `videos-originales/`.
 */
export async function mandarOriginalAPotente(opts: { platoId: string; rutaOriginal: string; tema: string }): Promise<TrabajoVideo> {
  const { platoId, rutaOriginal, tema } = opts;
  const { data: u } = await sb.auth.getUser();
  if (!u.user) throw new Error("Vuelve a entrar en el panel para mandar el vídeo.");
  const ext = extensionBruto({ name: rutaOriginal });
  const ruta = `pendientes/${uuid()}.${ext}`;
  const almacen = sb.storage.from(BUCKET_BRUTO);
  const { error: eCopia } = await almacen.copy(rutaOriginal, ruta);
  if (eCopia) throw eCopia;
  const { data, error } = await sb
    .from("trabajos_video")
    .insert({ plato_id: platoId, ruta_original: ruta, tema, creado_por: u.user.id, dispositivo_origen: describirDispositivo() })
    .select(COLUMNAS)
    .single();
  if (error) {
    await almacen.remove([ruta]).catch(() => undefined);
    if ((error as { code?: string }).code === "23505") throw new Error("Este plato ya tiene un vídeo pendiente.");
    lanzar(error);
  }
  return data as unknown as TrabajoVideo;
}

/** Cancela un pendiente (no uno que ya se está procesando) y borra su bruto. */
export async function cancelarTrabajo(t: Pick<TrabajoVideo, "id" | "ruta_original">): Promise<boolean> {
  const { data, error } = await sb.from("trabajos_video").delete().eq("id", t.id).neq("estado", "procesando").select("id");
  if (error) lanzar(error);
  const borrado = (data ?? []).length > 0;
  if (borrado) await sb.storage.from(BUCKET_BRUTO).remove([t.ruta_original]).catch(() => undefined);
  return borrado;
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
