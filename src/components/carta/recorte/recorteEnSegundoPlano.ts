/**
 * Móvil: el fondo se pone DESPUÉS de guardar la ficha con la foto original
 * (ver recorteMovil.ts):
 *   1. EN EL MÓVIL, con el mismo modelo del ordenador (quitarFondoNavegador:
 *      descarga ligera del modelo, WebGPU si hay, worker liberado al acabar);
 *   2. si falla → el SERVIDOR (quitarFondoServidor: mismo modelo, tope de gasto);
 *   3. si el servidor falla, no responde o hay tope → trabajo para un ordenador.
 * Un móvil que se queda sin memoria recortando queda marcado y las siguientes
 * fotos van directas al servidor. La foto nunca se pierde.
 *
 * Siempre se ve algo (petición del dueño, 03-11-2026: en el iPhone «no pasaba
 * nada»): el toast de progreso sale ANTES de cualquier espera, y cualquier
 * fallo acaba en un aviso.
 */
import { toast } from "sonner";
import {
  datosDeMarca,
  esFaltaDeMemoria,
  EVENTO_FOTO_RECORTADA,
  faseMarcaRecorte,
  ID_PESTANA,
  latirMarcasRecorte,
  leerMarcasRecorte,
  marcaHuerfana,
  marcarMovilSinLocal,
  marcarRecorteEnCurso,
  movilSinLocal,
  mensajeCorto,
  MS_LATIDO,
  MS_MARCA_MUERTA,
  motivoFallo,
  quitarMarcaRecorte,
  vaAOrdenador,
  type DatosRecorte,
} from "./recorteMovil";
import { ErrorFichaCambiada, recortarFotoGuardada } from "./recortarFotoGuardada";
import { quitarFondoServidor, type ProgresoServidor } from "./quitarFondoServidor";
import type { ProgresoRecorte } from "./quitarFondoNavegador";
import { mantenerPantallaEncendida } from "../video/pantallaEncendida";
import { diag, memoriaDiag } from "./diagnostico";

export { EVENTO_FOTO_RECORTADA } from "./recorteMovil";

const ID_TOAST = "recorte-movil";
export const MS_AVISO_SIN_RECORTE = 12_000;
/** Como mucho se espera esto al Wake Lock antes de seguir (en iOS la petición puede no volver nunca). */
const MS_ESPERA_PANTALLA = 1_000;
const MB = 1024 * 1024;

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

function emitirFotoRecortada(d: DatosRecorte): void {
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_FOTO_RECORTADA, { detail: { tabla: d.tabla, id: d.registroId } }));
  } catch {
    /* sin window */
  }
}

type Progreso = ProgresoServidor | ProgresoRecorte;
type Quitar = (foto: Blob, onProgreso?: (p: Progreso) => void) => Promise<Blob>;

export interface DependenciasMovil {
  recortar?: typeof recortarFotoGuardada;
  /** Quitar el fondo en el propio móvil (por defecto, el modelo en el navegador). */
  local?: Quitar;
  /** Quitar el fondo en el servidor (por defecto, /api/recortar-foto). */
  servidor?: Quitar;
  /** Soltar el worker y la memoria del modelo local al acabar. */
  liberar?: () => void;
  /** Wake Lock (por defecto, el del vídeo). Devuelve la función para soltarlo. */
  pantalla?: () => Promise<() => void>;
  /** Saltarse el intento local (p. ej. al retomar una foto de un panel que se cerró). */
  soloServidor?: boolean;
}

/** Texto del toast según la fase (también la cola cuando hay varias fotos). */
export function textoProgresoMovil(p: Progreso | { fase: "cola"; delante: number } | null, nombre: string | null): { titulo: string; descripcion: string } {
  const titulo = `Poniendo el fondo de carta${nombre ? ` a ${nombre}` : ""}…`;
  switch (p?.fase) {
    case "cola":
      return { titulo, descripcion: `En cola: ${p.delante === 1 ? "hay 1 foto" : `hay ${p.delante} fotos`} antes. La foto normal ya está guardada.` };
    case "descargando": {
      const total = p.total ? Math.max(1, Math.round(p.total / MB)) : null;
      const recibidos = p.recibidos !== undefined ? Math.round(p.recibidos / MB) : null;
      return {
        titulo,
        descripcion:
          recibidos !== null && total !== null
            ? `Descargando el recortador: ${recibidos}/${total} MB (solo la primera vez). No salgas del panel.`
            : `Descargando el recortador… ${p.pct} % (solo la primera vez). No salgas del panel.`,
      };
    }
    case "cargando":
      return { titulo, descripcion: "Preparando el recortador en este móvil… No salgas del panel." };
    case "recortando":
      return { titulo, descripcion: "Quitando el fondo en este móvil… No salgas del panel." };
    case "subiendo":
      return { titulo, descripcion: "Subiendo la foto al servidor… No salgas del panel." };
    case "servidor":
      return { titulo, descripcion: "Quitando el fondo en el servidor… No salgas del panel." };
    case "componiendo":
      return { titulo, descripcion: "Componiendo con el fondo elegido…" };
    default:
      return { titulo, descripcion: "La foto normal ya está guardada. No salgas del panel hasta que acabe." };
  }
}

/** Wake Lock sin bloquear: si no contesta pronto se sigue sin él (y se suelta cuando llegue). */
async function pantallaSinBloquear(pedir: () => Promise<() => void>): Promise<() => void> {
  let soltar: (() => void) | null = null;
  let tarde = false;
  const peticion = pedir()
    .then((s) => {
      if (tarde) s();
      else soltar = s;
    })
    .catch(() => undefined);
  await Promise.race([peticion, new Promise((r) => setTimeout(r, MS_ESPERA_PANTALLA))]);
  return () => {
    tarde = true;
    try {
      soltar?.();
    } catch {
      /* nada */
    }
  };
}

async function localPorDefecto(foto: Blob, onProgreso?: (p: Progreso) => void): Promise<Blob> {
  const { quitarFondoNavegador, recorteNavegadorDisponible } = await import("./quitarFondoNavegador");
  if (!recorteNavegadorDisponible()) throw new Error("Este navegador no puede recortar (sin Worker o WebAssembly)");
  return quitarFondoNavegador(foto, onProgreso);
}

async function liberarPorDefecto(): Promise<void> {
  try {
    (await import("./quitarFondoNavegador")).liberarWorkerRecorte();
  } catch {
    /* nada */
  }
}

async function medidaLocal(): Promise<unknown> {
  try {
    return (await import("./quitarFondoNavegador")).ultimaMedida;
  } catch {
    return null;
  }
}

// Las fotos se procesan de una en una (memoria en el móvil; una función a la vez en el servidor).
let cola: Promise<unknown> = Promise.resolve();
let enEspera = 0;
let latido: ReturnType<typeof setInterval> | null = null;
const alOcultar = () => latirMarcasRecorte();
const alSalir = () => latirMarcasRecorte({ visible: false });

function empezarLatido(): void {
  if (latido) return;
  latido = setInterval(() => latirMarcasRecorte(), MS_LATIDO);
  // Al ocultarse la página iOS congela los temporizadores: anotarlo YA.
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", alOcultar);
  if (typeof window !== "undefined") window.addEventListener("pagehide", alSalir);
}
function pararLatidoSiNoQueda(): void {
  if (enEspera === 0 && latido) {
    clearInterval(latido);
    latido = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", alOcultar);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", alSalir);
  }
}

/**
 * Pone el fondo de carta a la foto recién guardada (en el móvil y, si no
 * puede, en el servidor) y la deja en la ficha. Nunca lanza. Devuelve true si
 * la ficha quedó con fondo. El toast sale al momento, antes de cualquier espera.
 */
export function recortarEnMovil(d: DatosRecorte, original: Blob | null, deps: DependenciasMovil = {}): Promise<boolean> {
  const delante = enEspera;
  enEspera++;
  diag("recorte tras guardar: en marcha", { tabla: d.tabla, id: d.registroId, ruta: d.rutaOriginal, tema: d.tema, original, delante, ...memoriaDiag() });
  try {
    const t = textoProgresoMovil(delante ? { fase: "cola", delante } : null, d.nombre);
    toast.loading(t.titulo, { id: delante ? `${ID_TOAST}-${d.registroId}` : ID_TOAST, description: t.descripcion, duration: Infinity });
  } catch {
    /* sin toaster: se sigue */
  }
  marcarRecorteEnCurso(d);
  empezarLatido();
  const r = cola.then(
    () => procesar(d, original, deps, delante > 0),
    () => procesar(d, original, deps, delante > 0),
  );
  cola = r.catch(() => undefined);
  return r.finally(() => {
    enEspera--;
    pararLatidoSiNoQueda();
  });
}

async function procesar(d: DatosRecorte, original: Blob | null, deps: DependenciasMovil, vieneDeCola: boolean): Promise<boolean> {
  if (vieneDeCola) toast.dismiss(`${ID_TOAST}-${d.registroId}`);
  const recortar = deps.recortar ?? recortarFotoGuardada;
  const local = deps.local ?? localPorDefecto;
  const servidor = deps.servidor ?? ((foto: Blob, p?: (x: Progreso) => void) => quitarFondoServidor(foto, { onProgreso: p }));
  let ultimo = "";
  const onProgreso = (p: Progreso | null) => {
    const { titulo, descripcion } = textoProgresoMovil(p, d.nombre);
    if (descripcion === ultimo) return;
    ultimo = descripcion;
    if (p?.fase !== "descargando" || ultimo === "") diag("progreso", { fase: p?.fase ?? "empieza", ...memoriaDiag() });
    try {
      toast.loading(titulo, { id: ID_TOAST, description: descripcion, duration: Infinity });
    } catch {
      /* nada */
    }
  };
  onProgreso(null);
  const soltarPantalla = await pantallaSinBloquear(deps.pantalla ?? mantenerPantallaEncendida);
  let usoLocal = false;

  /** Local y, si falla, servidor (dentro del mismo recorte: la foto se reduce una sola vez). */
  const quitar = async (foto: Blob, p?: (x: Progreso) => void): Promise<Blob> => {
    const sinLocal = movilSinLocal();
    if (!deps.soloServidor && !sinLocal) {
      usoLocal = true;
      faseMarcaRecorte(d, "local");
      diag("quitar fondo: en el móvil", { foto, ...memoriaDiag() });
      try {
        const sticker = await local(foto, p);
        diag("quitar fondo en el móvil: hecho", { medida: await medidaLocal(), ...memoriaDiag() });
        return sticker;
      } catch (e) {
        const memoria = esFaltaDeMemoria(e);
        console.warn("[recorte-movil] no se pudo en el móvil; se prueba en el servidor", e);
        diag("quitar fondo en el móvil: fallo → servidor", { nombre: (e as Error)?.name, mensaje: mensajeCorto(e), memoria, ...memoriaDiag() });
        if (memoria) marcarMovilSinLocal(`Sin memoria al quitar el fondo (${mensajeCorto(e, 60)})`);
      } finally {
        await (deps.liberar ? Promise.resolve(deps.liberar()) : liberarPorDefecto());
      }
    } else {
      diag("quitar fondo: directo al servidor", { motivo: deps.soloServidor ? "retomar" : sinLocal?.motivo });
    }
    faseMarcaRecorte(d, "servidor");
    return servidor(foto, p);
  };

  try {
    await recortar(d, { original, onProgreso, quitar });
    quitarMarcaRecorte(d);
    diag("recorte tras guardar: hecho", { id: d.registroId, enElMovil: usoLocal });
    toast.success(`Foto con fondo de carta guardada${d.nombre ? `: ${d.nombre}` : ""}`, { id: ID_TOAST, description: undefined, duration: 5000 });
    emitirFotoRecortada(d);
    return true;
  } catch (e) {
    quitarMarcaRecorte(d);
    if (e instanceof ErrorFichaCambiada) {
      diag("recorte tras guardar: la ficha ya tiene otra foto");
      toast.dismiss(ID_TOAST);
      return false;
    }
    const err = e as (Error & { causa?: string; estado?: number }) | null;
    console.warn("[recorte-movil] no se pudo poner el fondo", { nombre: err?.name, mensaje: err?.message, causa: err?.causa, estado: err?.estado, error: e });
    const motivo = motivoFallo(e);
    diag("recorte tras guardar: fallo", { causa: err?.causa, estado: err?.estado, mensaje: err?.message, aOrdenador: vaAOrdenador(e) });
    if (vaAOrdenador(e)) await noRecortar(d, motivo);
    else avisarSinRecorte(d, motivo, "Prueba con otra foto o pon la foto desde un ordenador.");
    return false;
  } finally {
    soltarPantalla();
  }
}

/**
 * Al abrir el panel: si quedaron marcas de recortes de otra pestaña que ya no
 * late (el panel se cerró a medias), esas fotos (guardadas sin fondo) se
 * retoman EN EL SERVIDOR (y, si falla, van a un ordenador). Si murió
 * recortando en el móvil con la página a la vista, fue la memoria: el móvil
 * queda marcado y las siguientes fotos van directas al servidor. Si una marca
 * aún es reciente se vuelve a mirar pasado MS_MARCA_MUERTA (puede ser otra
 * pestaña viva). Devuelve la función para cancelar esa espera.
 */
export function recuperarRecorteInterrumpido(
  opts: { ahora?: () => number; alDetectar?: (d: DatosRecorte) => void; retomar?: (d: DatosRecorte) => void } = {},
): () => void {
  const ahora = opts.ahora ?? Date.now;
  const retomar = opts.retomar ?? ((d: DatosRecorte) => void recortarEnMovil(d, null, { soloServidor: true }));
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const comprobar = (reintento: boolean) => {
    let quedanVivas = false;
    for (const m of leerMarcasRecorte()) {
      if (m.pestana === ID_PESTANA) continue;
      if (!marcaHuerfana(m, ahora())) {
        quedanVivas = true;
        continue;
      }
      quitarMarcaRecorte(m);
      const datos = datosDeMarca(m);
      opts.alDetectar?.(datos);
      const memoria = m.fase === "local" && m.visible !== false;
      console.warn("[recorte-movil] el panel se cerró antes de poner el fondo a esta foto; se retoma en el servidor", { ...m, memoria });
      diag("panel cerrado a medias: se retoma en el servidor", { id: m.registroId, fase: m.fase, visible: m.visible, memoria });
      if (memoria) marcarMovilSinLocal("El panel se cerró solo mientras quitaba el fondo en el móvil (memoria)");
      retomar(datos);
    }
    if (quedanVivas && !reintento) temporizador = setTimeout(() => comprobar(true), MS_MARCA_MUERTA + 1000);
  };
  comprobar(false);
  return () => {
    if (temporizador) clearTimeout(temporizador);
  };
}
