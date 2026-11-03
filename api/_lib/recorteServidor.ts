/**
 * Quitar el fondo de una foto de la carta EN EL SERVIDOR (Vercel Function
 * `api/recortar-foto.ts`). Decisión del dueño (03-11-2026): el iPhone no
 * puede recortar en el navegador (memoria de Safari), así que el móvil manda
 * la foto ya reducida, aquí se pasa el MISMO modelo que en el ordenador
 * (isnet-general-use cuantizado, `public/modelos/isnet-general-use-u8.onnx`)
 * con el MISMO pre/postproceso (mascaraRecorte.ts + refinarMascara.ts) y se
 * devuelve solo la MÁSCARA (PNG gris de 1 canal, al tamaño de la foto
 * recibida). El móvil la aplica a su foto y compone con el fondo de carta.
 *
 * La sesión de onnxruntime-node se crea una vez por instancia y se reutiliza
 * entre invocaciones (Fluid Compute). Las inferencias van de una en una: con
 * dos a la vez se dobla la memoria y no se gana tiempo (la CPU es la misma).
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LADO_MODELO, minMaxAUint8, normalizarEntrada } from "../../src/components/carta/recorte/mascaraRecorte.js";
import {
  aplicarCoeficientes,
  coeficientesGuiado,
  entradaGuiado,
  limpiarMascara,
  luminancia,
  medidasTrabajo,
} from "../../src/components/carta/recorte/refinarMascara.js";

/** Lado mayor al que se limpia la máscara (igual que LADO_TRABAJO_FOTO del navegador). */
export const LADO_TRABAJO = 1600;
/** Lado mayor admitido en la foto de entrada (el móvil manda ≤ 1200-1600). */
export const LADO_MAXIMO_ENTRADA = 4096;
/** Menos de este porcentaje de píxeles opacos = no hay producto en la foto (como el navegador). */
const FRACCION_MINIMA_OPACA = 0.01;

/** Ruta del modelo dentro del bundle de la función (vercel.json → functions.includeFiles). */
export function rutaModelo(): string {
  return path.join(process.cwd(), "public", "modelos", "isnet-general-use-u8.onnx");
}

export class ErrorSinProducto extends Error {
  constructor() {
    super("No se encontró el producto en la foto");
    this.name = "ErrorSinProducto";
  }
}

export class ErrorFotoNoValida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorFotoNoValida";
  }
}

type Ort = typeof import("onnxruntime-node");
type Sharp = typeof import("sharp");

interface Sesion {
  ort: Ort;
  s: import("onnxruntime-node").InferenceSession;
  msCarga: number;
}

let sesion: Promise<Sesion> | null = null;

/** Sesión del modelo (una por instancia). Si falla, se vuelve a intentar en la siguiente petición. */
export function cargarSesion(): Promise<Sesion> {
  if (!sesion) {
    sesion = (async () => {
      const t0 = performance.now();
      const ort = (await import("onnxruntime-node")) as Ort;
      // Vercel Hobby da 1 vCPU (el host puede enseñar más núcleos): 2 hilos como
      // mucho y sin «spinning», para no pelear por la CPU. RECORTE_HILOS para medir.
      const nucleos = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
      const hilos = Number(process.env.RECORTE_HILOS) || Math.max(1, Math.min(2, nucleos));
      const s = await ort.InferenceSession.create(rutaModelo(), {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
        intraOpNumThreads: hilos,
        interOpNumThreads: 1,
        // Sin la arena de CPU de ORT la memoria vuelve a ~400 MB tras cada foto;
        // con ella crecía hasta ~1,5 GB (el plan Hobby da 2 GB por instancia).
        enableCpuMemArena: false,
        enableMemPattern: false,
        extra: { session: { intra_op: { allow_spinning: "0" } } },
      });
      return { ort, s, msCarga: performance.now() - t0 };
    })();
    sesion.catch(() => {
      sesion = null;
    });
  }
  return sesion;
}

/** ¿Está el motor listo para cargar? (GET de diagnóstico: no crea la sesión). */
export async function comprobarMotor(): Promise<{ modelo: boolean; motor: boolean; imagenes: boolean; error?: string }> {
  const modelo = existsSync(rutaModelo());
  let motor = false;
  let imagenes = false;
  let error: string | undefined;
  try {
    await import("onnxruntime-node");
    motor = true;
  } catch (e) {
    error = `onnxruntime-node: ${(e as Error)?.message ?? e}`;
  }
  try {
    await import("sharp");
    imagenes = true;
  } catch (e) {
    error = `${error ? `${error}; ` : ""}sharp: ${(e as Error)?.message ?? e}`;
  }
  return { modelo, motor, imagenes, error };
}

let sharpMod: Sharp | null = null;
async function cargarSharp(): Promise<Sharp> {
  if (!sharpMod) sharpMod = ((await import("sharp")) as unknown as { default: Sharp }).default;
  return sharpMod;
}

// Una inferencia cada vez por instancia.
let cola: Promise<unknown> = Promise.resolve();
function enCola<T>(fn: () => Promise<T>): Promise<T> {
  const r = cola.then(fn, fn);
  cola = r.catch(() => undefined);
  return r;
}

export interface Tiempos {
  /** Carga de la sesión en ESTA petición (0 si ya estaba: instancia caliente). */
  msCarga: number;
  /** Decodificar la foto y preparar la entrada 1024×1024. */
  msEntrada: number;
  msInferencia: number;
  /** Limpieza + filtro guiado + alfa a tamaño completo. */
  msRefinado: number;
  /** PNG de la máscara. */
  msPng: number;
  msTotal: number;
  /** Espera en la cola de la instancia. */
  msCola: number;
}

export interface ResultadoMascara {
  /** PNG gris de 1 canal: 255 = producto, 0 = fondo (alfa suave en el borde). */
  png: Buffer;
  ancho: number;
  alto: number;
  tiempos: Tiempos;
  /** true si la sesión ya estaba cargada (instancia caliente). */
  caliente: boolean;
}

/**
 * Foto (JPEG/PNG/WebP) → máscara refinada al tamaño de la foto (orientada
 * según su EXIF, como la decodifica el navegador). Lanza ErrorFotoNoValida si
 * no se puede leer y ErrorSinProducto si no se encuentra nada.
 */
export async function mascaraDeFoto(foto: Uint8Array): Promise<ResultadoMascara> {
  const tCola = performance.now();
  return enCola(async () => {
    const t0 = performance.now();
    const msCola = t0 - tCola;
    const sharp = await cargarSharp();

    // Foto completa en RGBA (los transparentes en negro, como getImageData del canvas).
    let completa: { data: Buffer; info: { width: number; height: number } };
    try {
      completa = await sharp(foto, { limitInputPixels: LADO_MAXIMO_ENTRADA * LADO_MAXIMO_ENTRADA, failOn: "error" })
        .rotate()
        .flatten({ background: { r: 0, g: 0, b: 0 } })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    } catch (e) {
      throw new ErrorFotoNoValida(`No se pudo leer la foto: ${(e as Error)?.message ?? e}`);
    }
    const ancho = completa.info.width;
    const alto = completa.info.height;
    if (Math.max(ancho, alto) > LADO_MAXIMO_ENTRADA) throw new ErrorFotoNoValida("La foto es demasiado grande");
    const crudo = () => sharp(completa.data, { raw: { width: ancho, height: alto, channels: 4 } });

    // Entrada del modelo: 1024×1024 deformada (como el canvas del navegador y rembg).
    const entradaRgba = await crudo().resize(LADO_MODELO, LADO_MODELO, { fit: "fill" }).raw().toBuffer();
    const entrada = normalizarEntrada(entradaRgba);
    const tEntrada = performance.now();

    const yaCargada = sesion !== null;
    const tCarga0 = performance.now();
    const { ort, s } = await cargarSesion();
    const msCarga = performance.now() - tCarga0;
    const caliente = yaCargada && msCarga < 50;

    const tInf = performance.now();
    const salida = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", entrada, [1, 3, LADO_MODELO, LADO_MODELO]) });
    const pred = salida[s.outputNames[0]].data as Float32Array;
    const mascara1024 = minMaxAUint8(pred);
    const msInferencia = performance.now() - tInf;

    // Refinado como en quitarFondoNavegador: máscara → resolución de trabajo →
    // limpieza + filtro guiado con la propia foto → alfa a tamaño completo.
    const tRef = performance.now();
    const tr = medidasTrabajo(ancho, alto, LADO_TRABAJO);
    const gris = new Uint8Array(
      await sharp(Buffer.from(mascara1024.buffer, mascara1024.byteOffset, mascara1024.byteLength), {
        raw: { width: LADO_MODELO, height: LADO_MODELO, channels: 1 },
      })
        .resize(tr.ancho, tr.alto, { fit: "fill" })
        .extractChannel(0)
        .raw()
        .toBuffer(),
    );
    const guia = tr.ancho === ancho && tr.alto === alto ? completa.data : await crudo().resize(tr.ancho, tr.alto, { fit: "fill" }).raw().toBuffer();
    const limpia = limpiarMascara(gris, tr.ancho, tr.alto);
    const coef = coeficientesGuiado(luminancia(guia, tr.ancho * tr.alto), entradaGuiado(limpia), tr.ancho, tr.alto);
    const px = completa.data; // se escribe el alfa en el canal 3
    const opacos = aplicarCoeficientes(coef, tr.ancho, tr.alto, px, ancho, alto);
    if (opacos < ancho * alto * FRACCION_MINIMA_OPACA) throw new ErrorSinProducto();
    const alfa = Buffer.allocUnsafe(ancho * alto);
    for (let i = 0; i < alfa.length; i++) alfa[i] = px[i * 4 + 3];
    const msRefinado = performance.now() - tRef;

    const tPng = performance.now();
    const png = await sharp(alfa, { raw: { width: ancho, height: alto, channels: 1 } })
      .toColourspace("b-w") // sin esto sharp guarda un PNG RGB (3 canales)
      .png({ compressionLevel: 6, adaptiveFiltering: true })
      .toBuffer();
    const fin = performance.now();

    return {
      png,
      ancho,
      alto,
      caliente,
      tiempos: {
        msCarga: Math.round(msCarga),
        msEntrada: Math.round(tEntrada - t0),
        msInferencia: Math.round(msInferencia),
        msRefinado: Math.round(msRefinado),
        msPng: Math.round(fin - tPng),
        msTotal: Math.round(fin - t0),
        msCola: Math.round(msCola),
      },
    };
  });
}

/** Solo para pruebas: olvidar la sesión (siguiente petición = arranque en frío). */
export function _olvidarSesionParaPruebas(): void {
  sesion = null;
}
