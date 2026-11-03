/**
 * Descarga del modelo del recorte (~47 MB) gastando la MENOR memoria posible.
 * Lógica pura (sin onnxruntime) para poder probarla; la usa recorte.worker.ts.
 *
 * Antes (hasta la v0.137) la descarga guardaba los trozos del stream (47 MB),
 * los copiaba a otro Uint8Array completo (47 MB) y hacía `bytes.slice()` para
 * guardarlo en Cache Storage (47 MB más, y `new Response(buffer)` lo vuelve a
 * copiar): 140-190 MB transitorios justo en el iPhone, el dispositivo con
 * menos margen, antes incluso de crear la sesión de ORT (que copia el modelo
 * a su memoria wasm). Ahora (03-11-2026):
 *   - Con Content-Length se reserva UN Uint8Array de ese tamaño y el stream se
 *     escribe dentro (sin longitud: trozos + una copia, como antes).
 *   - A Cache Storage se le da un stream de VISTAS (`subarray`) del mismo
 *     buffer: no se copia en JS ni se transfiere/neutraliza el buffer que luego
 *     usa ORT (el navegador copia por trozos al guardarlo).
 *   - Quien lo llama suelta los bytes nada más crear la sesión.
 */

/** Tamaño del modelo si el servidor no manda Content-Length (solo para el progreso). */
export const TAMANO_MODELO_APROX = 46_731_330;
/** Trozo con el que se pasa el buffer a Cache Storage. */
const TROZO_CACHE = 1 << 20;

/** Fallo al DESCARGAR (red, HTTP): no es culpa de la memoria del dispositivo. */
export class ErrorDescargaModelo extends Error {
  readonly causa?: unknown;
  constructor(mensaje: string, causa?: unknown) {
    super(mensaje);
    this.name = "ErrorDescargaModelo";
    this.causa = causa;
  }
}

const textoError = (e: unknown) => (e as Error)?.message || String(e);

/** Content-Length útil (sin compresión: si viene comprimido, el stream trae más bytes). */
export function longitudContenido(cabeceras: Headers): number | null {
  const codificacion = (cabeceras.get("Content-Encoding") || "identity").trim().toLowerCase();
  if (codificacion !== "identity") return null;
  const n = Number(cabeceras.get("Content-Length"));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Lee el stream en UN solo Uint8Array. Con `longitud`, lo reserva de entrada y
 * escribe dentro (si el servidor mintió y llega más, crece una vez). Sin
 * longitud, junta los trozos y los copia al final (un pico de 2×).
 */
export async function leerEnUnBuffer(
  cuerpo: ReadableStream<Uint8Array>,
  longitud: number | null,
  alProgreso?: (recibidos: number) => void,
): Promise<Uint8Array> {
  const lector = cuerpo.getReader();
  let recibidos = 0;
  if (longitud) {
    let buf = new Uint8Array(longitud);
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      if (recibidos + value.length > buf.length) {
        const mayor = new Uint8Array(Math.max(recibidos + value.length, Math.ceil(buf.length * 1.25)));
        mayor.set(buf.subarray(0, recibidos));
        buf = mayor;
      }
      buf.set(value, recibidos);
      recibidos += value.length;
      alProgreso?.(recibidos);
    }
    return recibidos === buf.length ? buf : buf.subarray(0, recibidos);
  }
  let trozos: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    trozos.push(value);
    recibidos += value.length;
    alProgreso?.(recibidos);
  }
  const buf = new Uint8Array(recibidos);
  let o = 0;
  for (const t of trozos) {
    buf.set(t, o);
    o += t.length;
  }
  trozos = [];
  return buf;
}

/** Stream de vistas del buffer (sin copiarlo ni neutralizarlo). */
export function streamDeVistas(bytes: Uint8Array, trozo = TROZO_CACHE): ReadableStream<Uint8Array> {
  let o = 0;
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (o >= bytes.length) {
        ctrl.close();
        return;
      }
      const fin = Math.min(o + trozo, bytes.length);
      ctrl.enqueue(bytes.subarray(o, fin));
      o = fin;
    },
  });
}

export interface DependenciasDescarga {
  /** Cache Storage donde se guarda el modelo (null: sin caché, p. ej. modo privado). */
  abrirCache?: () => Promise<Cache | null>;
  fetch?: typeof fetch;
  /** «low» en la precarga en segundo plano. */
  prioridad?: "low" | "auto";
  alProgreso?: (recibidos: number, total: number) => void;
}

const CABECERAS_CACHE = { "Content-Type": "application/octet-stream" };

/** Guarda el modelo en Cache Storage sin copiarlo en JS. Nunca lanza (sin caché se baja otra vez la próxima). */
export async function guardarEnCache(cache: Cache, url: string, bytes: Uint8Array): Promise<boolean> {
  try {
    await cache.put(url, new Response(streamDeVistas(bytes), { headers: CABECERAS_CACHE }));
    return true;
  } catch (e) {
    console.warn("[recorte] Cache Storage no acepta el modelo por stream; se guarda copiándolo", e);
  }
  try {
    // Navegador sin `put` de un stream: copia transitoria (se suelta al acabar).
    await cache.put(url, new Response(bytes, { headers: CABECERAS_CACHE }));
    return true;
  } catch (e) {
    console.warn("[recorte] no se pudo guardar el modelo en Cache Storage (cuota llena?)", e);
    return false;
  }
}

/**
 * Modelo desde Cache Storage o, si no está, descargado (y guardado). Los
 * errores de red/HTTP salen como ErrorDescargaModelo; uno de memoria al
 * reservar el buffer sale tal cual (RangeError).
 */
export async function descargarModelo(url: string, deps: DependenciasDescarga = {}): Promise<{ bytes: Uint8Array; desdeCache: boolean }> {
  let cache: Cache | null = null;
  try {
    cache = (await deps.abrirCache?.()) ?? null;
    const guardado = await cache?.match(url);
    if (guardado) return { bytes: new Uint8Array(await guardado.arrayBuffer()), desdeCache: true };
  } catch (e) {
    if (e instanceof RangeError) throw e;
    cache = null; // Sin Cache Storage (modo privado…): se descarga cada vez.
  }
  const traer = deps.fetch ?? fetch;
  let res: Response;
  try {
    // `priority` (Fetch Priority) aún no está en los tipos de RequestInit de TS.
    res = await traer(url, { priority: deps.prioridad ?? "auto" } as RequestInit);
  } catch (e) {
    throw new ErrorDescargaModelo(`No se pudo descargar el recortador (${textoError(e)})`, e);
  }
  if (!res.ok || !res.body) throw new ErrorDescargaModelo(`No se pudo descargar el recortador (HTTP ${res.status})`);
  const longitud = longitudContenido(res.headers);
  const total = longitud ?? TAMANO_MODELO_APROX;
  let bytes: Uint8Array;
  try {
    bytes = await leerEnUnBuffer(res.body, longitud, (r) => deps.alProgreso?.(r, Math.max(total, r)));
  } catch (e) {
    if (e instanceof RangeError) throw e; // sin memoria para el buffer
    throw new ErrorDescargaModelo(`Se cortó la descarga del recortador (${textoError(e)})`, e);
  }
  deps.alProgreso?.(bytes.length, bytes.length);
  if (cache) await guardarEnCache(cache, url, bytes);
  return { bytes, desdeCache: false };
}
