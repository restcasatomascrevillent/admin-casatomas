/**
 * Datos y acciones del vídeo de los reels (fase 6, docs/instagram-video.md):
 *  - useEstadoReel(piezaId): la pieza y su último trabajo de render; se
 *    refresca cada 5 s mientras hay un trabajo vivo o Meta procesa el vídeo.
 *  - useReelsGuardados(): los últimos reels (para reabrirlos).
 *  - encolarRender / cancelarRender: RPC instagram_render_encolar / _cancelar
 *    (validan en el servidor; el panel no escribe la cola directamente).
 *  - prepararFotosReel: copia a tmp/ del cubo las fotos de Drive y la carta
 *    (instagram-drive → preparar), reutilizando las que ya estén en caché.
 *  - subirPistaAudio: pista propia (con licencia) al cubo instagram-video.
 * Las tablas y RPC nuevas no están en src/integrations/supabase/types.ts: se
 * consultan con el cliente sin tipos y se estrechan aquí.
 */
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { fotoPreparable, type MarcaId } from "@/lib/instagram";
import type { ReelPieza } from "@/lib/instagram/reels";
import { prepararFotoCarta, prepararFotoDrive } from "@/components/marketing/instagram/api";
import { clavePreparada, VIDA_PREPARADA_MS } from "@/components/marketing/instagram/useFotosInstagram";
import { fotosAPreparar, revisarPista, TIPOS_AUDIO, type PiezaReel, type TrabajoRender } from "./logica";

// Sin tipos generados para instagram_trabajos_render ni las columnas de vídeo.
const sb = supabase as unknown as SupabaseClient;

export const CUBO_VIDEO = "instagram-video";
export const CLAVE_REEL = ["instagram_reel"] as const;
export const CLAVE_REELS = ["instagram_reels_guardados"] as const;
const COLUMNAS_PIEZA =
  "id,marca,plantilla,tipo_medio,estado,datos,caption,video_ruta,portada_ruta,duracion_s,video_bytes,contenedor_id,permalink,error,procesando_accion,procesando_desde,updated_at,created_at";
const COLUMNAS_TRABAJO = "id,pieza_id,estado,progreso,fotogramas,dispositivo,error,avisos,intentos,created_at,reclamado_en,latido_en,terminado_en";

const BASE_SUPABASE = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");

/** URL pública de un objeto del cubo instagram-video (con ?v= para no ver uno viejo de la caché). */
export function urlCuboVideo(ruta: string | null | undefined, version?: string): string | null {
  if (!ruta) return null;
  const url = `${BASE_SUPABASE}/storage/v1/object/public/${CUBO_VIDEO}/${ruta.split("/").map(encodeURIComponent).join("/")}`;
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

export interface EstadoReel {
  pieza: PiezaReel | null;
  trabajo: TrabajoRender | null;
}

export function useEstadoReel(piezaId: string | null) {
  return useQuery({
    queryKey: [...CLAVE_REEL, piezaId],
    enabled: !!piezaId,
    queryFn: async (): Promise<EstadoReel> => {
      const [p, t] = await Promise.all([
        sb.from("instagram_piezas").select(COLUMNAS_PIEZA).eq("id", piezaId as string).maybeSingle(),
        sb.from("instagram_trabajos_render").select(COLUMNAS_TRABAJO).eq("pieza_id", piezaId as string).order("created_at", { ascending: false }).limit(1),
      ]);
      if (p.error) throw p.error;
      if (t.error) throw t.error;
      return { pieza: (p.data as PiezaReel | null) ?? null, trabajo: ((t.data as TrabajoRender[] | null) ?? [])[0] ?? null };
    },
    refetchInterval: (q) => {
      const d = q.state.data as EstadoReel | undefined;
      const vivo = d?.trabajo && (d.trabajo.estado === "pendiente" || d.trabajo.estado === "renderizando");
      return vivo || d?.pieza?.estado === "procesando" ? 5_000 : false;
    },
  });
}

export function useReelsGuardados(activo = true) {
  return useQuery({
    queryKey: CLAVE_REELS,
    enabled: activo,
    queryFn: async (): Promise<PiezaReel[]> => {
      const { data, error } = await sb.from("instagram_piezas").select(COLUMNAS_PIEZA).eq("tipo_medio", "reel").order("updated_at", { ascending: false }).limit(20);
      if (error) throw error;
      return (data as PiezaReel[] | null) ?? [];
    },
    staleTime: 30_000,
  });
}

/** Mensaje claro si falta la migración (la tabla o la columna no existen). */
export function textoErrorVideo(e: unknown): string {
  const m = (e as { message?: string; code?: string } | null) ?? {};
  if (m.code === "PGRST205" || m.code === "42P01" || m.code === "42703" || /instagram_trabajos_render|tipo_medio|instagram_render_/.test(m.message ?? "")) {
    if (/does not exist|not find|no existe/i.test(m.message ?? "")) {
      return "Los vídeos de reels aún no están activados en este Supabase (falta la migración 20261109100000_instagram_video).";
    }
  }
  return m.message || "Error desconocido";
}

export interface DatosEncolar {
  piezaId: string | null;
  marca: MarcaId;
  reel: ReelPieza;
  fotos: Record<string, string>;
  caption?: string | null;
  portadaS?: number | null;
  audioRuta?: string | null;
}

export async function encolarRender(d: DatosEncolar): Promise<{ piezaId: string; trabajo: TrabajoRender }> {
  const { data, error } = await sb.rpc("instagram_render_encolar", {
    p_pieza_id: d.piezaId,
    p_marca: d.marca,
    p_reel: d.reel,
    p_fotos: d.fotos,
    p_caption: d.caption ?? null,
    p_portada_s: d.portadaS ?? null,
    p_audio_ruta: d.audioRuta ?? null,
  });
  if (error) throw error;
  const r = data as { ok?: boolean; piezaId?: string; trabajo?: TrabajoRender } | null;
  if (!r?.piezaId || !r.trabajo) throw new Error("El servidor no devolvió el trabajo");
  return { piezaId: r.piezaId, trabajo: r.trabajo };
}

export async function cancelarRender(trabajoId: string): Promise<void> {
  const { error } = await sb.rpc("instagram_render_cancelar", { p_id: trabajoId });
  if (error) throw error;
}

/**
 * id de foto → URL de su copia tmp/ para el render. Usa la caché de React
 * Query (las mismas claves que el editor de imágenes) y prepara las que falten.
 */
export async function prepararFotosReel(qc: QueryClient, reel: ReelPieza): Promise<Record<string, string>> {
  const salida: Record<string, string> = {};
  for (const id of fotosAPreparar(reel)) {
    const url = await prepararFoto(qc, reel.marca as MarcaId, id);
    if (url) salida[id] = url;
  }
  return salida;
}

/** Copia tmp/ de UNA foto de Drive o de la carta (caché de 12 h, como el editor de imágenes). */
export async function prepararFoto(qc: QueryClient, marca: MarcaId, id: string): Promise<string | undefined> {
  const origen = fotoPreparable(id);
  if (!origen) return undefined;
  const r = await qc.fetchQuery({
    queryKey: clavePreparada(id),
    queryFn: () => (origen.origen === "carta" ? prepararFotoCarta(marca, origen.id) : prepararFotoDrive(marca, origen.id)),
    staleTime: VIDA_PREPARADA_MS,
    gcTime: VIDA_PREPARADA_MS,
  });
  return r?.url || undefined;
}

/** URL ya preparada de una foto (o undefined): para la vista previa al reabrir un reel. */
export function urlPreparadaEnCache(qc: QueryClient, id: string): string | undefined {
  return (qc.getQueryData(clavePreparada(id)) as { url?: string } | undefined)?.url || undefined;
}

/** Sube una pista propia (con licencia) al cubo y devuelve su ruta audio/<uuid>.<ext>. */
export async function subirPistaAudio(archivo: File): Promise<string> {
  const r = revisarPista(archivo.name, archivo.size);
  if ("motivo" in r) throw new Error(r.motivo);
  const ruta = `audio/${crypto.randomUUID()}.${r.ext}`;
  const { error } = await sb.storage.from(CUBO_VIDEO).upload(ruta, archivo, { contentType: TIPOS_AUDIO[r.ext], upsert: false });
  if (error) throw error;
  return ruta;
}
