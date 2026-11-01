/**
 * Conversión en el navegador de un vídeo que el `<video>` no sabe decodificar
 * (típico: .mov HEVC del iPhone en Chrome/Edge de Windows) a MP4 H.264 corto
 * con ffmpeg.wasm monohilo (sin SharedArrayBuffer: el panel no tiene COOP/COEP).
 *
 * Este módulo y @ffmpeg/ffmpeg se cargan solo al hacer falta (import dinámico);
 * el núcleo (js + wasm, ~32 MB) se sirve desde el propio panel (RUTA_FFMPEG),
 * porque la CSP solo deja cargar scripts/conexiones de 'self'.
 */
import { argumentosConversion, porcentajeConversion } from "./lecturaVideo";
import { RUTA_FFMPEG } from "./rutaFfmpeg";

export interface OpcionesConversion {
  /** 0–100; -1 mientras se descarga/arranca ffmpeg. */
  onProgreso?: (pct: number) => void;
  signal?: AbortSignal;
}

/** ¿Hay lo necesario para ffmpeg.wasm (WebAssembly + Worker de módulo)? */
export function conversionDisponible(): boolean {
  return typeof WebAssembly === "object" && typeof Worker === "function";
}

function extensionDe(archivo: Blob): string {
  const nombre = (archivo as File).name ?? "";
  const m = /\.([a-z0-9]{1,5})$/i.exec(nombre);
  return m ? m[1].toLowerCase() : "mov";
}

export async function convertirVideoMovil(archivo: Blob, { onProgreso, signal }: OpcionesConversion = {}): Promise<Blob> {
  if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
  onProgreso?.(-1);
  const { FFmpeg, FFFSType } = await import("@ffmpeg/ffmpeg");
  const ff = new FFmpeg();
  const alAbortar = () => ff.terminate();
  signal?.addEventListener("abort", alAbortar, { once: true });
  const log: string[] = [];
  ff.on("log", ({ message }) => {
    log.push(message);
    if (log.length > 40) log.shift();
  });
  ff.on("progress", ({ time }) => onProgreso?.(porcentajeConversion(time)));
  try {
    const base = new URL(RUTA_FFMPEG, location.origin).href;
    await ff.load({ coreURL: `${base}/ffmpeg-core.js`, wasmURL: `${base}/ffmpeg-core.wasm` });
    onProgreso?.(0);

    // WORKERFS: ffmpeg lee el File sin copiarlo entero a la memoria del wasm
    // (un .mov de 30 s en 4K son cientos de MB). Si no se puede, se copia.
    const nombre = `entrada.${extensionDe(archivo)}`;
    let entrada = `/in/${nombre}`;
    try {
      await ff.createDir("/in");
      const f = archivo instanceof File ? archivo : new File([archivo], nombre, { type: archivo.type });
      await ff.mount(FFFSType.WORKERFS, { files: [f] }, "/in");
      entrada = `/in/${f.name}`;
    } catch {
      entrada = `/${nombre}`;
      await ff.writeFile(entrada, new Uint8Array(await archivo.arrayBuffer()));
    }

    const salida = "/salida.mp4";
    const codigo = await ff.exec(argumentosConversion(entrada, salida));
    if (codigo !== 0) throw new Error(`ffmpeg terminó con código ${codigo}: ${log.slice(-6).join(" | ")}`);
    const datos = await ff.readFile(salida);
    if (typeof datos === "string" || datos.length === 0) throw new Error("ffmpeg no generó vídeo");
    onProgreso?.(100);
    return new Blob([datos as BlobPart], { type: "video/mp4" });
  } catch (e) {
    if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
    throw e;
  } finally {
    signal?.removeEventListener("abort", alAbortar);
    try {
      ff.terminate();
    } catch {
      /* ya terminado */
    }
  }
}
