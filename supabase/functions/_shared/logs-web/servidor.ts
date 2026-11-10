// ============================================================================
//  Logs web · errores de las Edge Functions (los registra el envoltorio
//  conAuditoriaDePeticion de _shared/audit-client.ts)
// ----------------------------------------------------------------------------
//  Cuando una función responde 5xx o lanza, se apunta un evento `error_servidor`
//  en web_eventos (vía la RPC web_logs_ingerir por REST, sin supabase-js).
//    · REGISTRAR NUNCA ROMPE LA FUNCIÓN: nunca lanza, tope de 2 s, y si hay
//      EdgeRuntime.waitUntil la respuesta sale sin esperarlo.
//    · Ni cuerpo de la petición ni datos del usuario: función, ruta, método,
//      código HTTP, el campo `error` de la respuesta y, si la función lanzó,
//      la pila (todo saneado). Sin pila no se sabía en qué línea fallaba.
//    · Solo en proyectos reales de Supabase (https://<ref de 20 letras>.supabase.co):
//      en pruebas y en local no sale ninguna petición.
// ============================================================================

import { calcularHuella } from "./huella.ts";
import { sanearPila, sanearTexto } from "./saneado.ts";
import { entornoDeSupabase } from "./clasificacion.ts";

type LectorEnv = (n: string) => string | undefined;
const envDeno: LectorEnv = (n) => (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(n);

/** Funciones que no registran sus propios 5xx (la ingesta: evitaría bucles). */
export const SIN_REGISTRO_DE_ERRORES = new Set(["registrar-actividad-web"]);
/** Operaciones cuya caída rompe una conversión de la web. */
const CRITICAS = /^(reservas-web\/crear|cheques-regalo-web\/crear|stripe-webhook-cheques-regalo)/;

export interface ErrorServidor {
  fuente: string; // nombre de la función
  subruta: string; // «/crear», «/disponibilidad»…
  status: number;
  mensaje: string | null;
  duracionMs: number;
  /** GET, POST… */
  metodo?: string | null;
  /** Pila de la excepción, si la función lanzó (se sanea antes de guardarla). */
  pila?: string | null;
  /** true si la función lanzó (frente a responder 5xx ella misma). */
  excepcion?: boolean;
}

export async function eventoErrorServidor(e: ErrorServidor, ahora = new Date()) {
  const objetivo = `${e.fuente}${e.subruta && e.subruta !== "/" ? e.subruta.replace(/\/+$/, "") : ""}`.slice(0, 120);
  const mensaje = sanearTexto(e.mensaje, 300) ?? `HTTP ${e.status}`;
  return {
    evento_id: crypto.randomUUID(),
    ocurrido_en: ahora.toISOString(),
    proyecto: "supabase",
    fuente: "servidor",
    categoria: "error",
    tipo: "error_servidor",
    objetivo,
    valor: Math.round(e.duracionMs),
    propiedades: {
      status: e.status,
      ...(e.metodo && /^[A-Z]{3,7}$/.test(e.metodo) ? { metodo: e.metodo } : {}),
      ...(e.excepcion ? { excepcion: true } : {}),
    },
    gravedad: CRITICAS.test(objetivo) ? "critico" : "error",
    mensaje: `${objetivo}: ${mensaje}`.slice(0, 500),
    pila: sanearPila(e.pila) ?? null,
    huella: await calcularHuella({ tipo: "error_servidor", fuente: "servidor", objetivo, codigo: e.status, mensaje }),
    consentimiento: false,
  };
}

/** Apunta el error. Nunca lanza. */
export async function registrarErrorServidor(e: ErrorServidor, env: LectorEnv = envDeno, fetchFn: typeof fetch = fetch): Promise<void> {
  try {
    if (SIN_REGISTRO_DE_ERRORES.has(e.fuente) || env("LOGS_WEB_ERRORES_SERVIDOR") === "off") return;
    const url = env("SUPABASE_URL") ?? "";
    const clave = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!/^https:\/\/[a-z]{20}\.supabase\.co\/?$/.test(url) || !clave) return;
    const ctrl = new AbortController();
    const corte = setTimeout(() => ctrl.abort(), 2000);
    try {
      await fetchFn(`${url.replace(/\/+$/, "")}/rest/v1/rpc/web_logs_ingerir`, {
        method: "POST",
        headers: { apikey: clave, Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_eventos: [await eventoErrorServidor(e)], p_ctx: { entorno: entornoDeSupabase(url) } }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(corte);
    }
  } catch (error) {
    console.error("[logs-web] no se pudo registrar el error del servidor:", (error as Error)?.message ?? error);
  }
}

/** Mensaje de error de una respuesta JSON (`error`/`mensaje`), sin leer el cuerpo original. */
export async function mensajeDeRespuesta(res: Response): Promise<string | null> {
  try {
    if (!res.headers.get("Content-Type")?.includes("application/json")) return null;
    const j = await res.clone().json();
    const m = typeof j?.error === "string" ? j.error : typeof j?.mensaje === "string" ? j.mensaje : typeof j?.message === "string" ? j.message : null;
    return m ? m.slice(0, 300) : null;
  } catch {
    return null;
  }
}

/** Lanza el registro sin retrasar la respuesta si la plataforma lo permite. */
export function enSegundoPlano(p: Promise<void>): Promise<void> | void {
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er?.waitUntil) {
    er.waitUntil(p);
    return;
  }
  return p;
}
