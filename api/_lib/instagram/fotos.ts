/**
 * Fotos subidas desde el panel (tabla public.instagram_fotos) para el render
 * del servidor. Como el resto de api/_lib/instagram: fetch a PostgREST con la
 * clave pública + el JWT del usuario, así que decide la RLS
 * (can_read_section('marketing')). Nunca service_role.
 */
import { FOTOS, fotoDesdeFila, type FilaFotoSubida, type Foto } from "../../../src/lib/instagram/fotos.js";
import { ErrorSupabase, type Sesion } from "./supabase.js";
import { esUuid } from "./validacion.js";

const MS_TIEMPO = 15_000;
const COLUMNAS_FOTO = "id,marca,ruta,ancho,alto,tipo,descripcion";

/** Foto subida por id (null si no existe, la RLS la oculta o la fila no es válida). Lanza ErrorSupabase si PostgREST falla. */
export async function buscarFotoSubida(s: Sesion, id: string): Promise<Foto | null> {
  if (!esUuid(id)) return null;
  const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_fotos?id=eq.${encodeURIComponent(id)}&select=${COLUMNAS_FOTO}`, {
    headers: { apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(MS_TIEMPO),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo leer la foto subida (${r.status})`, r.status);
  const filas = (await r.json().catch(() => [])) as FilaFotoSubida[];
  return Array.isArray(filas) && filas[0] ? fotoDesdeFila(filas[0]) : null;
}

/**
 * Catálogo para validar y construir una pieza: el estático y, si la pieza
 * pide una foto que no está en él, esa foto de instagram_fotos (si existe).
 */
export async function catalogoParaPieza(s: Sesion, pieza: unknown): Promise<readonly Foto[]> {
  const idFoto = pieza && typeof pieza === "object" ? (pieza as { foto?: unknown }).foto : undefined;
  if (typeof idFoto !== "string") return FOTOS;
  const id = idFoto.trim();
  if (!id || FOTOS.some((f) => f.id === id)) return FOTOS;
  const subida = await buscarFotoSubida(s, id);
  return subida ? [...FOTOS, subida] : FOTOS;
}
