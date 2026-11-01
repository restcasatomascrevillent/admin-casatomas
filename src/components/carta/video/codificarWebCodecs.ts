/**
 * Codificación del vídeo del plato con WebCodecs (VideoEncoder H.264) +
 * mp4-muxer: cada fotograma lleva su instante exacto, así que NO depende del
 * reloj (MediaRecorder graba en tiempo real y pierde fotogramas si el
 * temporizador se retrasa o la pestaña pasa a segundo plano).
 *
 * Chrome/Edge, Safari 16.4+ y Firefox 130+. Si no hay VideoEncoder o no
 * admite H.264 a 1200×900, `codificarConWebCodecs` devuelve null y se usa
 * MediaRecorder.
 */
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { BITRATE_VIDEO, elegirCodecAvc, esClaveCodec, FPS_VIDEO, tiempoFotogramaUs } from "./videoPlato";

export function webCodecsDisponible(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined" && typeof createImageBitmap === "function";
}

/** Fotogramas en vuelo en el codificador antes de esperar (memoria). */
const MAX_COLA = 8;

export async function codificarConWebCodecs(
  fotogramas: readonly Blob[],
  { ancho, alto, fps = FPS_VIDEO, signal }: { ancho: number; alto: number; fps?: number; signal?: AbortSignal },
): Promise<Blob | null> {
  if (!webCodecsDisponible() || fotogramas.length === 0) return null;
  const base = { width: ancho, height: alto, bitrate: BITRATE_VIDEO, framerate: fps };
  const codec = await elegirCodecAvc(async (c) => (await VideoEncoder.isConfigSupported({ ...base, codec: c })).supported === true);
  if (!codec) return null;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: ancho, height: alto, frameRate: fps },
    fastStart: "in-memory",
  });
  let fallo: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      fallo = e instanceof Error ? e : new Error(String(e));
    },
  });
  try {
    encoder.configure({ ...base, codec, avc: { format: "avc" }, latencyMode: "quality" });
    for (let i = 0; i < fotogramas.length; i++) {
      if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
      if (fallo) throw fallo;
      const bmp = await createImageBitmap(fotogramas[i]);
      const frame = new VideoFrame(bmp, tiempoFotogramaUs(i, fps));
      bmp.close();
      encoder.encode(frame, { keyFrame: esClaveCodec(i, fps) });
      frame.close();
      while (encoder.encodeQueueSize > MAX_COLA && !fallo) await new Promise((r) => setTimeout(r, 5));
    }
    await encoder.flush();
    if (fallo) throw fallo;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}
