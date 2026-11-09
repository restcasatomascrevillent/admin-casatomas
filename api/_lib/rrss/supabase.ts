/**
 * RRSS · acceso a Supabase desde las funciones del motor, SIEMPRE como el
 * usuario: clave pública + su JWT, así que la RLS de las tablas rrss_* y del
 * cubo privado «rrss» decide (leer con «Ver» y escribir con «Editar» en
 * Marketing). Nunca service_role. Sin dependencias: fetch a Auth, PostgREST y
 * Storage (se simula en las pruebas).
 */
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { entornoSupabase, tokenDeCabecera, type EntornoSupabase } from "../autorizacion.js";

export const BUCKET_RRSS = "rrss";
const MS = 20_000;

export interface SesionRrss {
  usuario: string;
  token: string;
  sb: EntornoSupabase;
  fetch: typeof fetch;
}

export type ResultadoSesionRrss = { ok: true; sesion: SesionRrss } | { ok: false; estado: 401 | 403 | 500; motivo: string };

export class ErrorSupabaseRrss extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado: number) {
    super(mensaje);
    this.name = "ErrorSupabaseRrss";
    this.estado = estado;
  }
}

function cab(s: Pick<SesionRrss, "sb" | "token">, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, ...extra };
}

async function detalle(r: Response): Promise<string> {
  const t = await r.text().catch(() => "");
  try {
    const j = JSON.parse(t) as { message?: string; error?: string; msg?: string };
    return (j.message ?? j.error ?? j.msg ?? t).slice(0, 300);
  } catch {
    return t.slice(0, 300);
  }
}

/** Sesión válida + «Editar» en Marketing. */
export async function autorizarRrss(cabecera: string | null | undefined, opts: { env?: Record<string, string | undefined>; fetch?: typeof fetch } = {}): Promise<ResultadoSesionRrss> {
  const token = tokenDeCabecera(cabecera);
  if (!token) return { ok: false, estado: 401, motivo: "Falta la sesión" };
  const sb = entornoSupabase(opts.env);
  if (!sb) return { ok: false, estado: 500, motivo: "Falta la configuración de Supabase" };
  const f = opts.fetch ?? fetch;
  try {
    const u = await f(`${sb.url}/auth/v1/user`, { headers: cab({ sb, token }), signal: AbortSignal.timeout(MS) });
    if (u.status === 401 || u.status === 403) return { ok: false, estado: 401, motivo: "Sesión no válida o caducada" };
    if (!u.ok) return { ok: false, estado: 500, motivo: `Auth respondió ${u.status}` };
    const usuario = (await u.json().catch(() => null)) as { id?: string } | null;
    if (!usuario?.id) return { ok: false, estado: 401, motivo: "Sesión no válida" };
    const p = await f(`${sb.url}/rest/v1/rpc/can_edit_section`, {
      method: "POST",
      headers: cab({ sb, token }, { "Content-Type": "application/json" }),
      body: JSON.stringify({ _section: "marketing" }),
      signal: AbortSignal.timeout(MS),
    });
    if (p.status === 401) return { ok: false, estado: 401, motivo: "Sesión no válida o caducada" };
    if (!p.ok) return { ok: false, estado: 500, motivo: `La comprobación de permisos respondió ${p.status}` };
    if ((await p.json().catch(() => null)) !== true) return { ok: false, estado: 403, motivo: "Hace falta «Editar» en Marketing para usar el editor" };
    return { ok: true, sesion: { usuario: usuario.id, token, sb, fetch: f } };
  } catch (e) {
    return { ok: false, estado: 500, motivo: `No se pudo comprobar la sesión: ${(e as Error)?.message ?? e}` };
  }
}

export async function seleccionar<T>(s: SesionRrss, tabla: string, consulta: string): Promise<T[]> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/${tabla}?${consulta}`, { headers: cab(s, { Accept: "application/json" }), signal: AbortSignal.timeout(MS) });
  if (!r.ok) throw new ErrorSupabaseRrss(`No se pudo leer ${tabla}: ${await detalle(r)}`, r.status);
  return (await r.json()) as T[];
}

/** PATCH con filtro; devuelve las filas cambiadas (vacío si el filtro no casa: así se reclama un trabajo sin carreras). */
export async function actualizar<T>(s: SesionRrss, tabla: string, filtro: string, cambios: Record<string, unknown>): Promise<T[]> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/${tabla}?${filtro}`, {
    method: "PATCH",
    headers: cab(s, { "Content-Type": "application/json", Prefer: "return=representation", Accept: "application/json" }),
    body: JSON.stringify(cambios),
    signal: AbortSignal.timeout(MS),
  });
  if (!r.ok) throw new ErrorSupabaseRrss(`No se pudo actualizar ${tabla}: ${await detalle(r)}`, r.status);
  return (await r.json()) as T[];
}

export async function insertar<T>(s: SesionRrss, tabla: string, fila: Record<string, unknown>): Promise<T> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/${tabla}`, {
    method: "POST",
    headers: cab(s, { "Content-Type": "application/json", Prefer: "return=representation", Accept: "application/json" }),
    body: JSON.stringify(fila),
    signal: AbortSignal.timeout(MS),
  });
  if (!r.ok) throw new ErrorSupabaseRrss(`No se pudo guardar en ${tabla}: ${await detalle(r)}`, r.status);
  const filas = (await r.json()) as T[];
  return filas[0];
}

const rutaCodificada = (ruta: string) => ruta.split("/").map(encodeURIComponent).join("/");

export async function descargarBytes(s: SesionRrss, ruta: string): Promise<Buffer> {
  const r = await s.fetch(`${s.sb.url}/storage/v1/object/authenticated/${BUCKET_RRSS}/${rutaCodificada(ruta)}`, { headers: cab(s), signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new ErrorSupabaseRrss(`No se pudo descargar ${ruta}: ${await detalle(r)}`, r.status);
  return Buffer.from(await r.arrayBuffer());
}

/** Descarga a un fichero sin cargarlo entero en memoria (vídeos de hasta 50 MB). */
export async function descargarAFichero(s: SesionRrss, ruta: string, destino: string): Promise<void> {
  const r = await s.fetch(`${s.sb.url}/storage/v1/object/authenticated/${BUCKET_RRSS}/${rutaCodificada(ruta)}`, { headers: cab(s), signal: AbortSignal.timeout(180_000) });
  if (!r.ok || !r.body) throw new ErrorSupabaseRrss(`No se pudo descargar ${ruta}: ${await detalle(r)}`, r.status);
  await pipeline(Readable.fromWeb(r.body as unknown as import("node:stream/web").ReadableStream), createWriteStream(destino));
}

export async function subir(s: SesionRrss, ruta: string, cuerpo: Buffer, tipo: string): Promise<void> {
  const r = await s.fetch(`${s.sb.url}/storage/v1/object/${BUCKET_RRSS}/${rutaCodificada(ruta)}`, {
    method: "POST",
    headers: cab(s, { "Content-Type": tipo, "x-upsert": "true", "Cache-Control": "3600" }),
    body: new Uint8Array(cuerpo),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new ErrorSupabaseRrss(`No se pudo subir ${ruta}: ${await detalle(r)}`, r.status);
}
