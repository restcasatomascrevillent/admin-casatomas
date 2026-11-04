// ============================================================================
//  Archivado del documento original (Drive si está configurado, Storage si no)
// ----------------------------------------------------------------------------
//  Movido desde index.ts (04b, tarea B1) sin cambios de comportamiento; la
//  configuración de Drive llega por parámetro (ConfigDrive) en vez de leerse
//  de Deno.env al cargar el módulo. Añade `moverPendiente` para el
//  multipágina y la sustitución: el original ya está en Storage bajo
//  pendientes/… y solo hay que moverlo a su ruta definitiva.
// ============================================================================

// Creado por la migracion 20260919110000_facturas_archivo_original_y_validacion.sql
export const STORAGE_BUCKET = "facturas-originales";

export interface ConfigDrive {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  parentFolder: string;
}

export function driveActivo(cfg: ConfigDrive): boolean {
  return !!(cfg.clientId && cfg.clientSecret && cfg.refreshToken && cfg.parentFolder);
}

// ─── Google Drive (OAuth refresh token) ──────────────────────────────────────
async function driveToken(cfg: ConfigDrive): Promise<string> {
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
  if (!res.ok) throw new Error(`Drive token ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function ensureFolder(name: string, parentId: string, token: string): Promise<string> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const list = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const found = (await list.json()).files?.[0];
  if (found) return found.id;
  const create = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  if (!create.ok) throw new Error(`Drive crear carpeta ${create.status}: ${await create.text()}`);
  return (await create.json()).id;
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

async function subirADrive(
  cfg: ConfigDrive,
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  fecha: string,
  proveedor: string | null,
): Promise<string | null> {
  if (!driveActivo(cfg)) {
    // No es un error: simplemente Drive no esta configurado. Quien llama debe
    // recurrir al fallback de Storage, nunca descartar el fichero.
    return null;
  }
  const token = await driveToken(cfg);
  const provFolder = await ensureFolder(carpetaProveedor(proveedor), cfg.parentFolder, token);
  const monthFolder = await ensureFolder(carpetaMes(fecha), provFolder, token);

  // 1) metadata
  const meta = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: fileName, parents: [monthFolder] }),
  });
  if (!meta.ok) throw new Error(`Drive metadata ${meta.status}: ${await meta.text()}`);
  const fileId = (await meta.json()).id;

  // 2) media
  const up = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,webViewLink`,
    { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType }, body: bytes },
  );
  if (!up.ok) throw new Error(`Drive upload ${up.status}: ${await up.text()}`);
  return (await up.json()).webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;
}

// ─── Supabase Storage (fallback del archivo original) ────────────────────────

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

/**
 * Guarda el original en el bucket privado. Devuelve la ruta dentro del bucket.
 * Misma jerarquia año/mes que Drive, tomada de la FECHA DEL DOCUMENTO.
 */
// deno-lint-ignore no-explicit-any
export async function guardarEnStorage(
  supabase: any,
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  fecha: string,
  facturaId: number,
): Promise<string> {
  const path = `${fecha.slice(0, 4)}/${fecha.slice(5, 7)}/${facturaId}-${nombreSeguro(fileName)}`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, new Blob([bytes], { type: mimeType }), {
      contentType: mimeType,
      upsert: true,
    });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  return path;
}

/**
 * Archiva el documento original. Drive si esta configurado, Supabase Storage si
 * no (o si Drive falla). Nunca lanza: el documento ya esta en base de datos y
 * un fallo de archivado no debe invalidar el procesado. Devuelve que se logro.
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
): Promise<{ drive_url: string | null; archivo_path: string | null; error: string | null }> {
  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "base64 invalido";
    console.error("[archivo] No se pudo decodificar el base64:", msg);
    return { drive_url: null, archivo_path: null, error: msg };
  }

  // 1) Google Drive, si hay secrets.
  if (driveActivo(cfg)) {
    try {
      const driveUrl = await subirADrive(cfg, bytes, fileName, mimeType, fecha, proveedor);
      if (driveUrl) return { drive_url: driveUrl, archivo_path: null, error: null };
    } catch (e) {
      console.error("[Drive] Fallo la subida, se intenta Storage:", e);
    }
  } else {
    console.warn(
      "[Drive] Secrets GOOGLE_* no configurados → el original va a Supabase Storage.",
    );
  }

  // 2) Fallback: bucket privado de Supabase.
  try {
    const path = await guardarEnStorage(supabase, bytes, fileName, mimeType, fecha, facturaId);
    return { drive_url: null, archivo_path: path, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    // Este SI es un problema serio: se ha perdido el original.
    console.error(
      `[archivo] PERDIDA DEL ORIGINAL de la factura ${facturaId} (${fileName}): ${msg}`,
    );
    return { drive_url: null, archivo_path: null, error: msg };
  }
}

/**
 * Copia a Drive un original que ya está en Storage (camino de documentos
 * largos: el fichero llega por `pendientes/…` y se mueve dentro del bucket,
 * así que hasta ahora nunca llegaba a Drive). Storage se queda como copia de
 * seguridad. Nunca lanza: devuelve el enlace de Drive o null.
 */
// deno-lint-ignore no-explicit-any
export async function copiarADriveDesdeStorage(
  cfg: ConfigDrive,
  supabase: any,
  path: string,
  fileName: string,
  fecha: string,
  proveedor: string | null,
): Promise<string | null> {
  if (!driveActivo(cfg)) return null;
  try {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
    if (error || !data) throw new Error(error?.message ?? "sin datos");
    const bytes = new Uint8Array(await data.arrayBuffer());
    const mime = data.type || (fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
    return await subirADrive(cfg, bytes, fileName, mime, fecha, proveedor);
  } catch (e) {
    console.error(`[Drive] No se pudo copiar ${path} a Drive:`, e);
    return null;
  }
}

/** Ruta definitiva de un original: misma jerarquía año/mes que guardarEnStorage. */
export function rutaDefinitiva(fecha: string, facturaId: number, fileName: string): string {
  return `${fecha.slice(0, 4)}/${fecha.slice(5, 7)}/${facturaId}-${nombreSeguro(fileName)}`;
}

/**
 * Mueve un fichero ya subido (pendientes/{uid}/{trabajo}/…) a su ruta
 * definitiva. Si el destino ya existe (reintento), no es error: se devuelve.
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
    return { path: null, error: e instanceof Error ? e.message : String(e) };
  }
}
