/**
 * Subir y borrar fotos de la biblioteca de Instagram desde el panel, con el
 * cliente de Supabase del usuario (RLS: bucket «instagram» y tabla
 * instagram_fotos, sección marketing). Ver docs/instagram-fotos.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { BUCKET_INSTAGRAM, fotoDesdeFila, rutaFotoSubida, type Foto, type MarcaId, type TipoFoto } from "@/lib/instagram";

const sb = supabase as unknown as SupabaseClient;

export interface NuevaFoto {
  blob: Blob;
  marca: MarcaId;
  tipo: TipoFoto;
  descripcion: string;
  ancho: number;
  alto: number;
}

function nuevoUuid(): string {
  return crypto.randomUUID();
}

/**
 * Sube el JPEG a fotos/<marca>/subidas/<uuid>.jpg y guarda la fila en
 * instagram_fotos. Si la fila no se puede guardar, borra el fichero (sin
 * huérfanos). Devuelve la foto ya con la forma del catálogo.
 */
export async function subirFotoBiblioteca(n: NuevaFoto, crearId: () => string = nuevoUuid): Promise<Foto> {
  const id = crearId();
  const ruta = rutaFotoSubida(n.marca, id);
  const { error: errorSubida } = await sb.storage.from(BUCKET_INSTAGRAM).upload(ruta, n.blob, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  });
  if (errorSubida) throw new Error(`No se ha podido subir la foto: ${errorSubida.message}`);

  const fila = { id, marca: n.marca, ruta, ancho: n.ancho, alto: n.alto, tipo: n.tipo, descripcion: n.descripcion.trim() };
  const { error: errorFila } = await sb.from("instagram_fotos").insert(fila);
  if (errorFila) {
    await sb.storage.from(BUCKET_INSTAGRAM).remove([ruta]).catch(() => undefined);
    throw new Error(`No se ha podido guardar la foto en la biblioteca: ${errorFila.message}`);
  }
  const foto = fotoDesdeFila(fila);
  if (!foto) throw new Error("La foto subida no tiene una forma válida");
  return foto;
}

/** Cuántas piezas guardadas usan la foto (para avisar antes de borrarla). null si no se puede saber. */
export async function piezasQueUsanFoto(id: string): Promise<number | null> {
  const { count, error } = await sb.from("instagram_piezas").select("id", { count: "exact", head: true }).eq("datos->>foto", id);
  if (error) return null;
  return count ?? 0;
}

/**
 * Borra la fila (la RLS decide) y después el fichero. Si el fichero no se
 * puede borrar, la foto ya no sale en la biblioteca: se avisa con `aviso`.
 */
export async function borrarFotoBiblioteca(foto: Pick<Foto, "id" | "ruta">): Promise<{ aviso: string | null }> {
  const { data, error } = await sb.from("instagram_fotos").delete().eq("id", foto.id).select("id");
  if (error) throw new Error(`No se ha podido borrar la foto: ${error.message}`);
  if (!data || data.length === 0) throw new Error("No se ha podido borrar la foto: no existe o no tienes permiso.");
  const { error: errorFichero } = await sb.storage.from(BUCKET_INSTAGRAM).remove([foto.ruta]);
  return { aviso: errorFichero ? `La foto ya no sale en la biblioteca, pero el fichero sigue en el almacenamiento (${errorFichero.message}).` : null };
}
