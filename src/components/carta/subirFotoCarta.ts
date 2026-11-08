/**
 * Subida de la foto de un producto de la carta (platos, vinos, bebidas,
 * cócteles) con el mismo criterio de nombres que los vinos (rutasFotoCarta.ts):
 *
 *   - Con fondo de carta: la foto compuesta como `<id>-carta-<ext>.webp` (el
 *     «sticker», la versión de la web); `imagen_url` apunta a ella.
 *       · Platos y vinos (decisión del dueño, 08/11/2026: «En Supabase no
 *         quiero guardar más que el sticker»): el ORIGINAL NO se sube al
 *         bucket; va SOLO a Google Drive (trasGuardarFotoCarta →
 *         originalCarta.ts, instagram-drive · subir_original).
 *       · Bebidas y cócteles: además, el ORIGINAL intacto como `<id>.<ext>`
 *         (aún no tienen original en Drive).
 *   - «Usar foto original» (o recorte fallido): solo `<id>.<ext>`, que ES la
 *     foto de la web.
 */
import { supabase } from "@/integrations/supabase/client";
import { rutaCartaDesdeOriginal } from "./rutasFotoCarta";
import { exigirFotoValida } from "@/lib/validarFoto";

/** Buckets cuyo original va solo a Drive (en Supabase, solo el sticker). */
export const BUCKETS_SOLO_STICKER: readonly string[] = ["platos", "vinos"];

export interface RutasSubida {
  /** Nombre del original (de él sale el de la foto de carta); no siempre se sube. */
  original: string;
  /** null si no se sube foto de carta. */
  carta: string | null;
}

/** Extensión (minúsculas) del nombre de archivo; `jpg` si no tiene. */
function extension(nombre: string): string {
  const i = nombre.lastIndexOf(".");
  const ext = i > 0 ? nombre.slice(i + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : "jpg";
}

/** Rutas en Storage de una subida (sin efectos: se prueba con vitest). */
export function rutasSubida(id: string, original: File, carta: File | null): RutasSubida {
  const rutaOriginal = `${id}.${extension(original.name)}`;
  if (!carta) return { original: rutaOriginal, carta: null };
  const extCarta = carta.type === "image/webp" ? "webp" : "jpg";
  return { original: rutaOriginal, carta: rutaCartaDesdeOriginal(rutaOriginal, extCarta) };
}

export interface FotoParaSubir {
  original: File | null;
  /** Foto compuesta, solo si se va a usar (FotoCarta.usaCarta). */
  compuesta: File | null;
}

/**
 * Sube la foto de la web (sticker o, sin fondo, la original) con upsert y devuelve la URL pública a
 * guardar en `imagen_url` (con `?t=` para saltar la caché) y las rutas
 * escritas (para no borrarlas como «foto antigua»). Lanza error si falla.
 */
export async function subirFotoCarta(
  bucket: string,
  id: string,
  foto: FotoParaSubir,
): Promise<{ url: string; rutas: string[]; rutaPrincipal: string }> {
  if (!foto.original) throw new Error("No hay foto que subir");
  // Segunda barrera (la primera es aceptarFoto al elegirla): nunca se sube algo
  // que no sea JPG/PNG/WebP de hasta 5 MB. Lanza ErrorFoto con el motivo.
  const tipoReal = await exigirFotoValida(foto.original);
  const rutas = rutasSubida(id, foto.original, foto.compuesta);
  const almacen = supabase.storage.from(bucket);
  const conCarta = !!(rutas.carta && foto.compuesta);
  // Con sticker, en platos y vinos el original no se guarda en Supabase (va a Drive).
  const subirOriginal = !conCarta || !BUCKETS_SOLO_STICKER.includes(bucket);
  if (subirOriginal) {
    const { error: e1 } = await almacen.upload(rutas.original, foto.original, { upsert: true, contentType: tipoReal });
    if (e1) throw e1;
  }
  if (conCarta && rutas.carta && foto.compuesta) {
    const { error: e2 } = await almacen.upload(rutas.carta, foto.compuesta, { upsert: true, contentType: foto.compuesta.type });
    if (e2) throw e2;
  }
  const rutaPrincipal = conCarta && rutas.carta ? rutas.carta : rutas.original;
  const { data } = almacen.getPublicUrl(rutaPrincipal);
  return {
    url: `${data.publicUrl}?t=${Date.now()}`,
    rutas: [...(subirOriginal ? [rutas.original] : []), ...(conCarta && rutas.carta ? [rutas.carta] : [])],
    rutaPrincipal,
  };
}

/**
 * Ruta dentro del bucket a partir de la URL pública
 * (`…/object/public/<bucket>/<ruta>?t=…` → `<ruta>`). null si no es de ese bucket.
 */
export function rutaEnBucket(url: string | null | undefined, bucket: string): string | null {
  if (!url) return null;
  const limpia = url.split("?")[0].split("#")[0];
  const marca = `/object/public/${bucket}/`;
  const i = limpia.indexOf(marca);
  if (i < 0) return null;
  const ruta = decodeURIComponent(limpia.slice(i + marca.length));
  return ruta || null;
}
