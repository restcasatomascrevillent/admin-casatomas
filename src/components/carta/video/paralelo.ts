/**
 * Recorte de los fotogramas del vídeo en paralelo (lógica pura, sin DOM).
 *
 * Sin WebGPU el modelo va en CPU con 1 hilo por worker (el panel no tiene
 * aislamiento cross-origin: no hay hilos dentro de un worker). En un PC con
 * varios núcleos se pueden tener 2–4 workers, cada uno con su sesión del
 * modelo, y repartir los fotogramas clave entre ellos. Con WebGPU no se gana
 * nada (la GPU es una sola) y en móvil la memoria no da (cada sesión son
 * cientos de MB): 1 worker.
 */

export interface InfoDispositivo {
  userAgent?: string;
  maxTouchPoints?: number;
  /** GB aproximados (`navigator.deviceMemory`, solo Chromium; máx. 8). */
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export const MAX_WORKERS_RECORTE = 4;

/** Móvil o tablet (UA móvil, iPad que se presenta como Mac) o con ≤ 4 GB de memoria. */
export function esDispositivoMovil(info: InfoDispositivo): boolean {
  const ua = info.userAgent ?? "";
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
  if (/Macintosh/i.test(ua) && (info.maxTouchPoints ?? 0) > 1) return true;
  return typeof info.deviceMemory === "number" && info.deviceMemory <= 4;
}

/**
 * Nº de workers del recorte: 1 con WebGPU o en móvil; si no, la mitad de los
 * núcleos lógicos (deja sitio al hilo principal, que busca y compone), con
 * tope por memoria (8 GB → 4, 6 GB → 3, desconocida → 2) y como mucho 4.
 */
export function numeroWorkersRecorte(info: InfoDispositivo & { webgpu: boolean }): number {
  if (info.webgpu || esDispositivoMovil(info)) return 1;
  const nucleos = info.hardwareConcurrency && info.hardwareConcurrency > 0 ? info.hardwareConcurrency : 2;
  const porCpu = Math.floor(nucleos / 2);
  const mem = info.deviceMemory;
  const porMemoria = typeof mem !== "number" ? 2 : mem >= 8 ? 4 : mem >= 6 ? 3 : 2;
  return Math.max(1, Math.min(MAX_WORKERS_RECORTE, porCpu, porMemoria));
}

/**
 * Reparte `indices` entre `ejecutores` (cada uno procesa uno cada vez y, al
 * acabar, coge el siguiente libre: así un worker lento no retrasa a los
 * demás). Devuelve los resultados POR ÍNDICE (el orden de llegada no importa:
 * quien los use los recorre en orden). Al primer error se deja de repartir y
 * se lanza ese error cuando los que estaban en marcha terminan.
 */
export async function procesarEnPool<T>(
  indices: readonly number[],
  ejecutores: ReadonlyArray<(i: number) => Promise<T>>,
  onHecho?: (i: number, hechos: number) => void,
): Promise<Map<number, T>> {
  if (ejecutores.length === 0) throw new Error("Sin ejecutores");
  const resultados = new Map<number, T>();
  let siguiente = 0;
  let fallo: { e: unknown } | null = null;
  const bucle = async (ejecutar: (i: number) => Promise<T>) => {
    while (!fallo && siguiente < indices.length) {
      const i = indices[siguiente++];
      try {
        resultados.set(i, await ejecutar(i));
        onHecho?.(i, resultados.size);
      } catch (e) {
        fallo ??= { e };
      }
    }
  };
  await Promise.all(ejecutores.map(bucle));
  if (fallo) throw (fallo as { e: unknown }).e;
  return resultados;
}

/** Serializa tareas (p. ej. buscar en el único <video> y leer el fotograma). */
export function crearMutex() {
  let cola: Promise<unknown> = Promise.resolve();
  return <R>(tarea: () => Promise<R>): Promise<R> => {
    const r = cola.then(tarea, tarea);
    cola = r.catch(() => undefined);
    return r;
  };
}
