/**
 * Subir fotos a la biblioteca de Instagram desde el panel: el navegador las
 * prepara (convertirFoto) y la Edge Function instagram-drive las guarda en
 * Google Drive (marketing/instagram/fotos/<marca>) con su fila en
 * instagram_fotos (tipo y descripción). Ver docs/instagram-fotos.md.
 *
 * Para quitar una foto de la biblioteca se borra en Drive (es el archivo de
 * verdad): el panel no borra nada de Drive.
 */
import { fotoDesdeDrive, type Foto, type MarcaId, type TipoFoto } from "@/lib/instagram";
import { subirFotoDrive } from "./api";

export interface NuevaFoto {
  blob: Blob;
  marca: MarcaId;
  tipo: TipoFoto;
  descripcion: string;
  ancho: number;
  alto: number;
}

/** Sube el JPEG a Drive y devuelve la foto con la forma del catálogo (y los avisos de la función). */
export async function subirFotoBiblioteca(n: NuevaFoto): Promise<{ foto: Foto; avisos: string[] }> {
  let r: Awaited<ReturnType<typeof subirFotoDrive>>;
  try {
    r = await subirFotoDrive({ blob: n.blob, marca: n.marca, tipo: n.tipo, descripcion: n.descripcion });
  } catch (e) {
    throw new Error(`No se ha podido subir la foto a Drive: ${(e as Error).message}`);
  }
  const foto = fotoDesdeDrive({ ...r.foto, ancho: r.foto.ancho ?? n.ancho, alto: r.foto.alto ?? n.alto }, n.marca);
  if (!foto) throw new Error("Drive no ha devuelto una foto válida");
  return { foto, avisos: r.avisos };
}
