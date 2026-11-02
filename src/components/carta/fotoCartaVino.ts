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
 * Quitar el fondo en el panel, por orden:
 *   1. GRATIS en el navegador (recorte/quitarFondoNavegador.ts: isnet en un
 *      Web Worker con onnxruntime-web; el modelo se baja una vez y se cachea).
 *   2. Si falla: Edge Function `recortar-fondo-vino` (Replicate, de pago,
 *      opcional; sin token → 503 `sin_token`; cada fallo trae un `codigo`
 *      que avisoSinFondoCarta convierte en un aviso claro).
 *   3. Si también falla: el llamador sigue con la foto encuadrada de siempre
 *      (recorteFoto.ts) y avisa.
 * Las fotos ya subidas sin procesar se pueden homogeneizar con el script
 * local `scripts/fotos-vino/`.
 */
import { supabase } from "@/integrations/supabase/client";
import { componerFotoVino, extensionFoto } from "./composicionVino";
import { quitarFondoNavegador, recorteNavegadorSeguro, type ProgresoRecorte } from "./recorte/quitarFondoNavegador";

export type { ProgresoRecorte } from "./recorte/quitarFondoNavegador";

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
  /** La botella recortada sin fondo (PNG con transparencia). */
  sticker: Blob;
  /** Quién quitó el fondo. */
  metodo: "navegador" | "replicate";
}

/**
 * Quita el fondo: navegador gratis → Replicate. Lanza el error del último intento.
 * En móvil y tablet NO se intenta en el navegador (el modelo tumbaba la pestaña
 * por memoria y la página se recargaba con la foto a medias, ver
 * quitarFondoNavegador.ts): va directo a Replicate.
 */
export async function quitarFondo(
  foto: Blob,
  onProgreso?: (p: ProgresoRecorte) => void,
): Promise<{ sticker: Blob; metodo: ResultadoFotoCarta["metodo"] }> {
  if (recorteNavegadorSeguro()) {
    try {
      return { sticker: await quitarFondoNavegador(foto, onProgreso), metodo: "navegador" };
    } catch (e) {
      console.warn("[recorte-navegador] falló, se prueba Replicate", e);
    }
  } else {
    console.info("[recorte] móvil o poca memoria: se recorta con Replicate, no en el navegador");
  }
  onProgreso?.({ fase: "recortando" });
  return { sticker: await quitarFondoRemoto(foto), metodo: "replicate" };
}

/**
 * Foto (JPEG/PNG/WebP con fondo) → sticker + foto de carta lista para subir,
 * con nombre `botella-carta.<ext>` (los formularios suben `<id>-carta.<ext>`).
 * Lanza error si no se pudo por ninguna vía.
 */
export async function hacerFotoCarta(foto: Blob, onProgreso?: (p: ProgresoRecorte) => void): Promise<ResultadoFotoCarta> {
  const { sticker, metodo } = await quitarFondo(foto, onProgreso);
  const compuesta = await componerFotoVino(sticker);
  const ext = extensionFoto(compuesta);
  return { foto: new File([compuesta], `botella-carta.${ext}`, { type: compuesta.type }), sticker, metodo };
}

/** Por qué falló `recortar-fondo-vino`, según el `codigo` que devuelve. */
const MOTIVO_SIN_FONDO: Record<string, string> = {
  sin_token: "Quitar el fondo con Replicate no está activado (falta su clave en Supabase)",
  token_invalido: "La clave de Replicate no es válida",
  sin_saldo: "La cuenta de Replicate no tiene saldo",
  timeout: "Quitar el fondo tardó demasiado",
  demasiado_grande: "La foto es demasiado grande para quitarle el fondo",
  imagen_invalida: "El formato de la foto no sirve para quitarle el fondo",
  fallo_replicate: "Replicate no pudo quitar el fondo de esta foto",
};

/** Mensaje corto para el aviso cuando no se pudo aplicar el fondo de carta. */
export function avisoSinFondoCarta(e: unknown): string {
  const codigo = (e as { codigo?: string } | null)?.codigo;
  const motivo = codigo ? MOTIVO_SIN_FONDO[codigo] : undefined;
  if (motivo) return `${motivo}: se guarda la foto normal.`;
  return "No se pudo poner el fondo de carta: se guarda la foto normal.";
}
