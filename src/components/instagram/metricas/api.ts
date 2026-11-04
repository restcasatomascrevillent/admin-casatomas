/**
 * Llamadas de la pestaña «Métricas» a la Edge Function instagram-metricas,
 * con la clave pública (`apikey`) y el JWT de la sesión, como el resto de
 * funciones del panel. Los errores se convierten en ErrorMetricas con un
 * `tipo` que la UI sabe pintar (permiso que falta, secretos, etc.).
 */
import { supabase } from "@/integrations/supabase/client";
import { auditDeviceId } from "@/lib/audit-device";
import type { DatosMetricas, ResultadoCaptura } from "./tipos";

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const CLAVE_PUBLICA = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "");

export const URL_METRICAS = `${SUPABASE_URL}/functions/v1/instagram-metricas`;

export type TipoErrorMetricas =
  | "sesion"
  | "sin_permiso"
  | "permiso_insights"
  | "configuracion"
  | "demasiado_pronto"
  | "no_desplegada"
  | "servidor"
  | "red";

export class ErrorMetricas extends Error {
  constructor(
    mensaje: string,
    readonly tipo: TipoErrorMetricas,
    readonly estado?: number,
    /** Pasos para arreglarlo (uno o varios). */
    readonly comoArreglarlo: string[] = [],
    /** Segundos hasta poder volver a capturar (429). */
    readonly reintentarEn?: number,
  ) {
    super(mensaje);
    this.name = "ErrorMetricas";
  }
}

export interface OpcionesLlamada {
  fetch?: typeof fetch;
  /** JWT; por defecto el de la sesión actual. */
  token?: string | null;
}

async function tokenSesion(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function lista(x: unknown): string[] {
  return [x].flat().filter((s): s is string => typeof s === "string" && s.length > 0);
}

async function llamar<T>(init: RequestInit, opts: OpcionesLlamada = {}): Promise<T> {
  const token = opts.token === undefined ? await tokenSesion() : opts.token;
  if (!token) throw new ErrorMetricas("No hay sesión: vuelve a entrar en el panel.", "sesion", 401);
  const f = opts.fetch ?? fetch;
  let r: Response;
  try {
    r = await f(URL_METRICAS, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        apikey: CLAVE_PUBLICA,
        "x-client-info": `adminpanel/${auditDeviceId()}/${crypto.randomUUID()}`,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (e) {
    throw new ErrorMetricas((e as Error)?.message || "Sin conexión", "red");
  }
  let cuerpo: Record<string, unknown> = {};
  try {
    cuerpo = ((await r.json()) ?? {}) as Record<string, unknown>;
  } catch {
    if (!r.ok) throw new ErrorMetricas(`El servidor respondió ${r.status}`, "servidor", r.status);
    throw new ErrorMetricas(`Respuesta no válida del servidor (${r.status})`, "servidor", r.status);
  }
  if (r.ok) return cuerpo as T;

  const mensaje = typeof cuerpo.error === "string" ? cuerpo.error : typeof cuerpo.message === "string" ? cuerpo.message : `El servidor respondió ${r.status}`;
  const pasos = lista(cuerpo.comoArreglarlo);
  // La pasarela de Supabase contesta 404 { message } si la función no está desplegada.
  if (r.status === 404 && typeof cuerpo.error !== "string") {
    throw new ErrorMetricas("La función de métricas de Instagram no está desplegada en este Supabase.", "no_desplegada", 404, [
      "Despliégala desde la raíz del repo: npx supabase functions deploy instagram-metricas --project-ref <ref del proyecto> (docs/instagram-metricas.md).",
    ]);
  }
  if (cuerpo.tipo === "permiso_insights") throw new ErrorMetricas(mensaje, "permiso_insights", r.status, pasos);
  if (cuerpo.tipo === "configuracion") throw new ErrorMetricas(mensaje, "configuracion", r.status, pasos);
  if (r.status === 429 && cuerpo.tipo === "demasiado_pronto") {
    throw new ErrorMetricas(mensaje, "demasiado_pronto", 429, pasos, typeof cuerpo.reintentarEn === "number" ? cuerpo.reintentarEn : undefined);
  }
  if (r.status === 401) throw new ErrorMetricas(mensaje, "sesion", 401);
  if (r.status === 403) throw new ErrorMetricas(mensaje, "sin_permiso", 403);
  throw new ErrorMetricas(mensaje, "servidor", r.status, pasos);
}

/** Resumen, serie y publicaciones (no llama a Meta). */
export function leerMetricas(opts?: OpcionesLlamada): Promise<DatosMetricas> {
  return llamar<DatosMetricas & { ok: true }>({ method: "GET" }, opts);
}

/** Pide ahora las métricas a Meta y las guarda (necesita poder editar Marketing). */
export function capturarMetricas(opts?: OpcionesLlamada): Promise<ResultadoCaptura> {
  return llamar<ResultadoCaptura & { ok: true }>({ method: "POST", body: JSON.stringify({ accion: "capturar" }) }, opts);
}

export function textoError(e: unknown): string {
  return e instanceof Error ? e.message : "Error desconocido";
}
