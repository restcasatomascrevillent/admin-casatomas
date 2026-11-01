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
 *   - `recorteNavegadorSeguro()` dice si este dispositivo puede intentarlo
 *     (escritorio con memoria); en móvil/tablet `quitarFondo` va directo a
 *     Replicate (fotoCartaVino.ts) y, si no hay, se guarda la foto normal.
 *   - El worker se TERMINA tras un rato sin uso (`MS_WORKER_INACTIVO`) para
 *     devolver esa memoria; antes vivía para siempre con el modelo cargado.
 */
import type { MensajeAlWorker, MensajeDelWorker, Proveedor } from "./recorte.worker";
import { LADO_MODELO, postprocesarMascara } from "./mascaraRecorte";

export type ProgresoRecorte =
  | { fase: "descargando"; pct: number }
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
let temporizadorInactivo: ReturnType<typeof setTimeout> | null = null;
let sigId = 1;

/** Tras este tiempo sin recortes se termina el worker (libera modelo y memoria del runtime). */
export const MS_WORKER_INACTIVO = 60_000;
const pendientes = new Map<
  number,
  { ok: (m: { mascara: Uint8Array; ms: number; desdeCache: boolean; proveedor: Proveedor }) => void; ko: (e: Error) => void; onProgreso?: (p: ProgresoRecorte) => void }
>();

/** Termina el worker ya (si no hay recortes pendientes) y suelta su memoria. */
export function liberarWorkerRecorte(): void {
  if (temporizadorInactivo) clearTimeout(temporizadorInactivo);
  temporizadorInactivo = null;
  if (!worker || pendientes.size > 0) return;
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
      pendientes.forEach((p) => p.onProgreso?.({ fase: "descargando", pct }));
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
      p.ko(new Error(m.mensaje));
    }
  };
  w.onerror = (ev) => {
    const e = new Error(ev.message || "Error en el worker de recorte");
    pendientes.forEach((p) => p.ko(e));
    pendientes.clear();
    w.terminate();
    worker = null;
  };
  worker = w;
  return w;
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
 * dice cuánta memoria tiene, tiene al menos 8 GB. En otro caso el recorte va a
 * Replicate (ver cabecera: en móvil el modelo tumbaba la pestaña).
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

/** Foto → PNG con la botella sin fondo (máscara binaria con borde suavizado, como rembg). */
export async function quitarFondoNavegador(foto: Blob, onProgreso?: (p: ProgresoRecorte) => void): Promise<Blob> {
  if (!recorteNavegadorDisponible()) throw new Error("Este navegador no puede recortar");
  const t0 = performance.now();
  const bmp = await createImageBitmap(foto);
  const { width: ancho, height: alto } = bmp;

  // Entrada 1024×1024 (la deformación es la misma que hace rembg).
  const ent = lienzo(LADO_MODELO, LADO_MODELO);
  ent.ctx.imageSmoothingQuality = "high";
  ent.ctx.drawImage(bmp, 0, 0, LADO_MODELO, LADO_MODELO);
  const rgba = ent.ctx.getImageData(0, 0, LADO_MODELO, LADO_MODELO).data;

  const id = sigId++;
  onProgreso?.({ fase: "cargando" });
  let res: { mascara: Uint8Array; ms: number; desdeCache: boolean; proveedor: Proveedor };
  try {
    res = await new Promise<{ mascara: Uint8Array; ms: number; desdeCache: boolean; proveedor: Proveedor }>((ok, ko) => {
      pendientes.set(id, { ok, ko, onProgreso });
      const msg: MensajeAlWorker = { tipo: "recortar", id, rgba };
      obtenerWorker().postMessage(msg, [rgba.buffer]);
    });
  } catch (e) {
    bmp.close();
    throw e;
  } finally {
    // Sin más recortes en un rato, fuera el worker (y su memoria).
    if (pendientes.size === 0) programarLiberacion();
  }

  // Máscara 1024² → tamaño de la foto (suavizado del canvas) → post_process.
  const m = lienzo(LADO_MODELO, LADO_MODELO);
  const img = m.ctx.createImageData(LADO_MODELO, LADO_MODELO);
  for (let i = 0; i < res.mascara.length; i++) {
    const o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = res.mascara[i];
    img.data[o + 3] = 255;
  }
  m.ctx.putImageData(img, 0, 0);
  const sal = lienzo(ancho, alto);
  sal.ctx.imageSmoothingQuality = "high";
  sal.ctx.drawImage(m.c, 0, 0, ancho, alto);
  const grande = sal.ctx.getImageData(0, 0, ancho, alto).data;
  const gris = new Uint8Array(ancho * alto);
  for (let i = 0; i < gris.length; i++) gris[i] = grande[i * 4];
  const alfa = postprocesarMascara(gris, ancho, alto);

  // Recorte: la foto con alfa = máscara.
  sal.ctx.clearRect(0, 0, ancho, alto);
  sal.ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const px = sal.ctx.getImageData(0, 0, ancho, alto);
  let opacos = 0;
  for (let i = 0; i < alfa.length; i++) {
    px.data[i * 4 + 3] = alfa[i];
    if (alfa[i]) opacos++;
  }
  if (opacos < alfa.length * 0.01) throw new Error("No se encontró la botella en la foto");
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
