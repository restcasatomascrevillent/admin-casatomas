/**
 * De dónde sale el ORIGINAL de una foto de la carta (decisión del dueño,
 * 08/11/2026: «En Supabase no quiero guardar más que el sticker»).
 *
 *   1. Google Drive (instagram-drive · descargar_original): platos y vinos.
 *   2. Respaldo de transición: el original antiguo en el bucket
 *      (`<id>.<ext>`, deducido del nombre de la foto `-carta-`), hasta que
 *      scripts/carta/mover-originales-a-drive.mjs lo pase a Drive.
 *   3. Si no hay ninguno, null: quien llama usa la foto de la web (el
 *      sticker) y lo avisa.
 *
 * Los ficheros que vienen de Drive quedan marcados (esOriginalDeDrive) para
 * no volver a subirlos a Drive al guardar (cada vuelta recomprimiría el JPEG).
 */
import { rutaOriginalDesdeCarta } from "./rutasFotoCarta";
import { esTablaOriginal, type TablaOriginal } from "./originalCarta";
import { MAX_FOTO_BYTES } from "@/lib/validarFoto";

export const AVISO_SIN_ORIGINAL_FOTO = "No hay original guardado: se usa la foto de la web";

const deDrive = new WeakSet<Blob>();

/** true si el fichero es (o sale de) un original descargado de Drive. */
export function esOriginalDeDrive(f: Blob | null | undefined): boolean {
  return !!f && deDrive.has(f);
}

/** Marca un fichero como original de Drive (también su versión reducida). */
export function marcarOriginalDeDrive<T extends Blob>(f: T): T {
  deDrive.add(f);
  return f;
}

export interface OriginalFoto {
  archivo: File;
  origen: "drive" | "bucket";
}

export interface DependenciasOriginalFoto {
  descargarDrive?: (n: { tabla: TablaOriginal; id: string }) => Promise<Blob | null>;
  fetch?: typeof fetch;
  /** Reduce un original de Drive que no cabe en los 5 MB de la carta. */
  reducir?: (b: Blob) => Promise<Blob>;
}

async function descargarUrl(url: string, f: typeof fetch): Promise<File | null> {
  try {
    const r = await f(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    if (!blob.type.startsWith("image/")) return null;
    const nombre = decodeURIComponent(url.split("?")[0].split("/").pop() || "foto.jpg");
    return new File([blob], nombre, { type: blob.type });
  } catch {
    return null;
  }
}

/**
 * Original de la foto de una ficha (ver la cabecera). `errorDrive`: por qué
 * no se pudo pedir a Drive (sin red, función sin desplegar…), para avisarlo.
 */
export async function obtenerOriginalFoto(
  tabla: string,
  id: string | null | undefined,
  url: string | null | undefined,
  deps: DependenciasOriginalFoto = {},
): Promise<{ original: OriginalFoto | null; errorDrive: string | null }> {
  let errorDrive: string | null = null;
  if (id && esTablaOriginal(tabla)) {
    try {
      const descargar = deps.descargarDrive ?? (async (n) => (await import("@/components/marketing/instagram/api")).descargarOriginalCarta(n));
      const blob = await descargar({ tabla, id });
      if (blob) {
        let datos: Blob = blob;
        if (datos.size > MAX_FOTO_BYTES) {
          const reducir = deps.reducir ?? (async (b: Blob) => (await (await import("./redimensionarFoto")).redimensionarFoto(b)).blob);
          datos = await reducir(datos);
        }
        const archivo = marcarOriginalDeDrive(new File([datos], `${id}.jpg`, { type: datos.type || "image/jpeg" }));
        return { original: { archivo, origen: "drive" }, errorDrive: null };
      }
    } catch (e) {
      errorDrive = (e as Error)?.message || "Error desconocido";
      console.warn("[carta] original de Drive", e);
    }
  }
  const legado = rutaOriginalDesdeCarta(url);
  if (legado) {
    const archivo = await descargarUrl(legado, deps.fetch ?? fetch);
    if (archivo) return { original: { archivo, origen: "bucket" }, errorDrive };
  }
  return { original: null, errorDrive };
}

/** La foto de la web (el sticker) como File, de respaldo. */
export function descargarFotoWeb(url: string, f: typeof fetch = fetch): Promise<File | null> {
  return descargarUrl(url, f);
}
