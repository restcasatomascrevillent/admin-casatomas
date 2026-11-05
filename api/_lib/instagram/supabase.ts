/**
 * Acceso a Supabase de las funciones de Instagram COMO EL USUARIO: clave
 * pública (anon/publishable) + `Authorization: Bearer <JWT del usuario>`, así
 * que la RLS de `instagram_piezas` y del bucket «instagram» se aplica igual
 * que en el panel. Nunca se usa service_role.
 *
 * Autorización: sesión válida (/auth/v1/user) + permiso de la sección
 * Marketing con «Editar» (`can_edit_section('marketing')`, la misma función
 * que usan las políticas de RLS de escritura desde 20261111000000). No
 * `can_write_section`: mira «Ver» a propósito en todo el panel.
 *
 * Sin dependencias: fetch a Auth, PostgREST y Storage.
 */
import { entornoSupabase, tokenDeCabecera, type EntornoSupabase } from "../autorizacion.js";
import { registrarSecreto, sanear } from "./secretos.js";

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

    const rPermiso = await f(`${sb.url}/rest/v1/rpc/can_edit_section`, {
      method: "POST",
      headers: cabeceras({ sb, token }, { "Content-Type": "application/json" }),
      body: JSON.stringify({ _section: SECCION_MARKETING }),
      signal: senal,
    });
    if (rPermiso.status === 401) return { ok: false, estado: 401, motivo: "Sesión no válida o caducada" };
    if (!rPermiso.ok) return { ok: false, estado: 500, motivo: `La comprobación de permisos respondió ${rPermiso.status}` };
    const puede = await rPermiso.json().catch(() => null);
    if (puede !== true) {
      return { ok: false, estado: 403, motivo: "Sin permiso para editar Marketing: hace falta «Editar» en Marketing (pídeselo a un administrador en Usuarios), no solo «Ver»" };
    }
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

export async function insertarPieza(s: Sesion, fila: Partial<FilaPieza>): Promise<FilaPieza> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_piezas?select=${COLUMNAS}`, {
    method: "POST",
    headers: cabeceras(s, { "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(fila),
    signal: AbortSignal.timeout(MS_TIEMPO),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo guardar la pieza (${r.status}): ${await detalle(r)}`, r.status);
  const filas = (await r.json()) as FilaPieza[];
  if (!filas[0]) throw new ErrorSupabase("La base de datos no devolvió la pieza guardada (¿RLS?)", 500);
  return filas[0];
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

/** Ruta dentro del bucket: piezas/AAAA-MM/<id>.jpg */
export function rutaJpeg(id: string, ahora: Date = new Date()): string {
  return `piezas/${ahora.toISOString().slice(0, 7)}/${id}.jpg`;
}

/** URL pública del objeto (bucket público). */
export function urlPublica(sb: EntornoSupabase, ruta: string): string {
  return `${sb.url}/storage/v1/object/public/${BUCKET}/${ruta.split("/").map(encodeURIComponent).join("/")}`;
}

/** Sube (o sustituye) el JPEG con el JWT del usuario. */
export async function subirJpeg(s: Sesion, ruta: string, jpg: Uint8Array): Promise<void> {
  const r = await s.fetch(`${s.sb.url}/storage/v1/object/${BUCKET}/${ruta.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: cabeceras(s, {
      "Content-Type": "image/jpeg",
      "x-upsert": "true",
      // Se regenera con la misma ruta: que la CDN no sirva la versión anterior.
      "cache-control": "no-cache",
    }),
    body: jpg as unknown as BodyInit,
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo subir el JPEG al bucket «${BUCKET}» (${r.status}): ${await detalle(r)}`, r.status);
}
