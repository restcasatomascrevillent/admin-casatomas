/**
 * Edge Function instagram-drive — biblioteca de fotos de Marketing › Instagram
 * en Google Drive (marketing/instagram/fotos/<marca>). Ver docs/instagram-fotos.md.
 *
 * Autorización: JWT de Supabase + «Ver» en Marketing (can_read_section) para
 * listar y ver miniaturas; «Editar» (can_edit_section) para preparar y subir
 * (403 si no, desde 20261111000000). Supabase (tabla instagram_fotos y
 * bucket «instagram») se usa COMO EL USUARIO: clave pública + su JWT; nunca
 * service_role. Drive, con los secretos de Google (ver _shared/instagram/drive.ts).
 *
 *   POST { "accion": "listar", "marca": "casa-tomas"|"touza" }
 *     200 { ok, marca, alcance, avisos, fotos: [{ driveId, nombre, ancho, alto, tipo, descripcion, filaId, creada, problema }] }
 *     Fotos de la carpeta de la marca. Los metadatos (tipo, descripción)
 *     salen de instagram_fotos (por drive_id); si una foto no tiene fila,
 *     tipo = null y la aptitud se deduce de sus medidas en el panel.
 *
 *   POST ?accion=subir  (multipart/form-data: archivo, marca, tipo, descripcion)
 *     200 { ok, foto, avisos }. Solo JPEG (el panel ya la convierte: ≤ 2560 px,
 *     ≤ 8 MB). Las medidas se leen del propio JPEG. Se sube a la carpeta de
 *     la marca y se guarda la fila en instagram_fotos.
 *
 *   GET ?accion=miniatura&marca=…&id=<driveId>
 *     200 con los bytes de la miniatura (image/*). El panel la pide con
 *     Authorization y la enseña como blob URL. 404 si no hay miniatura.
 *
 *   POST { "accion": "preparar", "marca": …, "id": "<driveId>" }
 *     200 { ok, ruta: "tmp/<uuid>.jpg", url, ancho, alto }. Copia la foto al
 *     bucket (escala temporal) para la vista previa y el render: Meta y
 *     Chromium necesitan una URL pública directa. De paso borra las copias
 *     tmp/ de más de 24 h (limpieza oportunista).
 *
 *   POST { "accion": "preparar", "origen": "carta", "marca": …, "platoId": "<id>" }
 *     200 { ok, ruta: "tmp/<uuid>.<jpg|png|webp>", url, ancho, alto }. Igual,
 *     pero con la foto de un plato de la carta (tabla "Platos", leída con el
 *     JWT del usuario). Solo si el plato es de la marca (restaurante/touza),
 *     está activo y su imagen_url es del bucket público «platos» de ESTE
 *     Supabase (SUPABASE_URL); si no, 400. La URL se reconstruye desde la ruta
 *     (no se descarga la que hay en la fila) y no se siguen redirecciones.
 *     No necesita los secretos de Google.
 *
 *   POST { "accion": "preparar", "origen": "vino", "marca": …, "vinoId": "<id>" }
 *     Igual que «carta», pero con la foto de un vino de la carta (tabla
 *     "Vinos", bucket público «vinos» de ESTE Supabase).
 *
 *     En «carta» y «vino», si la ficha tiene ORIGINAL en Drive
 *     (carta_fotos_originales) y Drive está configurado, se copia ESE (JPEG a
 *     tamaño completo) en vez de la versión web: { …, original: true }. Si el
 *     original falla, la versión web, con `original: false` y un `aviso`.
 *
 *   POST ?accion=subir_original  (multipart/form-data: tabla "Platos"|"Vinos", id, archivo)
 *     200 { ok, tabla, id, driveId, marca, nombre, ancho, alto, reemplazado }.
 *     Permiso: «Editar» en la carta (gestor_carta), NO el de Marketing. Solo
 *     JPEG (el panel lo convierte: orientación EXIF aplicada, lado mayor
 *     ≤ 4000, ≤ 8 MB). Se sube a marketing/carta/<marca>/<nombre>-<id>.jpg
 *     (marca: restaurante → casa-tomas; si no, touza) y el id de Drive se
 *     guarda en carta_fotos_originales. Si la ficha ya tenía original en esa
 *     carpeta, se REEMPLAZA su contenido (mismo id de Drive).
 *
 *   POST ?accion=descargar_original  (JSON: { tabla: "Platos"|"Vinos", id, tipo?: "foto"|"video", comprobar?: true })
 *     Desde el 08/11/2026 los ORIGINALES de la carta viven SOLO en Drive (en
 *     Supabase solo queda la versión web, el «sticker»). Devuelve los bytes del
 *     original (image/jpeg o video/*) para «Cambiar fondo», el recorte, el
 *     cambio de fondo del vídeo, etc. Con `comprobar: true`, solo JSON
 *     { ok, tipo, driveId, nombre, mimeType, bytes, ancho?, alto? } (sin
 *     descargar). 404 { sinOriginal: true } si la ficha no tiene original: el
 *     panel usa entonces la versión web como respaldo y lo avisa. Permiso:
 *     «Editar» en la carta (gestor_carta). Foto: la de carta_fotos_originales,
 *     comprobando que está en marketing/carta/<marca>. Vídeo (solo Platos):
 *     marketing/carta/<marca>/videos/<id>.<ext>.
 *
 *   POST ?accion=subir_original_video  (multipart/form-data: tabla "Platos", id, archivo)
 *     200 { ok, tabla, id, driveId, marca, nombre, bytes, reemplazado }. El
 *     vídeo ORIGINAL (bruto) del plato, ≤ 50 MB, mp4/mov/m4v/webm/3gp/mkv
 *     (se mira la cabecera del fichero), a marketing/carta/<marca>/videos/<id>.<ext>
 *     con subida reanudable. Uno por plato: si ya había, se REEMPLAZA (mismo
 *     id de Drive). Permiso: «Editar» en la carta. Sin filas en la BD.
 *
 *   Seguridad: solo se leen ficheros que estén DENTRO de la carpeta de la
 *   marca (por `parents`), aunque el token pueda ver más (facturas, etc.).
 *
 *   Errores (JSON { ok: false, error, comoArreglarlo? }): 400 · 401 · 403 ·
 *   404 · 405 · 413 · 415 · 422 · 502 (Drive) · 503 (faltan secretos de Google).
 */
import { ErrorDrive, esIdDrive, medidasJpeg, type FicheroDrive } from "../_shared/google-drive.ts";
import {
  ARREGLO_DRIVE_FILE,
  AVISO_DRIVE_FILE,
  carpetaCarta,
  carpetaFotos,
  carpetaVideosCarta,
  clasificarAlcance,
  esMarcaDrive,
  estaEn,
  leerConfigDrive,
  medidasDrive,
  TIPOS_IMAGEN,
  type ConfigDriveInstagram,
  type MarcaDrive,
} from "../_shared/instagram/drive.ts";
import { dondeSecreto, entornoDeno } from "../_shared/instagram/entorno.ts";
import { CORS, json, jsonAuth, leerJson, opciones } from "../_shared/instagram/http.ts";
import { registro, sanear } from "../_shared/instagram/secretos.ts";
import {
  autorizarMarketing,
  puedeEditarMarketing,
  SIN_PERMISO_EDITAR,
  borrarObjetos,
  ErrorSupabase,
  insertarFotoDrive,
  leerFotosDrive,
  listarObjetos,
  subirObjeto,
  urlPublica,
  type FilaFotoDrive,
  type Sesion,
} from "../_shared/instagram/supabase.ts";
import {
  guardarOriginal,
  LADO_MAXIMO_ORIGINAL,
  leerOriginal,
  marcaDeFicha,
  MAX_BYTES_ORIGINAL,
  MIGRACION_ORIGINALES,
  SECCION_CARTA,
  SIN_PERMISO_CARTA,
} from "./originales.ts";

const ETIQUETA = "instagram-drive";

/** Los mismos que TIPOS_FOTO de src/lib/instagram/fotos.ts (y el CHECK de instagram_fotos). */
export const TIPOS_FOTO = ["plato", "sala", "bebida", "ambiente", "barra", "coctel", "interior"] as const;
export const MAX_BYTES_FOTO = 8 * 1024 * 1024;
export const LADO_MAXIMO = 2560;
export const MAX_DESCRIPCION = 140;
/** Copias tmp/ más viejas que esto se borran al preparar otra. */
export const VIDA_TMP_MS = 24 * 60 * 60 * 1000;

export interface DependenciasDrive {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  ahora?: () => number;
  nuevoId?: () => string;
}

export interface FotoDriveRespuesta {
  driveId: string;
  nombre: string;
  ancho: number | null;
  alto: number | null;
  tipo: string | null;
  descripcion: string;
  /** id de la fila de instagram_fotos (null si la foto no tiene metadatos). */
  filaId: string | null;
  creada: string | null;
  /** Por qué no se puede usar (formato o peso), o null. */
  problema: string | null;
}

function problemaFichero(f: Pick<FicheroDrive, "mimeType" | "size">): string | null {
  if (!TIPOS_IMAGEN[f.mimeType]) return `Formato ${f.mimeType.replace("image/", "").toUpperCase()}: súbela desde el panel («Subir foto») para que se convierta a JPEG.`;
  if (Number(f.size ?? "0") > MAX_BYTES_FOTO) return "Pesa más de 8 MB: súbela desde el panel («Subir foto») para que se reduzca.";
  return null;
}

export function aRespuesta(f: FicheroDrive, fila: FilaFotoDrive | undefined): FotoDriveRespuesta {
  const m = medidasDrive(f);
  return {
    driveId: f.id,
    nombre: f.name,
    ancho: m?.ancho ?? fila?.ancho ?? null,
    alto: m?.alto ?? fila?.alto ?? null,
    tipo: fila?.tipo ?? null,
    descripcion: (fila?.descripcion ?? "").trim(),
    filaId: fila?.id ?? null,
    creada: f.createdTime ?? null,
    problema: problemaFichero(f),
  };
}

/** Respuesta de error de Drive con el «cómo arreglarlo» (y la trampa de drive.file). */
async function errorDrive(e: unknown, c: ConfigDriveInstagram | null): Promise<Response> {
  if (!(e instanceof ErrorDrive)) throw e;
  let comoArreglarlo = "Pulsa «Comprobar» en la pestaña Conexión para ver qué falla con Google Drive.";
  if (e.motivo === "token") comoArreglarlo = "Revisa los secretos GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN (pestaña Conexión → Comprobar).";
  else if ((e.motivo === "no_encontrado" || e.motivo === "permiso") && c) {
    const alcance = await c.cliente.token().then((t) => clasificarAlcance(t.alcances)).catch(() => null);
    comoArreglarlo = alcance === "drive.file" ? ARREGLO_DRIVE_FILE : "Comprueba que la carpeta «marketing» existe y que la cuenta de Google del token puede editarla.";
  }
  return json(502, { ok: false, error: `Google Drive: ${sanear(e.message)}`, comoArreglarlo });
}

function sinConfig(faltan: string[], problema: string, env: Record<string, string | undefined>): Response {
  return json(503, {
    ok: false,
    error: problema,
    faltan,
    comoArreglarlo: faltan.map((n) => `Crea ${n} en ${dondeSecreto(n, env)}.`).join(" "),
  });
}

function nombreSeguro(texto: string): string {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "foto"
  );
}

export async function manejarDrive(request: Request, deps: DependenciasDrive = {}): Promise<Response> {
  if (request.method === "OPTIONS") return opciones();
  if (request.method !== "GET" && request.method !== "POST") return json(405, { ok: false, error: "Método no permitido" });
  const env = deps.env ?? entornoDeno();
  const url = new URL(request.url);
  // El original de la carta lo sube quien edita la carta (gestor_carta),
  // tenga o no Marketing: se autoriza aparte.
  const accionUrl = url.searchParams.get("accion");
  if (request.method === "POST" && accionUrl === "subir_original") return await subirOriginal(request, env, deps);
  if (request.method === "POST" && accionUrl === "subir_original_video") return await subirOriginalVideo(request, env, deps);
  if (request.method === "POST" && accionUrl === "descargar_original") return await descargarOriginal(request, env, deps);
  // `{ accion: "descargar_original" }` en el cuerpo JSON (sin ?accion=): se mira una copia.
  if (request.method === "POST" && !accionUrl && !(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    const copia = await leerJson(request.clone(), 16 * 1024);
    if (copia.ok && (copia.valor as { accion?: unknown } | null)?.accion === "descargar_original") return await descargarOriginal(request, env, deps);
  }
  // Ver fotos (listar, miniatura) basta con «Ver»; copiarlas al cubo
  // (preparar) o subirlas a Drive exige «Editar» (20261111000000).
  const auth = await autorizarMarketing(request.headers.get("authorization"), { env, fetch: deps.fetch, permiso: "leer" });
  if ("motivo" in auth) {
    if (auth.estado >= 500) registro("error", ETIQUETA, "autorización", { motivo: auth.motivo });
    return jsonAuth(auth.estado, auth.motivo);
  }
  const s = auth.sesion;
  const tipoContenido = (request.headers.get("content-type") ?? "").toLowerCase();

  let accion = url.searchParams.get("accion");
  let cuerpo: Record<string, unknown> = {};
  if (request.method === "POST" && !tipoContenido.startsWith("multipart/form-data")) {
    const leido = await leerJson(request, 16 * 1024);
    if ("error" in leido) return json(leido.estado, { ok: false, error: leido.error });
    if (!leido.valor || typeof leido.valor !== "object") return json(400, { ok: false, error: "El cuerpo tiene que ser un objeto JSON" });
    cuerpo = leido.valor as Record<string, unknown>;
    if (typeof cuerpo.accion === "string") accion = cuerpo.accion;
  }

  if (request.method === "POST" && (accion === "preparar" || accion === "subir") && !(await puedeEditarMarketing(s))) {
    return jsonAuth(403, SIN_PERMISO_EDITAR);
  }

  // La foto de la carta (platos o vinos) no pasa por Google Drive: funciona aunque falten sus secretos.
  if (request.method === "POST" && accion === "preparar" && (cuerpo.origen === "carta" || cuerpo.origen === "vino")) {
    try {
      const depsCarta = { ...deps, env };
      return cuerpo.origen === "vino"
        ? await prepararCarta(s, cuerpo.marca, cuerpo.vinoId, depsCarta, CARTA_VINOS)
        : await prepararCarta(s, cuerpo.marca, cuerpo.platoId, depsCarta);
    } catch (e) {
      if (e instanceof ErrorSupabase) {
        registro("error", ETIQUETA, "Supabase (carta)", e);
        return json(e.estado === 401 || e.estado === 403 ? 403 : 500, { ok: false, error: e.message });
      }
      registro("error", ETIQUETA, "fallo (carta)", e);
      return json(502, { ok: false, error: "No se pudo copiar la foto de la carta", detalle: sanear((e as Error)?.message ?? e) });
    }
  }

  const cfg = leerConfigDrive(env, { fetch: deps.fetch, ahora: deps.ahora });
  if ("faltan" in cfg) return sinConfig(cfg.faltan, cfg.problema, env);
  const c = cfg.config;

  try {
    if (request.method === "GET" && accion === "miniatura") return await miniatura(c, url.searchParams.get("marca"), url.searchParams.get("id"));
    if (request.method === "POST" && accion === "listar") return await listar(s, c, cuerpo.marca);
    if (request.method === "POST" && accion === "preparar") return await preparar(s, c, cuerpo.marca, cuerpo.id, deps);
    if (request.method === "POST" && accion === "subir") return await subir(s, c, request, deps);
    return json(400, { ok: false, error: "Acción no válida (listar, subir, miniatura, preparar, subir_original, subir_original_video o descargar_original)" });
  } catch (e) {
    if (e instanceof ErrorDrive) {
      registro("warn", ETIQUETA, "Drive", { accion, motivo: e.motivo, estado: e.estado, mensaje: e.message });
      return await errorDrive(e, c);
    }
    if (e instanceof ErrorSupabase) {
      registro("error", ETIQUETA, "Supabase", e);
      return json(e.estado === 401 || e.estado === 403 ? 403 : 500, { ok: false, error: e.message });
    }
    registro("error", ETIQUETA, "fallo", e);
    return json(500, { ok: false, error: "No se pudo completar la operación con Drive", detalle: sanear((e as Error)?.message ?? e) });
  }
}

async function listar(s: Sesion, c: ConfigDriveInstagram, marca: unknown): Promise<Response> {
  if (!esMarcaDrive(marca)) return json(400, { ok: false, error: "«marca» tiene que ser casa-tomas o touza" });
  const carpeta = await carpetaFotos(c, marca);
  const [ficheros, filas, alcance] = await Promise.all([
    c.cliente.listarImagenes(carpeta),
    leerFotosDrive(s, marca),
    c.cliente.token().then((t) => clasificarAlcance(t.alcances)),
  ]);
  const porDrive = new Map(filas.filas.filter((f) => f.drive_id).map((f) => [f.drive_id as string, f]));
  const avisos: string[] = [];
  if (alcance === "drive.file") avisos.push(AVISO_DRIVE_FILE);
  if (filas.sinColumna) avisos.push("Falta aplicar la migración 20261105150000_instagram_drive: las fotos salen sin tipo ni descripción.");
  return json(200, { ok: true, marca, alcance, avisos, fotos: ficheros.map((f) => aRespuesta(f, porDrive.get(f.id))) });
}

/** Metadatos de un fichero comprobando que está en la carpeta de la marca. null → 404. */
async function ficheroDeMarca(c: ConfigDriveInstagram, marca: MarcaDrive, id: string, campos: string): Promise<FicheroDrive | null> {
  const carpeta = await carpetaFotos(c, marca);
  const f = await c.cliente.metadatos(id, campos);
  if (!f || f.trashed || !estaEn(f, carpeta)) return null;
  return f;
}

async function miniatura(c: ConfigDriveInstagram, marca: string | null, id: string | null): Promise<Response> {
  if (!esMarcaDrive(marca) || !esIdDrive(id)) return json(400, { ok: false, error: "Faltan «marca» o «id» válidos" });
  const f = await ficheroDeMarca(c, marca, id, "id,mimeType,size,parents,trashed,thumbnailLink");
  if (!f) return json(404, { ok: false, error: "Esa foto no está en la carpeta de la marca" });
  let img = await c.cliente.miniatura(f.thumbnailLink, 400);
  // Sin miniatura (Drive aún la está creando): el propio fichero si es pequeño.
  if (!img && TIPOS_IMAGEN[f.mimeType] && Number(f.size ?? "0") <= 3 * 1024 * 1024) img = await c.cliente.descargar(f.id);
  if (!img) return json(404, { ok: false, error: "Drive todavía no tiene miniatura de esta foto" });
  return new Response(img.bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: { ...CORS, "Content-Type": img.tipo, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}

async function preparar(s: Sesion, c: ConfigDriveInstagram, marca: unknown, id: unknown, deps: DependenciasDrive): Promise<Response> {
  if (!esMarcaDrive(marca) || !esIdDrive(id)) return json(400, { ok: false, error: "Faltan «marca» o «id» válidos" });
  const f = await ficheroDeMarca(c, marca, id, "id,name,mimeType,size,parents,trashed,imageMediaMetadata(width,height,rotation)");
  if (!f) return json(404, { ok: false, error: "Esa foto no está en la carpeta de la marca (o se ha borrado de Drive)" });
  const problema = problemaFichero(f);
  if (problema) return json(422, { ok: false, error: problema });
  const { bytes, tipo: tipoDescargado } = await c.cliente.descargar(f.id);
  if (bytes.byteLength > MAX_BYTES_FOTO) return json(422, { ok: false, error: "Pesa más de 8 MB: súbela desde el panel («Subir foto») para que se reduzca." });
  const tipo = TIPOS_IMAGEN[tipoDescargado] ? tipoDescargado : f.mimeType;
  const ruta = `tmp/${(deps.nuevoId ?? (() => crypto.randomUUID()))()}.${TIPOS_IMAGEN[tipo]}`;
  await subirObjeto(s, ruta, bytes, tipo);
  const m = medidasDrive(f) ?? (tipo === "image/jpeg" ? medidasJpeg(bytes) : null);
  await limpiarTmp(s, deps.ahora ?? Date.now, ruta);
  return json(200, { ok: true, ruta, url: urlPublica(s.sb, ruta), ancho: m?.ancho ?? null, alto: m?.alto ?? null });
}

const RE_ID_PLATO = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Ruta en el bucket público «platos» de una URL de NUESTRO Supabase, o null
 * (otro host/puerto/esquema, credenciales, otro bucket, «..», %-codificados).
 * Es la misma regla que rutaPlatoDeUrl de src/lib/instagram/fotos.ts.
 */
export function rutaPlatoDeUrl(url: unknown, supabaseUrl: string): string | null {
  return rutaBucketDeUrl(url, supabaseUrl, "platos");
}

/** Igual que rutaPlatoDeUrl, pero para cualquier bucket público («platos», «vinos»). */
export function rutaBucketDeUrl(url: unknown, supabaseUrl: string, bucket: string): string | null {
  const prefijo = `/storage/v1/object/public/${bucket}/`;
  if (typeof url !== "string" || url.length > 1000 || !supabaseUrl) return null;
  let u: URL;
  let base: URL;
  try {
    u = new URL(url);
    base = new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (u.origin !== base.origin || u.username || u.password) return null;
  if (!u.pathname.startsWith(prefijo)) return null;
  const ruta = u.pathname.slice(prefijo.length);
  if (!ruta || ruta.includes("..") || ruta.includes("%") || ruta.includes("//") || !/^[A-Za-z0-9_./ -]+$/.test(ruta)) return null;
  return ruta;
}

/** Medidas de un PNG (IHDR) o WebP (VP8 / VP8L / VP8X); JPEG con medidasJpeg. null si no se sabe. */
export function medidasImagen(b: Uint8Array, tipo: string): { ancho: number; alto: number } | null {
  if (tipo === "image/jpeg") return medidasJpeg(b);
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const txt = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (tipo === "image/png" && b.length >= 24 && b[0] === 0x89 && txt(12, 4) === "IHDR") {
    return { ancho: u32be(16), alto: u32be(20) };
  }
  if (tipo === "image/webp" && b.length >= 30 && txt(0, 4) === "RIFF" && txt(8, 4) === "WEBP") {
    const trozo = txt(12, 4);
    if (trozo === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { ancho: (b[26] | (b[27] << 8)) & 0x3fff, alto: (b[28] | (b[29] << 8)) & 0x3fff };
    }
    if (trozo === "VP8L" && b[20] === 0x2f) {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { ancho: (v & 0x3fff) + 1, alto: ((v >>> 14) & 0x3fff) + 1 };
    }
    if (trozo === "VP8X") {
      return { ancho: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), alto: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    }
  }
  return null;
}

interface FilaPlato {
  id: string;
  imagen_url: string | null;
  activado: boolean | null;
  restaurante: boolean | null;
  touza: boolean | null;
}

/** De dónde sale la foto de la carta: tabla, bucket público y cómo se llama en los mensajes. */
interface OrigenCarta {
  tabla: "Platos" | "Vinos";
  bucket: "platos" | "vinos";
  campo: "platoId" | "vinoId";
  nombre: "plato" | "vino";
}
const CARTA_PLATOS: OrigenCarta = { tabla: "Platos", bucket: "platos", campo: "platoId", nombre: "plato" };
const CARTA_VINOS: OrigenCarta = { tabla: "Vinos", bucket: "vinos", campo: "vinoId", nombre: "vino" };

/** Copia la foto de un plato (o de un vino) de la carta a tmp/ (ver la cabecera). */
async function prepararCarta(s: Sesion, marca: unknown, id: unknown, deps: DependenciasDrive, o: OrigenCarta = CARTA_PLATOS): Promise<Response> {
  if (!esMarcaDrive(marca) || typeof id !== "string" || !RE_ID_PLATO.test(id)) {
    return json(400, { ok: false, error: `Faltan «marca» o «${o.campo}» válidos` });
  }
  // Con el JWT del usuario: decide la RLS de la tabla.
  const r = await s.fetch(`${s.sb.url}/rest/v1/${o.tabla}?id=eq.${encodeURIComponent(id)}&select=id,imagen_url,activado,restaurante,touza`, {
    headers: { apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo leer el ${o.nombre} (${r.status})`, r.status);
  const filas = (await r.json().catch(() => [])) as FilaPlato[];
  const plato = Array.isArray(filas) ? filas[0] : undefined;
  if (!plato) return json(404, { ok: false, error: `Ese ${o.nombre} no existe (o no tienes permiso para verlo)` });
  const deMarca = marca === "touza" ? plato.touza === true : plato.restaurante === true;
  if (!deMarca || plato.activado !== true) return json(404, { ok: false, error: `Ese ${o.nombre} no está activo en la carta de esta marca` });
  const ruta = rutaBucketDeUrl(plato.imagen_url, s.sb.url, o.bucket);
  if (!ruta) return json(400, { ok: false, error: `La foto de ese ${o.nombre} no está en el bucket «${o.bucket}» de este Supabase` });

  // Si la ficha tiene original en Drive, se copia ESE (tamaño completo) y no la versión web.
  const conOriginal = await prepararOriginal(s, o, id, deps);
  if (conOriginal.respuesta) return conOriginal.respuesta;

  // Se reconstruye la URL (nunca la de la fila) y no se siguen redirecciones.
  const origenUrl = `${s.sb.url}/storage/v1/object/public/${o.bucket}/${ruta.split("/").map(encodeURIComponent).join("/")}`;
  const d = await s.fetch(origenUrl, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!d.ok) return json(502, { ok: false, error: `No se pudo descargar la foto del ${o.nombre} (${d.status})` });
  const tipo = (d.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!TIPOS_IMAGEN[tipo]) return json(422, { ok: false, error: `La foto del ${o.nombre} es ${tipo || "de un tipo desconocido"}; solo valen JPEG, PNG o WebP` });
  if (Number(d.headers.get("content-length") ?? "0") > MAX_BYTES_FOTO) return json(422, { ok: false, error: `La foto del ${o.nombre} pesa más de 8 MB` });
  const bytes = new Uint8Array(await d.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES_FOTO) return json(422, { ok: false, error: `La foto del ${o.nombre} pesa más de 8 MB` });

  const destino = `tmp/${(deps.nuevoId ?? (() => crypto.randomUUID()))()}.${TIPOS_IMAGEN[tipo]}`;
  await subirObjeto(s, destino, bytes, tipo);
  const m = medidasImagen(bytes, tipo);
  await limpiarTmp(s, deps.ahora ?? Date.now, destino);
  return json(200, {
    ok: true,
    ruta: destino,
    url: urlPublica(s.sb, destino),
    ancho: m?.ancho ?? null,
    alto: m?.alto ?? null,
    original: false,
    ...(conOriginal.aviso ? { aviso: conOriginal.aviso } : {}),
  });
}

/**
 * Copia a tmp/ el ORIGINAL de Drive de una ficha de la carta, si lo tiene.
 * `respuesta`: el 200 listo. Sin original (o sin Drive configurado): nada,
 * y se usa la versión web. Si el original falla: `aviso` y versión web.
 */
async function prepararOriginal(s: Sesion, o: OrigenCarta, id: string, deps: DependenciasDrive): Promise<{ respuesta?: Response; aviso?: string }> {
  const env = deps.env ?? entornoDeno();
  const cfg = leerConfigDrive(env, { fetch: deps.fetch, ahora: deps.ahora });
  if ("faltan" in cfg) return {};
  const aviso = "No se ha podido usar el original de Drive: se usa la foto de la web.";
  try {
    const { fila } = await leerOriginal(s, o.tabla, id);
    if (!fila) return {};
    const c = cfg.config;
    const carpeta = await carpetaCarta(c, fila.marca);
    const f = await c.cliente.metadatos(fila.drive_id, "id,mimeType,size,parents,trashed,imageMediaMetadata(width,height,rotation)");
    if (!f || f.trashed || !estaEn(f, carpeta) || f.mimeType !== "image/jpeg" || Number(f.size ?? "0") > MAX_BYTES_FOTO) {
      registro("warn", ETIQUETA, "original no válido", { tabla: o.tabla, id, driveId: fila.drive_id });
      return { aviso };
    }
    const { bytes } = await c.cliente.descargar(f.id);
    const m = medidasJpeg(bytes);
    if (!m || bytes.byteLength > MAX_BYTES_FOTO) return { aviso };
    const destino = `tmp/${(deps.nuevoId ?? (() => crypto.randomUUID()))()}.jpg`;
    await subirObjeto(s, destino, bytes, "image/jpeg");
    await limpiarTmp(s, deps.ahora ?? Date.now, destino);
    return { respuesta: json(200, { ok: true, ruta: destino, url: urlPublica(s.sb, destino), ancho: m.ancho, alto: m.alto, original: true }) };
  } catch (e) {
    registro("warn", ETIQUETA, "original de Drive", { tabla: o.tabla, id, error: sanear((e as Error)?.message ?? e) });
    return { aviso };
  }
}

/** Sube el original de la foto de un plato o vino a Drive (ver la cabecera). */
async function subirOriginal(request: Request, env: Record<string, string | undefined>, deps: DependenciasDrive): Promise<Response> {
  const auth = await autorizarMarketing(request.headers.get("authorization"), { env, fetch: deps.fetch, permiso: "editar", seccion: SECCION_CARTA });
  if ("motivo" in auth) {
    if (auth.estado >= 500) registro("error", ETIQUETA, "autorización (original)", { motivo: auth.motivo });
    return jsonAuth(auth.estado, auth.estado === 403 ? SIN_PERMISO_CARTA : auth.motivo);
  }
  const s = auth.sesion;
  const largo = Number(request.headers.get("content-length") ?? "0");
  if (largo > MAX_BYTES_ORIGINAL + 64 * 1024) return json(413, { ok: false, error: "El original pesa más de 8 MB" });
  const cfg = leerConfigDrive(env, { fetch: deps.fetch, ahora: deps.ahora });
  if ("faltan" in cfg) return sinConfig(cfg.faltan, cfg.problema, env);
  const c = cfg.config;

  let datos: FormData;
  try {
    datos = await request.formData();
  } catch {
    return json(400, { ok: false, error: "Se esperaba un formulario multipart con el original" });
  }
  const tabla = datos.get("tabla");
  const id = datos.get("id");
  const archivo = datos.get("archivo");
  if (tabla !== "Platos" && tabla !== "Vinos") return json(400, { ok: false, error: "«tabla» tiene que ser Platos o Vinos" });
  if (typeof id !== "string" || !RE_ID_PLATO.test(id)) return json(400, { ok: false, error: "Falta un «id» válido" });
  if (!archivo || typeof archivo === "string") return json(400, { ok: false, error: "Falta el original («archivo»)" });
  if (archivo.size > MAX_BYTES_ORIGINAL) return json(413, { ok: false, error: "El original pesa más de 8 MB" });
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const medidas = medidasJpeg(bytes);
  if (!medidas) return json(415, { ok: false, error: "El original tiene que ser un JPEG (el panel lo convierte antes de subirlo)" });
  if (medidas.ancho > LADO_MAXIMO_ORIGINAL || medidas.alto > LADO_MAXIMO_ORIGINAL) {
    return json(422, { ok: false, error: `El original mide ${medidas.ancho}×${medidas.alto}; el lado mayor no puede pasar de ${LADO_MAXIMO_ORIGINAL} px` });
  }
  const o = tabla === "Vinos" ? CARTA_VINOS : CARTA_PLATOS;

  try {
    // La ficha, con el JWT del usuario (decide la RLS): nombre y marca.
    const r = await s.fetch(`${s.sb.url}/rest/v1/${o.tabla}?id=eq.${encodeURIComponent(id)}&select=id,nombre,restaurante,touza`, {
      headers: { apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new ErrorSupabase(`No se pudo leer el ${o.nombre} (${r.status})`, r.status);
    const fichas = (await r.json().catch(() => [])) as Array<{ id: string; nombre: string | null; restaurante: boolean | null; touza: boolean | null }>;
    const ficha = Array.isArray(fichas) ? fichas[0] : undefined;
    if (!ficha) return json(404, { ok: false, error: `Ese ${o.nombre} no existe (o no tienes permiso para verlo)` });

    const previo = await leerOriginal(s, o.tabla, id);
    if (previo.sinTabla) {
      return json(503, { ok: false, error: `Falta aplicar la migración ${MIGRACION_ORIGINALES}`, comoArreglarlo: "Aplica la migración en Supabase (ver docs/instagram-fotos.md)." });
    }
    const marca = marcaDeFicha(ficha);
    const carpeta = await carpetaCarta(c, marca);
    const nombre = `${nombreSeguro((ficha.nombre ?? "").trim() || o.nombre)}-${id}.jpg`;
    const descripcion = `Original de la foto del ${o.nombre} «${(ficha.nombre ?? "").trim() || id}» (carta)`;

    let subido: FicheroDrive | null = null;
    if (previo.fila?.drive_id) {
      const f = await c.cliente.metadatos(previo.fila.drive_id, "id,parents,trashed");
      if (f && !f.trashed && estaEn(f, carpeta)) subido = await c.cliente.reemplazar(f.id, nombre, "image/jpeg", bytes, descripcion);
    }
    const reemplazado = !!subido;
    if (!subido) subido = await c.cliente.subir(carpeta, nombre, "image/jpeg", bytes, descripcion);

    try {
      await guardarOriginal(s, o.tabla, id, { drive_id: subido.id, marca, nombre, ancho: medidas.ancho, alto: medidas.alto, bytes: bytes.byteLength });
    } catch (e) {
      registro("warn", ETIQUETA, "original en Drive sin fila", { tabla: o.tabla, id, driveId: subido.id, error: (e as Error).message });
      return json(500, { ok: false, error: `El original está en Drive, pero no se pudo anotar en la ficha: ${sanear((e as Error).message)}`, driveId: subido.id });
    }
    registro("info", ETIQUETA, "original subido", { tabla: o.tabla, id, marca, driveId: subido.id, reemplazado, usuario: s.usuario });
    return json(200, { ok: true, tabla: o.tabla, id, driveId: subido.id, marca, nombre, ancho: medidas.ancho, alto: medidas.alto, reemplazado });
  } catch (e) {
    if (e instanceof ErrorDrive) {
      registro("warn", ETIQUETA, "Drive (original)", { motivo: e.motivo, estado: e.estado, mensaje: e.message });
      return await errorDrive(e, c);
    }
    if (e instanceof ErrorSupabase) {
      registro("error", ETIQUETA, "Supabase (original)", e);
      return json(e.estado === 401 || e.estado === 403 ? 403 : 500, { ok: false, error: e.message });
    }
    registro("error", ETIQUETA, "fallo (original)", e);
    return json(500, { ok: false, error: "No se pudo guardar el original en Drive", detalle: sanear((e as Error)?.message ?? e) });
  }
}

// ---------------------------------------------------------------------------
// Originales de la carta SOLO en Drive (08/11/2026): descargar y vídeos.
// ---------------------------------------------------------------------------

/** Vídeo original de un plato: el mismo tope que el bruto del flujo «dispositivo potente». */
export const MAX_BYTES_VIDEO_ORIGINAL = 50 * 1024 * 1024;
/** Extensiones de vídeo admitidas → tipo MIME (las de tipoMimeBruto del panel). */
export const TIPOS_VIDEO: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
  mkv: "video/x-matroska",
};
const SIN_ORIGINAL = "Esta ficha no tiene original en Google Drive";

/** Extensión del vídeo por nombre o tipo; null si no es de los admitidos. */
export function extensionVideo(nombre: string, tipo: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(nombre)?.[1]?.toLowerCase();
  if (ext && TIPOS_VIDEO[ext]) return ext;
  const t = tipo.toLowerCase().split(";")[0].trim();
  if (t === "video/quicktime") return "mov";
  if (t === "video/webm") return "webm";
  if (t === "video/3gpp") return "3gp";
  if (t === "video/x-matroska") return "mkv";
  if (t === "video/mp4") return "mp4";
  return null;
}

/** ¿La cabecera es de un vídeo? (ISO BMFF «ftyp» —mp4/mov/m4v/3gp— o EBML —webm/mkv—). */
export function pareceVideo(cabecera: Uint8Array): boolean {
  if (cabecera.length >= 8 && String.fromCharCode(...cabecera.subarray(4, 8)) === "ftyp") return true;
  return cabecera.length >= 4 && cabecera[0] === 0x1a && cabecera[1] === 0x45 && cabecera[2] === 0xdf && cabecera[3] === 0xa3;
}

/** Nombre del vídeo original de un plato en Drive (uno por plato). */
export const nombreVideoOriginal = (id: string, ext: string) => `${id}.${ext}`;
/** El id ya está validado con RE_ID_PLATO (solo letras, números, «_» y «-»). */
const esVideoDePlato = (f: FicheroDrive, id: string) => !f.trashed && f.name.toLowerCase().startsWith(`${id.toLowerCase()}.`) && /^\.[a-z0-9]{2,4}$/i.test(f.name.slice(id.length));

async function autorizarCarta(request: Request, env: Record<string, string | undefined>, deps: DependenciasDrive): Promise<{ s: Sesion } | { respuesta: Response }> {
  const auth = await autorizarMarketing(request.headers.get("authorization"), { env, fetch: deps.fetch, permiso: "editar", seccion: SECCION_CARTA });
  if ("motivo" in auth) {
    if (auth.estado >= 500) registro("error", ETIQUETA, "autorización (carta)", { motivo: auth.motivo });
    return { respuesta: jsonAuth(auth.estado, auth.estado === 403 ? SIN_PERMISO_CARTA : auth.motivo) };
  }
  return { s: auth.sesion };
}

interface FichaCarta {
  id: string;
  nombre: string | null;
  restaurante: boolean | null;
  touza: boolean | null;
}

/** Ficha de "Platos"/"Vinos" con el JWT del usuario (decide la RLS). */
async function leerFicha(s: Sesion, o: OrigenCarta, id: string): Promise<FichaCarta | null> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/${o.tabla}?id=eq.${encodeURIComponent(id)}&select=id,nombre,restaurante,touza`, {
    headers: { apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo leer el ${o.nombre} (${r.status})`, r.status);
  const filas = (await r.json().catch(() => [])) as FichaCarta[];
  return Array.isArray(filas) && filas[0] ? filas[0] : null;
}

/** Vídeo original de un plato en marketing/carta/<marca>/videos (primero en la marca de la ficha). */
async function buscarVideoOriginal(c: ConfigDriveInstagram, id: string, marcas: MarcaDrive[]): Promise<{ f: FicheroDrive; marca: MarcaDrive; carpeta: string } | null> {
  for (const marca of marcas) {
    const carpeta = await carpetaVideosCarta(c, marca);
    const f = (await c.cliente.buscarEnCarpeta(carpeta, `${id}.`)).find((x) => esVideoDePlato(x, id) && estaEn(x, carpeta));
    if (f) return { f, marca, carpeta };
  }
  return null;
}

function binario(bytes: Uint8Array, tipo: string): Response {
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: { ...CORS, "Content-Type": tipo, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function errorCarta(e: unknown, c: ConfigDriveInstagram, que: string): Promise<Response> {
  if (e instanceof ErrorDrive) {
    registro("warn", ETIQUETA, `Drive (${que})`, { motivo: e.motivo, estado: e.estado, mensaje: e.message });
    return await errorDrive(e, c);
  }
  if (e instanceof ErrorSupabase) {
    registro("error", ETIQUETA, `Supabase (${que})`, e);
    return json(e.estado === 401 || e.estado === 403 ? 403 : 500, { ok: false, error: e.message });
  }
  registro("error", ETIQUETA, `fallo (${que})`, e);
  return json(500, { ok: false, error: `No se pudo completar la operación con Drive (${que})`, detalle: sanear((e as Error)?.message ?? e) });
}

/** Devuelve (o comprueba) el ORIGINAL de Drive de un plato o vino (ver la cabecera). */
async function descargarOriginal(request: Request, env: Record<string, string | undefined>, deps: DependenciasDrive): Promise<Response> {
  const a = await autorizarCarta(request, env, deps);
  if ("respuesta" in a) return a.respuesta;
  const s = a.s;
  const leido = await leerJson(request, 16 * 1024);
  if ("error" in leido) return json(leido.estado, { ok: false, error: leido.error });
  const cuerpo = (leido.valor && typeof leido.valor === "object" ? leido.valor : {}) as Record<string, unknown>;
  const { tabla, id } = cuerpo;
  const tipo = cuerpo.tipo ?? "foto";
  const comprobar = cuerpo.comprobar === true;
  if (tabla !== "Platos" && tabla !== "Vinos") return json(400, { ok: false, error: "«tabla» tiene que ser Platos o Vinos" });
  if (typeof id !== "string" || !RE_ID_PLATO.test(id)) return json(400, { ok: false, error: "Falta un «id» válido" });
  if (tipo !== "foto" && tipo !== "video") return json(400, { ok: false, error: "«tipo» tiene que ser foto o video" });
  if (tipo === "video" && tabla !== "Platos") return json(400, { ok: false, error: "Solo los platos tienen vídeo" });
  const cfg = leerConfigDrive(env, { fetch: deps.fetch, ahora: deps.ahora });
  if ("faltan" in cfg) return sinConfig(cfg.faltan, cfg.problema, env);
  const c = cfg.config;
  const o = tabla === "Vinos" ? CARTA_VINOS : CARTA_PLATOS;

  try {
    if (tipo === "video") {
      const ficha = await leerFicha(s, o, id);
      if (!ficha) return json(404, { ok: false, error: `Ese ${o.nombre} no existe (o no tienes permiso para verlo)` });
      const propia = marcaDeFicha(ficha);
      const hallado = await buscarVideoOriginal(c, id, [propia, propia === "touza" ? "casa-tomas" : "touza"]);
      if (!hallado) return json(404, { ok: false, sinOriginal: true, error: SIN_ORIGINAL });
      const { f, marca } = hallado;
      const ext = extensionVideo(f.name, f.mimeType);
      const mime = ext ? TIPOS_VIDEO[ext] : null;
      if (!mime) return json(422, { ok: false, error: "El original de Drive no es un vídeo admitido" });
      if (Number(f.size ?? "0") > MAX_BYTES_VIDEO_ORIGINAL) return json(422, { ok: false, error: "El vídeo original pesa más de 50 MB" });
      if (comprobar) return json(200, { ok: true, tipo: "video", tabla, id, driveId: f.id, nombre: f.name, mimeType: mime, bytes: Number(f.size ?? "0"), marca });
      const { bytes } = await c.cliente.descargar(f.id);
      if (bytes.byteLength > MAX_BYTES_VIDEO_ORIGINAL) return json(422, { ok: false, error: "El vídeo original pesa más de 50 MB" });
      registro("info", ETIQUETA, "original descargado", { tabla, id, tipo, usuario: s.usuario });
      return binario(bytes, mime);
    }

    const { fila, sinTabla } = await leerOriginal(s, o.tabla, id);
    if (sinTabla) {
      return json(503, { ok: false, error: `Falta aplicar la migración ${MIGRACION_ORIGINALES}`, comoArreglarlo: "Aplica la migración en Supabase (ver docs/instagram-fotos.md)." });
    }
    if (!fila) return json(404, { ok: false, sinOriginal: true, error: SIN_ORIGINAL });
    const carpeta = await carpetaCarta(c, fila.marca);
    const f = await c.cliente.metadatos(fila.drive_id, "id,name,mimeType,size,parents,trashed,imageMediaMetadata(width,height,rotation)");
    if (!f || f.trashed || !estaEn(f, carpeta)) {
      registro("warn", ETIQUETA, "original anotado fuera de su carpeta", { tabla, id, driveId: fila.drive_id });
      return json(404, { ok: false, sinOriginal: true, error: "El original anotado ya no está en la carpeta de la carta de Drive" });
    }
    if (f.mimeType !== "image/jpeg" || Number(f.size ?? "0") > MAX_BYTES_ORIGINAL) return json(422, { ok: false, error: "El original de Drive no es un JPEG de hasta 8 MB" });
    const m = medidasDrive(f);
    if (comprobar) {
      return json(200, {
        ok: true,
        tipo: "foto",
        tabla,
        id,
        driveId: f.id,
        nombre: f.name,
        mimeType: f.mimeType,
        bytes: Number(f.size ?? "0"),
        ancho: m?.ancho ?? fila.ancho,
        alto: m?.alto ?? fila.alto,
        marca: fila.marca,
      });
    }
    const { bytes } = await c.cliente.descargar(f.id);
    if (bytes.byteLength > MAX_BYTES_ORIGINAL || !medidasJpeg(bytes)) return json(422, { ok: false, error: "El original de Drive no es un JPEG de hasta 8 MB" });
    registro("info", ETIQUETA, "original descargado", { tabla, id, tipo, usuario: s.usuario });
    return binario(bytes, "image/jpeg");
  } catch (e) {
    return await errorCarta(e, c, "descargar original");
  }
}

/** Sube (o reemplaza) el vídeo ORIGINAL de un plato a Drive (ver la cabecera). */
async function subirOriginalVideo(request: Request, env: Record<string, string | undefined>, deps: DependenciasDrive): Promise<Response> {
  const a = await autorizarCarta(request, env, deps);
  if ("respuesta" in a) return a.respuesta;
  const s = a.s;
  const largo = Number(request.headers.get("content-length") ?? "0");
  if (largo > MAX_BYTES_VIDEO_ORIGINAL + 64 * 1024) return json(413, { ok: false, error: "El vídeo original pesa más de 50 MB" });
  const cfg = leerConfigDrive(env, { fetch: deps.fetch, ahora: deps.ahora });
  if ("faltan" in cfg) return sinConfig(cfg.faltan, cfg.problema, env);
  const c = cfg.config;

  let datos: FormData;
  try {
    datos = await request.formData();
  } catch {
    return json(400, { ok: false, error: "Se esperaba un formulario multipart con el vídeo" });
  }
  const tabla = datos.get("tabla") ?? "Platos";
  const id = datos.get("id");
  const archivo = datos.get("archivo");
  if (tabla !== "Platos") return json(400, { ok: false, error: "Solo los platos tienen vídeo («tabla» = Platos)" });
  if (typeof id !== "string" || !RE_ID_PLATO.test(id)) return json(400, { ok: false, error: "Falta un «id» válido" });
  if (!archivo || typeof archivo === "string") return json(400, { ok: false, error: "Falta el vídeo («archivo»)" });
  if (archivo.size > MAX_BYTES_VIDEO_ORIGINAL) return json(413, { ok: false, error: "El vídeo original pesa más de 50 MB" });
  if (archivo.size === 0) return json(400, { ok: false, error: "El vídeo está vacío" });
  const ext = extensionVideo(archivo.name ?? "", archivo.type ?? "");
  if (!ext || !pareceVideo(new Uint8Array(await archivo.slice(0, 16).arrayBuffer()))) {
    return json(415, { ok: false, error: "El original tiene que ser un vídeo mp4, mov, m4v, webm, 3gp o mkv" });
  }

  try {
    const ficha = await leerFicha(s, CARTA_PLATOS, id);
    if (!ficha) return json(404, { ok: false, error: "Ese plato no existe (o no tienes permiso para verlo)" });
    const marca = marcaDeFicha(ficha);
    const carpeta = await carpetaVideosCarta(c, marca);
    const nombre = nombreVideoOriginal(id, ext);
    const descripcion = `Vídeo original del plato «${(ficha.nombre ?? "").trim() || id}» (carta)`;
    const previo = (await c.cliente.buscarEnCarpeta(carpeta, `${id}.`)).find((x) => esVideoDePlato(x, id) && estaEn(x, carpeta));
    const subido = await c.cliente.subirReanudable({ ...(previo ? { reemplazarId: previo.id } : { carpeta }), nombre, tipo: TIPOS_VIDEO[ext], datos: archivo, descripcion });
    registro("info", ETIQUETA, "vídeo original subido", { id, marca, driveId: subido.id, reemplazado: !!previo, usuario: s.usuario });
    return json(200, { ok: true, tabla: "Platos", id, driveId: subido.id, marca, nombre, bytes: archivo.size, reemplazado: !!previo });
  } catch (e) {
    return await errorCarta(e, c, "vídeo original");
  }
}

/** Borra las copias tmp/ de más de 24 h. Oportunista: nunca falla la petición. */
export async function limpiarTmp(s: Sesion, ahora: () => number, salvo?: string): Promise<number> {
  const objetos = await listarObjetos(s, "tmp", 200);
  const limite = ahora() - VIDA_TMP_MS;
  const viejas = objetos
    .filter((o) => o.created_at && Date.parse(o.created_at) < limite)
    .map((o) => `tmp/${o.name}`)
    .filter((r) => r !== salvo);
  if (!viejas.length) return 0;
  const n = await borrarObjetos(s, viejas.slice(0, 100));
  registro("info", ETIQUETA, "limpieza tmp", { borradas: n });
  return n;
}

async function subir(s: Sesion, c: ConfigDriveInstagram, request: Request, deps: DependenciasDrive): Promise<Response> {
  const largo = Number(request.headers.get("content-length") ?? "0");
  if (largo > MAX_BYTES_FOTO + 64 * 1024) return json(413, { ok: false, error: "La foto pesa más de 8 MB" });
  let datos: FormData;
  try {
    datos = await request.formData();
  } catch {
    return json(400, { ok: false, error: "Se esperaba un formulario multipart con la foto" });
  }
  const marca = datos.get("marca");
  const tipo = datos.get("tipo");
  const descripcion = String(datos.get("descripcion") ?? "").trim();
  const archivo = datos.get("archivo");
  if (!esMarcaDrive(marca)) return json(400, { ok: false, error: "«marca» tiene que ser casa-tomas o touza" });
  if (typeof tipo !== "string" || !(TIPOS_FOTO as readonly string[]).includes(tipo)) return json(400, { ok: false, error: `«tipo» tiene que ser uno de: ${TIPOS_FOTO.join(", ")}` });
  if ([...descripcion].length > MAX_DESCRIPCION) return json(400, { ok: false, error: `La descripción tiene más de ${MAX_DESCRIPCION} caracteres` });
  if (!archivo || typeof archivo === "string") return json(400, { ok: false, error: "Falta la foto («archivo»)" });
  if (archivo.size > MAX_BYTES_FOTO) return json(413, { ok: false, error: "La foto pesa más de 8 MB" });
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const medidas = medidasJpeg(bytes);
  if (!medidas) return json(415, { ok: false, error: "La foto tiene que ser un JPEG (el panel la convierte antes de subirla)" });
  if (medidas.ancho > LADO_MAXIMO || medidas.alto > LADO_MAXIMO) return json(422, { ok: false, error: `La foto mide ${medidas.ancho}×${medidas.alto}; el lado mayor no puede pasar de ${LADO_MAXIMO} px` });

  const id = (deps.nuevoId ?? (() => crypto.randomUUID()))();
  const fecha = new Date((deps.ahora ?? Date.now)()).toISOString().slice(0, 10);
  const nombre = `${fecha}-${nombreSeguro(descripcion)}-${id.slice(0, 8)}.jpg`;
  const carpeta = await carpetaFotos(c, marca);
  const subido = await c.cliente.subir(carpeta, nombre, "image/jpeg", bytes, descripcion || undefined);

  const avisos: string[] = [];
  let fila: FilaFotoDrive | undefined;
  try {
    fila = await insertarFotoDrive(s, { id, marca, drive_id: subido.id, ancho: medidas.ancho, alto: medidas.alto, tipo, descripcion });
  } catch (e) {
    // La foto ya está en Drive (que es el archivo de verdad): sale igual, sin tipo.
    registro("warn", ETIQUETA, "foto en Drive sin fila", { driveId: subido.id, error: (e as Error).message });
    avisos.push(`La foto está en Drive, pero no se pudieron guardar su tipo y su descripción: ${sanear((e as Error).message)}`);
  }
  const foto = aRespuesta({ ...subido, mimeType: "image/jpeg", size: String(bytes.byteLength), imageMediaMetadata: { width: medidas.ancho, height: medidas.alto } }, fila);
  registro("info", ETIQUETA, "foto subida", { marca, driveId: subido.id, usuario: s.usuario });
  return json(200, { ok: true, foto, avisos });
}
