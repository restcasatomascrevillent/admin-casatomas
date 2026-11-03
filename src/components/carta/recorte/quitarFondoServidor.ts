/**
 * Quitar el fondo en el SERVIDOR (móvil y tablet, desde el 03-11-2026): la
 * foto ya reducida va a `/api/recortar-foto` (Vercel Function, mismo modelo y
 * refinado que el ordenador; ver docs/recorte-servidor.md) con el JWT de la
 * sesión, vuelve la MÁSCARA (PNG gris al tamaño de la foto) y aquí se aplica
 * a la foto → sticker PNG con transparencia, igual que quitarFondoNavegador.
 * El móvil no descarga el modelo ni ejecuta la inferencia.
 */
import { supabase } from "@/integrations/supabase/client";
import { almacenLocal, type Almacen, type CausaFallo } from "./recorteMovil";
import { diag } from "./diagnostico";

export const URL_RECORTE_SERVIDOR = "/api/recortar-foto";
/** Si el servidor no ha contestado en este tiempo, se deja para un ordenador. */
export const MS_TIEMPO_SERVIDOR = 90_000;
/** El límite de Vercel para el cuerpo es 4,5 MB y la función rechaza > 4 MB: por encima de esto se vuelve a comprimir. */
export const BYTES_MAXIMOS_ENVIO = 3_500_000;
const TIPOS_ADMITIDOS = /^image\/(jpeg|png|webp)$/;

/**
 * Tope de gasto alcanzado (429 de la función, ver la migración
 * 20261103180000): se recuerda hasta que pase (fin del día o del mes) para no
 * volver a llamar al servidor mientras tanto; las fotos van a un ordenador.
 */
export const CLAVE_TOPE = "panel.recorte.topeServidor.v1";
export type TipoTope = "mes" | "dia" | "cpu";
const MOTIVO_TOPE: Record<TipoTope, string> = {
  mes: "Se ha alcanzado el tope mensual de recortes en el servidor",
  dia: "Se ha alcanzado el tope diario de recortes en el servidor",
  cpu: "Se ha alcanzado el tope mensual de CPU de los recortes en el servidor",
};

/** Hasta cuándo vale un tope (hora local: mañana a las 0:00 o el día 1 del mes siguiente). */
export function finDelTope(tope: TipoTope, ahora = new Date()): number {
  return tope === "dia"
    ? new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1).getTime()
    : new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1).getTime();
}

export function recordarTope(tope: TipoTope, almacen: Almacen | null = almacenLocal(), ahora = new Date()): void {
  try {
    almacen?.setItem(CLAVE_TOPE, JSON.stringify({ tope, hasta: finDelTope(tope, ahora) }));
  } catch {
    /* nada */
  }
}

/** El tope recordado si sigue vigente (null si no hay o ya pasó). */
export function topeVigente(almacen: Almacen | null = almacenLocal(), ahora = Date.now()): TipoTope | null {
  try {
    const v = JSON.parse(almacen?.getItem(CLAVE_TOPE) ?? "null") as { tope?: TipoTope; hasta?: number } | null;
    if (!v?.tope || !(typeof v.hasta === "number" && ahora < v.hasta) || !(v.tope in MOTIVO_TOPE)) return null;
    return v.tope;
  } catch {
    return null;
  }
}

export type ProgresoServidor = { fase: "subiendo" } | { fase: "servidor" } | { fase: "componiendo" };

export class ErrorRecorteServidor extends Error {
  constructor(
    mensaje: string,
    readonly causa: CausaFallo,
    readonly estado?: number,
  ) {
    super(mensaje);
    this.name = "ErrorRecorteServidor";
  }
}

export interface OpcionesServidor {
  onProgreso?: (p: ProgresoServidor) => void;
  /** JWT (por defecto, el de la sesión actual). */
  token?: string | null;
  fetch?: typeof fetch;
  msTiempo?: number;
}

async function tokenSesion(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function causaDeEstado(estado: number): CausaFallo {
  if (estado === 401) return "sesion";
  if (estado === 403) return "permiso";
  if (estado === 422) return "sin-producto";
  if (estado === 504) return "tiempo";
  return "servidor";
}

/** JPEG 0,9 de la foto (para fotos de tipo no admitido o demasiado pesadas). */
async function aJpeg(foto: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(foto);
  try {
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas no disponible");
    ctx.drawImage(bmp, 0, 0);
    const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.9));
    c.width = c.height = 0;
    if (!b) throw new Error("No se pudo preparar la foto");
    return b;
  } finally {
    bmp.close();
  }
}

/** La foto tal cual si el servidor la admite; si no, en JPEG. */
export async function fotoParaServidor(foto: Blob): Promise<Blob> {
  if (TIPOS_ADMITIDOS.test(foto.type) && foto.size <= BYTES_MAXIMOS_ENVIO) return foto;
  return aJpeg(foto);
}

/** Pide la máscara al servidor. Lanza ErrorRecorteServidor con la causa. */
export async function pedirMascaraServidor(foto: Blob, opts: OpcionesServidor = {}): Promise<Blob> {
  const vigente = topeVigente();
  if (vigente) diag("servidor: no se llama, tope recordado", vigente);
  if (vigente) throw new ErrorRecorteServidor(MOTIVO_TOPE[vigente], "tope", 429);
  const token = opts.token === undefined ? await tokenSesion() : opts.token;
  if (!token) throw new ErrorRecorteServidor("No hay sesión", "sesion");
  const f = opts.fetch ?? fetch;
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), opts.msTiempo ?? MS_TIEMPO_SERVIDOR);
  opts.onProgreso?.({ fase: "subiendo" });
  // La subida de una foto de ~0,5 MB tarda poco: a partir de ahí, lo que se espera es al servidor.
  const avisoServidor = setTimeout(() => opts.onProgreso?.({ fase: "servidor" }), 1500);
  const t0 = Date.now();
  diag("servidor: petición", { foto });
  try {
    let r: Response;
    try {
      r = await f(URL_RECORTE_SERVIDOR, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": foto.type || "image/jpeg" },
        body: foto,
        signal: control.signal,
      });
    } catch (e) {
      diag("servidor: sin respuesta", { ms: Date.now() - t0, abortado: control.signal.aborted, mensaje: (e as Error)?.message });
      if (control.signal.aborted) throw new ErrorRecorteServidor("El servidor no ha respondido a tiempo", "tiempo");
      throw new ErrorRecorteServidor((e as Error)?.message || "Sin conexión", "red");
    }
    diag("servidor: respuesta", { estado: r.status, ms: Date.now() - t0, tiempos: r.headers.get("server-timing"), medidas: `${r.headers.get("x-recorte-ancho")}x${r.headers.get("x-recorte-alto")}` });
    if (!r.ok) {
      let mensaje = `Respuesta ${r.status}`;
      let tope: TipoTope | null = null;
      try {
        const cuerpo = (await r.json()) as { error?: string; tope?: TipoTope };
        if (cuerpo?.error) mensaje = cuerpo.error;
        if (cuerpo?.tope && cuerpo.tope in MOTIVO_TOPE) tope = cuerpo.tope;
      } catch {
        /* sin JSON */
      }
      if (r.status === 429) {
        recordarTope(tope ?? "mes");
        throw new ErrorRecorteServidor(tope ? MOTIVO_TOPE[tope] : mensaje, "tope", 429);
      }
      throw new ErrorRecorteServidor(mensaje, causaDeEstado(r.status), r.status);
    }
    try {
      return await r.blob();
    } catch (e) {
      if (control.signal.aborted) throw new ErrorRecorteServidor("El servidor no ha respondido a tiempo", "tiempo");
      throw new ErrorRecorteServidor((e as Error)?.message || "Respuesta cortada", "red");
    }
  } finally {
    clearTimeout(temporizador);
    clearTimeout(avisoServidor);
  }
}

/** Foto + máscara (PNG gris) → PNG con la máscara como transparencia. */
export async function aplicarMascara(foto: Blob, mascara: Blob): Promise<Blob> {
  const [bmp, mbmp] = await Promise.all([
    createImageBitmap(foto),
    createImageBitmap(mascara, { colorSpaceConversion: "none", premultiplyAlpha: "none" }),
  ]);
  try {
    const { width: ancho, height: alto } = bmp;
    if (mbmp.width !== ancho || mbmp.height !== alto) {
      console.warn("[recorte-servidor] la máscara no mide lo mismo que la foto: se escala", { foto: [ancho, alto], mascara: [mbmp.width, mbmp.height] });
    }
    const c = document.createElement("canvas");
    c.width = ancho;
    c.height = alto;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas no disponible");
    ctx.drawImage(mbmp, 0, 0, ancho, alto);
    const m = ctx.getImageData(0, 0, ancho, alto).data;
    ctx.clearRect(0, 0, ancho, alto);
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, ancho, alto);
    for (let i = 3; i < px.data.length; i += 4) px.data[i] = m[i - 3];
    ctx.putImageData(px, 0, 0);
    const png = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
    c.width = c.height = 0;
    if (!png) throw new Error("No se pudo generar la imagen");
    return png;
  } finally {
    bmp.close();
    mbmp.close();
  }
}

/** Foto (ya reducida) → sticker PNG sin fondo, quitando el fondo en el servidor. */
export async function quitarFondoServidor(foto: Blob, opts: OpcionesServidor = {}): Promise<Blob> {
  const t0 = performance.now();
  const envio = await fotoParaServidor(foto);
  const mascara = await pedirMascaraServidor(envio, opts);
  const tServidor = performance.now();
  opts.onProgreso?.({ fase: "componiendo" });
  const sticker = await aplicarMascara(envio, mascara);
  console.info("[recorte-servidor]", {
    bytesFoto: envio.size,
    bytesMascara: mascara.size,
    msServidor: Math.round(tServidor - t0),
    msTotal: Math.round(performance.now() - t0),
  });
  return sticker;
}
