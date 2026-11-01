/**
 * Procesa en ESTE dispositivo un trabajo de vídeo mandado desde un móvil:
 * reclamar → descargar el bruto → procesar y guardar `video_url` (pipeline
 * del vídeo del plato) → marcar listo → borrar el bruto → avisar por push.
 * Si falla: marcar error y avisar igualmente (el móvil ve «no se pudo»).
 *
 * El paso «procesar y guardar» es inyectable (`procesarYGuardar`) para meter
 * el trabajo en la cola de procesado de vídeo de la app cuando exista; por
 * defecto usa procesarVideoPlato + guardarVideoPlato directamente.
 */
import type { NombreTema } from "../composicionCarta";
import type { ProgresoVideo } from "../video/videoPlato";
import type { TrabajoVideo } from "./colaPendientes";
import {
  borrarBruto,
  descargarBruto,
  notificarTrabajo,
  reclamarTrabajo,
  soltarTrabajo,
  terminarTrabajo,
  videoActualPlato,
} from "./trabajosVideo";

export interface EntradaProcesado {
  platoId: string;
  nombrePlato: string;
  bruto: Blob;
  tema: NombreTema;
  signal?: AbortSignal;
  onProgreso?: (p: ProgresoVideo) => void;
}

/** Procesa el bruto y guarda el vídeo del plato. Devuelve la URL guardada. */
export type ProcesarYGuardar = (e: EntradaProcesado) => Promise<string>;

export const procesarYGuardarDirecto: ProcesarYGuardar = async ({ platoId, bruto, tema, signal, onProgreso }) => {
  const [{ procesarVideoPlato }, { guardarVideoPlato }] = await Promise.all([
    import("../video/procesarVideoPlato"),
    import("../video/subirVideoPlato"),
  ]);
  const r = await procesarVideoPlato(bruto, { tema, signal, onProgreso });
  const anterior = await videoActualPlato(platoId);
  return guardarVideoPlato(platoId, r.blob, anterior);
};

export interface DependenciasRemoto {
  reclamar?: typeof reclamarTrabajo;
  descargar?: typeof descargarBruto;
  terminar?: typeof terminarTrabajo;
  soltar?: typeof soltarTrabajo;
  borrar?: typeof borrarBruto;
  notificar?: typeof notificarTrabajo;
  procesarYGuardar?: ProcesarYGuardar;
}

export type ResultadoRemoto =
  | { estado: "listo"; url: string }
  | { estado: "cogido"; mensaje: string }
  | { estado: "cancelado" }
  | { estado: "error"; mensaje: string };

export async function procesarTrabajoRemoto(
  trabajo: Pick<TrabajoVideo, "id" | "plato_id" | "tema" | "ruta_original" | "Platos">,
  opts: { signal?: AbortSignal; onProgreso?: (p: ProgresoVideo) => void } & DependenciasRemoto = {},
): Promise<ResultadoRemoto> {
  const reclamar = opts.reclamar ?? reclamarTrabajo;
  const descargar = opts.descargar ?? descargarBruto;
  const terminar = opts.terminar ?? terminarTrabajo;
  const soltar = opts.soltar ?? soltarTrabajo;
  const borrar = opts.borrar ?? borrarBruto;
  const notificar = opts.notificar ?? notificarTrabajo;
  const procesarYGuardar = opts.procesarYGuardar ?? procesarYGuardarDirecto;

  const mio = await reclamar(trabajo.id);
  if (!mio) return { estado: "cogido", mensaje: "Otro dispositivo ya está procesando este vídeo." };
  try {
    const bruto = await descargar(mio.ruta_original);
    const url = await procesarYGuardar({
      platoId: mio.plato_id,
      nombrePlato: trabajo.Platos?.nombre ?? "",
      bruto,
      tema: mio.tema as NombreTema,
      signal: opts.signal,
      onProgreso: opts.onProgreso,
    });
    await terminar(mio.id, true);
    await borrar(mio.ruta_original);
    await notificar(mio.id);
    return { estado: "listo", url };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      // Cancelado aquí: vuelve a pendiente para otro dispositivo (o más tarde).
      await soltar(mio.id).catch(() => undefined);
      return { estado: "cancelado" };
    }
    const mensaje = (e as Error)?.message || "No se pudo procesar el vídeo";
    await terminar(mio.id, false, mensaje).catch(() => undefined);
    await notificar(mio.id);
    return { estado: "error", mensaje };
  }
}
