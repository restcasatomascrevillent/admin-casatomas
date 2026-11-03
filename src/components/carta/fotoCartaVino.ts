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
 *   - Ordenador: se recorta en el formulario, antes de guardar.
 *   - Móvil y tablet: el formulario NO recorta. La ficha se guarda con la foto
 *     original y después el SERVIDOR le quita el fondo (api/recortar-foto.ts,
 *     recorte/recorteEnSegundoPlano.ts); si falla, la foto normal se queda
 *     guardada, se avisa y se crea un trabajo para un ordenador.
 * Las fotos ya subidas sin procesar se pueden homogeneizar con el script
 * local `scripts/fotos-vino/`.
 */
import { componerFotoVino, extensionFoto } from "./composicionVino";
import { quitarFondoNavegador, recorteNavegadorSeguro, type ProgresoRecorte } from "./recorte/quitarFondoNavegador";

export type { ProgresoRecorte } from "./recorte/quitarFondoNavegador";

export { esFotoCarta, nombreSubida, rutaCartaDesdeOriginal, rutaOriginalDesdeCarta } from "./rutasFotoCarta";

type ErrorRecorte = Error & { codigo?: string };

function errorRecorte(mensaje: string, codigo?: string): ErrorRecorte {
  const e = new Error(mensaje) as ErrorRecorte;
  e.codigo = codigo;
  return e;
}

export interface ResultadoFotoCarta {
  /** Foto de carta (WebP 900×1200, o JPEG en Safari). */
  foto: File;
  /** La botella recortada sin fondo (PNG con transparencia). */
  sticker: Blob;
  /** Quién quitó el fondo (solo queda el navegador). */
  metodo: "navegador";
}

/**
 * Quita el fondo en el navegador (solo en el ordenador). En móvil y tablet no
 * se hace aquí, en el formulario: lanza un error con `codigo: "movil"` sin
 * cargar nada (ahí el recorte va después de guardar, recorteEnSegundoPlano.ts).
 */
export async function quitarFondo(
  foto: Blob,
  onProgreso?: (p: ProgresoRecorte) => void,
): Promise<{ sticker: Blob; metodo: ResultadoFotoCarta["metodo"] }> {
  if (!recorteNavegadorSeguro()) throw errorRecorte("En el móvil la foto se recorta después de guardar", "movil");
  return { sticker: await quitarFondoNavegador(foto, onProgreso), metodo: "navegador" };
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

/**
 * Aviso corto cuando no se pudo aplicar el fondo de carta en el formulario
 * (ordenador): que se guarda la foto normal y qué hacer.
 */
export function avisoSinFondoCarta(e: unknown): string {
  const mensaje = (e as { message?: string } | null)?.message;
  const motivo = /botella/i.test(mensaje ?? "") ? "No se ha encontrado el producto en la foto" : "No se ha podido poner el fondo de carta";
  return `${motivo}. Se guarda la foto normal. Pulsa «Repetir recorte» o, más tarde, abre la ficha y pulsa «Quitar fondo».`;
}
