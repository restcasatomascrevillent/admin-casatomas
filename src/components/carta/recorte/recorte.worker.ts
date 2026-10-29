/// <reference lib="webworker" />
/**
 * Worker del recorte gratis en el navegador: onnxruntime-web con
 * `isnet-general-use` cuantizado (pesos uint8 por canal, ~47 MB). Se carga
 * solo cuando se usa (import dinámico del worker), así no entra en el bundle
 * inicial ni congela la UI.
 *
 * Proveedor: WebGPU si el navegador lo tiene (≈1–2 s en PC) y, si no o si
 * falla / devuelve un mapa vacío, WASM en CPU con 1 hilo (≈13 s en PC; el
 * panel no tiene aislamiento cross-origin, así que no hay hilos).
 *
 * El modelo se guarda en Cache Storage propio (CACHE_MODELO) tras la 1ª
 * descarga; el service worker del panel no lo toca (ni precache ni borrado).
 */
import * as ort from "onnxruntime-web/webgpu";
import { LADO_MODELO, minMaxAUint8, normalizarEntrada } from "./mascaraRecorte";

export const URL_MODELO = "/modelos/isnet-general-use-u8.onnx";
export const CACHE_MODELO = "modelos-recorte-v1";

export type MensajeAlWorker = { tipo: "recortar"; id: number; rgba: Uint8ClampedArray };
export type MensajeDelWorker =
  | { tipo: "descarga"; recibidos: number; total: number }
  | { tipo: "recortando"; id: number }
  | { tipo: "mascara"; id: number; mascara: Uint8Array; ms: number; msCarga: number; desdeCache: boolean; proveedor: Proveedor }
  | { tipo: "error"; id: number; mensaje: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const enviar = (m: MensajeDelWorker, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);

async function descargarModelo(): Promise<{ bytes: ArrayBuffer; desdeCache: boolean }> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE_MODELO);
    const guardado = await cache.match(URL_MODELO);
    if (guardado) return { bytes: await guardado.arrayBuffer(), desdeCache: true };
  } catch {
    cache = null; // Sin Cache Storage (modo privado…): se descarga cada vez.
  }
  const res = await fetch(URL_MODELO);
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar el modelo (${res.status})`);
  const total = Number(res.headers.get("Content-Length")) || 46_731_330;
  const lector = res.body.getReader();
  const trozos: Uint8Array[] = [];
  let recibidos = 0;
  let ultimo = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    trozos.push(value);
    recibidos += value.length;
    if (recibidos - ultimo > 512 * 1024) {
      ultimo = recibidos;
      enviar({ tipo: "descarga", recibidos, total });
    }
  }
  enviar({ tipo: "descarga", recibidos, total: recibidos });
  const bytes = new Uint8Array(recibidos);
  let o = 0;
  for (const t of trozos) {
    bytes.set(t, o);
    o += t.length;
  }
  if (cache) {
    try {
      await cache.put(URL_MODELO, new Response(bytes.slice().buffer, { headers: { "Content-Type": "application/octet-stream" } }));
    } catch {
      /* cuota llena: se volverá a bajar la próxima vez */
    }
  }
  return { bytes: bytes.buffer, desdeCache: false };
}

export type Proveedor = "webgpu" | "wasm";

let sesion: Promise<{ s: ort.InferenceSession; msCarga: number; desdeCache: boolean; proveedor: Proveedor }> | null = null;
let sinWebgpu = false;
let modelo: { bytes: ArrayBuffer; desdeCache: boolean } | null = null;

async function hayWebgpu(): Promise<boolean> {
  if (sinWebgpu) return false;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

function cargarSesion() {
  if (!sesion) {
    sesion = (async () => {
      const t0 = performance.now();
      // Hilos solo con aislamiento cross-origin (el panel no lo tiene: 1 hilo).
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      modelo ??= await descargarModelo();
      const { bytes, desdeCache } = modelo;
      const opciones = { graphOptimizationLevel: "all" as const };
      if (await hayWebgpu()) {
        try {
          const s = await ort.InferenceSession.create(bytes, { ...opciones, executionProviders: ["webgpu"] });
          return { s, msCarga: performance.now() - t0, desdeCache, proveedor: "webgpu" as const };
        } catch (e) {
          console.warn("[recorte] WebGPU no disponible, se usa WASM", e);
          sinWebgpu = true;
        }
      }
      const s = await ort.InferenceSession.create(bytes, { ...opciones, executionProviders: ["wasm"] });
      return { s, msCarga: performance.now() - t0, desdeCache, proveedor: "wasm" as const };
    })();
    sesion.catch(() => {
      sesion = null; // reintentar en la próxima petición
    });
  }
  return sesion;
}

// Las peticiones se atienden en orden (una inferencia cada vez).
let cola: Promise<void> = Promise.resolve();

ctx.onmessage = (ev: MessageEvent<MensajeAlWorker>) => {
  const m = ev.data;
  if (m.tipo !== "recortar") return;
  cola = cola.then(async () => {
    try {
      const entrada = normalizarEntrada(m.rgba);
      for (let intento = 0; ; intento++) {
        const { s, msCarga, desdeCache, proveedor } = await cargarSesion();
        enviar({ tipo: "recortando", id: m.id });
        const t0 = performance.now();
        try {
          const salida = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", entrada, [1, 3, LADO_MODELO, LADO_MODELO]) });
          const tensor = salida[s.outputNames[0]];
          const pred = (tensor.location === "gpu-buffer" ? await tensor.getData() : tensor.data) as Float32Array;
          const mascara = minMaxAUint8(pred);
          // GPU con drivers raros: NaN o mapa plano → repetir en CPU.
          if (proveedor === "webgpu" && !mascara.some((v) => v > 127)) throw new Error("Máscara vacía en WebGPU");
          enviar({ tipo: "mascara", id: m.id, mascara, ms: performance.now() - t0, msCarga, desdeCache, proveedor }, [mascara.buffer]);
          return;
        } catch (e) {
          if (proveedor !== "webgpu" || intento > 0) throw e;
          console.warn("[recorte] fallo en WebGPU, se repite en WASM", e);
          sinWebgpu = true;
          sesion = null;
        }
      }
    } catch (e) {
      enviar({ tipo: "error", id: m.id, mensaje: (e as Error)?.message || String(e) });
    }
  });
};
