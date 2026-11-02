/**
 * «Fondo de carta» para las fotos de vino: quitar el fondo + componer sobre el
 * fondo fijo (composicionVino.ts), y las reglas de nombres en Storage que
 * permiten saber qué foto está ya procesada y volver a la original.
 *
 * Nombres en el bucket `vinos` (sin migración):
 *   - Foto procesada desde una ya subida: `<base>-carta-<ext>.webp`, p. ej.
 *     `6d6c….webp` → `6d6c…-carta-webp.webp`. El original NO se toca, y su
 *     ruta se deduce del nombre: «Deshacer» = volver a `<base>.<ext>`.
 *   - Alta nueva ya compuesta en el panel: `<id>-carta.webp` (sin original
 *     guardado: no hay nada que deshacer).
 *   Cualquier ruta con `-carta` antes de la extensión cuenta como procesada.
 *
 * Quitar el fondo en el panel, por orden:
 *   1. GRATIS en el navegador (recorte/quitarFondoNavegador.ts: isnet en un
 *      Web Worker con onnxruntime-web; el modelo se baja una vez y se cachea).
 *   2. Si falla: Edge Function `recortar-fondo-vino` (Replicate, de pago,
 *      opcional; sin token → 503 `sin_token`; cada fallo trae un `codigo`
 *      que avisoSinFondoCarta convierte en un aviso claro).
 *   3. Si también falla: el llamador sigue con la foto encuadrada de siempre
 *      (recorteFoto.ts) y avisa (en el formulario y, al guardar, con un toast
 *      que dice cómo ponerle el fondo después: botón «Quitar fondo» de la ficha).
 *
 * En móvil y tablet solo existe la vía 2 (el modelo del navegador pesa 47 MB y
 * pide ~0,8 GB; la entrada del modelo es fija de 1024×1024, no hay "resolución
 * menor": ver cabecera de recorte/quitarFondoNavegador.ts). Por eso aquí:
 *   - la llamada tiene tiempo máximo (TIMEOUT_REMOTO_MS);
 *   - si el servicio no está configurado (sin_token, token_invalido, sin_saldo)
 *     se recuerda MS_RECUERDO_SERVICIO y no se vuelve a subir la foto (un lote
 *     de botellas no sube N fotos para recibir N 503);
 *   - el aviso (avisoSinFondoCarta) dice el motivo y qué hacer.
 * Las fotos ya subidas sin procesar se pueden homogeneizar con el script
 * local `scripts/fotos-vino/`.
 */
import { supabase } from "@/integrations/supabase/client";
import { componerFotoVino, extensionFoto } from "./composicionVino";
import { quitarFondoNavegador, recorteNavegadorSeguro, type ProgresoRecorte } from "./recorte/quitarFondoNavegador";

export type { ProgresoRecorte } from "./recorte/quitarFondoNavegador";

export { esFotoCarta, nombreSubida, rutaCartaDesdeOriginal, rutaOriginalDesdeCarta } from "./rutasFotoCarta";

function aDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Tiempo máximo (ms) que el panel espera a `recortar-fondo-vino`. La función
 * espera hasta 60 s a Replicate; esto deja margen para subir y bajar la foto.
 * En producción (02-11-2026) hubo respuestas 503 que tardaron 160 s en cerrarse
 * con fotos de más de 500 KB: sin tiempo máximo el móvil se quedaba en
 * «Recortando…» minutos.
 */
export const TIMEOUT_REMOTO_MS = 75_000;

/** `codigo` que significan «el servicio no está bien configurado»: repetir ahora no sirve. */
const CODIGOS_SERVICIO_NO_CONFIGURADO = new Set(["sin_token", "token_invalido", "sin_saldo"]);
/** Cuánto se recuerda (ms) que el servicio no está configurado antes de volver a intentarlo. */
export const MS_RECUERDO_SERVICIO = 3 * 60_000;

type ErrorRecorte = Error & { codigo?: string };
let servicioNoDisponible: { codigo: string; mensaje: string; hasta: number } | null = null;

function errorRecorte(mensaje: string, codigo?: string): ErrorRecorte {
  const e = new Error(mensaje) as ErrorRecorte;
  e.codigo = codigo;
  return e;
}

/** Olvida que el servicio no estaba configurado (lo usa «Repetir recorte»: un intento real). */
export function olvidarServicioNoDisponible(): void {
  servicioNoDisponible = null;
}

/** El error recordado si hace poco que el servicio dijo que no está configurado. */
function servicioRecordadoNoDisponible(): ErrorRecorte | null {
  if (!servicioNoDisponible) return null;
  if (Date.now() >= servicioNoDisponible.hasta) {
    servicioNoDisponible = null;
    return null;
  }
  return errorRecorte(servicioNoDisponible.mensaje, servicioNoDisponible.codigo);
}

/** Fallos del propio `fetch` (supabase-js los envuelve en FunctionsFetchError con la causa en `context`). */
function codigoDeFalloDeRed(error: unknown): string | undefined {
  const e = error as { name?: string; context?: { name?: string } } | null;
  if (!e) return undefined;
  if (e.name === "AbortError" || e.context?.name === "AbortError") return "timeout";
  if (e.name === "FunctionsFetchError") return "sin_conexion";
  return undefined;
}

/** Llama a `recortar-fondo-vino` y devuelve el PNG sin fondo. Lanza error (con `codigo` si lo hay). */
export async function quitarFondoRemoto(foto: Blob): Promise<Blob> {
  const imagen = await aDataUrl(foto);
  const { data, error } = await supabase.functions.invoke("recortar-fondo-vino", {
    body: { imagen },
    timeout: TIMEOUT_REMOTO_MS,
  });
  if (error || !data?.ok || typeof data?.png !== "string") {
    let codigo: string | undefined = data?.codigo;
    let mensaje: string | undefined = data?.error;
    // FunctionsHttpError: el cuerpo (con `codigo`) viene en error.context.
    const ctx = (error as { context?: Response } | null)?.context;
    if (!codigo && ctx && typeof ctx.json === "function") {
      try {
        const cuerpo = await ctx.json();
        codigo = cuerpo?.codigo;
        mensaje = cuerpo?.error ?? mensaje;
      } catch {
        /* sin cuerpo */
      }
    }
    codigo ??= codigoDeFalloDeRed(error);
    const e = errorRecorte(mensaje || error?.message || "No se pudo quitar el fondo", codigo);
    if (codigo && CODIGOS_SERVICIO_NO_CONFIGURADO.has(codigo)) {
      servicioNoDisponible = { codigo, mensaje: e.message, hasta: Date.now() + MS_RECUERDO_SERVICIO };
    }
    throw e;
  }
  servicioNoDisponible = null;
  const res = await fetch(data.png);
  return res.blob();
}

export interface ResultadoFotoCarta {
  /** Foto de carta (WebP 900×1200, o JPEG en Safari). */
  foto: File;
  /** La botella recortada sin fondo (PNG con transparencia). */
  sticker: Blob;
  /** Quién quitó el fondo. */
  metodo: "navegador" | "replicate";
}

/**
 * Quita el fondo: navegador gratis → Replicate. Lanza el error del último intento.
 * En móvil y tablet NO se intenta en el navegador (el modelo tumbaba la pestaña
 * por memoria y la página se recargaba con la foto a medias, ver
 * quitarFondoNavegador.ts): va directo a Replicate.
 */
export async function quitarFondo(
  foto: Blob,
  onProgreso?: (p: ProgresoRecorte) => void,
): Promise<{ sticker: Blob; metodo: ResultadoFotoCarta["metodo"] }> {
  if (recorteNavegadorSeguro()) {
    try {
      return { sticker: await quitarFondoNavegador(foto, onProgreso), metodo: "navegador" };
    } catch (e) {
      console.warn("[recorte-navegador] falló, se prueba Replicate", e);
    }
  } else {
    console.info("[recorte] móvil o poca memoria: se recorta con Replicate, no en el navegador");
  }
  // Si hace un momento el servicio dijo que no está configurado, no se sube la
  // foto otra vez para recibir el mismo 503 (olvidarServicioNoDisponible lo salta).
  const recordado = servicioRecordadoNoDisponible();
  if (recordado) throw recordado;
  onProgreso?.({ fase: "recortando" });
  return { sticker: await quitarFondoRemoto(foto), metodo: "replicate" };
}

/**
 * Foto (JPEG/PNG/WebP con fondo) → sticker + foto de carta lista para subir,
 * con nombre `botella-carta.<ext>` (los formularios suben `<id>-carta.<ext>`).
 * Lanza error si no se pudo por ninguna vía.
 */
export async function hacerFotoCarta(foto: Blob, onProgreso?: (p: ProgresoRecorte) => void): Promise<ResultadoFotoCarta> {
  const { sticker, metodo } = await quitarFondo(foto, onProgreso);
  const compuesta = await componerFotoVino(sticker);
  const ext = extensionFoto(compuesta);
  return { foto: new File([compuesta], `botella-carta.${ext}`, { type: compuesta.type }), sticker, metodo };
}

type Consejo = "servicio" | "pasajero" | "foto";

/** Por qué falló `recortar-fondo-vino`, según el `codigo` que devuelve, y qué conviene hacer. */
const MOTIVO_SIN_FONDO: Record<string, { motivo: string; consejo: Consejo }> = {
  sin_token: { motivo: "El servicio de recorte no está activado (falta la clave de Replicate en Supabase)", consejo: "servicio" },
  token_invalido: { motivo: "El servicio de recorte no acepta su clave (Replicate)", consejo: "servicio" },
  sin_saldo: { motivo: "El servicio de recorte no tiene saldo (Replicate)", consejo: "servicio" },
  timeout: { motivo: "Quitar el fondo ha tardado demasiado", consejo: "pasajero" },
  sin_conexion: { motivo: "No se ha podido conectar para quitar el fondo (¿sin cobertura?)", consejo: "pasajero" },
  fallo_replicate: { motivo: "No se ha podido quitar el fondo de esta foto", consejo: "pasajero" },
  demasiado_grande: { motivo: "La foto es demasiado grande para quitarle el fondo", consejo: "foto" },
  imagen_invalida: { motivo: "El formato de la foto no sirve para quitarle el fondo", consejo: "foto" },
};
const MOTIVO_GENERICO = { motivo: "No se ha podido poner el fondo de carta", consejo: "pasajero" as Consejo };

const CONSEJO_SIN_FONDO = {
  /** Servicio sin configurar: en el móvil solo queda el ordenador (recorta en el navegador). */
  servicioMovil: "Desde un ordenador sí se puede: abre la ficha y pulsa «Quitar fondo».",
  servicioOrdenador: "Prueba con «Repetir recorte» o con otra foto.",
  pasajero: "Pulsa «Repetir recorte» o, más tarde, abre la ficha y pulsa «Quitar fondo».",
  foto: "Prueba con otra foto.",
} as const;

/**
 * Aviso corto cuando no se pudo aplicar el fondo de carta: el motivo, que se
 * guarda la foto normal y qué hacer. `movil` (por defecto, según el navegador)
 * cambia el consejo cuando el servicio de recorte no está configurado.
 */
export function avisoSinFondoCarta(e: unknown, movil: boolean = !recorteNavegadorSeguro()): string {
  const codigo = (e as { codigo?: string } | null)?.codigo;
  const { motivo, consejo } = (codigo && MOTIVO_SIN_FONDO[codigo]) || MOTIVO_GENERICO;
  const que =
    consejo === "servicio"
      ? movil
        ? CONSEJO_SIN_FONDO.servicioMovil
        : CONSEJO_SIN_FONDO.servicioOrdenador
      : CONSEJO_SIN_FONDO[consejo];
  return `${motivo}. Se guarda la foto normal. ${que}`;
}
