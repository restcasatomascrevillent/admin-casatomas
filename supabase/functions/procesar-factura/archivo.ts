// ============================================================================
//  Archivado del documento original: SIEMPRE en Google Drive
// ----------------------------------------------------------------------------
//  Orden del dueño (05-nov-2026): «no se puede guardar nada en Supabase
//  Storage, que reventamos el almacenamiento». El bucket `facturas-originales`
//  es solo un ALMACÉN TEMPORAL de trabajo:
//    - pendientes/{uid}/{trabajo}/…  lo que sube el panel para el OCR por
//      trabajos (documentos largos). Se borra al archivar el original y al
//      terminar o fallar el trabajo (limpiarPendientesTrabajo).
//    - temporal/{factura}-{nombre}   el original de una factura cuando Drive
//      falla al guardarla. La factura queda «pendiente de Drive»
//      (archivo_path sin drive_url) y la función facturas-originales-drive
//      (pg_cron cada 10 min) la sube a Drive y borra la copia.
//  Las rutas antiguas (AAAA/MM/{factura}-…) siguen abriéndose en el panel
//  mientras existan; el rescate las pasa a Drive y las borra.
//
//  La configuración de Drive llega por parámetro (ConfigDrive) en vez de
//  leerse de Deno.env al cargar el módulo.
// ============================================================================

// Creado por la migracion 20260919110000_facturas_archivo_original_y_validacion.sql
export const STORAGE_BUCKET = "facturas-originales";
/** Prefijo de los originales que esperan a Drive (Drive falló al guardar). */
export const CARPETA_TEMPORAL = "temporal";
/** Tras estos fallos seguidos subiendo a Drive, aviso en la campana del panel. */
export const FALLOS_DRIVE_AVISO = 5;

export interface ConfigDrive {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  parentFolder: string;
}

/** Los secretos pegados en el panel de Supabase pueden arrastrar un salto de
 *  línea final (pasó el 04-nov-2026: Google respondía «invalid_client»). */
export function limpiarConfigDrive(cfg: ConfigDrive): ConfigDrive {
  return {
    clientId: (cfg.clientId ?? "").trim(),
    clientSecret: (cfg.clientSecret ?? "").trim(),
    refreshToken: (cfg.refreshToken ?? "").trim(),
    parentFolder: (cfg.parentFolder ?? "").trim(),
  };
}

export function driveActivo(cfg: ConfigDrive): boolean {
  return !!(cfg.clientId && cfg.clientSecret && cfg.refreshToken && cfg.parentFolder);
}

export const DRIVE_NO_CONFIGURADO = "Drive no configurado (faltan los secretos GOOGLE_*)";

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ─── Google Drive (OAuth refresh token) ──────────────────────────────────────
// El token dura 1 h: se reutiliza dentro de la misma instancia (el rescate
// sube decenas de ficheros seguidos y no hace falta pedir uno por fichero).
let tokenCache: { clave: string; token: string; hasta: number } | null = null;

// Carpetas ya encontradas/creadas (padre|nombre → id), 10 min por instancia:
// el rescate sube muchos ficheros a las mismas carpetas proveedor → mes.
const carpetasCache = new Map<string, { id: string; hasta: number }>();
const CARPETAS_MS = 10 * 60 * 1000;

/** Solo para las pruebas. */
export function _olvidarTokenDrive(): void {
  tokenCache = null;
  carpetasCache.clear();
}

/** Fallo de Drive con su código HTTP (para invalidar las cachés ante 401/404). */
export class ErrorDrive extends Error {
  constructor(mensaje: string, readonly status: number) {
    super(mensaje);
  }
}

async function driveToken(cfgCruda: ConfigDrive): Promise<string> {
  const cfg = limpiarConfigDrive(cfgCruda);
  const clave = `${cfg.clientId}|${cfg.refreshToken}`;
  if (tokenCache && tokenCache.clave === clave && tokenCache.hasta > Date.now()) return tokenCache.token;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new ErrorDrive(`Drive token ${res.status}: ${await res.text()}`, res.status);
  const j = await res.json();
  const segundos = Number(j.expires_in) > 0 ? Number(j.expires_in) : 3600;
  tokenCache = { clave, token: j.access_token, hasta: Date.now() + (segundos - 300) * 1000 };
  return j.access_token;
}

// Búsquedas/creaciones de carpeta en curso en ESTA instancia (padre|nombre →
// promesa): dos subidas a la vez para un proveedor nuevo esperan a la misma
// en vez de crear dos carpetas iguales (QA 05/11/2026, S-11).
const carpetasEnCurso = new Map<string, Promise<string>>();

async function ensureFolder(name: string, parentId: string, token: string): Promise<string> {
  const clave = `${parentId}|${name}`;
  const enCache = carpetasCache.get(clave);
  if (enCache && enCache.hasta > Date.now()) return enCache.id;
  const enCurso = carpetasEnCurso.get(clave);
  if (enCurso) return enCurso;
  const p = buscarOCrearCarpeta(name, parentId, token)
    .then((id) => {
      carpetasCache.set(clave, { id, hasta: Date.now() + CARPETAS_MS });
      return id;
    })
    .finally(() => carpetasEnCurso.delete(clave));
  carpetasEnCurso.set(clave, p);
  return p;
}

async function listarCarpetas(name: string, parentId: string, token: string): Promise<{ id: string }[]> {
  const q = encodeURIComponent(
    `name='${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  // La más antigua primero: si otra instancia creó una igual a la vez, todas
  // acaban usando la misma.
  const list = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime&spaces=drive`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!list.ok) throw new ErrorDrive(`Drive buscar carpeta ${list.status}: ${await list.text()}`, list.status);
  return (((await list.json()).files ?? []) as { id: string }[]).filter((c) => !!c?.id);
}

async function buscarOCrearCarpeta(name: string, parentId: string, token: string): Promise<string> {
  const found = (await listarCarpetas(name, parentId, token))[0];
  if (found) return found.id;
  const create = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  if (!create.ok) throw new ErrorDrive(`Drive crear carpeta ${create.status}: ${await create.text()}`, create.status);
  const creada: string = (await create.json()).id;
  // Carrera con otra instancia: si ya hay una más antigua con el mismo nombre,
  // se usa esa y se borra la recién creada (está vacía).
  try {
    const todas = await listarCarpetas(name, parentId, token);
    const primera = todas[0]?.id;
    if (primera && primera !== creada && todas.some((c) => c.id === creada)) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${creada}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
      return primera;
    }
  } catch {
    // Si no se puede comprobar, se usa la creada.
  }
  return creada;
}

/** Ante 401 (token caducado o revocado) o 404 (carpeta borrada) se olvidan las cachés. */
function olvidarSiCaduca(e: unknown): void {
  const status = e instanceof ErrorDrive ? e.status : 0;
  if (status === 401 || status === 403) tokenCache = null;
  if (status === 404 || status === 401) carpetasCache.clear();
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/**
 * Carpeta del mes dentro de la del proveedor: «2026-03 Marzo». Lleva el año
 * delante para que Drive las ordene bien y porque el histórico mezcla años.
 * Sin fecha válida → «Sin fecha».
 */
export function carpetaMes(fecha: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(fecha ?? "");
  const n = m ? Number(m[2]) : 0;
  if (!m || n < 1 || n > 12) return "Sin fecha";
  return `${m[1]}-${m[2]} ${MESES[n - 1]}`;
}

/**
 * Nombre de la carpeta del proveedor (orden pedido por el dueño, 04-nov-2026:
 * proveedor → meses). Se usa el nombre canónico de la tabla `proveedores`
 * cuando lo hay, para que «CETAREA ANGEL MAR S.L.» y «CETAREA ANGELMAR S.L.»
 * no acaben en dos carpetas. Se quitan barras y espacios sobrantes.
 */
export function carpetaProveedor(nombre: string | null | undefined): string {
  const limpio = (nombre ?? "")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return limpio || "Sin proveedor";
}

/**
 * Sube un fichero a Drive (carpeta del proveedor → mes) y devuelve su enlace.
 * LANZA si Drive no está configurado o falla: quien llama decide qué hacer.
 */
export async function subirADrive(
  cfg: ConfigDrive,
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  fecha: string | null,
  proveedor: string | null,
): Promise<string> {
  if (!driveActivo(cfg)) throw new Error(DRIVE_NO_CONFIGURADO);
  try {
    const token = await driveToken(cfg);
    const provFolder = await ensureFolder(carpetaProveedor(proveedor), cfg.parentFolder.trim(), token);
    const monthFolder = await ensureFolder(carpetaMes(fecha), provFolder, token);

    // Metadatos y contenido en UNA sola llamada (multipart): si Drive falla
    // no queda un fichero vacío, y un reintento no deja otro (QA, S-8).
    const limite = `casatomas${crypto.randomUUID().replace(/-/g, "")}`;
    const enc = new TextEncoder();
    const cabecera = enc.encode(
      `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name: fileName, parents: [monthFolder] }) +
        `\r\n--${limite}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    );
    const pie = enc.encode(`\r\n--${limite}--`);
    const cuerpo = new Uint8Array(cabecera.length + bytes.length + pie.length);
    cuerpo.set(cabecera, 0);
    cuerpo.set(bytes, cabecera.length);
    cuerpo.set(pie, cabecera.length + bytes.length);
    const up = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${limite}` },
        body: cuerpo,
      },
    );
    if (!up.ok) throw new ErrorDrive(`Drive upload ${up.status}: ${await up.text()}`, up.status);
    const j = await up.json();
    return j.webViewLink ?? `https://drive.google.com/file/d/${j.id}/view`;
  } catch (e) {
    olvidarSiCaduca(e);
    throw e;
  }
}

/**
 * Busca en Drive ficheros (no carpetas, no en la papelera) con ese nombre
 * exacto. Lo usa el rescate a mano de facturas sin original
 * (facturas-originales-drive {accion:"buscar_original"}). LANZA si Drive falla.
 */
export async function buscarEnDrive(
  cfg: ConfigDrive,
  nombre: string,
): Promise<{ id: string; name: string; webViewLink: string; createdTime?: string }[]> {
  if (!driveActivo(cfg)) throw new Error(DRIVE_NO_CONFIGURADO);
  try {
    const token = await driveToken(cfg);
    const q = encodeURIComponent(
      `name='${nombre.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
    );
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink,createdTime)&orderBy=createdTime&spaces=drive&pageSize=20`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) throw new ErrorDrive(`Drive buscar fichero ${r.status}: ${await r.text()}`, r.status);
    type FicheroDrive = { id: string; name: string; webViewLink?: string; createdTime?: string };
    return (((await r.json()).files ?? []) as FicheroDrive[]).map((f) => ({
      id: f.id,
      name: f.name,
      webViewLink: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
      createdTime: f.createdTime,
    }));
  } catch (e) {
    olvidarSiCaduca(e);
    throw e;
  }
}

// ─── Supabase Storage: solo almacén temporal ─────────────────────────────────

// Marcas diacriticas (U+0300–U+036F) que deja sueltas `normalize("NFD")`.
// Se construye con fromCharCode para no depender de secuencias de escape en el
// fichero fuente, que es facil que se corrompan al editarlo.
const DIACRITICOS = new RegExp(
  "[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]",
  "g",
);

/** Nombre de fichero seguro para una clave de Storage. */
export function nombreSeguro(nombre: string): string {
  const limpio = (nombre || "documento")
    .normalize("NFD")
    .replace(DIACRITICOS, "")         // "Factura Nº Ángel" -> "Factura N Angel"
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);                     // por la cola: conserva la extension
  return limpio || "documento";
}

/** Ruta TEMPORAL del original de una factura mientras espera a Drive. */
export function rutaTemporal(facturaId: number, fileName: string): string {
  return `${CARPETA_TEMPORAL}/${facturaId}-${nombreSeguro(fileName)}`;
}

/**
 * Ruta definitiva antigua (AAAA/MM/{factura}-{nombre}). Ya no se escribe nada
 * en ella; se conserva porque hay originales antiguos con esa forma.
 */
export function rutaDefinitiva(fecha: string, facturaId: number, fileName: string): string {
  return `${fecha.slice(0, 4)}/${fecha.slice(5, 7)}/${facturaId}-${nombreSeguro(fileName)}`;
}

/**
 * ¿Es el original de una PÁGINA AÑADIDA ({factura}-pag{n}-…)? Esa copia no es
 * la misma que la del drive_url de la factura (que es la página 1): no se
 * puede borrar sin subirla antes a Drive.
 */
export function esOriginalDePagina(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return /^\d+-pag\d+-/.test(base);
}

/** Nombre con el que un fichero de Storage se sube a Drive (sin el «{factura}-»). */
export function nombreEnDrive(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/^\d+-/, "") || base;
}

export function mimeDeNombre(nombre: string, tipo?: string | null): string {
  if (tipo && tipo !== "application/octet-stream") return tipo;
  const n = nombre.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (/\.(jpe?g)$/.test(n)) return "image/jpeg";
  return "application/octet-stream";
}

/** Guarda el original en la carpeta TEMPORAL del bucket. Devuelve la ruta. */
// deno-lint-ignore no-explicit-any
export async function guardarEnStorage(
  supabase: any,
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  facturaId: number,
): Promise<string> {
  const path = rutaTemporal(facturaId, fileName);
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, new Blob([bytes], { type: mimeType }), {
      contentType: mimeType,
      upsert: true,
    });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  return path;
}

export interface ResultadoArchivo {
  /** Enlace de Drive: el original está archivado y NO queda copia en Storage. */
  drive_url: string | null;
  /** Solo si Drive falló: copia temporal en Storage (pendiente de Drive). */
  archivo_path: string | null;
  /** Se ha perdido el original (ni Drive ni Storage). */
  error: string | null;
  /** Por qué no se subió a Drive (si no se subió). */
  drive_error: string | null;
}

function aBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Archiva el original (llega en base64: subida normal e importación). Drive y
 * nada más; si Drive falla, copia TEMPORAL en Storage para reintentarlo. Nunca
 * lanza: el documento ya está en base de datos y un fallo de archivado no debe
 * invalidar el procesado.
 */
// deno-lint-ignore no-explicit-any
export async function archivarOriginal(
  cfg: ConfigDrive,
  supabase: any,
  b64: string,
  fileName: string,
  mimeType: string,
  fecha: string,
  facturaId: number,
  proveedor: string | null = null,
): Promise<ResultadoArchivo> {
  let bytes: Uint8Array;
  try {
    bytes = aBytes(b64);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "base64 invalido";
    console.error("[archivo] No se pudo decodificar el base64:", msg);
    return { drive_url: null, archivo_path: null, error: msg, drive_error: null };
  }

  // 1) Google Drive.
  let driveError: string;
  try {
    const driveUrl = await subirADrive(cfg, bytes, fileName, mimeType, fecha, proveedor);
    return { drive_url: driveUrl, archivo_path: null, error: null, drive_error: null };
  } catch (e) {
    driveError = mensaje(e);
    console.error(`[Drive] No se pudo subir el original de la factura ${facturaId}; queda temporal en Storage:`, driveError);
  }

  // 2) Copia TEMPORAL (el cron la sube a Drive y la borra).
  try {
    const path = await guardarEnStorage(supabase, bytes, fileName, mimeType, facturaId);
    return { drive_url: null, archivo_path: path, error: null, drive_error: driveError };
  } catch (e) {
    const msg = mensaje(e);
    // Este SI es un problema serio: se ha perdido el original.
    console.error(
      `[archivo] PERDIDA DEL ORIGINAL de la factura ${facturaId} (${fileName}): ${msg}`,
    );
    return { drive_url: null, archivo_path: null, error: msg, drive_error: driveError };
  }
}

/**
 * Archiva un original que ya está en Storage (pendientes/…: documentos largos,
 * sustituir, añadir página). Drive OK → se BORRA de Storage. Drive KO → se
 * mueve a la ruta temporal (`destino`, por defecto temporal/{factura}-…) y
 * queda pendiente de Drive. Nunca lanza.
 */
// deno-lint-ignore no-explicit-any
export async function archivarDesdeStorage(
  cfg: ConfigDrive,
  supabase: any,
  desde: string,
  nombreDrive: string,
  mime: string | null,
  fecha: string | null,
  facturaId: number,
  proveedor: string | null,
  destino: string | null = null,
): Promise<ResultadoArchivo> {
  let driveError: string;
  try {
    if (!driveActivo(cfg)) throw new Error(DRIVE_NO_CONFIGURADO);
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(desde);
    if (error || !data) throw new Error(`Storage download: ${error?.message ?? "sin datos"}`);
    const bytes = new Uint8Array(await data.arrayBuffer());
    const url = await subirADrive(cfg, bytes, nombreDrive, mimeDeNombre(nombreDrive, mime ?? data.type), fecha, proveedor);
    const { error: eBorrar } = await supabase.storage.from(STORAGE_BUCKET).remove([desde]);
    if (eBorrar) console.warn(`[archivo] ${desde} ya está en Drive pero no se pudo borrar (lo borrará la limpieza):`, eBorrar.message);
    return { drive_url: url, archivo_path: null, error: null, drive_error: null };
  } catch (e) {
    driveError = mensaje(e);
    console.error(`[Drive] No se pudo subir ${desde} (factura ${facturaId}); queda temporal en Storage:`, driveError);
  }
  const hasta = destino ?? rutaTemporal(facturaId, nombreDrive);
  const m = await moverPendiente(supabase, desde, hasta);
  if (m.path) return { drive_url: null, archivo_path: m.path, error: null, drive_error: driveError };
  // No se pudo mover: sigue a salvo donde estaba y se apunta ahí.
  return { drive_url: null, archivo_path: desde, error: null, drive_error: `${driveError}; no se pudo mover a ${hasta}: ${m.error}` };
}

/**
 * Mueve un fichero ya subido (pendientes/{uid}/{trabajo}/…) a otra ruta del
 * bucket. Si el destino ya existe (reintento), no es error: se devuelve.
 * Nunca lanza: devuelve la ruta final o el error.
 */
// deno-lint-ignore no-explicit-any
export async function moverPendiente(
  supabase: any,
  desde: string,
  hasta: string,
): Promise<{ path: string | null; error: string | null }> {
  try {
    const { error } = await supabase.storage.from(STORAGE_BUCKET).move(desde, hasta);
    if (!error) return { path: hasta, error: null };
    // Reintento: el destino ya está (se movió en un intento anterior).
    const carpeta = hasta.slice(0, hasta.lastIndexOf("/"));
    const nombre = hasta.slice(hasta.lastIndexOf("/") + 1);
    const { data } = await supabase.storage.from(STORAGE_BUCKET).list(carpeta, { search: nombre });
    // deno-lint-ignore no-explicit-any
    if (Array.isArray(data) && data.some((o: any) => o?.name === nombre)) return { path: hasta, error: null };
    return { path: null, error: error.message ?? String(error) };
  } catch (e) {
    return { path: null, error: mensaje(e) };
  }
}

/**
 * Apunta un fallo subiendo a Drive (RPC facturas_original_drive_fallo: suma
 * el intento y, al llegar a FALLOS_DRIVE_AVISO, deja el aviso en la campana).
 * Nunca lanza (si la migración no está aplicada, solo avisa en el log).
 */
// deno-lint-ignore no-explicit-any
export async function marcarPendienteDrive(supabase: any, facturaId: number, error: string | null): Promise<void> {
  try {
    const { error: e } = await supabase.rpc("facturas_original_drive_fallo", {
      p_factura_id: facturaId,
      p_error: (error ?? "error desconocido").slice(0, 1000),
    });
    if (e) console.warn(`[archivo] No se pudo marcar la factura ${facturaId} como pendiente de Drive:`, e.message);
  } catch (e) {
    console.warn(`[archivo] No se pudo marcar la factura ${facturaId} como pendiente de Drive:`, e);
  }
}

/**
 * Borra de Storage los ficheros de pendientes/ de un trabajo de OCR (piezas y
 * original) al terminarlo o fallar. Respeta lo que alguna factura use todavía
 * como archivo_path. Nunca lanza; devuelve cuántos borró.
 */
// deno-lint-ignore no-explicit-any
export async function limpiarPendientesTrabajo(supabase: any, trabajoId: string): Promise<number> {
  try {
    const [{ data: t }, { data: piezas }, { data: facturas, error: eFacturas }] = await Promise.all([
      supabase.from("ocr_trabajos").select("original_path").eq("id", trabajoId).maybeSingle(),
      supabase.from("ocr_trabajo_paginas").select("storage_path").eq("trabajo_id", trabajoId),
      supabase.from("facturas").select("id, drive_url, archivo_path").eq("ocr_trabajo_id", trabajoId),
    ]);
    if (eFacturas) throw new Error(eFacturas.message);
    // QA 05/11/2026 (S-1): si la factura de este trabajo no tiene original (ni
    // Drive ni copia temporal), lo de pendientes/ es lo ÚNICO que queda: no se
    // borra nada (el rescate de facturas-originales-drive se lo devuelve).
    type FacturaOriginal = { id: number; drive_url: string | null; archivo_path: string | null };
    const sinOriginal = ((facturas ?? []) as FacturaOriginal[]).filter((f) => f && !f.drive_url && !f.archivo_path);
    if (sinOriginal.length > 0) {
      console.warn(
        `[archivo] el trabajo ${trabajoId} tiene la factura ${sinOriginal.map((f) => f.id).join(", ")} sin original: no se borra pendientes/`,
      );
      return 0;
    }
    const rutas = [...new Set(
      // deno-lint-ignore no-explicit-any
      [t?.original_path, ...((piezas ?? []) as any[]).map((p) => p?.storage_path)]
        .filter((r): r is string => typeof r === "string" && r.startsWith("pendientes/")),
    )];
    if (rutas.length === 0) return 0;
    const { data: usadas, error: eUsadas } = await supabase.from("facturas").select("archivo_path").in("archivo_path", rutas);
    if (eUsadas) throw new Error(eUsadas.message);
    // deno-lint-ignore no-explicit-any
    const enUso = new Set(((usadas ?? []) as any[]).map((f) => f.archivo_path));
    const borrar = rutas.filter((r) => !enUso.has(r));
    if (borrar.length === 0) return 0;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(borrar);
    if (error) throw new Error(error.message);
    return borrar.length;
  } catch (e) {
    console.warn(`[archivo] No se pudieron borrar los ficheros de pendientes/ del trabajo ${trabajoId} (lo hará la limpieza):`, mensaje(e));
    return 0;
  }
}
