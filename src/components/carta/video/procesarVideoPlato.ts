/**
 * Vídeo del plato en el navegador: primeros 4 s de un vídeo → fotogramas a
 * 30 fps → fondo quitado con el MISMO modelo/worker que la foto
 * (mascaraModelo) → cada fotograma compuesto sobre el tema de la carta con el
 * mismo encuadre 4:3 que la foto (componerPlatoEnLienzo) → WebCodecs + mp4
 * (instantes exactos) o, si no hay, MediaRecorder sobre canvas.captureStream.
 *
 * Fases:
 *   A. Modelo en los fotogramas clave: como mucho FPS_MODELO (12) por
 *      segundo con WebGPU, 6 o 3 en CPU (indicesClaveSalida); el resto de
 *      los 30 fps usan la máscara interpolada.
 *      Las máscaras se guardan a 512² para no gastar memoria.
 *   B. Por fotograma: máscara interpolada + media exponencial, encuadre
 *      suavizado, composición → JPEG en memoria (~100 KB cada uno).
 *   C. Codificación: VideoEncoder H.264 + mp4-muxer con el instante exacto
 *      de cada fotograma (no depende del reloj ni de que la pestaña se vea).
 *      Sin WebCodecs: reproducción de los JPEG en un lienzo a 30 fps mientras
 *      graba MediaRecorder (en tiempo real: por eso se graba al final).
 */
import { crearWorkerRecorteDedicado, mascaraModelo, recorteNavegadorDisponible } from "../recorte/quitarFondoNavegador";
import { crearMutex, numeroWorkersRecorte, procesarEnPool } from "./paralelo";
import { LADO_MODELO, postprocesarMascara } from "../recorte/mascaraRecorte";
import { componerPlatoEnLienzo, FONDO_ACTIVO, PLATO_ALTO, PLATO_ANCHO, TEMAS, type CrearLienzo, type NombreTema } from "../composicionCarta";
import { codificarConWebCodecs } from "./codificarWebCodecs";
import {
  ALFA_CAJA,
  ALFA_MASCARA,
  alfaParaFps,
  aUint8,
  BITRATE_VIDEO,
  cajaDeMascara,
  elegirMimeVideo,
  FPS_VIDEO,
  indicesClaveSalida,
  interpolarMascara,
  LADO_MASCARA_VIDEO,
  estimarRestanteMs,
  MS_CODIFICACION,
  pasoInferencia,
  suavizarCajas,
  suavizarMascara,
  tiemposFotogramas,
  vecinosClave,
  type CajaVideo,
  type FormatoVideo,
  type ProgresoVideo,
} from "./videoPlato";
import { esperarVisible } from "./pantallaEncendida";
import {
  ErrorLecturaVideo,
  esErrorLecturaVideo,
  MENSAJE_FORMATO_NO_COMPATIBLE,
  mensajeFalloLectura,
  pasosLecturaVideo,
  type PasoLecturaVideo,
} from "./lecturaVideo";

/** Lado mayor del fotograma con el que se compone (la salida es 1200×900). */
const LADO_FOTOGRAMA = 1280;

export type DisponibilidadVideo = { ok: true; formato: FormatoVideo } | { ok: false; motivo: string };

/** ¿Puede este dispositivo generar el vídeo? (MediaRecorder + captureStream + worker del modelo). */
export function videoPlatoDisponible(): DisponibilidadVideo {
  if (typeof document === "undefined" || !recorteNavegadorDisponible())
    return { ok: false, motivo: "Este navegador no puede quitar el fondo (falta Web Worker o WebAssembly)." };
  if (typeof MediaRecorder === "undefined")
    return { ok: false, motivo: "Este navegador no puede grabar vídeo (sin MediaRecorder). Prueba con Chrome o con Safari actualizado." };
  if (typeof HTMLCanvasElement === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function")
    return { ok: false, motivo: "Este navegador no puede generar vídeo desde un lienzo (sin captureStream)." };
  const formato = elegirMimeVideo((m) => MediaRecorder.isTypeSupported(m));
  if (!formato) return { ok: false, motivo: "Este navegador no sabe codificar vídeo MP4 ni WebM." };
  return { ok: true, formato };
}

export interface ResultadoVideoPlato {
  blob: Blob;
  formato: FormatoVideo;
  fotogramas: number;
  /** Fotogramas en los que se pasó el modelo. */
  inferencias: number;
  ms: number;
  /** Primer fotograma compuesto (JPEG 1200×900), para el póster de la notificación. */
  poster?: Blob;
}

export interface OpcionesVideoPlato {
  tema?: NombreTema;
  onProgreso?: (p: ProgresoVideo) => void;
  signal?: AbortSignal;
}

function abortado(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
}

function lienzo(ancho: number, alto: number) {
  const c = document.createElement("canvas");
  c.width = ancho;
  c.height = alto;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas no disponible");
  return { c, ctx };
}

/**
 * Lienzos reutilizados entre fotogramas (memoria, sobre todo en móvil): la
 * k-ésima petición de cada fotograma devuelve siempre el mismo canvas (se
 * redimensiona si hace falta, lo que además lo limpia). `reiniciar()` al
 * empezar cada fotograma; lo devuelto solo vale hasta el siguiente.
 */
function lienzosReutilizables(): { crear: CrearLienzo; reiniciar: () => void; soltar: () => void } {
  const usados: HTMLCanvasElement[] = [];
  let k = 0;
  return {
    crear: (ancho, alto) => {
      let c = usados[k];
      if (!c) {
        c = document.createElement("canvas");
        usados[k] = c;
      }
      k++;
      // Asignar width/height siempre: deja el lienzo limpio y con el contexto reiniciado.
      c.width = ancho;
      c.height = alto;
      return c;
    },
    reiniciar: () => {
      k = 0;
    },
    soltar: () => {
      for (const c of usados) c.width = c.height = 0;
      usados.length = 0;
    },
  };
}

function esperarEvento(el: HTMLElement, ok: string, ms: number, error = "error"): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      limpiar();
      reject(new ErrorLecturaVideo("El vídeo no responde", "no-responde"));
    }, ms);
    const bien = () => {
      limpiar();
      resolve();
    };
    const mal = () => {
      limpiar();
      reject(new ErrorLecturaVideo(MENSAJE_FORMATO_NO_COMPATIBLE, "formato"));
    };
    const limpiar = () => {
      clearTimeout(t);
      el.removeEventListener(ok, bien);
      el.removeEventListener(error, mal);
    };
    el.addEventListener(ok, bien);
    el.addEventListener(error, mal);
  });
}

async function cargarVideo(archivo: Blob): Promise<{ video: HTMLVideoElement; liberar: () => void }> {
  const url = URL.createObjectURL(archivo);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.preload = "auto";
  const liberar = () => {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  };
  try {
    const meta = esperarEvento(video, "loadeddata", 15000);
    video.src = url;
    await meta;
    // iOS no pinta fotogramas al buscar hasta que el vídeo ha arrancado una vez.
    try {
      await video.play();
    } catch {
      /* sin autoplay: se intenta igual */
    }
    video.pause();
    if (!video.videoWidth || !video.videoHeight) throw new ErrorLecturaVideo("El vídeo no tiene imagen", "sin-imagen");
    return { video, liberar };
  } catch (e) {
    liberar();
    throw e;
  }
}

/**
 * Abre el vídeo probando, en orden, los pasos de pasosLecturaVideo: tal cual,
 * como video/mp4 (MOV con H.264) y convertido con ffmpeg.wasm (HEVC). Solo se
 * pasa al siguiente si el <video> no pudo decodificarlo (ErrorLecturaVideo).
 */
export async function cargarVideoCompatible(
  archivo: Blob,
  onProgreso?: (p: ProgresoVideo) => void,
  signal?: AbortSignal,
): Promise<{ video: HTMLVideoElement; liberar: () => void }> {
  const nombre = (archivo as File).name;
  let convertir: typeof import("./convertirVideoMovil") | null = null;
  try {
    convertir = await import("./convertirVideoMovil");
  } catch (e) {
    console.warn("[video-plato] sin conversor", e);
  }
  const pasos = pasosLecturaVideo(archivo.type, nombre, !!convertir?.conversionDisponible());
  let ultimo: unknown = null;
  for (const paso of pasos) {
    abortado(signal);
    await esperarVisible(signal);
    try {
      return await cargarVideo(await blobParaPaso(paso, archivo, convertir, onProgreso, signal));
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      ultimo = e;
      console.warn(`[video-plato] lectura «${paso}» falló`, e);
      // Un fallo de ffmpeg (no de lectura) también acaba aquí: era el último paso.
      if (paso !== "convertir" && !esErrorLecturaVideo(e)) throw e;
    }
  }
  console.warn("[video-plato] ningún intento de lectura funcionó", ultimo);
  throw new Error(mensajeFalloLectura(archivo.type, nombre));
}

async function blobParaPaso(
  paso: PasoLecturaVideo,
  archivo: Blob,
  convertir: typeof import("./convertirVideoMovil") | null,
  onProgreso?: (p: ProgresoVideo) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  if (paso === "original") return archivo;
  if (paso === "mp4") return new Blob([archivo], { type: "video/mp4" });
  if (!convertir) throw new Error("Conversor no disponible");
  onProgreso?.({ fase: "convirtiendo", pct: -1 });
  return convertir.convertirVideoMovil(archivo, {
    signal,
    onProgreso: (pct) => onProgreso?.({ fase: "convirtiendo", pct }),
  });
}

/**
 * Busca el instante t. Con la pestaña oculta el navegador puede no servir
 * fotogramas: se ESPERA a que vuelva a verse (pausa) y, si la búsqueda se
 * quedó colgada por ocultarse a medias, se repite al volver.
 */
async function irA(video: HTMLVideoElement, t: number, signal?: AbortSignal) {
  for (let intento = 0; ; intento++) {
    await esperarVisible(signal);
    if (Math.abs(video.currentTime - t) < 0.0005 && video.readyState >= 2) return;
    const listo = esperarEvento(video, "seeked", 8000);
    video.currentTime = t;
    try {
      await listo;
      return;
    } catch (e) {
      if (intento < 3 && esErrorLecturaVideo(e) && document.visibilityState === "hidden") continue;
      throw e;
    }
  }
}

type Lienzo = ReturnType<typeof lienzo>;
/** Lienzos de reescalarMascara, reutilizados durante un procesado (es síncrona: no se pisan). */
const lienzosMascara: { src: Lienzo | null; dst: Lienzo | null } = { src: null, dst: null };
function lienzoMascara(cual: "src" | "dst", lado: number): Lienzo {
  let l = lienzosMascara[cual];
  if (!l || l.c.width !== lado) l = lienzosMascara[cual] = lienzo(lado, lado);
  return l;
}

/** Máscara 0–255 de lado `de` → lado `a` (suavizado del canvas). */
function reescalarMascara(m: Uint8Array, de: number, a: number): Uint8Array {
  const src = lienzoMascara("src", de);
  const img = src.ctx.createImageData(de, de);
  for (let i = 0; i < m.length; i++) {
    const o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = m[i];
    img.data[o + 3] = 255;
  }
  src.ctx.putImageData(img, 0, 0);
  const dst = lienzoMascara("dst", a);
  dst.ctx.imageSmoothingQuality = "high";
  dst.ctx.clearRect(0, 0, a, a);
  dst.ctx.drawImage(src.c, 0, 0, a, a);
  const d = dst.ctx.getImageData(0, 0, a, a).data;
  const out = new Uint8Array(a * a);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
  return out;
}

function aBlob(c: HTMLCanvasElement, tipo: string, calidad?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo generar el fotograma"))), tipo, calidad));
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Vídeo (archivo de la cámara o galería) → vídeo del plato sin fondo con el tema elegido. */
export async function procesarVideoPlato(archivo: Blob, { tema = FONDO_ACTIVO, onProgreso, signal }: OpcionesVideoPlato = {}): Promise<ResultadoVideoPlato> {
  const disp = videoPlatoDisponible();
  if ("motivo" in disp) throw new Error(disp.motivo);
  const { formato } = disp;
  const t0 = performance.now();
  onProgreso?.({ fase: "preparando" });

  const { video, liberar } = await cargarVideoCompatible(archivo, onProgreso, signal);
  try {
    const tiempos = tiemposFotogramas(video.duration);
    if (tiempos.length < 2) throw new Error("El vídeo es demasiado corto");
    const total = tiempos.length;
    const escala = Math.min(1, LADO_FOTOGRAMA / Math.max(video.videoWidth, video.videoHeight));
    const W = Math.max(2, Math.round(video.videoWidth * escala));
    const H = Math.max(2, Math.round(video.videoHeight * escala));
    const L = LADO_MASCARA_VIDEO;

    // --- A. Modelo en los fotogramas clave ---------------------------------
    const ent = lienzo(LADO_MODELO, LADO_MODELO);
    ent.ctx.imageSmoothingQuality = "high";
    const mascaras = new Map<number, Uint8Array>();
    // Buscar en el único <video> y leer el fotograma va de uno en uno; el
    // modelo puede ir en paralelo en varios workers.
    const enSerie = crearMutex();
    const entrada = (i: number) =>
      enSerie(async () => {
        abortado(signal);
        await irA(video, tiempos[i], signal);
        abortado(signal);
        ent.ctx.drawImage(video, 0, 0, LADO_MODELO, LADO_MODELO);
        return ent.ctx.getImageData(0, 0, LADO_MODELO, LADO_MODELO).data;
      });
    const principal = (rgba: Uint8ClampedArray) =>
      mascaraModelo(rgba, (p) => {
        if (p.fase === "descargando") onProgreso?.({ fase: "descargando", pct: p.pct });
      });
    onProgreso?.({ fase: "recortando", hecho: 0, total: 1 });
    // El primer fotograma incluye cargar el modelo: para estimar se cuenta
    // solo la inferencia (r.ms) y la búsqueda/lectura del fotograma.
    const tEntrada = performance.now();
    const rgba0 = await entrada(0);
    const msEntrada = performance.now() - tEntrada;
    const primero = await principal(rgba0);
    mascaras.set(0, reescalarMascara(primero.mascara, LADO_MODELO, L));

    // Sin WebGPU, en PC: 2–4 workers con su propia sesión (paralelo.ts). El
    // paso entre fotogramas clave se decide con el tiempo efectivo por
    // fotograma (lo que tarda uno ÷ nº de workers).
    const nav = navigator as Navigator & { deviceMemory?: number };
    const nWorkers = numeroWorkersRecorte({
      webgpu: primero.proveedor === "webgpu",
      userAgent: nav.userAgent,
      maxTouchPoints: nav.maxTouchPoints,
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
    });
    const claves = indicesClaveSalida(total, pasoInferencia(primero.ms / nWorkers));
    // Tiempo estimado a partir de lo que tardó el primer fotograma (con su búsqueda y lectura).
    const msPorClave = primero.ms + msEntrada;
    const fin = performance.now() + estimarRestanteMs({ msPorClave, clavesPendientes: claves.length - 1, workers: nWorkers, fotogramas: total });
    const restante = () => Math.max(0, Math.round(fin - performance.now()));
    onProgreso?.({ fase: "recortando", hecho: 1, total: claves.length, restanteMs: restante() });
    const dedicados = Array.from({ length: nWorkers - 1 }, () => crearWorkerRecorteDedicado());
    const cortar = () => dedicados.forEach((d) => d.terminar());
    signal?.addEventListener("abort", cortar, { once: true });
    try {
      const ejecutores = [principal, ...dedicados.map((d) => (rgba: Uint8ClampedArray) => d.mascara(rgba))].map(
        (modelo) => async (i: number) => {
          const r = await modelo(await entrada(i));
          abortado(signal);
          mascaras.set(i, reescalarMascara(r.mascara, LADO_MODELO, L));
        },
      );
      await procesarEnPool(claves.slice(1), ejecutores, (_i, hechos) =>
        onProgreso?.({ fase: "recortando", hecho: hechos + 1, total: claves.length, restanteMs: restante() }),
      );
    } catch (e) {
      abortado(signal);
      throw e;
    } finally {
      signal?.removeEventListener("abort", cortar);
      cortar();
    }
    if (nWorkers > 1) console.info("[video-plato] recorte en paralelo", { workers: nWorkers, claves: claves.length });

    // Máscara del fotograma i: interpolada entre claves y suavizada en el
    // tiempo (mismo suavizado por segundo que a 12 fps).
    const alfaMascara = alfaParaFps(ALFA_MASCARA);
    const mascaraDe = (i: number, previa: Float32Array | null) => {
      const { a, b, t } = vecinosClave(i, claves);
      const base = interpolarMascara(mascaras.get(a)!, mascaras.get(b)!, t);
      return suavizarMascara(previa, base, alfaMascara);
    };

    // Encuadre estable para todo el vídeo.
    const cajasCrudas: Array<CajaVideo | null> = [];
    let previa: Float32Array | null = null;
    for (let i = 0; i < total; i++) {
      previa = mascaraDe(i, previa);
      cajasCrudas.push(cajaDeMascara(previa, L, W, H));
    }
    const cajas = suavizarCajas(cajasCrudas, alfaParaFps(ALFA_CAJA));
    if (cajas.length === 0) throw new Error("No se encontró el plato en el vídeo");

    // --- B. Composición de cada fotograma ----------------------------------
    const fr = lienzo(W, H);
    fr.ctx.imageSmoothingQuality = "high";
    const tmpL = lienzo(L, L);
    const tmpG = lienzo(W, H);
    tmpG.ctx.imageSmoothingQuality = "high";
    const temaFondo = TEMAS[tema] ?? TEMAS[FONDO_ACTIVO];
    const fotogramas: Blob[] = [];
    const reutil = lienzosReutilizables();
    const tB = performance.now();
    previa = null;
    try {
    for (let i = 0; i < total; i++) {
      abortado(signal);
      await esperarVisible(signal);
      reutil.reiniciar();
      previa = mascaraDe(i, previa);
      await irA(video, tiempos[i], signal);
      fr.ctx.clearRect(0, 0, W, H);
      fr.ctx.drawImage(video, 0, 0, W, H);

      // Máscara L² → W×H → apertura + gaussiana + umbral (igual que la foto).
      const m8 = aUint8(previa);
      const img = tmpL.ctx.createImageData(L, L);
      for (let p = 0; p < m8.length; p++) {
        const o = p * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = m8[p];
        img.data[o + 3] = 255;
      }
      tmpL.ctx.putImageData(img, 0, 0);
      tmpG.ctx.drawImage(tmpL.c, 0, 0, W, H);
      const g = tmpG.ctx.getImageData(0, 0, W, H).data;
      const gris = new Uint8Array(W * H);
      for (let p = 0; p < gris.length; p++) gris[p] = g[p * 4];
      const alfa = postprocesarMascara(gris, W, H);

      const px = fr.ctx.getImageData(0, 0, W, H);
      for (let p = 0; p < alfa.length; p++) px.data[p * 4 + 3] = alfa[p];
      fr.ctx.putImageData(px, 0, 0);

      const compuesto = componerPlatoEnLienzo(reutil.crear, fr.c, W, H, temaFondo, cajas[i]) as HTMLCanvasElement | null;
      if (!compuesto) throw new Error("No se pudo componer el fotograma");
      fotogramas.push(await aBlob(compuesto, "image/jpeg", 0.92));
      const msPorFotograma = (performance.now() - tB) / (i + 1);
      onProgreso?.({ fase: "componiendo", hecho: i + 1, total, restanteMs: Math.round(msPorFotograma * (total - i - 1) + MS_CODIFICACION) });
    }
    } finally {
      reutil.soltar();
      for (const l of [fr, tmpL, tmpG]) l.c.width = l.c.height = 0;
    }

    // --- C. Codificación -----------------------------------------------------
    abortado(signal);
    onProgreso?.({ fase: "codificando" });
    const tC = performance.now();
    let blob: Blob | null = null;
    let formatoFinal: FormatoVideo = formato;
    try {
      blob = await codificarConWebCodecs(fotogramas, { ancho: PLATO_ANCHO, alto: PLATO_ALTO, signal });
    } catch (e) {
      abortado(signal);
      console.warn("[video-plato] WebCodecs falló; se graba con MediaRecorder", e);
    }
    if (blob) formatoFinal = { mime: "video/mp4", ext: "mp4", contentType: "video/mp4" };
    else blob = await grabarConPausa(fotogramas, formato, signal);
    const ms = Math.round(performance.now() - t0);
    console.info("[video-plato]", {
      fotogramas: total,
      inferencias: claves.length,
      ms,
      msCodificacion: Math.round(performance.now() - tC),
      codificador: blob && formatoFinal !== formato ? "webcodecs" : "mediarecorder",
      formato: formatoFinal.mime,
      kb: Math.round(blob.size / 1024),
    });
    return { blob, formato: formatoFinal, fotogramas: total, inferencias: claves.length, ms, poster: fotogramas[0] };
  } finally {
    liberar();
    lienzosMascara.src = lienzosMascara.dst = null;
  }
}

type PistaLienzo = MediaStreamTrack & { requestFrame?: () => void };

class GrabacionInterrumpida extends Error {}

/**
 * MediaRecorder graba en tiempo real: si la pestaña se oculta a medias, los
 * temporizadores se frenan y el vídeo saldría a trompicones. Se descarta esa
 * grabación, se espera a que la pestaña vuelva y se graba de nuevo (4 s).
 */
async function grabarConPausa(fotogramas: Blob[], formato: FormatoVideo, signal?: AbortSignal): Promise<Blob> {
  for (let intento = 0; ; intento++) {
    await esperarVisible(signal);
    try {
      return await grabar(fotogramas, formato, signal);
    } catch (e) {
      if (e instanceof GrabacionInterrumpida && intento < 5) continue;
      throw e;
    }
  }
}

async function grabar(fotogramas: Blob[], formato: FormatoVideo, signal?: AbortSignal): Promise<Blob> {
  const { c, ctx } = lienzo(PLATO_ANCHO, PLATO_ALTO);
  const decodificar = (b: Blob) => createImageBitmap(b);
  let actual = await decodificar(fotogramas[0]);
  ctx.drawImage(actual, 0, 0);

  // captureStream(0) + requestFrame: un fotograma exacto por dibujo. Si el
  // navegador no tiene requestFrame, captura a FPS_VIDEO.
  let stream = c.captureStream(0);
  let pista = stream.getVideoTracks()[0] as PistaLienzo;
  if (typeof pista?.requestFrame !== "function") {
    stream.getTracks().forEach((t) => t.stop());
    stream = c.captureStream(FPS_VIDEO);
    pista = stream.getVideoTracks()[0] as PistaLienzo;
  }
  const pedir = () => pista.requestFrame?.();

  const rec = new MediaRecorder(stream, { mimeType: formato.mime, videoBitsPerSecond: BITRATE_VIDEO });
  const trozos: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) trozos.push(e.data);
  };
  const parado = new Promise<void>((resolve, reject) => {
    rec.onstop = () => resolve();
    rec.onerror = () => reject(new Error("Error al codificar el vídeo"));
  });
  const intervalo = 1000 / FPS_VIDEO;
  let ocultada = false;
  const alOcultar = () => {
    if (document.visibilityState === "hidden") ocultada = true;
  };
  document.addEventListener("visibilitychange", alOcultar);
  try {
    rec.start(1000);
    const inicio = performance.now();
    pedir();
    for (let i = 1; i < fotogramas.length; i++) {
      const siguiente = await decodificar(fotogramas[i]);
      await dormir(inicio + i * intervalo - performance.now());
      if (signal?.aborted || ocultada) {
        siguiente.close();
        break;
      }
      ctx.drawImage(siguiente, 0, 0);
      pedir();
      actual.close();
      actual = siguiente;
    }
    await dormir(intervalo);
    pedir();
  } finally {
    document.removeEventListener("visibilitychange", alOcultar);
    actual.close();
    if (rec.state !== "inactive") rec.stop();
    await parado.catch(() => undefined);
    stream.getTracks().forEach((t) => t.stop());
  }
  abortado(signal);
  if (ocultada) throw new GrabacionInterrumpida("La pestaña se ocultó mientras se grababa");
  const blob = new Blob(trozos, { type: formato.contentType });
  if (blob.size === 0) throw new Error("El navegador no generó el vídeo");
  return blob;
}
