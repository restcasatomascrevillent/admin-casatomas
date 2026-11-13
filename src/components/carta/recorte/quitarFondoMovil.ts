/**
 * Quitar el fondo en el MÓVIL y la TABLETA: siempre en el SERVIDOR
 * (`/api/recortar-foto`, el mismo modelo que el ordenador, con tope de gasto).
 *
 * 13/11/2026, «he hecho una foto de un vino con el iPhone y me ha echado»:
 * hasta ahora el móvil probaba primero el modelo en su propio navegador y, si
 * fallaba, el servidor. En el iPhone el modelo (≈ 300 MB con él cargado, picos
 * de 800 MB) dejaba a Safari sin memoria y la página se recargaba sola en
 * mitad del formulario: se perdía la foto y lo que ya había leído la IA. El
 * servidor tarda unos 8 s y no gasta memoria del móvil, así que va siempre allí.
 * Si falla, lanza el error del servidor: el formulario enseña el motivo y deja
 * «Reintentar» o «Usar foto original» (nunca guarda sola la foto sin recortar).
 */
import { quitarFondoServidor, type ProgresoServidor } from "./quitarFondoServidor";
import { reducirFotoRecorte } from "./reducirFotoRecorte";
import type { ProgresoRecorte } from "./quitarFondoNavegador";

/** Lado mayor de la foto que se recorta en el móvil (la foto de carta sale a 900×1200 o 1200×900). */
export const LADO_RECORTE_MOVIL = 1200;

/**
 * Progreso que enseña el formulario. `etiqueta`: en el móvil, primero se lee
 * la etiqueta del vino y después se quita el fondo (uno detrás de otro).
 */
export type ProgresoMovil = ProgresoRecorte | ProgresoServidor | { fase: "etiqueta" };
type Quitar = (foto: Blob, onProgreso?: (p: ProgresoMovil) => void) => Promise<Blob>;

export interface DependenciasQuitarMovil {
  servidor?: Quitar;
}

/** Foto del móvil → sticker PNG, quitado en el servidor (foto reducida a 1200 px). Lanza el error del servidor si falla. */
export async function quitarFondoMovil(
  foto: Blob,
  onProgreso?: (p: ProgresoMovil) => void,
  deps: DependenciasQuitarMovil = {},
): Promise<{ sticker: Blob; metodo: "servidor" }> {
  const reducida = await reducirFotoRecorte(foto, LADO_RECORTE_MOVIL);
  const servidor: Quitar = deps.servidor ?? ((f, p) => quitarFondoServidor(f, { onProgreso: p }));
  const sticker = await servidor(reducida, onProgreso);
  return { sticker, metodo: "servidor" };
}
