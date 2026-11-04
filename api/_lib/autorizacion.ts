/**
 * Autorización y cupo de `api/recortar-foto`: el JWT de Supabase del usuario
 * (`Authorization: Bearer …`) se comprueba contra el proyecto de Supabase de
 * ESTE entorno (las mismas variables que usa el panel: en Preview apuntan a la
 * demo y en Production a producción) y, COMO ESE USUARIO, se llama a
 * `recorte_servidor_reservar()` (migración 20261103180000), que exige permiso
 * de carta (`can_write_section('gestor_carta')`), mira los topes de gasto y,
 * si caben, deja la fila en `ia_uso`. Al acabar, `recorte_servidor_terminar`
 * anota la duración.
 *
 * Sin dependencias: llamadas fetch a Auth y a PostgREST.
 */

export interface UsoRecortes {
  recortes_mes: number;
  recortes_dia: number;
  cpu_ms_mes: number;
  tope_mes: number;
  tope_dia: number;
  tope_cpu_min: number;
}

export type ResultadoAutorizacion =
  | { ok: true; usuario: string; reserva: number; uso: UsoRecortes | null }
  | { ok: false; estado: 401 | 403 | 429 | 500 | 503; motivo: string; tope?: "mes" | "dia" | "cpu"; uso?: UsoRecortes | null };

export interface EntornoSupabase {
  url: string;
  clave: string;
}

/** URL y clave pública del proyecto de Supabase de este despliegue (null si faltan). */
export function entornoSupabase(env: Record<string, string | undefined> = process.env): EntornoSupabase | null {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const clave = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !clave) return null;
  return { url: url.replace(/\/+$/, ""), clave };
}

/** Token de `Authorization: Bearer <jwt>` (null si no hay o no tiene forma de JWT). */
export function tokenDeCabecera(cabecera: string | null | undefined): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/i.exec(cabecera ?? "");
  return m ? m[1] : null;
}

const MS_TIEMPO_AUTH = 10_000;

export const MOTIVOS_TOPE: Record<"mes" | "dia" | "cpu", string> = {
  mes: "Se ha alcanzado el tope mensual de recortes en el servidor",
  dia: "Se ha alcanzado el tope diario de recortes en el servidor",
  cpu: "Se ha alcanzado el tope mensual de CPU de los recortes en el servidor",
};

interface Opciones {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

function cabeceras(sb: EntornoSupabase, token: string) {
  return { apikey: sb.clave, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function uso(r: Record<string, unknown> | null): UsoRecortes | null {
  if (!r || typeof r.recortes_mes !== "number") return null;
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    recortes_mes: n("recortes_mes"),
    recortes_dia: n("recortes_dia"),
    cpu_ms_mes: n("cpu_ms_mes"),
    tope_mes: n("tope_mes"),
    tope_dia: n("tope_dia"),
    tope_cpu_min: n("tope_cpu_min"),
  };
}

/** Sesión válida + permiso de carta + cupo libre → reserva (id de la fila de ia_uso). */
export async function autorizarRecorte(cabecera: string | null | undefined, opts: Opciones = {}): Promise<ResultadoAutorizacion> {
  const token = tokenDeCabecera(cabecera);
  if (!token) return { ok: false, estado: 401, motivo: "Falta la sesión" };
  const sb = entornoSupabase(opts.env);
  if (!sb) return { ok: false, estado: 500, motivo: "Falta la configuración de Supabase" };
  const f = opts.fetch ?? fetch;
  const senal = AbortSignal.timeout(MS_TIEMPO_AUTH);
  try {
    // Primero la sesión (Auth también mira que no esté cerrada); después la reserva.
    const rUsuario = await f(`${sb.url}/auth/v1/user`, { headers: cabeceras(sb, token), signal: senal });
    if (rUsuario.status === 401 || rUsuario.status === 403) return { ok: false, estado: 401, motivo: "Sesión no válida o caducada" };
    if (!rUsuario.ok) return { ok: false, estado: 500, motivo: `Auth respondió ${rUsuario.status}` };
    const usuario = (await rUsuario.json().catch(() => null)) as { id?: string } | null;
    if (!usuario?.id) return { ok: false, estado: 401, motivo: "Sesión no válida" };

    const rReserva = await f(`${sb.url}/rest/v1/rpc/recorte_servidor_reservar`, {
      method: "POST",
      headers: cabeceras(sb, token),
      body: "{}",
      signal: senal,
    });
    if (rReserva.status === 401) return { ok: false, estado: 401, motivo: "Sesión no válida o caducada" };
    if (rReserva.status === 403) return { ok: false, estado: 403, motivo: "Sin permiso para la carta" };
    // Sin la migración 20261103180000 no hay control de gasto: no se recorta.
    if (rReserva.status === 404) return { ok: false, estado: 503, motivo: "Falta aplicar la migración del cupo de recortes (20261103180000)" };
    if (!rReserva.ok) return { ok: false, estado: 500, motivo: `La reserva respondió ${rReserva.status}` };
    const r = (await rReserva.json().catch(() => null)) as Record<string, unknown> | null;
    if (!r || typeof r.permitido !== "boolean") return { ok: false, estado: 500, motivo: "Respuesta de reserva no válida" };
    if (!r.permitido) {
      const tope = (r.motivo === "dia" || r.motivo === "cpu" ? r.motivo : "mes") as "mes" | "dia" | "cpu";
      return { ok: false, estado: 429, motivo: MOTIVOS_TOPE[tope], tope, uso: uso(r) };
    }
    return { ok: true, usuario: usuario.id, reserva: Number(r.id), uso: uso(r) };
  } catch (e) {
    return { ok: false, estado: 500, motivo: `No se pudo comprobar la sesión: ${(e as Error)?.message ?? e}` };
  }
}

/** Anota en la fila reservada cuánto tardó el trabajo y si salió bien. Nunca lanza. */
export async function terminarRecorte(cabecera: string | null | undefined, reserva: number, ms: number, ok: boolean, opts: Opciones = {}): Promise<void> {
  const token = tokenDeCabecera(cabecera);
  const sb = entornoSupabase(opts.env);
  if (!token || !sb) return;
  try {
    const r = await (opts.fetch ?? fetch)(`${sb.url}/rest/v1/rpc/recorte_servidor_terminar`, {
      method: "POST",
      headers: cabeceras(sb, token),
      body: JSON.stringify({ p_id: reserva, p_duracion_ms: Math.round(ms), p_ok: ok }),
      signal: AbortSignal.timeout(MS_TIEMPO_AUTH),
    });
    if (!r.ok) console.warn("[recortar-foto] no se pudo anotar la duración", r.status);
  } catch (e) {
    console.warn("[recortar-foto] no se pudo anotar la duración", e);
  }
}
