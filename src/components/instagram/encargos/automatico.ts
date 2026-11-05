/**
 * Encargos automáticos: se generan con lo que ya existe y la pieza se vincula
 * al encargo (RPC instagram_encargo_vincular_pieza).
 *   · Imagen: /api/instagram-render (generarImagen) con la plantilla elegida,
 *     la primera foto (copiada a tmp/ con instagram-drive → preparar) y el
 *     título como titular (6 palabras como mucho, regla de marca).
 *   · Vídeo: el reel base elegido con las fotos del encargo en sus escenas, a
 *     la cola de render (instagram_render_encolar); el encargo sigue «en curso»
 *     hasta que el trabajador sube el MP4 (trigger de la migración).
 */
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fotoPreparable, obtenerPlantilla, type MarcaId } from "@/lib/instagram";
import { crearReelDesdeBase, INFO_BASES, type BaseReel, type ReelPieza } from "@/lib/instagram/reels";
import { generarImagen, prepararFotoOrigen, type FotoPreparada } from "@/components/marketing/instagram/api";
import { borradorVacio, piezaDesdeBorrador } from "@/components/marketing/instagram/pieza";
import { encolarRender, prepararFotosReel } from "@/components/instagram/video/useVideoReel";
import { llamarRpc, type RespuestaEncargo } from "./api";
import type { Encargo, FotoEncargo } from "./logica";

const sb = supabase as unknown as SupabaseClient;

/** Primeras 6 palabras del título (el titular de las plantillas no admite más). */
export function titularDesdeTitulo(titulo: string): string {
  return titulo.trim().split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
}

/** Bases de reel que valen para una marca (las de la marca y «libre»). */
export function basesDeMarca(marca: MarcaId): typeof INFO_BASES {
  return INFO_BASES.filter((b) => b.marca === null || b.marca === marca);
}

/** Reel a partir de la base, con las fotos del encargo repartidas por las escenas. */
export function reelDesdeEncargo(base: BaseReel, marca: MarcaId, fotos: readonly FotoEncargo[]): ReelPieza {
  const reel = crearReelDesdeBase(base, marca);
  if (!fotos.length) return reel;
  return { ...reel, escenas: reel.escenas.map((e, i) => ({ ...e, foto: fotos[i % fotos.length].id })) };
}

/** JSON de la pieza de imagen (solo los campos que admite la plantilla). */
export function piezaImagenDesdeEncargo(e: Pick<Encargo, "marca" | "formato" | "plantilla" | "titulo">, fotos: readonly FotoEncargo[]): Record<string, unknown> {
  const plantilla = obtenerPlantilla(e.plantilla ?? "");
  const formato = e.formato === "story" ? "story" : "post";
  const b = { ...borradorVacio(e.marca, e.plantilla ?? "", formato), foto: fotos[0]?.id ?? "", titular: titularDesdeTitulo(e.titulo) };
  return piezaDesdeBorrador(b, plantilla);
}

async function prepararPrimera(marca: MarcaId, fotos: readonly FotoEncargo[]): Promise<FotoPreparada | null> {
  const f = fotos[0];
  const origen = f ? fotoPreparable(f.id) : null;
  if (!f || !origen) return null;
  const r = await prepararFotoOrigen(marca, origen);
  return { id: f.id, url: r.url, ancho: r.ancho ?? 0, alto: r.alto ?? 0, tipo: null, marca };
}

/** Genera la pieza del encargo automático y la vincula. Lanza si algo falla (el encargo sigue «en curso»). */
export async function generarAutomatico(qc: QueryClient, e: Encargo, fotos: readonly FotoEncargo[]): Promise<RespuestaEncargo> {
  let piezaId: string;
  if (e.formato === "reel") {
    const reel = reelDesdeEncargo((e.base_reel ?? "libre") as BaseReel, e.marca, fotos);
    const urls = await prepararFotosReel(qc, reel);
    piezaId = (await encolarRender({ piezaId: null, marca: e.marca, reel, fotos: urls, caption: e.texto ?? null })).piezaId;
  } else {
    const pieza = piezaImagenDesdeEncargo(e, fotos);
    const preparada = await prepararPrimera(e.marca, fotos);
    const r = await generarImagen(pieza, null, undefined, preparada);
    piezaId = r.id;
    // El texto pedido pasa a la pieza (el render no lo guarda).
    if (e.texto) await sb.from("instagram_piezas").update({ caption: e.texto }).eq("id", piezaId);
  }
  return llamarRpc("instagram_encargo_vincular_pieza", { p_id: e.id, p_pieza_id: piezaId });
}
