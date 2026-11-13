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
 * Quitar el fondo en el panel, siempre en el formulario y antes de guardar:
 *   - Ordenador: GRATIS en el navegador (recorte/quitarFondoNavegador.ts:
 *     isnet en un Web Worker con onnxruntime-web, WebGPU si hay; el modelo se
 *     baja una vez y se cachea). Si el navegador no puede, el SERVIDOR.
 *   - Móvil y tablet: siempre el SERVIDOR (api/recortar-foto.ts, mismo
 *     modelo; recorte/quitarFondoMovil.ts). El modelo en el iPhone dejaba a
 *     Safari sin memoria y recargaba la página (13/11/2026).
 *   - Si todo falla, el formulario lo dice y deja «Reintentar» o «Usar foto
 *     original»: nunca se guarda sola una foto sin recortar.
 * Sin servicios de pago: el recorte por Replicate se quitó el 02-11-2026.
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
  /** Quién quitó el fondo: el navegador (ordenador) o el servidor (móvil y tableta, o si el navegador del ordenador no puede). */
  metodo: "navegador" | "servidor";
}

/** El modelo no encontró nada que recortar: el servidor usa el mismo, no merece la pena probar allí. */
const RE_SIN_PRODUCTO = /botella|producto/i;

/**
 * Quita el fondo. En el ordenador, en su navegador con la foto tal cual y, si
 * no puede, en el servidor; en el móvil y la tableta, siempre en el servidor
 * (quitarFondoMovil, con la foto reducida).
 */
export async function quitarFondo(
  foto: Blob,
  onProgreso?: (p: ProgresoMovil) => void,
): Promise<{ sticker: Blob; metodo: ResultadoFotoCarta["metodo"] }> {
  const { quitarFondoMovil } = await import("./recorte/quitarFondoMovil");
  if (!recorteNavegadorSeguro()) return quitarFondoMovil(foto, onProgreso);
  try {
    return { sticker: await quitarFondoNavegador(foto, onProgreso), metodo: "navegador" };
  } catch (e) {
    const mensaje = (e as { message?: string } | null)?.message ?? "";
    if (RE_SIN_PRODUCTO.test(mensaje)) throw e;
    console.warn("[recorte] el navegador no ha podido; se prueba en el servidor", e);
    return quitarFondoMovil(foto, onProgreso);
  }
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
 * Aviso corto cuando no se pudo quitar el fondo en el formulario: el motivo y
 * qué hacer (13/11/2026: ya no se guarda sola la foto normal).
 */
export function avisoSinFondoCarta(e: unknown): string {
  const err = e as { message?: string; causa?: string } | null;
  const motivo = err?.causa
    ? motivoFallo(e)
    : RE_SIN_PRODUCTO.test(err?.message ?? "")
      ? "No se ha encontrado el producto en la foto."
      : "No se ha podido poner el fondo de carta.";
  return `${motivo} Pulsa «Reintentar» o, si prefieres guardarla tal cual, «Usar foto original».`;
}
