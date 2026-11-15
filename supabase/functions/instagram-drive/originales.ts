/**
 * Originales de las fotos de la carta (tabla carta_fotos_originales,
 * migración 20261117100000). Lecturas y escrituras COMO EL USUARIO (clave
 * pública + su JWT): decide la RLS (escribe gestor_carta «Editar»; leen
 * gestor_carta y marketing). Ver docs/instagram-fotos.md, «Originales de la
 * carta en Drive».
 */
import { ErrorSupabase, type Sesion } from "../_shared/instagram/supabase.ts";
import { sanear } from "../_shared/instagram/secretos.ts";
import type { MarcaDrive } from "../_shared/instagram/drive.ts";

/** Sección de permisos de la carta (la de las políticas de "Platos" y "Vinos"). */
export const SECCION_CARTA = "gestor_carta";
export const SIN_PERMISO_CARTA = "Sin permiso para editar la carta: hace falta «Editar» en la carta (pídeselo a un administrador en Usuarios)";
/** Lado mayor del original (lo deja así el panel) y peso máximo (el mismo que el resto de fotos de Instagram). */
export const LADO_MAXIMO_ORIGINAL = 4000;
export const MAX_BYTES_ORIGINAL = 8 * 1024 * 1024;
export const MIGRACION_ORIGINALES = "20261117100000_carta_fotos_originales";

export type TablaCarta = "Platos" | "Vinos";

export interface FilaOriginal {
  drive_id: string;
  marca: MarcaDrive;
  nombre: string;
  ancho: number;
  alto: number;
  bytes: number;
}

const COLUMNAS = "drive_id,marca,nombre,ancho,alto,bytes";
const MS = 15_000;
const columna = (t: TablaCarta) => (t === "Vinos" ? "vino_id" : "plato_id");
const cab = (s: Sesion, extra: Record<string, string> = {}) => ({ apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, ...extra });

async function texto(r: Response): Promise<string> {
  return sanear(await r.text().catch(() => "")).slice(0, 300);
}

/**
 * Original de un plato o vino (null si no tiene). `sinTabla: true` si la
 * migración aún no está aplicada (en vez de fallar).
 */
export async function leerOriginal(s: Sesion, tabla: TablaCarta, id: string): Promise<{ fila: FilaOriginal | null; sinTabla: boolean }> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/carta_fotos_originales?${columna(tabla)}=eq.${encodeURIComponent(id)}&select=${COLUMNAS}`, {
    headers: cab(s, { Accept: "application/json" }),
    signal: AbortSignal.timeout(MS),
  });
  if (r.status === 404 || r.status === 400) {
    const t = await texto(r);
    if (/carta_fotos_originales|42P01|PGRST20/.test(t)) return { fila: null, sinTabla: true };
    throw new ErrorSupabase(`No se pudo leer el original (${r.status}): ${t}`, r.status);
  }
  if (!r.ok) throw new ErrorSupabase(`No se pudo leer el original (${r.status}): ${await texto(r)}`, r.status);
  const filas = (await r.json().catch(() => [])) as FilaOriginal[];
  return { fila: Array.isArray(filas) && filas[0] ? filas[0] : null, sinTabla: false };
}

/** Guarda (o reemplaza: upsert por plato_id / vino_id) el original de una ficha. */
export async function guardarOriginal(s: Sesion, tabla: TablaCarta, id: string, fila: FilaOriginal): Promise<FilaOriginal> {
  const col = columna(tabla);
  const r = await s.fetch(`${s.sb.url}/rest/v1/carta_fotos_originales?on_conflict=${col}&select=${COLUMNAS}`, {
    method: "POST",
    headers: cab(s, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify({ [col]: id, ...fila }),
    signal: AbortSignal.timeout(MS),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo anotar el original (${r.status}): ${await texto(r)}`, r.status);
  const filas = (await r.json().catch(() => [])) as FilaOriginal[];
  if (!Array.isArray(filas) || !filas[0]) throw new ErrorSupabase("No se pudo anotar el original (sin permiso)", 403);
  return filas[0];
}

/** Marca de Drive de una ficha de la carta: Casa Tomás si está en su carta; si no, Touza. */
export function marcaDeFicha(f: { restaurante?: boolean | null; touza?: boolean | null }): MarcaDrive {
  if (f.restaurante === true) return "casa-tomas";
  if (f.touza === true) return "touza";
  return "casa-tomas";
}

// ---------------------------------------------------------------------------
// Carpeta de Drive de cada plato o vino (columna drive_folder_id, migración
// 20261201120000_carta_drive_folder_id). Como el usuario: decide la RLS.
// ---------------------------------------------------------------------------

export const MIGRACION_CARPETAS = "20261201120000_carta_drive_folder_id";

export interface FichaConCarpeta {
  id: string;
  nombre: string | null;
  categoria: string | null;
  drive_folder_id: string | null;
  restaurante: boolean | null;
  touza: boolean | null;
}

/**
 * Ficha de "Platos"/"Vinos" con su carpeta de Drive. Si la migración aún no
 * está aplicada (la columna no existe), se lee sin ella: `sinColumna: true` y
 * nada falla (la función se puede desplegar antes que la migración).
 */
export async function leerFichaConCarpeta(s: Sesion, tabla: TablaCarta, id: string): Promise<{ ficha: FichaConCarpeta | null; sinColumna: boolean }> {
  const pedir = async (campos: string) =>
    await s.fetch(`${s.sb.url}/rest/v1/${tabla}?id=eq.${encodeURIComponent(id)}&select=${campos}`, {
      headers: cab(s, { Accept: "application/json" }),
      signal: AbortSignal.timeout(MS),
    });
  let sinColumna = false;
  let r = await pedir("id,nombre,categoria,drive_folder_id,restaurante,touza");
  if (r.status === 400 && /drive_folder_id|42703/.test(await texto(r.clone()))) {
    sinColumna = true;
    r = await pedir("id,nombre,categoria,restaurante,touza");
  }
  if (!r.ok) throw new ErrorSupabase(`No se pudo leer la ficha (${r.status}): ${await texto(r)}`, r.status);
  const filas = (await r.json().catch(() => [])) as Array<Partial<FichaConCarpeta> & { id: string }>;
  const f = Array.isArray(filas) ? filas[0] : undefined;
  return { ficha: f ? { id: f.id, nombre: f.nombre ?? null, categoria: f.categoria ?? null, drive_folder_id: f.drive_folder_id ?? null, restaurante: f.restaurante ?? null, touza: f.touza ?? null } : null, sinColumna };
}

/**
 * Guarda en la ficha el id de su carpeta de Drive (desde el servidor, con el
 * JWT del usuario). Nunca falla la subida: devuelve false si no se pudo (sin
 * migración, sin permiso…) y lo deja en el registro.
 */
export async function guardarCarpetaFicha(s: Sesion, tabla: TablaCarta, id: string, carpetaId: string): Promise<boolean> {
  try {
    const r = await s.fetch(`${s.sb.url}/rest/v1/${tabla}?id=eq.${encodeURIComponent(id)}&select=id`, {
      method: "PATCH",
      headers: cab(s, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({ drive_folder_id: carpetaId }),
      signal: AbortSignal.timeout(MS),
    });
    if (!r.ok) return false;
    const filas = (await r.json().catch(() => [])) as unknown[];
    return Array.isArray(filas) && filas.length > 0;
  } catch {
    return false;
  }
}
