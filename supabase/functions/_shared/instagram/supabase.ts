/**
 * Acceso a Supabase de las Edge Functions de Instagram COMO EL USUARIO: clave
 * pública (anon/publishable) + `Authorization: Bearer <JWT del usuario>`, así
 * que la RLS de `instagram_piezas` y del bucket «instagram» se aplica igual
 * que en el panel. Nunca se usa service_role.
 *
 * Autorización: sesión válida (/auth/v1/user) + permiso de la sección
 * Marketing (`can_write_section('marketing')`, la misma función que usan las
 * políticas de RLS de escritura).
 *
 * Sin dependencias (ni supabase-js): fetch a Auth, PostgREST y Storage, que
 * se puede simular en los tests. SUPABASE_URL y SUPABASE_ANON_KEY los inyecta
 * la plataforma en todas las Edge Functions.
 */
import { registrarSecreto, sanear } from "./secretos.ts";

export interface EntornoSupabase {
  url: string;
  clave: string;
}

/** URL y clave pública del proyecto de Supabase de esta función (null si faltan). */
export function entornoSupabase(env: Record<string, string | undefined> = {}): EntornoSupabase | null {
  const url = env.SUPABASE_URL;
  const clave = env.SUPABASE_ANON_KEY;
  if (!url || !clave) return null;
  return { url: url.replace(/\/+$/, ""), clave };
}

/** Token de `Authorization: Bearer <jwt>` (null si no hay o no tiene forma de JWT). */
export function tokenDeCabecera(cabecera: string | null | undefined): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/i.exec(cabecera ?? "");
  return m ? m[1] : null;
}

export const SECCION_MARKETING = "marketing";
export const BUCKET = "instagram";
const MS_TIEMPO = 15_000;

export type EstadoPieza = "borrador" | "generada" | "prueba_ok" | "publicada" | "error";

export interface FilaPieza {
  id: string;
  marca: string;
  plantilla: string;
  formato: string;
  datos: unknown;
  caption: string | null;
  estado: EstadoPieza;
  imagen_ruta: string | null;
  contenedor_id: string | null;
  media_id: string | null;
  permalink: string | null;
  error: string | null;
  creado_por: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Sesion {
  usuario: string;
  token: string;
  sb: EntornoSupabase;
  fetch: typeof fetch;
}

export type ResultadoSesion = { ok: true; sesion: Sesion } | { ok: false; estado: 401 | 403 | 500 | 503; motivo: string };

export interface OpcionesSupabase {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

function cabeceras(s: Pick<Sesion, "sb" | "token">, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, ...extra };
}

/** Sesión válida + permiso de Marketing. */
export async function autorizarMarketing(cabecera: string | null | undefined, opts: OpcionesSupabase = {}): Promise<ResultadoSesion> {
  const token = tokenDeCabecera(cabecera);
  if (!token) return { ok: false, estado: 401, motivo: "Falta la sesión" };
  registrarSecreto(token);
  const sb = entornoSupabase(opts.env);
  if (!sb) return { ok: false, estado: 500, motivo: "Falta la configuración de Supabase" };
  const f = opts.fetch ?? fetch;
  const senal = AbortSignal.timeout(MS_TIEMPO);
  try {
    const rUsuario = await f(`${sb.url}/auth/v1/user`, { headers: cabeceras({ sb, token }), signal: senal });
    if (rUsuario.status === 401 || rUsuario.status === 403) return { ok: false, estado: 401, motivo: "Sesión no válida o caducada" };
    if (!rUsuario.ok) return { ok: false, estado: 500, motivo: `Auth respondió ${rUsuario.status}` };
    const usuario = (await rUsuario.json().catch(() => null)) as { id?: string } | null;
    if (!usuario?.id) return { ok: false, estado: 401, motivo: "Sesión no válida" };

    const rPermiso = await f(`${sb.url}/rest/v1/rpc/can_write_section`, {
      method: "POST",
      headers: cabeceras({ sb, token }, { "Content-Type": "application/json" }),
      body: JSON.stringify({ _section: SECCION_MARKETING }),
      signal: senal,
    });
    if (rPermiso.status === 401) return { ok: false, estado: 401, motivo: "Sesión no válida o caducada" };
    if (!rPermiso.ok) return { ok: false, estado: 500, motivo: `La comprobación de permisos respondió ${rPermiso.status}` };
    const puede = await rPermiso.json().catch(() => null);
    if (puede !== true) return { ok: false, estado: 403, motivo: "Sin permiso de Marketing" };
    return { ok: true, sesion: { usuario: usuario.id, token, sb, fetch: f } };
  } catch (e) {
    return { ok: false, estado: 500, motivo: sanear(`No se pudo comprobar la sesión: ${(e as Error)?.message ?? e}`) };
  }
}

export class ErrorSupabase extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado: number) {
    super(sanear(mensaje));
    this.name = "ErrorSupabase";
    this.estado = estado;
  }
}

async function detalle(r: Response): Promise<string> {
  const texto = await r.text().catch(() => "");
  try {
    const j = JSON.parse(texto) as { message?: string; error?: string; msg?: string };
    return sanear(j.message ?? j.error ?? j.msg ?? texto).slice(0, 300);
  } catch {
    return sanear(texto).slice(0, 300);
  }
}

const COLUMNAS = "id,marca,plantilla,formato,datos,caption,estado,imagen_ruta,contenedor_id,media_id,permalink,error,creado_por,created_at,updated_at";

/** Fila de instagram_piezas visible para el usuario (null si no existe o la RLS la oculta). */
export async function leerPieza(s: Sesion, id: string): Promise<FilaPieza | null> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_piezas?id=eq.${encodeURIComponent(id)}&select=${COLUMNAS}`, {
    headers: cabeceras(s, { Accept: "application/json" }),
    signal: AbortSignal.timeout(MS_TIEMPO),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo leer la pieza (${r.status}): ${await detalle(r)}`, r.status);
  const filas = (await r.json()) as FilaPieza[];
  return filas[0] ?? null;
}

export async function actualizarPieza(s: Sesion, id: string, cambios: Partial<FilaPieza>): Promise<FilaPieza> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_piezas?id=eq.${encodeURIComponent(id)}&select=${COLUMNAS}`, {
    method: "PATCH",
    headers: cabeceras(s, { "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(cambios),
    signal: AbortSignal.timeout(MS_TIEMPO),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo actualizar la pieza (${r.status}): ${await detalle(r)}`, r.status);
  const filas = (await r.json()) as FilaPieza[];
  if (!filas[0]) throw new ErrorSupabase("La pieza no existe o no tienes permiso para cambiarla", 404);
  return filas[0];
}

/** Igual que actualizarPieza pero nunca lanza (para anotar errores). */
export async function anotarError(s: Sesion, id: string, mensaje: string): Promise<void> {
  try {
    await actualizarPieza(s, id, { estado: "error", error: sanear(mensaje).slice(0, 1000) });
  } catch {
    /* sin consecuencias: la respuesta ya lleva el error */
  }
}

/** URL pública del objeto (bucket público). */
export function urlPublica(sb: EntornoSupabase, ruta: string): string {
  return `${sb.url}/storage/v1/object/public/${BUCKET}/${ruta.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Borra el JPEG del bucket con el JWT del usuario (DELETE en bloque de
 * Storage, que devuelve los objetos borrados). Si la RLS no deja borrar,
 * Storage no da error: devuelve una lista vacía. Nunca lanza.
 */
export async function borrarJpeg(s: Sesion, ruta: string): Promise<{ borrado: boolean; motivo?: string }> {
  try {
    const r = await s.fetch(`${s.sb.url}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: cabeceras(s, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: [ruta] }),
      signal: AbortSignal.timeout(MS_TIEMPO),
    });
    if (!r.ok) return { borrado: false, motivo: `Storage respondió ${r.status}: ${await detalle(r)}` };
    const lista = (await r.json().catch(() => null)) as Array<{ name?: string }> | null;
    if (!Array.isArray(lista) || lista.length === 0) {
      return { borrado: false, motivo: "Storage no borró nada (el fichero ya no estaba o la RLS del bucket no deja borrar a este usuario)" };
    }
    return { borrado: true };
  } catch (e) {
    return { borrado: false, motivo: sanear(`No se pudo borrar el JPEG: ${(e as Error)?.message ?? e}`) };
  }
}
