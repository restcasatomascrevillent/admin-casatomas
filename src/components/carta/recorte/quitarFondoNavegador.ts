/**
 * Quitar el fondo GRATIS en el navegador (isnet-general-use en un Web Worker
 * con onnxruntime-web). El worker y el runtime se crean al primer uso.
 *
 *   quitarFondoNavegador(foto, onProgreso) → PNG RGBA (el «sticker»).
 *
 * Progreso: { fase: "descargando", pct } solo la 1ª vez (luego sale de Cache
 * Storage), { fase: "cargando" } al preparar el modelo, { fase: "recortando" }.
 *
 * MEMORIA (fallo «subo una foto y se me cierra», 2026-11-01): el modelo pesa
 * 47 MB y recortar a 1024×1024 pide cientos de MB más dentro del worker. En un
 * móvil o una tablet eso basta para que el sistema mate la pestaña (iOS la
 * recarga, Android también si va justo de memoria; peor aún al abrir la cámara
 * con la pestaña en segundo plano): la página se «cierra» sola y la foto se
 * pierde. Por eso:
 *   - `recorteNavegadorSeguro()` dice si este dispositivo es un ordenador con
 *     memoria (recorta en el formulario). En móvil/tablet el modelo NO se
 *     ejecuta en el navegador: desde el 03-11-2026 el fondo lo quita el
 *     servidor después de guardar (quitarFondoServidor.ts, api/recortar-foto.ts).
 *   - El worker se TERMINA tras un rato sin uso (`MS_WORKER_INACTIVO`) para
 *     devolver esa memoria; antes vivía para siempre con el modelo cargado.
 *
 * MEDIDAS (02-11-2026; onnxruntime-web 1.30, WASM de 1 hilo, Node 22 en un
 * servidor de 4 núcleos; el iPhone no se puede medir desde aquí) y por qué el
 * móvil recorta DESPUÉS de guardar y no en el formulario:
 *   - El modelo pesa 44,6 MB y su entrada es FIJA, 1×3×1024×1024: a 768, 512 o
 *     384 ORT responde «invalid dimensions». No hay «resolución de trabajo
 *     menor» para el móvil sin reexportar el modelo (LADO_TRABAJO_FOTO solo
 *     afecta a la limpieza de la máscara, que pesa poco).
 *   - Memoria: 311 MB con la sesión creada y pico de 814 MB tras una
 *     inferencia, sin contar la página, la foto decodificada ni los 47 MB del
 *     modelo que guarda el worker. Cerca de 1 GB por pestaña.
 *   - Tiempo: 17-19 s por foto en un núcleo de servidor.
 *   Con eso una pestaña de iPhone/iPad puede ser cerrada por el sistema (pasó
 *   el 01-11-2026, y la foto se perdía). Por eso el móvil manda la foto al
 *   servidor (docs/recorte-servidor.md).
 *
 * PRECARGA (petición del dueño, 2026-11-01): `precargarRecorte()` baja el
 * modelo (47 MB, a Cache Storage) y el motor (wasm de onnxruntime, ~27 MB, a la
 * caché HTTP: /assets es inmutable) en segundo plano al entrar al panel, para
 * que la primera foto no tenga que esperar la descarga. Solo donde el recorte
 * se hace en el navegador, sin ahorro de datos ni conexión lenta, y una vez:
 * si el modelo ya está guardado no hace nada. Lo lanza <PrecargaRecorte />.
 */
import type { MensajeAlWorker, MensajeDelWorker, Proveedor } from "./recorte.worker";
import { LADO_MODELO } from "./mascaraRecorte";
import { aplicarCoeficientes, coeficientesGuiado, entradaGuiado, limpiarMascara, luminancia, medidasTrabajo } from "./refinarMascara";
import { CACHE_MODELO, URL_MODELO } from "./modeloRecorte";
import { diag, memoriaDiag } from "./diagnostico";

export type ProgresoRecorte =
  /** `recibidos`/`total` en bytes (para «23/47 MB»). */
  | { fase: "descargando"; pct: number; recibidos?: number; total?: number }
  | { fase: "cargando" }
  | { fase: "recortando" };

export interface MedidaRecorte {
  /** Inferencia del modelo (ms). */
  msModelo: number;
  /** Total de la llamada, incluida la carga del modelo (ms). */
  msTotal: number;
  desdeCache: boolean;
  proveedor: Proveedor;
}

/** Última medida (diagnóstico en consola / pruebas). */
export let ultimaMedida: MedidaRecorte | null = null;

let worker: Worker | null = null;
/** Precarga lanzada en esta pestaña (una vez por carga del panel). */
let precargaLanzada = false;
/** El worker está bajando el modelo para la precarga: no terminarlo a medias. */
let precargaEnCurso = false;
let temporizadorInactivo: ReturnType<typeof setTimeout> | null = null;
let sigId = 1;

/** Tras este tiempo sin recortes se termina el worker (libera modelo y memoria del runtime). */
export const MS_WORKER_INACTIVO = 60_000;
const pendientes = new Map<
  number,
  { ok: (m: { mascara: Uint8Array; ms: number; desdeCache: boolean; proveedor: Proveedor }) => void; ko: (e: Error) => void; onProgreso?: (p: ProgresoRecorte) => void }
>();

/** Termina el worker ya (si no hay recortes ni precarga en marcha) y suelta su memoria. */
export function liberarWorkerRecorte(): void {
  if (temporizadorInactivo) clearTimeout(temporizadorInactivo);
  temporizadorInactivo = null;
  if (!worker || pendientes.size > 0 || precargaEnCurso) return;
  worker.terminate();
  worker = null;
}

function programarLiberacion(): void {
  if (temporizadorInactivo) clearTimeout(temporizadorInactivo);
  temporizadorInactivo = setTimeout(liberarWorkerRecorte, MS_WORKER_INACTIVO);
}

function obtenerWorker(): Worker {
  if (temporizadorInactivo) clearTimeout(temporizadorInactivo);
  temporizadorInactivo = null;
  if (worker) return worker;
  const w = new Worker(new URL("./recorte.worker.ts", import.meta.url), { type: "module", name: "recorte-vino" });
  w.onmessage = (ev: MessageEvent<MensajeDelWorker>) => {
    const m = ev.data;
    if (m.tipo === "descarga") {
      const pct = m.total > 0 ? Math.min(100, Math.round((m.recibidos / m.total) * 100)) : 0;
      // La descarga es compartida: avisar a todas las peticiones en espera.
      pendientes.forEach((p) => p.onProgreso?.({ fase: "descargando", pct, recibidos: m.recibidos, total: m.total }));
      return;
    }
    if (m.tipo === "precargado") {
      precargaEnCurso = false;
      if (!m.ok) console.info("[recorte] la precarga del modelo no ha podido terminar:", m.mensaje);
      // Precargado y sin fotos en marcha: fuera el worker en un rato (el modelo
      // y el motor ya quedan guardados en el navegador).
      if (pendientes.size === 0) programarLiberacion();
      return;
    }
    const p = pendientes.get(m.id);
    if (!p) return;
    if (m.tipo === "recortando") p.onProgreso?.({ fase: "recortando" });
    else if (m.tipo === "mascara") {
      pendientes.delete(m.id);
      p.ok({ mascara: m.mascara, ms: m.ms, desdeCache: m.desdeCache, proveedor: m.proveedor });
    } else if (m.tipo === "error") {
      pendientes.delete(m.id);
      p.ko(errorDelWorker(m));
    }
  };
  w.onerror = (ev) => {
    const e = new Error(ev.message || "Error en el worker de recorte");
    pendientes.forEach((p) => p.ko(e));
    pendientes.clear();
    precargaEnCurso = false;
    w.terminate();
    worker = null;
  };
  worker = w;
  return w;
}

/** Error del worker con su `name` original (ErrorDescargaModelo, RangeError…): de ahí sale la causa del fallo. */
function errorDelWorker(m: { mensaje: string; nombre?: string }): Error {
  const e = new Error(m.mensaje);
  if (m.nombre) e.name = m.nombre;
  return e;
}

function lienzo(ancho: number, alto: number) {
  const c = document.createElement("canvas");
  c.width = ancho;
  c.height = alto;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas no disponible");
  return { c, ctx };
}

function aBlob(c: HTMLCanvasElement, tipo: string): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo generar la imagen"))), tipo),
  );
}

/** true si el navegador puede intentarlo (Worker módulo + WebAssembly). */
export function recorteNavegadorDisponible(): boolean {
  return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined" && typeof document !== "undefined";
}

/** Memoria mínima (GB, `navigator.deviceMemory`, solo Chrome) para recortar en el navegador. */
const MEMORIA_MINIMA_GB = 8;

/**
 * true si en ESTE dispositivo es seguro recortar en el navegador: no es un
 * móvil ni una tablet (ni un iPad que se presenta como Mac) y, si el navegador
 * dice cuánta memoria tiene, tiene al menos 8 GB. En otro caso el recorte se
 * hace después de guardar (ver cabecera: en móvil el modelo tumbaba la pestaña).
 */
export function recorteNavegadorSeguro(nav: Navigator | undefined = typeof navigator !== "undefined" ? navigator : undefined): boolean {
  if (!recorteNavegadorDisponible() || !nav) return false;
  const ua = nav.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return false;
  // iPadOS se identifica como «Macintosh»; se le reconoce por la pantalla táctil.
  if (/Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return false;
  const memoria = (nav as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof memoria === "number" && memoria < MEMORIA_MINIMA_GB) return false;
  try {
    // Pantalla táctil sin ratón como puntero principal (tablets con UA de escritorio).
    if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse) and (hover: none)").matches) return false;
  } catch {
    /* sin matchMedia: se decide por lo anterior */
  }
  return true;
}

/** ¿Ya está el modelo guardado en este navegador? (sin Cache Storage: no). */
export async function modeloRecorteGuardado(): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    const cache = await caches.open(CACHE_MODELO);
    return Boolean(await cache.match(URL_MODELO));
  } catch {
    return false;
  }
}

type ConexionRed = { saveData?: boolean; effectiveType?: string };

/**
 * Precarga en segundo plano el modelo y el motor del recorte (ver cabecera).
 * Devuelve true si la ha lanzado; false si no toca: ya lanzada en esta pestaña,
 * dispositivo donde el recorte no se hace en el navegador (móvil, tablet, poca
 * memoria), ahorro de datos o conexión 2G, o el modelo ya está guardado.
 */
export async function precargarRecorte(
  nav: Navigator | undefined = typeof navigator !== "undefined" ? navigator : undefined,
): Promise<boolean> {
  if (precargaLanzada || !nav || !recorteNavegadorSeguro(nav)) return false;
  const conexion = (nav as Navigator & { connection?: ConexionRed }).connection;
  if (conexion?.saveData || /(^|-)2g$/.test(conexion?.effectiveType ?? "")) return false;
  precargaLanzada = true;
  if (await modeloRecorteGuardado()) return false;
  // Si mientras tanto alguien ya está recortando, el worker ya lo está bajando.
  if (pendientes.size > 0) return false;
  precargaEnCurso = true;
  const msg: MensajeAlWorker = { tipo: "precargar" };
  obtenerWorker().postMessage(msg);
  return true;
}

/** Solo para pruebas: vuelve al estado de una pestaña recién abierta. */
export function _reiniciarPrecargaParaPruebas(): void {
  precargaLanzada = false;
  precargaEnCurso = false;
  if (temporizadorInactivo) clearTimeout(temporizadorInactivo);
  temporizadorInactivo = null;
  worker?.terminate();
  worker = null;
}

export interface MascaraModelo {
  /** Mapa LADO_MODELO² en 0–255 (sin postprocesar). */
  mascara: Uint8Array;
  /** Inferencia (ms). */
  ms: number;
  desdeCache: boolean;
  proveedor: Proveedor;
}

/**
 * Máscara cruda del modelo para una entrada RGBA LADO_MODELO² (se transfiere:
 * el buffer queda inservible). La usa también el vídeo del plato.
 */
export function mascaraModelo(rgba: Uint8ClampedArray, onProgreso?: (p: ProgresoRecorte) => void): Promise<MascaraModelo> {
  if (!recorteNavegadorDisponible()) return Promise.reject(new Error("Este navegador no puede recortar"));
  const id = sigId++;
  return new Promise<MascaraModelo>((ok, ko) => {
    pendientes.set(id, { ok, ko, onProgreso });
    const msg: MensajeAlWorker = { tipo: "recortar", id, rgba };
    obtenerWorker().postMessage(msg, [rgba.buffer]);
  }).finally(() => {
    // Sin más recortes en un rato, fuera el worker (y su memoria).
    if (pendientes.size === 0) programarLiberacion();
  });
}

/**
 * Lado mayor al que se limpia la máscara y se calculan los coeficientes del
 * filtro guiado de la foto; el alfa final se aplica a la resolución completa.
 */
export const LADO_TRABAJO_FOTO = 1600;

/** Foto → PNG sin fondo: modelo + limpieza + filtro guiado (alfa suave, conserva antenas y patas finas). */
export async function quitarFondoNavegador(foto: Blob, onProgreso?: (p: ProgresoRecorte) => void): Promise<Blob> {
  if (!recorteNavegadorDisponible()) throw new Error("Este navegador no puede recortar");
  const t0 = performance.now();
  const bmp = await createImageBitmap(foto);
  const { width: ancho, height: alto } = bmp;
  diag("recorte local: foto decodificada", { foto, lienzo: `${ancho}x${alto}`, entrada: `${LADO_MODELO}x${LADO_MODELO}`, ...memoriaDiag() });

  // Entrada 1024×1024 (la deformación es la misma que hace rembg).
  const ent = lienzo(LADO_MODELO, LADO_MODELO);
  ent.ctx.imageSmoothingQuality = "high";
  ent.ctx.drawImage(bmp, 0, 0, LADO_MODELO, LADO_MODELO);
  const rgba = ent.ctx.getImageData(0, 0, LADO_MODELO, LADO_MODELO).data;

  onProgreso?.({ fase: "cargando" });
  let res: MascaraModelo;
  try {
    res = await mascaraModelo(rgba, onProgreso);
  } catch (e) {
    bmp.close();
    diag("recorte local: fallo del modelo", { nombre: (e as Error)?.name, mensaje: (e as Error)?.message, ...memoriaDiag() });
    throw e;
  }
  diag("recorte local: modelo hecho", { proveedor: res.proveedor, ms: Math.round(res.ms), desdeCache: res.desdeCache, ...memoriaDiag() });

  // Máscara 1024² → resolución de trabajo (≤ LADO_TRABAJO_FOTO) → limpieza +
  // filtro guiado con la propia foto → alfa a resolución completa
  // (refinarMascara.ts; antes: apertura + gaussiana + umbral de rembg, que
  // borraba antenas y patas finas y dejaba el borde en escalera).
  const tr = medidasTrabajo(ancho, alto, LADO_TRABAJO_FOTO);
  const m = lienzo(LADO_MODELO, LADO_MODELO);
  const img = m.ctx.createImageData(LADO_MODELO, LADO_MODELO);
  for (let i = 0; i < res.mascara.length; i++) {
    const o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = res.mascara[i];
    img.data[o + 3] = 255;
  }
  m.ctx.putImageData(img, 0, 0);
  const trab = lienzo(tr.ancho, tr.alto);
  trab.ctx.imageSmoothingQuality = "high";
  trab.ctx.drawImage(m.c, 0, 0, tr.ancho, tr.alto);
  const grande = trab.ctx.getImageData(0, 0, tr.ancho, tr.alto).data;
  const gris = new Uint8Array(tr.ancho * tr.alto);
  for (let i = 0; i < gris.length; i++) gris[i] = grande[i * 4];
  trab.ctx.clearRect(0, 0, tr.ancho, tr.alto);
  trab.ctx.drawImage(bmp, 0, 0, tr.ancho, tr.alto);
  const guia = trab.ctx.getImageData(0, 0, tr.ancho, tr.alto).data;
  const limpia = limpiarMascara(gris, tr.ancho, tr.alto);
  const coef = coeficientesGuiado(luminancia(guia, gris.length), entradaGuiado(limpia), tr.ancho, tr.alto);
  trab.c.width = trab.c.height = 0;

  // Recorte: la foto con el alfa refinado (escrito en el canal 3).
  const sal = lienzo(ancho, alto);
  sal.ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const px = sal.ctx.getImageData(0, 0, ancho, alto);
  const opacos = aplicarCoeficientes(coef, tr.ancho, tr.alto, px.data, ancho, alto);
  if (opacos < ancho * alto * 0.01) throw new Error("No se encontró la botella en la foto");
  sal.ctx.putImageData(px, 0, 0);
  const png = await aBlob(sal.c, "image/png");

  ultimaMedida = {
    msModelo: Math.round(res.ms),
    msTotal: Math.round(performance.now() - t0),
    desdeCache: res.desdeCache,
    proveedor: res.proveedor,
  };
  console.info("[recorte-navegador]", ultimaMedida, `${ancho}x${alto}`);
  return png;
}

export interface WorkerRecorteDedicado {
  mascara(rgba: Uint8ClampedArray): Promise<MascaraModelo>;
  terminar(): void;
}

/**
 * Worker del recorte APARTE del compartido, con su propia sesión del modelo
 * (lo lee de Cache Storage si ya se bajó). Para repartir fotogramas del vídeo
 * en paralelo en PC sin WebGPU (video/paralelo.ts). Hay que terminarlo al
 * acabar: cada sesión ocupa cientos de MB.
 */
export function crearWorkerRecorteDedicado(): WorkerRecorteDedicado {
  const w = new Worker(new URL("./recorte.worker.ts", import.meta.url), { type: "module", name: "recorte-video" });
  const espera = new Map<number, { ok: (m: MascaraModelo) => void; ko: (e: Error) => void }>();
  let id = 1;
  const fallarTodo = (e: Error) => {
    espera.forEach((p) => p.ko(e));
    espera.clear();
  };
  w.onmessage = (ev: MessageEvent<MensajeDelWorker>) => {
    const m = ev.data;
    if (m.tipo !== "mascara" && m.tipo !== "error") return;
    const p = espera.get(m.id);
    if (!p) return;
    espera.delete(m.id);
    if (m.tipo === "mascara") p.ok({ mascara: m.mascara, ms: m.ms, desdeCache: m.desdeCache, proveedor: m.proveedor });
    else p.ko(errorDelWorker(m));
  };
  w.onerror = (ev) => fallarTodo(new Error(ev.message || "Error en el worker de recorte"));
  return {
    mascara(rgba) {
      const n = id++;
      return new Promise<MascaraModelo>((ok, ko) => {
        espera.set(n, { ok, ko });
        const msg: MensajeAlWorker = { tipo: "recortar", id: n, rgba };
        w.postMessage(msg, [rgba.buffer]);
      });
    },
    terminar() {
      fallarTodo(new DOMException("Cancelado", "AbortError") as unknown as Error);
      w.terminate();
    },
  };
}
