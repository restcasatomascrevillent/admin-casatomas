/**
 * Acceso de instagram-metricas a Supabase, sin supabase-js (fetch simulable):
 *
 *  - Como el USUARIO (clave pública + su JWT) para LEER: la RLS de las tablas
 *    de métricas (can_read_section('marketing')) decide.
 *  - Con la clave de SERVICIO solo para ESCRIBIR lo capturado (las tablas no
 *    dejan escribir a nadie más) y para el registro de capturas.
 *
 * Autorización del usuario: sesión válida (/auth/v1/user) + permiso de la
 * sección Marketing: can_read_section para «leer», can_edit_section («Editar»,
 * desde 20261111000000) para «capturar» (botón «Actualizar ahora»). Mismo esquema que
 * _shared/instagram/supabase.ts (autorizarMarketing), que solo comprueba
 * escritura y por eso no se reutiliza aquí.
 */
import { registrarSecreto, sanear } from "../_shared/instagram/secretos.ts";
import { entornoSupabase, tokenDeCabecera, SECCION_MARKETING, type EntornoSupabase } from "../_shared/instagram/supabase.ts";

const MS_TIEMPO = 15_000;

export type Permiso = "leer" | "escribir";

export interface SesionUsuario {
  usuario: string;
  token: string;
  sb: EntornoSupabase;
  fetch: typeof fetch;
}

export type ResultadoAutorizacion =
  | { ok: true; sesion: SesionUsuario }
  | { ok: false; estado: 401 | 403 | 500; motivo: string };

function cabeceras(clave: string, token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: clave, Authorization: `Bearer ${token}`, ...extra };
}

/** Sesión válida + permiso de Marketing (lectura o escritura). */
export async function autorizarSeccion(
  cabecera: string | null | undefined,
  permiso: Permiso,
  env: Record<string, string | undefined>,
  f: typeof fetch,
): Promise<ResultadoAutorizacion> {
  const token = tokenDeCabecera(cabecera);
  if (!token) return { ok: false, estado: 401, motivo: "Falta la sesión" };
  registrarSecreto(token);
  const sb = entornoSupabase(env);
  if (!sb) return { ok: false, estado: 500, motivo: "Falta la configuración de Supabase" };
  const senal = AbortSignal.timeout(MS_TIEMPO);
  try {
    const rUsuario = await f(`${sb.url}/auth/v1/user`, { headers: cabeceras(sb.clave, token), signal: senal });
    if (rUsuario.status === 401 || rUsuario.status === 403) return { ok: false, estado: 401, motivo: "Sesión no válida o caducada" };
    if (!rUsuario.ok) return { ok: false, estado: 500, motivo: `Auth respondió ${rUsuario.status}` };
    const usuario = (await rUsuario.json().catch(() => null)) as { id?: string } | null;
    if (!usuario?.id) return { ok: false, estado: 401, motivo: "Sesión no válida" };

    const rpc = permiso === "leer" ? "can_read_section" : "can_edit_section";
    const rPermiso = await f(`${sb.url}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: cabeceras(sb.clave, token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ _section: SECCION_MARKETING }),
      signal: senal,
    });
    if (rPermiso.status === 401) return { ok: false, estado: 401, motivo: "Sesión no válida o caducada" };
    if (!rPermiso.ok) return { ok: false, estado: 500, motivo: `La comprobación de permisos respondió ${rPermiso.status}` };
    const puede = await rPermiso.json().catch(() => null);
    if (puede !== true) {
      return { ok: false, estado: 403, motivo: permiso === "leer" ? "Sin permiso de Marketing" : "Sin permiso para editar Marketing: hace falta «Editar» en Marketing, no solo «Ver»" };
    }
    return { ok: true, sesion: { usuario: usuario.id, token, sb, fetch: f } };
  } catch (e) {
    return { ok: false, estado: 500, motivo: sanear(`No se pudo comprobar la sesión: ${(e as Error)?.message ?? e}`) };
  }
}

export class ErrorBaseDatos extends Error {
  readonly estado: number;
  readonly codigo: string | null;
  constructor(mensaje: string, estado: number, codigo: string | null = null) {
    super(sanear(mensaje));
    this.name = "ErrorBaseDatos";
    this.estado = estado;
    this.codigo = codigo;
  }
}

async function errorDe(r: Response, que: string): Promise<ErrorBaseDatos> {
  const texto = await r.text().catch(() => "");
  let mensaje = texto;
  let codigo: string | null = null;
  try {
    const j = JSON.parse(texto) as { message?: string; code?: string };
    mensaje = j.message ?? texto;
    codigo = j.code ?? null;
  } catch {
    /* texto plano */
  }
  return new ErrorBaseDatos(`${que} (${r.status}): ${sanear(mensaje).slice(0, 300)}`, r.status, codigo);
}

/** PostgREST con unas credenciales (usuario o servicio). */
export interface Rest {
  leer<T>(ruta: string, que: string): Promise<T[]>;
  /** Upsert (merge-duplicates) por `conflicto`. */
  guardar(tabla: string, filas: Record<string, unknown>[], conflicto?: string): Promise<void>;
}

export function rest(sb: EntornoSupabase, token: string, clave: string, f: typeof fetch): Rest {
  return {
    async leer<T>(ruta: string, que: string): Promise<T[]> {
      const r = await f(`${sb.url}/rest/v1/${ruta}`, {
        headers: cabeceras(clave, token, { Accept: "application/json" }),
        signal: AbortSignal.timeout(MS_TIEMPO),
      });
      if (!r.ok) throw await errorDe(r, `No se pudo leer ${que}`);
      return (await r.json()) as T[];
    },
    async guardar(tabla: string, filas: Record<string, unknown>[], conflicto?: string): Promise<void> {
      if (filas.length === 0) return;
      const consulta = conflicto ? `?on_conflict=${encodeURIComponent(conflicto)}` : "";
      const r = await f(`${sb.url}/rest/v1/${tabla}${consulta}`, {
        method: "POST",
        headers: cabeceras(clave, token, {
          "Content-Type": "application/json",
          Prefer: conflicto ? "resolution=merge-duplicates,return=minimal" : "return=minimal",
        }),
        body: JSON.stringify(filas),
        signal: AbortSignal.timeout(MS_TIEMPO),
      });
      if (!r.ok) throw await errorDe(r, `No se pudo guardar en ${tabla}`);
    },
  };
}

/** PostgREST como el usuario (RLS). */
export function restUsuario(s: SesionUsuario): Rest {
  return rest(s.sb, s.token, s.sb.clave, s.fetch);
}

/** PostgREST con la clave de servicio (solo para escribir lo capturado). */
export function restServicio(sb: EntornoSupabase, claveServicio: string, f: typeof fetch): Rest {
  registrarSecreto(claveServicio);
  return rest(sb, claveServicio, claveServicio, f);
}
