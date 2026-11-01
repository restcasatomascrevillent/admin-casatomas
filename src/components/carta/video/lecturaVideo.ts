/**
 * Lectura de vídeos del móvil (lógica pura, sin DOM): qué intentos se hacen
 * para que el `<video>` del navegador pueda decodificar el archivo.
 *
 * Los .mov del iPhone (QuickTime, HEVC/H.265 o H.264) no se abren en Chrome/Edge
 * de Windows tal cual:
 *   1. «original»: el archivo tal cual (Safari y vídeos normales).
 *   2. «mp4»: el mismo contenido con tipo `video/mp4`. El contenedor MOV con
 *      H.264 suele reproducirse así en Chrome (solo se rechazaba por el tipo).
 *   3. «convertir»: ffmpeg.wasm en el navegador (primeros 4 s, ≤1280 px, H.264).
 *      Es el caso HEVC sin decodificador. Se descarga (~32 MB) solo entonces.
 */
import { SEGUNDOS_VIDEO } from "./videoPlato";

/** `accept` del input «Elegir vídeo»: algunos navegadores no asocian .mov/.m4v a video/*. */
export const ACEPTA_VIDEO = "video/*,.mov,.mp4,.m4v,.webm";

export type PasoLecturaVideo = "original" | "mp4" | "convertir";

/** Lado mayor máximo del vídeo convertido (el pipeline compone a 1280). */
export const LADO_CONVERSION = 1280;
/** fps del vídeo convertido: el doble del muestreo (12) para que buscar caiga cerca del fotograma. */
export const FPS_CONVERSION = 24;

export const MENSAJE_FORMATO_NO_COMPATIBLE = "No se pudo leer el vídeo (formato no compatible con este navegador)";
export const MENSAJE_HEVC_NO_CONVERTIDO =
  "Este vídeo está en HEVC y no se pudo convertir. En el iPhone: Ajustes → Cámara → Formatos → Más compatible, y vuelve a grabarlo";

/** Fallo al abrir el vídeo en el `<video>`: se puede pasar al siguiente intento. */
export class ErrorLecturaVideo extends Error {
  constructor(
    message: string,
    readonly motivo: "formato" | "sin-imagen" | "no-responde",
  ) {
    super(message);
    this.name = "ErrorLecturaVideo";
  }
}

export function esErrorLecturaVideo(e: unknown): e is ErrorLecturaVideo {
  return e instanceof ErrorLecturaVideo || (e as { name?: string } | null)?.name === "ErrorLecturaVideo";
}

function extension(nombre: string | undefined): string {
  const m = /\.([a-z0-9]+)$/i.exec(nombre ?? "");
  return m ? m[1].toLowerCase() : "";
}

/** ¿Es un vídeo QuickTime (lo típico del iPhone)? Por tipo o, si el tipo viene vacío/raro, por extensión. */
export function esVideoQuickTime(tipo: string | undefined, nombre?: string): boolean {
  const t = (tipo ?? "").toLowerCase().split(";")[0].trim();
  if (t === "video/quicktime" || t === "video/x-m4v") return true;
  const ext = extension(nombre);
  return ext === "mov" || ext === "m4v" || ext === "qt";
}

/**
 * Intentos, en orden, para abrir el archivo:
 *   - QuickTime: original → mp4 → convertir.
 *   - Resto: original → convertir (p. ej. un .mp4 HEVC de Android).
 * `puedeConvertir` = false (sin WebAssembly/Worker) quita el último.
 */
export function pasosLecturaVideo(tipo: string | undefined, nombre?: string, puedeConvertir = true): PasoLecturaVideo[] {
  const pasos: PasoLecturaVideo[] = ["original"];
  if (esVideoQuickTime(tipo, nombre)) pasos.push("mp4");
  if (puedeConvertir) pasos.push("convertir");
  return pasos;
}

/** Mensaje final si fallan todos los intentos. */
export function mensajeFalloLectura(tipo: string | undefined, nombre?: string): string {
  return esVideoQuickTime(tipo, nombre) ? MENSAJE_HEVC_NO_CONVERTIDO : MENSAJE_FORMATO_NO_COMPATIBLE;
}

/**
 * Argumentos de ffmpeg: primeros `segundos` s, sin audio, autorrotado (por
 * defecto), lado mayor ≤ `lado` (par), 24 fps, H.264 yuv420p ultrafast con un
 * fotograma clave por segundo (buscar rápido) y moov al principio.
 */
export function argumentosConversion(
  entrada: string,
  salida: string,
  { segundos = SEGUNDOS_VIDEO, lado = LADO_CONVERSION, fps = FPS_CONVERSION } = {},
): string[] {
  return [
    "-hide_banner",
    "-i",
    entrada,
    "-t",
    String(segundos),
    "-an",
    "-vf",
    `scale=w='min(${lado},iw)':h='min(${lado},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=${fps}`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(fps),
    "-movflags",
    "+faststart",
    "-y",
    salida,
  ];
}

/** 0–100 de la conversión a partir del `time` (µs) que da ffmpeg.wasm. */
export function porcentajeConversion(tiempoMicros: number, segundos = SEGUNDOS_VIDEO): number {
  if (!(tiempoMicros > 0) || !(segundos > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((tiempoMicros / (segundos * 1_000_000)) * 100)));
}
