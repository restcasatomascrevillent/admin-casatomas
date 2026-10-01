// ---------------------------------------------------------------------------
// Foto de un plato «A mano» del menú del día.
//
// Los platos elegidos «De la carta» traen la foto de la carta (se copia su
// `imagen_url` al item). Los escritos a mano no tenían forma de llevar foto:
// esto sube una y devuelve su URL pública, que se guarda en `item.imagenUrl`
// igual que la de un plato de la carta. La web (casa-tomas-story,
// `CartaDelDia`) pinta `imagenUrl` sin mirar el origen del item.
//
// DÓNDE SE GUARDA
// Bucket `novedades` (el del Gestor Web), carpeta `menu-dia/`. No en `platos`:
// la galería de marketing (`SelectorImagenGaleria`) lista la raíz de `platos`
// y una carpeta ahí le aparecería como una «imagen» rota. Las políticas de
// Storage de `novedades` (migración 20260118100357) ya permiten subir a
// cualquier usuario autenticado y leer a todo el mundo: no hace falta otra.
//
// NUNCA SE BORRA DE STORAGE al quitar la foto o el plato: el menú se guarda en
// tres filas (es/en/fr) que comparten la URL, y quitar la foto en el editor no
// es definitivo hasta guardar (se puede cancelar la edición). Un fichero
// huérfano cuesta unos KB; una foto borrada que seguía publicada, un hueco roto.
// ---------------------------------------------------------------------------

import { supabase } from "@/integrations/supabase/client";

export const BUCKET_FOTOS_MENU = "novedades";
export const CARPETA_FOTOS_MENU = "menu-dia";
/** El mismo tope que las fotos de novedades. */
export const MAX_FOTO_MENU_MB = 5;

/**
 * Formatos que pinta cualquier navegador. HEIC (iPhone) se queda fuera a
 * propósito: Chrome no lo muestra y la foto saldría rota en la web. Al elegir
 * con `accept` restringido, iOS ya convierte a JPEG por su cuenta.
 */
const EXTENSION_POR_TIPO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Valor para el `accept` del `<input type="file">`. */
export const ACCEPT_FOTO_MENU = Object.keys(EXTENSION_POR_TIPO).join(",");

/** Mensaje de error en español si el fichero no vale, o `null` si vale. */
export function validarFotoMenu(file: File): string | null {
  if (!EXTENSION_POR_TIPO[file.type]) {
    return "El archivo tiene que ser una foto JPG, PNG o WebP.";
  }
  if (file.size > MAX_FOTO_MENU_MB * 1024 * 1024) {
    return `La foto pesa demasiado (máximo ${MAX_FOTO_MENU_MB} MB).`;
  }
  return null;
}

/**
 * Ruta única dentro del bucket. La extensión sale del tipo MIME, no del nombre
 * del fichero (que puede no tenerla o venir en mayúsculas). Ser única evita
 * pisar la foto de otro menú y que la caché del CDN sirva la anterior.
 */
export function rutaFotoMenu(file: File, ahora: number = Date.now(), aleatorio: number = Math.random()): string {
  const extension = EXTENSION_POR_TIPO[file.type] ?? "jpg";
  const sufijo = aleatorio.toString(36).slice(2, 10) || "0";
  return `${CARPETA_FOTOS_MENU}/${ahora}-${sufijo}.${extension}`;
}

/** Sube la foto y devuelve su URL pública. Lanza si Storage falla. */
export async function subirFotoMenu(file: File): Promise<string> {
  const ruta = rutaFotoMenu(file);
  const { error } = await supabase.storage.from(BUCKET_FOTOS_MENU).upload(ruta, file, {
    contentType: file.type,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET_FOTOS_MENU).getPublicUrl(ruta);
  return data.publicUrl;
}
