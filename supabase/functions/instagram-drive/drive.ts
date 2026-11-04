/**
 * Edge Function instagram-drive — biblioteca de fotos de Marketing › Instagram
 * en Google Drive (marketing/instagram/fotos/<marca>). Ver docs/instagram-fotos.md.
 *
 * Autorización: JWT de Supabase + can_write_section('marketing') (igual que
 * instagram-publicar e instagram-estado). Supabase (tabla instagram_fotos y
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
  carpetaFotos,
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
  const auth = await autorizarMarketing(request.headers.get("authorization"), { env, fetch: deps.fetch });
  if ("motivo" in auth) {
    if (auth.estado >= 500) registro("error", ETIQUETA, "autorización", { motivo: auth.motivo });
    return jsonAuth(auth.estado, auth.motivo);
  }
  const s = auth.sesion;
  const url = new URL(request.url);
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

  const cfg = leerConfigDrive(env, { fetch: deps.fetch, ahora: deps.ahora });
  if ("faltan" in cfg) return sinConfig(cfg.faltan, cfg.problema, env);
  const c = cfg.config;

  try {
    if (request.method === "GET" && accion === "miniatura") return await miniatura(c, url.searchParams.get("marca"), url.searchParams.get("id"));
    if (request.method === "POST" && accion === "listar") return await listar(s, c, cuerpo.marca);
    if (request.method === "POST" && accion === "preparar") return await preparar(s, c, cuerpo.marca, cuerpo.id, deps);
    if (request.method === "POST" && accion === "subir") return await subir(s, c, request, deps);
    return json(400, { ok: false, error: "Acción no válida (listar, subir, miniatura o preparar)" });
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
