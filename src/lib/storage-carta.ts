import { supabase } from "@/integrations/supabase/client";

export type TablaCarta = "Platos" | "Vinos" | "Bebidas" | "Cocteles";

/**
 * Ruta del objeto dentro de `bucket` a partir de su URL pública de Supabase
 * Storage (`.../object/public/<bucket>/<ruta>`, quizá con `?t=` de
 * cache-busting). `null` si no hay imagen o la URL no es de ese bucket, para
 * no borrar nunca nada por error.
 */
export function rutaEnBucket(imagenUrl: string | null | undefined, bucket: string): string | null {
  if (!imagenUrl) return null;
  try {
    const sinQuery = imagenUrl.split("?")[0].split("#")[0];
    const marcador = `/object/public/${bucket}/`;
    const indice = sinQuery.indexOf(marcador);
    if (indice === -1) return null;
    const ruta = sinQuery.slice(indice + marcador.length);
    return ruta ? decodeURIComponent(ruta) : null;
  } catch {
    return null;
  }
}

/**
 * Borra la foto de una ficha de la carta SOLO si ninguna otra ficha de la
 * misma tabla la sigue usando. En producción la botella normal y la Magnum de
 * un mismo vino comparten foto (9 pares): borrar o quitar la foto de una
 * dejaba a la otra con la imagen rota en la web.
 *
 * Nunca lanza. Ante cualquier duda (la consulta falla) NO se borra: un objeto
 * huérfano en Storage no se ve; una foto que otra ficha enseña, sí.
 */
export async function borrarFotoSiNoSeUsa(opciones: {
  tabla: TablaCarta;
  bucket: string;
  ruta: string;
  /** La ficha que deja de usar la foto (ya borrada, o a punto de cambiarla). */
  excluirId: string;
}): Promise<void> {
  const { tabla, bucket, ruta, excluirId } = opciones;
  try {
    const nombre = ruta.split("/").pop() || ruta;
    const { data, error } = await supabase
      .from(tabla)
      .select("id, imagen_url")
      .neq("id", excluirId)
      .like("imagen_url", `%${nombre}%`);
    if (error) {
      console.error(`No se pudo comprobar si otra ficha usa la foto ${bucket}/${ruta}; no se borra:`, error);
      return;
    }
    const enUso = ((data ?? []) as { imagen_url: string | null }[])
      .some((fila) => rutaEnBucket(fila.imagen_url, bucket) === ruta);
    if (enUso) {
      console.info(`La foto ${bucket}/${ruta} la usa otra ficha: se conserva en Storage.`);
      return;
    }
    const { error: errorBorrado } = await supabase.storage.from(bucket).remove([ruta]);
    if (errorBorrado) console.error(`No se pudo borrar la foto ${bucket}/${ruta} de Storage:`, errorBorrado);
  } catch (error) {
    console.error(`Error borrando la foto ${bucket}/${ruta} de Storage:`, error);
  }
}
