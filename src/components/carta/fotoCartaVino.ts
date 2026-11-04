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
 * Quitar el fondo en el panel: GRATIS en el navegador (recorte/
 * quitarFondoNavegador.ts: isnet en un Web Worker con onnxruntime-web, WebGPU
 * si hay; el modelo se baja una vez y se cachea). Sin servicios de pago: el
 * recorte por Replicate se quitó el 02-11-2026 (decisión del dueño).
 *
 *   - Ordenador y móvil: se recorta en el formulario, antes de guardar.
 *   - Móvil y tablet: si el modelo no puede en el navegador, lo hace el
 *     SERVIDOR (api/recortar-foto.ts, recorte/quitarFondoMovil.ts); si también
 *     falla, se guarda la foto normal, se avisa y va a un ordenador.
 * Las fotos ya subidas sin procesar se pueden homogeneizar con el script
 * local `scripts/fotos-vino/`.
 */
import { componerFotoVino, extensionFoto } from "./composicionVino";
import { quitarFondoNavegador, recorteNavegadorSeguro } from "./recorte/quitarFondoNavegador";
import type { ProgresoMovil } from "./recorte/quitarFondoMovil";
import { motivoFallo } from "./recorte/recorteMovil";

export type { ProgresoRecorte } from "./recorte/quitarFondoNavegador";

export { esFotoCarta, nombreSubida, rutaCartaDesdeOriginal, rutaOriginalDesdeCarta } from "./rutasFotoCarta";

export interface ResultadoFotoCarta {
  /** Foto de carta (WebP 900×1200, o JPEG en Safari). */
  foto: File;
  /** La botella recortada sin fondo (PNG con transparencia). */
  sticker: Blob;
  /** Quién quitó el fondo: el navegador (ordenador o móvil) o, de respaldo en el móvil, el servidor. */
  metodo: "navegador" | "servidor";
}

/**
 * Quita el fondo en el navegador. En el ordenador, con la foto tal cual; en el
 * móvil (quitarFondoMovil), reducida y, si el modelo no puede, en el servidor.
 */
export async function quitarFondo(
  foto: Blob,
  onProgreso?: (p: ProgresoMovil) => void,
): Promise<{ sticker: Blob; metodo: ResultadoFotoCarta["metodo"] }> {
  if (recorteNavegadorSeguro()) return { sticker: await quitarFondoNavegador(foto, onProgreso), metodo: "navegador" };
  const { quitarFondoMovil } = await import("./recorte/quitarFondoMovil");
  return quitarFondoMovil(foto, onProgreso);
}

/**
 * Foto (JPEG/PNG/WebP con fondo) → sticker + foto de carta lista para subir,
 * con nombre `botella-carta.<ext>` (los formularios suben `<id>-carta.<ext>`).
 * Lanza error si no se pudo por ninguna vía.
 */
export async function hacerFotoCarta(foto: Blob, onProgreso?: (p: ProgresoMovil) => void): Promise<ResultadoFotoCarta> {
  const { sticker, metodo } = await quitarFondo(foto, onProgreso);
  const compuesta = await componerFotoVino(sticker);
  const ext = extensionFoto(compuesta);
  return { foto: new File([compuesta], `botella-carta.${ext}`, { type: compuesta.type }), sticker, metodo };
}

/**
 * Aviso corto cuando no se pudo aplicar el fondo de carta en el formulario
 * (ordenador): que se guarda la foto normal y qué hacer.
 */
export function avisoSinFondoCarta(e: unknown): string {
  const err = e as { message?: string; causa?: string } | null;
  const motivo = err?.causa
    ? motivoFallo(e)
    : /botella|producto/i.test(err?.message ?? "")
      ? "No se ha encontrado el producto en la foto."
      : "No se ha podido poner el fondo de carta.";
  return `${motivo} Se guarda la foto normal. Pulsa «Repetir recorte» o, más tarde, abre la ficha y pulsa «Quitar fondo».`;
}
