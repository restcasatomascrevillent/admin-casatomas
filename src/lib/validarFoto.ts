// ---------------------------------------------------------------------------
// Validación común de las fotos que se suben desde el panel (carta, novedades,
// menú del día, tienda).
//
// Solo valen JPG, PNG y WebP de hasta 5 MB. El tipo se decide por los PRIMEROS
// BYTES del archivo (la «firma»), no por la extensión ni por `file.type`: un
// .exe o un .txt renombrado a .jpg trae `type: "image/jpeg"` y pasaría. Los
// cubos de Storage tienen el mismo límite (tarea «Límites en los cubos»); esto
// es la primera barrera, con un mensaje claro en castellano antes de subir.
// ---------------------------------------------------------------------------

export const MAX_FOTO_MB = 5;
export const MAX_FOTO_BYTES = MAX_FOTO_MB * 1024 * 1024;

export type TipoImagen = "image/jpeg" | "image/png" | "image/webp";

/**
 * Valor para el `accept` del `<input type="file">`. Restringirlo también hace
 * que el iPhone convierta sus fotos HEIC a JPEG al elegirlas.
 */
export const ACCEPT_FOTO = "image/jpeg,image/png,image/webp";

export const MENSAJE_FOTO_NO_VALIDA =
  "Ese archivo no es una foto válida. Elige una foto JPG, PNG o WebP.";
export const MENSAJE_FOTO_HEIC =
  "Las fotos HEIC del iPhone no se pueden subir. Elige la foto desde la galería con el botón del panel " +
  "(el iPhone la pasa a JPG solo) o, en el iPhone, activa Ajustes › Cámara › Formatos › «Más compatible».";
export const MENSAJE_FOTO_GRANDE = `La foto pesa demasiado: el máximo son ${MAX_FOTO_MB} MB. Elige una más pequeña o hazle una captura.`;
export const MENSAJE_FOTO_VACIA = "El archivo está vacío. Elige otra foto.";

const ascii = (b: Uint8Array, desde: number, hasta: number) => String.fromCharCode(...b.subarray(desde, hasta));

/** Tipo real por la firma de los primeros bytes, o null si no es JPG/PNG/WebP. */
export function tipoPorFirma(b: Uint8Array): TipoImagen | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return "image/png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** true si la firma es la de un HEIC/HEIF (fotos del iPhone). */
export function esHeic(b: Uint8Array): boolean {
  if (b.length < 12 || ascii(b, 4, 8) !== "ftyp") return false;
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(ascii(b, 8, 12));
}

async function primerosBytes(file: Blob, n = 16): Promise<Uint8Array> {
  const trozo = file.slice(0, n);
  // jsdom (pruebas) no tiene Blob.arrayBuffer en todas las versiones.
  const buffer =
    typeof trozo.arrayBuffer === "function"
      ? await trozo.arrayBuffer()
      : await new Response(trozo).arrayBuffer();
  return new Uint8Array(buffer);
}

export type ResultadoValidacion =
  | { ok: true; tipo: TipoImagen; mensaje?: undefined }
  | { ok: false; mensaje: string; tipo?: undefined };

/** Comprueba tamaño y tipo real. No lanza: devuelve el mensaje para el usuario. */
export async function validarFoto(file: Blob): Promise<ResultadoValidacion> {
  if (file.size === 0) return { ok: false, mensaje: MENSAJE_FOTO_VACIA };
  let bytes: Uint8Array;
  try {
    bytes = await primerosBytes(file);
  } catch {
    return { ok: false, mensaje: MENSAJE_FOTO_NO_VALIDA };
  }
  const tipo = tipoPorFirma(bytes);
  if (!tipo) return { ok: false, mensaje: esHeic(bytes) ? MENSAJE_FOTO_HEIC : MENSAJE_FOTO_NO_VALIDA };
  if (file.size > MAX_FOTO_BYTES) return { ok: false, mensaje: MENSAJE_FOTO_GRANDE };
  return { ok: true, tipo };
}

/** Error con un mensaje ya listo para enseñar al usuario. */
export class ErrorFoto extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorFoto";
  }
}

/** Como validarFoto, pero lanza ErrorFoto si no vale (para las funciones de subida). */
export async function exigirFotoValida(file: Blob): Promise<TipoImagen> {
  const r = await validarFoto(file);
  if (!r.ok) throw new ErrorFoto(r.mensaje);
  return r.tipo;
}

/**
 * Traduce el error de Storage a un mensaje en castellano si es de tamaño (413)
 * o de tipo (415); si no, null (el formulario pone el suyo).
 */
export function mensajeErrorStorage(error: unknown): string | null {
  if (error instanceof ErrorFoto) return error.message;
  if (!error || typeof error !== "object") return null;
  const e = error as { statusCode?: string | number; status?: string | number; message?: string; error?: string };
  const codigo = String(e.statusCode ?? e.status ?? "");
  const texto = `${e.message ?? ""} ${e.error ?? ""}`.toLowerCase();
  if (codigo === "413" || /payload too large|exceeded the maximum allowed size|entity too large/.test(texto)) {
    return MENSAJE_FOTO_GRANDE;
  }
  if (codigo === "415" || /mime type .* is not supported|invalid mime|not supported/.test(texto)) {
    return MENSAJE_FOTO_NO_VALIDA;
  }
  return null;
}
