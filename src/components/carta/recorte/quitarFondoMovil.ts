/**
 * Quitar el fondo en el MÓVIL, en el propio formulario (igual que en el
 * portátil; decisión del dueño, 03-11-2026). Ver recorteMovil.ts:
 *   1. en el navegador del móvil (quitarFondoNavegador: mismo modelo del PC,
 *      descarga ligera, WebGPU si hay; el worker se suelta al acabar);
 *   2. si falla → en el SERVIDOR (quitarFondoServidor), también aquí;
 *   3. si también falla, lanza el error del servidor: el formulario enseña el
 *      motivo, se guarda la foto normal y va a un ordenador.
 * Si el móvil se queda sin memoria (error o pestaña muerta), queda marcado y
 * las siguientes fotos van directas al servidor.
 */
import {
  esFaltaDeMemoria,
  latirMarcaRecorte,
  marcarMovilSinLocal,
  marcarRecorteEnCurso,
  mensajeCorto,
  MS_LATIDO,
  movilSinLocal,
  quitarMarcaRecorte,
} from "./recorteMovil";
import type { ProgresoRecorte } from "./quitarFondoNavegador";
import { quitarFondoServidor, type ProgresoServidor } from "./quitarFondoServidor";
import { reducirFotoRecorte } from "./reducirFotoRecorte";

/** Lado mayor de la foto que se recorta en el móvil (la foto de carta sale a 900×1200 o 1200×900). */
export const LADO_RECORTE_MOVIL = 1200;

export type ProgresoMovil = ProgresoRecorte | ProgresoServidor;
type Quitar = (foto: Blob, onProgreso?: (p: ProgresoMovil) => void) => Promise<Blob>;

export interface DependenciasQuitarMovil {
  local?: Quitar;
  servidor?: Quitar;
  liberar?: () => void | Promise<void>;
}

async function localPorDefecto(foto: Blob, onProgreso?: (p: ProgresoMovil) => void): Promise<Blob> {
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

/** Foto del móvil → sticker PNG (local y, si falla, servidor). Lanza el error del servidor si los dos fallan. */
export async function quitarFondoMovil(
  foto: Blob,
  onProgreso?: (p: ProgresoMovil) => void,
  deps: DependenciasQuitarMovil = {},
): Promise<{ sticker: Blob; metodo: "navegador" | "servidor" }> {
  const reducida = await reducirFotoRecorte(foto, LADO_RECORTE_MOVIL);
  const sinLocal = movilSinLocal();
  if (!sinLocal) {
    marcarRecorteEnCurso();
    const latido = setInterval(() => latirMarcaRecorte(), MS_LATIDO);
    // Al ocultarse la página el sistema congela los temporizadores: anotarlo YA.
    const alCambiar = () => latirMarcaRecorte();
    const alSalir = () => latirMarcaRecorte({ visible: false });
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", alCambiar);
    if (typeof window !== "undefined") window.addEventListener("pagehide", alSalir);
    try {
      const sticker = await (deps.local ?? localPorDefecto)(reducida, onProgreso);
      return { sticker, metodo: "navegador" };
    } catch (e) {
      const memoria = esFaltaDeMemoria(e);
      console.warn("[recorte-movil] no se pudo en el móvil; se prueba en el servidor", e);
      if (memoria) marcarMovilSinLocal(`Sin memoria al quitar el fondo (${mensajeCorto(e, 60)})`);
    } finally {
      clearInterval(latido);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", alCambiar);
      if (typeof window !== "undefined") window.removeEventListener("pagehide", alSalir);
      quitarMarcaRecorte();
      await (deps.liberar ?? liberarPorDefecto)();
    }
  }
  const sticker = await (deps.servidor ?? ((f: Blob, p?: (x: ProgresoMovil) => void) => quitarFondoServidor(f, { onProgreso: p })))(reducida, onProgreso);
  return { sticker, metodo: "servidor" };
}
