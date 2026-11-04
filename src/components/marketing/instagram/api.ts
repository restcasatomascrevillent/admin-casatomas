/**
 * Llamadas de Marketing › Instagram con el JWT de la sesión:
 *
 *  - Render (JPEG): función de Vercel `/api/instagram-render` (necesita
 *    Chromium; no usa secretos de Meta). En local (`vite`) NO existe: Vite
 *    contesta con el index.html (200, text/html) o con un 404, y en vez de
 *    fallar con un «Unexpected token <» se lanza un ErrorInstagram de tipo
 *    «sin-servidor» con un texto claro.
 *  - Publicar y comprobar la conexión: Edge Functions de Supabase
 *    (`instagram-publicar` e `instagram-estado`), donde viven los secretos de
 *    Meta. Funcionan también en local: van al Supabase de VITE_SUPABASE_URL
 *    con la clave pública (`apikey`) y el JWT, como el resto de funciones.
 */
import { supabase } from "@/integrations/supabase/client";
import { auditDeviceId } from "@/lib/audit-device";

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const CLAVE_PUBLICA = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "");

export const URL_RENDER = "/api/instagram-render";
export const URL_PUBLICAR = `${SUPABASE_URL}/functions/v1/instagram-publicar`;
export const URL_ESTADO = `${SUPABASE_URL}/functions/v1/instagram-estado`;

export const MENSAJE_SIN_SERVIDOR =
  "La imagen definitiva solo se genera en la demo de Vercel: en local (npm run dev) no existe la función /api/instagram-render.";

export type TipoErrorInstagram = "sin-servidor" | "sesion" | "validacion" | "servidor" | "red";

export class ErrorInstagram extends Error {
  constructor(
    mensaje: string,
    readonly tipo: TipoErrorInstagram,
    readonly estado?: number,
    /** Pasos para arreglarlo que devuelve la función (si los hay). */
    readonly comoArreglarlo?: string | string[],
    /** Problemas de validación (422 de instagram-render). */
    readonly problemas?: string[],
  ) {
    super(mensaje);
    this.name = "ErrorInstagram";
  }
}

export interface RespuestaRender {
  id: string;
  urlJpeg: string;
  ancho: number;
  alto: number;
  avisos?: string[];
}

export type EstadoPublicacion = "prueba_ok" | "publicada" | "en_proceso" | "error" | string;

export interface Cuota {
  usadas: number;
  /** null si Meta no devuelve el total. */
  total: number | null;
  ventanaHoras?: number | null;
}

/** Respuesta de instagram-publicar, ya normalizada. */
export interface RespuestaPublicar {
  estado: EstadoPublicacion;
  contenedorId: string | null;
  /** Estado del contenedor en Meta (FINISHED, IN_PROGRESS…). */
  estadoContenedor: string | null;
  cuota: Cuota | null;
  urlJpeg: string | null;
  permalink: string | null;
  avisos: string[];
  mensaje: string | null;
}

export type EstadoComprobacion = "ok" | "falla" | "aviso";

export interface Comprobacion {
  seccion?: string;
  nombre: string;
  estado: EstadoComprobacion;
  detalle?: string;
  comoArreglarlo?: string;
}

/** Respuesta de instagram-estado, ya normalizada. Nunca trae valores secretos. */
export interface RespuestaEstado {
  ok: boolean;
  variables: Comprobacion[];
  comprobaciones: Comprobacion[];
  cuenta: { id: string | null; username: string } | null;
  cuota: Cuota | null;
  avisos: string[];
  comoArreglarlo: string[];
  entornoSupabase?: string;
}

export interface OpcionesLlamada {
  fetch?: typeof fetch;
  /** JWT; por defecto el de la sesión actual. */
  token?: string | null;
}

/** Cabeceras extra de las Edge Functions: clave pública + identificador del panel (auditoría). */
function cabecerasEdge(): Record<string, string> {
  return { apikey: CLAVE_PUBLICA, "x-client-info": `adminpanel/${auditDeviceId()}/${crypto.randomUUID()}` };
}

async function tokenSesion(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function esJson(r: Response): boolean {
  return (r.headers.get("content-type") ?? "").includes("application/json");
}

async function llamar<T>(url: string, init: RequestInit, opts: OpcionesLlamada = {}, extra: Record<string, string> = {}): Promise<T> {
  const token = opts.token === undefined ? await tokenSesion() : opts.token;
  if (!token) throw new ErrorInstagram("No hay sesión: vuelve a entrar en el panel.", "sesion", 401);
  const f = opts.fetch ?? fetch;
  let r: Response;
  try {
    r = await f(url, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...extra, Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    throw new ErrorInstagram((e as Error)?.message || "Sin conexión", "red");
  }
  // En local, Vite responde con HTML (o 404 vacío): no hay función de Vercel detrás.
  if (!esJson(r)) {
    if (url === URL_RENDER && (r.status === 404 || r.ok || (r.headers.get("content-type") ?? "").includes("text/html"))) {
      throw new ErrorInstagram(MENSAJE_SIN_SERVIDOR, "sin-servidor", r.status);
    }
    throw new ErrorInstagram(`El servidor respondió ${r.status}`, "servidor", r.status);
  }
  let cuerpo: unknown;
  try {
    cuerpo = await r.json();
  } catch {
    throw new ErrorInstagram(`Respuesta no válida del servidor (${r.status})`, "servidor", r.status);
  }
  if (!r.ok) {
    const c = (cuerpo ?? {}) as { error?: string; message?: string; comoArreglarlo?: string | string[]; problemas?: string[] };
    if (r.status === 422 && Array.isArray(c.problemas)) {
      throw new ErrorInstagram(c.error ?? "La pieza tiene problemas", "validacion", 422, c.comoArreglarlo, c.problemas);
    }
    // La pasarela de Supabase contesta 404 { message } si la Edge Function no está desplegada.
    if (r.status === 404 && !c.error && url !== URL_RENDER) {
      throw new ErrorInstagram(
        "La función de Instagram no está desplegada en este Supabase.",
        "servidor",
        404,
        "Despliégala desde la raíz del repo: npx supabase functions deploy instagram-publicar instagram-estado --project-ref <ref del proyecto> (docs/instagram.md).",
      );
    }
    const tipo: TipoErrorInstagram = r.status === 401 || r.status === 403 ? "sesion" : "servidor";
    throw new ErrorInstagram(c.error ?? c.message ?? `El servidor respondió ${r.status}`, tipo, r.status, c.comoArreglarlo);
  }
  return cuerpo as T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON del servidor sin tipar: se normaliza justo aquí.
type Crudo = Record<string, any>;

function normalizarEstadoComprobacion(e: unknown): EstadoComprobacion {
  return e === "ok" ? "ok" : e === "aviso" ? "aviso" : "falla";
}

function normalizarCuota(c: unknown): Cuota | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Crudo;
  if (typeof o.usadas !== "number") return null;
  return { usadas: o.usadas, total: typeof o.total === "number" ? o.total : null, ventanaHoras: o.ventanaHoras ?? null };
}

export function normalizarPublicar(r: Crudo): RespuestaPublicar {
  return {
    estado: String(r.estado ?? ""),
    contenedorId: r.contenedor?.id ?? r.contenedorId ?? null,
    estadoContenedor: r.contenedor?.estado ?? null,
    cuota: normalizarCuota(r.cuota),
    urlJpeg: r.urlJpeg ?? null,
    permalink: r.permalink ?? null,
    avisos: Array.isArray(r.avisos) ? r.avisos.map(String) : [],
    mensaje: typeof r.mensaje === "string" ? r.mensaje : null,
  };
}

export function normalizarEstado(r: Crudo): RespuestaEstado {
  const comp = (x: Crudo): Comprobacion => ({
    seccion: x.seccion,
    nombre: String(x.nombre ?? ""),
    estado: normalizarEstadoComprobacion(x.estado),
    detalle: x.detalle ?? undefined,
    comoArreglarlo: x.comoArreglarlo ?? undefined,
  });
  const variables = Array.isArray(r.variables) ? r.variables.map(comp) : [];
  const comprobaciones = Array.isArray(r.comprobaciones) ? r.comprobaciones.map(comp) : [];
  const username = r.identidad?.username ?? r.cuenta?.username ?? null;
  const pasos = new Set<string>();
  for (const x of [...variables, ...comprobaciones]) if (x.estado !== "ok" && x.comoArreglarlo) pasos.add(x.comoArreglarlo);
  for (const x of [r.comoArreglarlo].flat()) if (typeof x === "string" && x) pasos.add(x);
  return {
    ok: r.ok === true,
    variables,
    comprobaciones,
    cuenta: username ? { id: r.identidad?.igUserId ?? r.cuenta?.id ?? null, username } : null,
    cuota: normalizarCuota(r.cuota),
    avisos: [...(Array.isArray(r.avisos) ? r.avisos : []), ...(Array.isArray(r.noVerificado) ? r.noVerificado : [])].map(String),
    comoArreglarlo: [...pasos],
    entornoSupabase: r.entornoSupabase,
  };
}

/** Genera el JPEG definitivo y guarda (o actualiza, con `id`) la pieza. */
export function generarImagen(pieza: unknown, id?: string | null, opts?: OpcionesLlamada) {
  return llamar<RespuestaRender>(URL_RENDER, { method: "POST", body: JSON.stringify(id ? { pieza, id } : { pieza }) }, opts);
}

/** Prueba (dryRun) o publicación real. `contenedorId` para reintentar uno «en_proceso». */
export function publicar(
  args: { id: string; caption: string; dryRun: boolean; contenedorId?: string | null },
  opts?: OpcionesLlamada,
) {
  const cuerpo: Record<string, unknown> = { id: args.id, caption: args.caption, dryRun: args.dryRun };
  if (args.contenedorId) cuerpo.contenedorId = args.contenedorId;
  return llamar<Crudo>(URL_PUBLICAR, { method: "POST", body: JSON.stringify(cuerpo) }, opts, cabecerasEdge()).then(normalizarPublicar);
}

/** Estado de la conexión (variables, cuenta y cupo). Nunca devuelve valores secretos. */
export function comprobarConexion(opts?: OpcionesLlamada) {
  return llamar<Crudo>(URL_ESTADO, { method: "GET" }, opts, cabecerasEdge()).then(normalizarEstado);
}

/** Texto para el usuario a partir de cualquier error de estas llamadas. */
export function textoError(e: unknown): string {
  if (e instanceof ErrorInstagram) return e.message;
  return (e as Error)?.message || "Error desconocido";
}
