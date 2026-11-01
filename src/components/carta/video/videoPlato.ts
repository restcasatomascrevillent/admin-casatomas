/**
 * Vídeo del plato: lógica PURA (sin DOM) para poder probarla con vitest.
 *
 *   - elegirMimeVideo: formato de MediaRecorder (mp4 si se puede; si no webm).
 *   - tiemposFotogramas: instantes a extraer de los primeros 4 s.
 *   - pasoInferencia / indicesClave: en qué fotogramas se pasa el modelo
 *     (en CPU es lento: se pasa cada 2–4 fotogramas y se interpola).
 *   - interpolarMascara / suavizarMascara: máscara por fotograma con media
 *     exponencial, para que el borde no tiemble.
 *   - cajaDeMascara / suavizarCajas: encuadre del plato estable en el tiempo.
 *   - esErrorColumnaVideo: la migración de `video_url` aún no está aplicada.
 */

/** Segundos que se usan del vídeo (el resto se ignora). */
export const SEGUNDOS_VIDEO = 4;
/** Fotogramas por segundo del vídeo generado. */
export const FPS_VIDEO = 12;
/** Tope de fotogramas (12 fps × 4 s). */
export const MAX_FOTOGRAMAS = 48;
/** Lado al que se guardan las máscaras entre la fase de modelo y la de composición. */
export const LADO_MASCARA_VIDEO = 512;
/** Peso del fotograma nuevo en la media exponencial de la máscara (0–1). */
export const ALFA_MASCARA = 0.6;
/** Peso de la caja nueva en la media exponencial del encuadre (0–1). */
export const ALFA_CAJA = 0.35;
/** Bits por segundo del vídeo codificado. */
export const BITRATE_VIDEO = 1_200_000;

export interface FormatoVideo {
  /** mimeType para MediaRecorder (puede llevar codecs). */
  mime: string;
  /** Extensión del fichero subido. */
  ext: "mp4" | "webm";
  /** Content-Type del fichero (sin codecs). */
  contentType: "video/mp4" | "video/webm";
}

/** Orden de preferencia: mp4 (H.264, se ve en todos, también iPhone) → webm VP9 → VP8. */
export const CANDIDATOS_MIME = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

/** Primer formato que el navegador sabe grabar; null si ninguno. */
export function elegirMimeVideo(soporta: (mime: string) => boolean): FormatoVideo | null {
  for (const mime of CANDIDATOS_MIME) {
    let ok = false;
    try {
      ok = soporta(mime);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    const mp4 = mime.startsWith("video/mp4");
    return { mime, ext: mp4 ? "mp4" : "webm", contentType: mp4 ? "video/mp4" : "video/webm" };
  }
  return null;
}

/**
 * Instantes (s) de los fotogramas a extraer: `fps` por segundo de los primeros
 * `maxSegundos`, sin pasar de `maxFotogramas`. Duración no finita (algunos webm)
 * → se asume `maxSegundos`. Vídeo vacío → [].
 */
export function tiemposFotogramas(
  duracion: number,
  { fps = FPS_VIDEO, maxSegundos = SEGUNDOS_VIDEO, maxFotogramas = MAX_FOTOGRAMAS } = {},
): number[] {
  const d = Number.isFinite(duracion) ? duracion : duracion === Infinity ? maxSegundos : 0;
  const usable = Math.min(d, maxSegundos);
  if (!(usable > 0) || !(fps > 0)) return [];
  const n = Math.max(1, Math.min(maxFotogramas, Math.floor(usable * fps)));
  const paso = 1 / fps;
  // Medio fotograma de margen al final para no pedir un instante fuera del vídeo.
  const limite = Math.max(0, usable - paso / 2);
  const t: number[] = [];
  for (let i = 0; i < n; i++) t.push(Math.min(limite, Math.round(i * paso * 1000) / 1000));
  return t;
}

/** Cada cuántos fotogramas se pasa el modelo según lo que tardó el primero (ms). */
export function pasoInferencia(msPorFotograma: number): number {
  if (!(msPorFotograma > 0)) return 1;
  if (msPorFotograma < 2500) return 1; // WebGPU / PC rápido
  if (msPorFotograma < 6000) return 2;
  return 4; // CPU (WASM): ~13 s por fotograma en PC
}

/** Índices con máscara del modelo: 0, paso, 2·paso… y siempre el último. */
export function indicesClave(total: number, paso: number): number[] {
  if (total <= 0) return [];
  const p = Math.max(1, Math.floor(paso));
  const out: number[] = [];
  for (let i = 0; i < total; i += p) out.push(i);
  if (out[out.length - 1] !== total - 1) out.push(total - 1);
  return out;
}

/** Para el fotograma i: claves anterior/siguiente y peso t (0 = anterior, 1 = siguiente). */
export function vecinosClave(i: number, claves: number[]): { a: number; b: number; t: number } {
  if (claves.length === 0) throw new Error("Sin fotogramas clave");
  let a = claves[0];
  let b = claves[claves.length - 1];
  for (const k of claves) {
    if (k <= i) a = k;
    if (k >= i) {
      b = k;
      break;
    }
  }
  if (i <= claves[0]) return { a: claves[0], b: claves[0], t: 0 };
  if (i >= claves[claves.length - 1]) return { a: b, b, t: 0 };
  return { a, b, t: b === a ? 0 : (i - a) / (b - a) };
}

/** Mezcla lineal de dos máscaras (t = 0 → a, t = 1 → b). */
export function interpolarMascara(a: ArrayLike<number>, b: ArrayLike<number>, t: number): Float32Array {
  const out = new Float32Array(a.length);
  const u = Math.min(1, Math.max(0, t));
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * u;
  return out;
}

/**
 * Media exponencial de la máscara: `alfa·nueva + (1−alfa)·previa`. Sin previa
 * (primer fotograma) devuelve la nueva tal cual. Valores 0–255.
 */
export function suavizarMascara(previa: ArrayLike<number> | null, nueva: ArrayLike<number>, alfa = ALFA_MASCARA): Float32Array {
  const out = new Float32Array(nueva.length);
  if (!previa || previa.length !== nueva.length) {
    for (let i = 0; i < out.length; i++) out[i] = nueva[i];
    return out;
  }
  const a = Math.min(1, Math.max(0, alfa));
  for (let i = 0; i < out.length; i++) out[i] = a * nueva[i] + (1 - a) * previa[i];
  return out;
}

/** Float 0–255 → Uint8 redondeado y recortado. */
export function aUint8(m: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(m[i])));
  return out;
}

export interface CajaVideo {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Caja de lo opaco (≥ umbral) en una máscara lado×lado, llevada a las medidas
 * del fotograma (la máscara es el fotograma deformado a cuadrado). null si vacía.
 */
export function cajaDeMascara(
  m: ArrayLike<number>,
  lado: number,
  anchoFotograma: number,
  altoFotograma: number,
  umbral = 127,
): CajaVideo | null {
  let x0 = lado;
  let y0 = lado;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      if (m[y * lado + x] < umbral) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const sx = anchoFotograma / lado;
  const sy = altoFotograma / lado;
  const x = Math.floor(x0 * sx);
  const y = Math.floor(y0 * sy);
  return {
    x,
    y,
    w: Math.max(1, Math.min(anchoFotograma, Math.ceil((x1 + 1) * sx)) - x),
    h: Math.max(1, Math.min(altoFotograma, Math.ceil((y1 + 1) * sy)) - y),
  };
}

/**
 * Encuadre estable: rellena huecos (null → la caja vecina) y aplica una media
 * exponencial hacia delante y hacia atrás (sin retraso). Devuelve enteros.
 */
export function suavizarCajas(cajas: Array<CajaVideo | null>, alfa = ALFA_CAJA): CajaVideo[] {
  const llenas: CajaVideo[] = [];
  let ultima: CajaVideo | null = cajas.find((c): c is CajaVideo => !!c) ?? null;
  if (!ultima) return [];
  for (const c of cajas) {
    if (c) ultima = c;
    llenas.push({ ...(ultima as CajaVideo) });
  }
  const a = Math.min(1, Math.max(0, alfa));
  const campos = ["x", "y", "w", "h"] as const;
  const ida = llenas.map((c) => ({ ...c }));
  for (let i = 1; i < ida.length; i++) for (const k of campos) ida[i][k] = a * llenas[i][k] + (1 - a) * ida[i - 1][k];
  const vuelta = ida.map((c) => ({ ...c }));
  for (let i = vuelta.length - 2; i >= 0; i--) for (const k of campos) vuelta[i][k] = a * ida[i][k] + (1 - a) * vuelta[i + 1][k];
  return vuelta.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y), w: Math.max(1, Math.round(c.w)), h: Math.max(1, Math.round(c.h)) }));
}

/** Ruta en el bucket `platos`. */
export function rutaVideoPlato(id: string, ext: "mp4" | "webm"): string {
  return `${id}-video.${ext}`;
}

/** Extensión de un vídeo generado (por su tipo). */
export function extensionVideo(tipo: string): "mp4" | "webm" {
  return tipo.startsWith("video/mp4") ? "mp4" : "webm";
}

/**
 * true si el error de PostgREST/Postgres es que la columna `video_url` no
 * existe (migración sin aplicar): PGRST204 «Could not find the 'video_url'
 * column…» o 42703 «column … does not exist».
 */
export function esErrorColumnaVideo(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  const texto = `${String(e.message ?? "")} ${String(e.details ?? "")}`;
  if (!/video_url/.test(texto)) return false;
  return e.code === "PGRST204" || e.code === "42703" || /does not exist|could not find/i.test(texto);
}

/**
 * ¿Existe la columna? Con `select('*')` una fila sin la clave `video_url`
 * significa que la migración no está aplicada. null = no se sabe (sin filas).
 */
export function columnaVideoDisponible(filas: ReadonlyArray<object> | null | undefined): boolean | null {
  if (!filas || filas.length === 0) return null;
  return "video_url" in filas[0];
}

export type ProgresoVideo =
  | { fase: "preparando" }
  | { fase: "descargando"; pct: number }
  /** Conversión del vídeo del móvil con ffmpeg.wasm; pct -1 = descargando/arrancando el conversor. */
  | { fase: "convirtiendo"; pct: number }
  | { fase: "recortando"; hecho: number; total: number }
  | { fase: "componiendo"; hecho: number; total: number }
  | { fase: "codificando" };

export function textoProgresoVideo(p: ProgresoVideo | null): string {
  switch (p?.fase) {
    case "descargando":
      return `Descargando modelo (1ª vez)… ${p.pct} %`;
    case "convirtiendo":
      return p.pct < 0 ? "Convirtiendo vídeo del móvil… (preparando conversor)" : `Convirtiendo vídeo del móvil… ${p.pct} %`;
    case "recortando":
      return `Procesando vídeo… quitando fondo ${p.hecho}/${p.total}`;
    case "componiendo":
      return `Procesando vídeo… ${p.hecho}/${p.total}`;
    case "codificando":
      return "Procesando vídeo… codificando";
    default:
      return "Preparando vídeo…";
  }
}

/** 0–100 para la barra de progreso (recorte 0–70 %, composición 70–95 %, codificación 95–100 %). */
export function porcentajeProgresoVideo(p: ProgresoVideo | null): number {
  switch (p?.fase) {
    case "descargando":
      return 0;
    case "convirtiendo":
      return 0;
    case "recortando":
      return Math.round((p.hecho / Math.max(1, p.total)) * 70);
    case "componiendo":
      return 70 + Math.round((p.hecho / Math.max(1, p.total)) * 25);
    case "codificando":
      return 97;
    default:
      return 0;
  }
}
