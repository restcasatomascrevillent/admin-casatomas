/**
 * «Fondo de carta» para las fotos de vino: quitar el fondo + componer sobre el
 * fondo fijo (composicionVino.ts), y las reglas de nombres en Storage que
 * permiten saber qué foto está ya procesada y volver a la original.
 *
 * Nombres en el bucket `vinos` (sin migración):
 *   - Foto procesada desde una ya subida: `<base>-carta-<ext>.webp`, p. ej.
 *     `6d6c….webp` → `6d6c…-carta-webp.webp`. El original NO se toca, y su
 *     ruta se deduce del nombre: «Deshacer» = volver a `<base>.<ext>`.
 *   - Alta nueva ya compuesta en el panel: `<id>-carta.webp` (sin original
 *     guardado: no hay nada que deshacer).
 *   Cualquier ruta con `-carta` antes de la extensión cuenta como procesada.
 *
 * Quitar el fondo en el panel usa la Edge Function `recortar-fondo-vino`
 * (Replicate, respaldo OPCIONAL de pago). Si no está configurada o falla, el
 * llamador sigue con la foto de siempre; las fotos sin procesar se pueden
 * homogeneizar gratis con el script local `scripts/fotos-vino/`.
 */
import { supabase } from "@/integrations/supabase/client";
import { componerFotoVino, extensionFoto } from "./composicionVino";

export { esFotoCarta, nombreSubida, rutaCartaDesdeOriginal, rutaOriginalDesdeCarta } from "./rutasFotoCarta";

function aDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Llama a `recortar-fondo-vino` y devuelve el PNG sin fondo. Lanza error (con `codigo` si lo hay). */
export async function quitarFondoRemoto(foto: Blob): Promise<Blob> {
  const imagen = await aDataUrl(foto);
  const { data, error } = await supabase.functions.invoke("recortar-fondo-vino", { body: { imagen } });
  if (error || !data?.ok || typeof data?.png !== "string") {
    let codigo: string | undefined = data?.codigo;
    let mensaje: string | undefined = data?.error;
    // FunctionsHttpError: el cuerpo (con `codigo`) viene en error.context.
    const ctx = (error as { context?: Response } | null)?.context;
    if (!codigo && ctx && typeof ctx.json === "function") {
      try {
        const cuerpo = await ctx.json();
        codigo = cuerpo?.codigo;
        mensaje = cuerpo?.error ?? mensaje;
      } catch {
        /* sin cuerpo */
      }
    }
    const e = new Error(mensaje || error?.message || "No se pudo quitar el fondo") as Error & { codigo?: string };
    e.codigo = codigo;
    throw e;
  }
  const res = await fetch(data.png);
  return res.blob();
}

export interface ResultadoFotoCarta {
  /** Foto de carta (WebP 900×1200, o JPEG en Safari). */
  foto: File;
}

/**
 * Foto (JPEG/PNG/WebP con fondo) → foto de carta lista para subir, con nombre
 * `botella-carta.<ext>` (los formularios suben `<id>-carta.<ext>`).
 * Lanza error si no se pudo (sin token, timeout, imagen vacía…).
 */
export async function hacerFotoCarta(foto: Blob): Promise<ResultadoFotoCarta> {
  const png = await quitarFondoRemoto(foto);
  const compuesta = await componerFotoVino(png);
  const ext = extensionFoto(compuesta);
  return { foto: new File([compuesta], `botella-carta.${ext}`, { type: compuesta.type }) };
}

/** Mensaje corto para el aviso cuando no se pudo aplicar el fondo de carta. */
export function avisoSinFondoCarta(e: unknown): string {
  const codigo = (e as { codigo?: string } | null)?.codigo;
  if (codigo === "sin_token") return "Fondo de carta no disponible todavía: se guarda la foto normal.";
  if (codigo === "timeout") return "Quitar el fondo tardó demasiado: se guarda la foto normal.";
  return "No se pudo poner el fondo de carta: se guarda la foto normal.";
}
