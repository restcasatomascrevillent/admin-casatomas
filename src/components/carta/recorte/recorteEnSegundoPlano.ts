/**
 * Móvil: recorte DESPUÉS de guardar la ficha con la foto original (ver
 * recorteMovil.ts). La foto nunca se pierde: si el recorte falla, la pestaña
 * muere o el dispositivo ya está marcado, la ficha se queda con la foto normal
 * y se avisa.
 */
import { toast } from "sonner";
import {
  causaFallo,
  EVENTO_FOTO_RECORTADA,
  ID_PESTANA,
  latirMarcaRecorte,
  leerMarcaRecorte,
  marcaHuerfana,
  marcarDispositivoNoRecorta,
  marcarRecorteEnCurso,
  MS_LATIDO,
  MS_MARCA_MUERTA,
  motivoFallo,
  quitarMarcaRecorte,
  type DatosRecorte,
} from "./recorteMovil";
import { ErrorFichaCambiada, recortarFotoGuardada } from "./recortarFotoGuardada";
import type { ProgresoRecorte } from "./quitarFondoNavegador";
import { mantenerPantallaEncendida, vigilarSegundoPlano } from "../video/pantallaEncendida";

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
  /** Wake Lock (por defecto, el del vídeo). Devuelve la función para soltarlo. */
  pantalla?: () => Promise<() => void>;
}

const MB = 1024 * 1024;

/** Toast de progreso en primer plano: «Descargando el recortador: 23/47 MB — no salgas del panel». */
export function textoProgresoMovil(p: ProgresoRecorte, nombre: string | null): { titulo: string; descripcion: string } {
  if (p.fase === "descargando") {
    const total = p.total ? Math.max(1, Math.round(p.total / MB)) : null;
    const recibidos = p.recibidos !== undefined ? Math.round(p.recibidos / MB) : null;
    return {
      titulo: recibidos !== null && total !== null ? `Descargando el recortador: ${recibidos}/${total} MB` : `Descargando el recortador… ${p.pct} %`,
      descripcion: "Solo la primera vez. No salgas del panel ni bloquees el móvil.",
    };
  }
  if (p.fase === "cargando") return { titulo: "Preparando el recortador…", descripcion: "No salgas del panel ni bloquees el móvil." };
  return { titulo: `Quitando el fondo${nombre ? ` a ${nombre}` : ""}…`, descripcion: "Tarda unos segundos. No salgas del panel." };
}

/**
 * Recorta en ESTE móvil la foto recién guardada y, si sale bien, deja en la
 * ficha la foto de carta. Nunca lanza. Devuelve true si la ficha quedó con fondo.
 * Mientras tanto: toast con el progreso (descarga en MB), pantalla encendida
 * (Wake Lock) y la marca de recorte en curso sabe si la página se ve.
 */
export async function recortarEnMovil(d: DatosRecorte, original: Blob | null, deps: DependenciasMovil = {}): Promise<boolean> {
  const recortar = deps.recortar ?? recortarFotoGuardada;
  marcarRecorteEnCurso(d);
  const latido = setInterval(() => latirMarcaRecorte(), MS_LATIDO);
  // Al ocultarse la página iOS congela los temporizadores: anotarlo YA.
  const alCambiar = () => latirMarcaRecorte();
  const alSalir = () => latirMarcaRecorte({ visible: false });
  const hayDoc = typeof document !== "undefined";
  if (hayDoc) document.addEventListener("visibilitychange", alCambiar);
  if (typeof window !== "undefined") window.addEventListener("pagehide", alSalir);
  const vigia = vigilarSegundoPlano();
  let soltarPantalla: () => void = () => undefined;
  try {
    soltarPantalla = await (deps.pantalla ?? mantenerPantallaEncendida)();
  } catch {
    /* sin Wake Lock: se sigue */
  }
  toast.loading(`Quitando el fondo${d.nombre ? ` a ${d.nombre}` : ""}…`, {
    id: ID_TOAST,
    description: "La foto normal ya está guardada. No salgas del panel hasta que acabe.",
    duration: Infinity,
  });
  let ultimoTexto = "";
  const onProgreso = (p: ProgresoRecorte) => {
    const { titulo, descripcion } = textoProgresoMovil(p, d.nombre);
    if (titulo === ultimoTexto) return;
    ultimoTexto = titulo;
    toast.loading(titulo, { id: ID_TOAST, description: descripcion, duration: Infinity });
  };
  try {
    await recortar(d, { original, onProgreso });
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
    const causa = causaFallo(e, { seOculto: vigia.seOculto() });
    const err = e as Error | null;
    console.warn("[recorte-movil] no se pudo recortar en este móvil", {
      causa,
      nombre: err?.name,
      mensaje: err?.message,
      seOculto: vigia.seOculto(),
      error: e,
    });
    // Solo la memoria (con la página a la vista) marca el móvil como «no recorta».
    if (causa === "memoria") marcarDispositivoNoRecorta(motivoFallo("memoria", e));
    toast.dismiss(ID_TOAST);
    await noRecortar(d, motivoFallo(causa, e));
    return false;
  } finally {
    clearInterval(latido);
    if (hayDoc) document.removeEventListener("visibilitychange", alCambiar);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", alSalir);
    vigia.parar();
    try {
      soltarPantalla();
    } catch {
      /* nada */
    }
    try {
      (deps.liberar ?? (await import("./quitarFondoNavegador")).liberarWorkerRecorte)();
    } catch {
      /* nada */
    }
  }
}

/**
 * Al abrir el panel: si quedó la marca de un recorte de otra pestaña que ya no
 * late (iOS la mató) y la página estaba A LA VISTA, este dispositivo queda
 * marcado como «no recorta en el navegador» (si estaba oculta, no: el usuario
 * salió del panel) y esa foto (guardada sin recortar) sigue el camino de las fotos
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
    const { pestana: _p, desde: _d, latido: _l, visible, ...datos } = m;
    opts.alDetectar?.(datos);
    if (visible === false) {
      // Murió estando oculta: el usuario salió del panel (iOS congela/tira la
      // página). No es falta de memoria: no se marca el móvil.
      console.warn("[recorte-movil] el panel se cerró estando oculto mientras recortaba: no se marca el móvil", m);
      void noRecortar(datos, `${motivoFallo("oculta")} Deja el panel abierto hasta que acabe la próxima vez.`);
      return;
    }
    console.warn("[recorte-movil] el panel se cerró a la vista mientras recortaba (memoria): se marca el móvil", m);
    marcarDispositivoNoRecorta("Memoria: el panel se cerró solo mientras quitaba el fondo");
    void noRecortar(datos, "El panel se cerró solo mientras le quitaba el fondo (falta de memoria); este móvil ya no lo intentará más.");
  };
  comprobar(false);
  return () => {
    if (temporizador) clearTimeout(temporizador);
  };
}
