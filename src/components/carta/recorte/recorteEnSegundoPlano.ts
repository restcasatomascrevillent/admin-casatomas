/**
 * Móvil: recorte DESPUÉS de guardar la ficha con la foto original (ver
 * recorteMovil.ts). La foto nunca se pierde: si el recorte falla, la pestaña
 * muere o el dispositivo ya está marcado, la ficha se queda con la foto normal
 * y se avisa.
 */
import { toast } from "sonner";
import {
  EVENTO_FOTO_RECORTADA,
  esFaltaDeMemoria,
  ID_PESTANA,
  latirMarcaRecorte,
  leerMarcaRecorte,
  marcaHuerfana,
  marcarDispositivoNoRecorta,
  marcarRecorteEnCurso,
  MS_LATIDO,
  MS_MARCA_MUERTA,
  quitarMarcaRecorte,
  type DatosRecorte,
} from "./recorteMovil";
import { ErrorFichaCambiada, recortarFotoGuardada } from "./recortarFotoGuardada";

export { EVENTO_FOTO_RECORTADA } from "./recorteMovil";

const ID_TOAST = "recorte-movil";
export const MS_AVISO_SIN_RECORTE = 12_000;

/**
 * Qué hacer con una foto guardada que este móvil no ha podido recortar.
 * Por defecto: avisar de que se queda la foto normal y cómo recortarla desde
 * un ordenador. Se puede sustituir (p. ej. para crear un trabajo para un
 * ordenador con el panel abierto).
 */
export type AlNoRecortar = (d: DatosRecorte, motivo: string) => Promise<void>;

let alNoRecortar: AlNoRecortar = async (d, motivo) => avisarSinRecorte(d, motivo);

export function configurarAlNoRecortar(fn: AlNoRecortar | null): void {
  alNoRecortar = fn ?? (async (d, motivo) => avisarSinRecorte(d, motivo));
}

export function avisarSinRecorte(d: Pick<DatosRecorte, "nombre">, motivo: string): void {
  try {
    toast.warning(`Guardado con la foto normal${d.nombre ? `: ${d.nombre}` : ""}`, {
      id: ID_TOAST,
      description: `${motivo} Se recortará desde un ordenador: abre la ficha y pulsa «Quitar fondo».`,
      duration: MS_AVISO_SIN_RECORTE,
    });
  } catch (e) {
    console.warn("[recorte] no se pudo enseñar el aviso", e);
  }
}

export function noRecortar(d: DatosRecorte, motivo: string): Promise<void> {
  return alNoRecortar(d, motivo).catch((e) => {
    console.warn("[recorte] fallo al gestionar la foto sin recortar", e);
    avisarSinRecorte(d, motivo);
  });
}

function emitirFotoRecortada(d: DatosRecorte): void {
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_FOTO_RECORTADA, { detail: { tabla: d.tabla, id: d.registroId } }));
  } catch {
    /* sin window */
  }
}

export interface DependenciasMovil {
  recortar?: typeof recortarFotoGuardada;
  liberar?: () => void;
}

/**
 * Recorta en ESTE móvil la foto recién guardada y, si sale bien, deja en la
 * ficha la foto de carta. Nunca lanza. Devuelve true si la ficha quedó con fondo.
 */
export async function recortarEnMovil(d: DatosRecorte, original: Blob | null, deps: DependenciasMovil = {}): Promise<boolean> {
  const recortar = deps.recortar ?? recortarFotoGuardada;
  marcarRecorteEnCurso(d);
  const latido = setInterval(() => latirMarcaRecorte(), MS_LATIDO);
  toast.loading(`Poniendo el fondo de carta${d.nombre ? ` a ${d.nombre}` : ""}…`, {
    id: ID_TOAST,
    description: "La foto normal ya está guardada. Deja el panel abierto un momento.",
    duration: Infinity,
  });
  try {
    await recortar(d, { original });
    quitarMarcaRecorte();
    toast.success(`Foto con fondo de carta guardada${d.nombre ? `: ${d.nombre}` : ""}`, { id: ID_TOAST, description: undefined, duration: 5000 });
    emitirFotoRecortada(d);
    return true;
  } catch (e) {
    quitarMarcaRecorte();
    if (e instanceof ErrorFichaCambiada) {
      toast.dismiss(ID_TOAST);
      return false;
    }
    console.warn("[recorte-movil] no se pudo recortar en este móvil", e);
    if (esFaltaDeMemoria(e)) marcarDispositivoNoRecorta(`Sin memoria: ${(e as Error)?.message ?? e}`);
    toast.dismiss(ID_TOAST);
    await noRecortar(d, "Este móvil no ha podido quitarle el fondo.");
    return false;
  } finally {
    clearInterval(latido);
    try {
      (deps.liberar ?? (await import("./quitarFondoNavegador")).liberarWorkerRecorte)();
    } catch {
      /* nada */
    }
  }
}

/**
 * Al abrir el panel: si quedó la marca de un recorte de otra pestaña que ya no
 * late (iOS la mató), este dispositivo queda marcado como «no recorta en el
 * navegador» y esa foto (guardada sin recortar) sigue el camino de las fotos
 * que no se pudieron recortar. Si la marca aún es reciente se vuelve a mirar
 * pasado MS_MARCA_MUERTA (puede ser otra pestaña viva). Devuelve la función
 * para cancelar esa espera.
 */
export function recuperarRecorteInterrumpido(opts: { ahora?: () => number; alDetectar?: (d: DatosRecorte) => void } = {}): () => void {
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
    marcarDispositivoNoRecorta("El panel se cerró mientras recortaba una foto");
    const { pestana: _p, desde: _d, latido: _l, ...datos } = m;
    opts.alDetectar?.(datos);
    void noRecortar(datos, "El panel se cerró mientras le quitaba el fondo; este móvil ya no lo intentará más.");
  };
  comprobar(false);
  return () => {
    if (temporizador) clearTimeout(temporizador);
  };
}
