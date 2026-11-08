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
