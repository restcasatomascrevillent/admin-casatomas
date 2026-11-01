/**
 * Quitar el fondo GRATIS en el navegador (isnet-general-use en un Web Worker
 * con onnxruntime-web). El worker y el runtime se crean al primer uso.
 *
 *   quitarFondoNavegador(foto, onProgreso) → PNG RGBA (el «sticker»).
 *
 * Progreso: { fase: "descargando", pct } solo la 1ª vez (luego sale de Cache
 * Storage), { fase: "cargando" } al preparar el modelo, { fase: "recortando" }.
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
let sigId = 1;
const pendientes = new Map<
  number,
  { ok: (m: { mascara: Uint8Array; ms: number; desdeCache: boolean; proveedor: Proveedor }) => void; ko: (e: Error) => void; onProgreso?: (p: ProgresoRecorte) => void }
>();

function obtenerWorker(): Worker {
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
  });
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

  onProgreso?.({ fase: "cargando" });
  const res = await mascaraModelo(rgba, onProgreso);

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
