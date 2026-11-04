/**
 * Lo que pasa FUERA del formulario con el recorte del móvil (ver recorteMovil.ts):
 *   - noRecortar: la foto se guardó sin fondo de carta (el móvil y el servidor
 *     fallaron): trabajo para un ordenador (GestorRecortes engancha
 *     mandarRecorteAOrdenador) o, si no se puede, aviso;
 *   - recuperarRecorteInterrumpido: al abrir el panel, si una pestaña murió
 *     recortando en el formulario (marca sin latido) con la página a la vista,
 *     fue la memoria: este móvil queda marcado y va directo al servidor.
 */
import { toast } from "sonner";
import { ID_PESTANA, leerMarcaRecorte, marcaHuerfana, marcarMovilSinLocal, MS_MARCA_MUERTA, quitarMarcaRecorte, type DatosRecorte, type MarcaRecorte } from "./recorteMovil";

const ID_TOAST = "recorte-movil";
export const MS_AVISO_SIN_RECORTE = 12_000;

/**
 * Qué hacer con una foto guardada a la que no se ha podido poner el fondo.
 * Por defecto: avisar de que se queda la foto normal. GestorRecortes lo
 * sustituye por mandarRecorteAOrdenador (trabajo para un ordenador).
 */
export type AlNoRecortar = (d: DatosRecorte, motivo: string) => Promise<void>;

let alNoRecortar: AlNoRecortar = async (d, motivo) => avisarSinRecorte(d, motivo);

export function configurarAlNoRecortar(fn: AlNoRecortar | null): void {
  alNoRecortar = fn ?? (async (d, motivo) => avisarSinRecorte(d, motivo));
}

export function avisarSinRecorte(d: Pick<DatosRecorte, "nombre">, motivo: string, siguiente = "Abre la ficha desde un ordenador y pulsa «Quitar fondo»."): void {
  try {
    toast.warning(`Guardado con la foto normal${d.nombre ? `: ${d.nombre}` : ""}`, {
      id: ID_TOAST,
      description: `${motivo} ${siguiente}`,
      duration: MS_AVISO_SIN_RECORTE,
    });
  } catch (e) {
    console.warn("[recorte] no se pudo enseñar el aviso", e);
  }
}

/** La foto se queda sin fondo de carta: trabajo para un ordenador (o aviso). Nunca lanza. */
export function noRecortar(d: DatosRecorte, motivo: string): Promise<void> {
  return alNoRecortar(d, motivo).catch((e) => {
    console.warn("[recorte] fallo al gestionar la foto sin recortar", e);
    avisarSinRecorte(d, motivo);
  });
}

/**
 * Al abrir el panel: si quedó la marca de un recorte en el formulario de otra
 * pestaña que ya no late y la página estaba A LA VISTA, el sistema la cerró
 * por memoria: este móvil queda marcado y las siguientes fotos van directas al
 * servidor (si estaba oculta, el usuario salió: no se marca). Si la marca aún
 * es reciente se vuelve a mirar pasado MS_MARCA_MUERTA (puede ser otra
 * pestaña viva). Devuelve la función para cancelar esa espera.
 */
export function recuperarRecorteInterrumpido(opts: { ahora?: () => number; alDetectar?: (m: MarcaRecorte) => void } = {}): () => void {
  const ahora = opts.ahora ?? Date.now;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const comprobar = (reintento: boolean) => {
    const m = leerMarcaRecorte();
    if (!m || m.pestana === ID_PESTANA) return;
    if (!marcaHuerfana(m, ahora())) {
      if (!reintento) temporizador = setTimeout(() => comprobar(true), MS_MARCA_MUERTA + 1000);
      return;
    }
    quitarMarcaRecorte();
    opts.alDetectar?.(m);
    const memoria = m.visible !== false;
    if (!memoria) return;
    console.warn("[recorte-movil] el panel se cerró a la vista mientras recortaba (memoria): las fotos irán al servidor", m);
    marcarMovilSinLocal("El panel se cerró solo mientras quitaba el fondo (memoria)");
    try {
      toast.info("La última foto cerró el panel al quitarle el fondo", {
        id: ID_TOAST,
        description: "A partir de ahora este móvil quitará el fondo en el servidor.",
        duration: MS_AVISO_SIN_RECORTE,
      });
    } catch {
      /* nada */
    }
  };
  comprobar(false);
  return () => {
    if (temporizador) clearTimeout(temporizador);
  };
}
