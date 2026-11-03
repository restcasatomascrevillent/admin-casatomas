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
 * Descarga con un solo buffer y sin retener los bytes tras crear la sesión:
 * ver descargaModelo.ts (memoria en iPhone, 03-11-2026).
 */
import * as ort from "onnxruntime-web/webgpu";
import { LADO_MODELO, minMaxAUint8, normalizarEntrada } from "./mascaraRecorte";
import { CACHE_MODELO, URL_MODELO } from "./modeloRecorte";
import { descargarModelo } from "./descargaModelo";

export { CACHE_MODELO, URL_MODELO };

export type MensajeAlWorker =
  | { tipo: "recortar"; id: number; rgba: Uint8ClampedArray }
  /** Precarga en segundo plano: baja (y guarda) el modelo y prepara el motor sin recortar nada. */
  | { tipo: "precargar" };
export type MensajeDelWorker =
  | { tipo: "descarga"; recibidos: number; total: number }
  | { tipo: "precargado"; ok: boolean; desdeCache: boolean; mensaje?: string }
  | { tipo: "recortando"; id: number }
  | { tipo: "mascara"; id: number; mascara: Uint8Array; ms: number; msCarga: number; desdeCache: boolean; proveedor: Proveedor }
  /** `nombre`: el `name` del error (ErrorDescargaModelo, RangeError…) para saber la causa. */
  | { tipo: "error"; id: number; mensaje: string; nombre?: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const enviar = (m: MensajeDelWorker, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);

/** «low» mientras se precarga en segundo plano: no compite con lo que pide la pantalla. */
let prioridadDescarga: "low" | "auto" = "auto";

/** Descarga (o lee de la caché) con un solo buffer y avisa del progreso cada ~512 KB. */
function traerModelo() {
  let ultimo = 0;
  return descargarModelo(URL_MODELO, {
    abrirCache: () => caches.open(CACHE_MODELO),
    prioridad: prioridadDescarga,
    alProgreso: (recibidos, total) => {
      if (recibidos - ultimo < 512 * 1024 && recibidos < total) return;
      ultimo = recibidos;
      enviar({ tipo: "descarga", recibidos, total });
    },
  });
}

export type Proveedor = "webgpu" | "wasm";

let sesion: Promise<{ s: ort.InferenceSession; msCarga: number; desdeCache: boolean; proveedor: Proveedor }> | null = null;
let sinWebgpu = false;

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
      // Los bytes del modelo solo viven aquí: en cuanto hay sesión (ORT ya los
      // copió a su memoria) se sueltan. Para recrearla se vuelven a leer de la
      // caché (antes quedaban 47 MB vivos para siempre en `modelo`).
      const modelo: { bytes: Uint8Array | null; desdeCache: boolean } = await traerModelo();
      const desdeCache = modelo.desdeCache;
      try {
        const opciones = { graphOptimizationLevel: "all" as const };
        if (await hayWebgpu()) {
          try {
            const s = await ort.InferenceSession.create(modelo.bytes!, { ...opciones, executionProviders: ["webgpu"] });
            return { s, msCarga: performance.now() - t0, desdeCache, proveedor: "webgpu" as const };
          } catch (e) {
            console.warn("[recorte] WebGPU no disponible, se usa WASM", e);
            sinWebgpu = true;
          }
        }
        const s = await ort.InferenceSession.create(modelo.bytes!, { ...opciones, executionProviders: ["wasm"] });
        return { s, msCarga: performance.now() - t0, desdeCache, proveedor: "wasm" as const };
      } finally {
        modelo.bytes = null;
      }
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
  if (m.tipo === "precargar") {
    // Fuera de la cola: si llega una foto mientras tanto, espera a la MISMA
    // carga (cargarSesion la comparte) en vez de bajar el modelo otra vez.
    prioridadDescarga = "low";
    cargarSesion()
      .then((r) => enviar({ tipo: "precargado", ok: true, desdeCache: r.desdeCache }))
      .catch((e) => enviar({ tipo: "precargado", ok: false, desdeCache: false, mensaje: (e as Error)?.message || String(e) }))
      .finally(() => {
        prioridadDescarga = "auto";
      });
    return;
  }
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
      enviar({ tipo: "error", id: m.id, mensaje: (e as Error)?.message || String(e), nombre: (e as Error)?.name });
    }
  });
};
