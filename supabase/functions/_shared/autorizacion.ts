// ============================================================================
//  Autorización común de las Edge Functions del panel (CT-REM-FN-01/02)
// ----------------------------------------------------------------------------
//  `conAuditoriaDePeticion` solo AUTENTICA (cualquier cuenta de Auth pasa). Este
//  módulo AUTORIZA: hay un usuario real detrás del token y tiene la sección.
//
//  Contrato:
//    exigirPermiso(req, seccion | [secciones], "view" | "edit", deps?)
//      → { ok: true, userId, email }            si pasa
//      → { ok: false, status, response }        401 sin usuario
//                                               403 sin permiso
//                                               503 si no se pudo comprobar
//    Falla CERRADO: cualquier error de Auth o de la RPC deniega.
//
//  Por qué la RPC va con service role y no con el cliente del usuario:
//    `has_section_permission(_user_id uuid, _section text, _permission text)`
//    (20260926060716) tiene el EXECUTE retirado a anon/authenticated desde
//    20260922200000_endurecer_funciones.sql. El usuario se resuelve con SU
//    token (cliente anon + Authorization del usuario → `auth.getUser()`, que
//    GoTrue valida) y la RPC se llama con service role pasando ese id ya
//    verificado — nunca un id del body. Es el mismo patrón que procesar-factura,
//    rebuild-webs, notify-reservation-change y chat-facturas.
//    `has_section_permission` devuelve true para super admins.
//
//  Modos: hoy `can_write_section` (RLS) exige solo can_view en todas las
//  secciones salvo reservas (`can_edit_section`). "edit" solo debe usarse donde
//  el hallazgo lo exige explícitamente (ver informe T1-AUTHZ).
//
//  Tokens que NUNCA son un usuario: ausente, la anon key heredada, una
//  `sb_publishable_…` y la service role (las integraciones con service role se
//  deciden ANTES de llamar a este helper, en cada función).
// ============================================================================

export type ModoPermiso = "view" | "edit";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FabricaCliente = (url: string, key: string, opciones?: any) => any;

export interface DependenciasAutorizacion {
  crearCliente: FabricaCliente;
  /** Por defecto, Deno.env. */
  env?: (nombre: string) => string | undefined;
  /** Cabeceras CORS de la función que responde. */
  corsHeaders?: Record<string, string>;
}

export type UsuarioAutorizado = { ok: true; userId: string; email: string | null };
export type Denegacion = { ok: false; status: 401 | 403 | 503; response: Response };
export type ResultadoAutorizacion = UsuarioAutorizado | Denegacion;

const CORS_POR_DEFECTO = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const MENSAJES_AUTORIZACION = {
  sinUsuario: "Se requiere un usuario autenticado para ejecutar esta acción.",
  sinPermiso: "No tienes permiso para esta acción.",
  noVerificable: "No se pudo comprobar tu permiso. La acción no se ha ejecutado.",
} as const;

function envDeDeno(nombre: string): string | undefined {
  return (globalThis as typeof globalThis & { Deno?: { env: { get(n: string): string | undefined } } })
    .Deno?.env.get(nombre);
}

export function respuestaJson(body: unknown, status: number, cors: Record<string, string> = CORS_POR_DEFECTO): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function denegar(status: 401 | 403 | 503, error: string, cors?: Record<string, string>): Denegacion {
  return { ok: false, status, response: respuestaJson({ success: false, error }, status, cors) };
}

/** Token Bearer de la petición ("" si no hay). */
export function tokenBearer(req: Request): string {
  return req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
}

/** true si el token es exactamente la service role key configurada. */
export function esServiceRole(req: Request, env: (n: string) => string | undefined = envDeDeno): boolean {
  const servicio = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = tokenBearer(req);
  return !!servicio && !!token && token === servicio;
}

/**
 * Resuelve el usuario real detrás del token. 401 si no hay usuario; 503 si
 * Auth no responde (no se degrada nunca a "sin usuario = permitido").
 */
export async function exigirUsuario(req: Request, deps: DependenciasAutorizacion): Promise<ResultadoAutorizacion> {
  const env = deps.env ?? envDeDeno;
  const cors = deps.corsHeaders;
  const token = tokenBearer(req);
  const anon = env("SUPABASE_ANON_KEY") ?? "";
  const servicio = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!token || (anon && token === anon) || (servicio && token === servicio) || token.startsWith("sb_publishable_") || token.startsWith("sb_secret_")) {
    return denegar(401, MENSAJES_AUTORIZACION.sinUsuario, cors);
  }
  try {
    const cliente = deps.crearCliente(env("SUPABASE_URL") ?? "", anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await cliente.auth.getUser(token);
    const user = data?.user ?? null;
    if (error || !user?.id) return denegar(401, MENSAJES_AUTORIZACION.sinUsuario, cors);
    return { ok: true, userId: String(user.id), email: typeof user.email === "string" ? user.email : null };
  } catch (error) {
    console.error("[autorizacion] No se pudo verificar el usuario:", error instanceof Error ? error.message : error);
    return denegar(503, MENSAJES_AUTORIZACION.noVerificable, cors);
  }
}

function clienteServicio(deps: DependenciasAutorizacion) {
  const env = deps.env ?? envDeDeno;
  return deps.crearCliente(env("SUPABASE_URL") ?? "", env("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Llama a una RPC booleana; true solo si devuelve exactamente `true`. Lanza si hay error. */
async function rpcBooleana(cliente: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }, fn: string, args: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await cliente.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${(error as { message?: string })?.message ?? "error"}`);
  return data === true;
}

/**
 * Usuario + `has_section_permission`. Con varias secciones basta con UNA
 * (p. ej. traducir-contenido sirve a Carta y a Novedades).
 */
export async function exigirPermiso(
  req: Request,
  seccion: string | readonly string[],
  modo: ModoPermiso,
  deps: DependenciasAutorizacion,
): Promise<ResultadoAutorizacion> {
  const secciones = (Array.isArray(seccion) ? seccion : [seccion]).filter((s): s is string => typeof s === "string" && s.length > 0);
  if (secciones.length === 0 || (modo !== "view" && modo !== "edit")) {
    // Un llamador mal escrito nunca abre la función.
    return denegar(403, MENSAJES_AUTORIZACION.sinPermiso, deps.corsHeaders);
  }
  const usuario = await exigirUsuario(req, deps);
  if (!usuario.ok) return usuario;
  try {
    const admin = clienteServicio(deps);
    for (const s of secciones) {
      if (await rpcBooleana(admin, "has_section_permission", { _user_id: usuario.userId, _section: s, _permission: modo })) {
        return usuario;
      }
    }
    return denegar(403, MENSAJES_AUTORIZACION.sinPermiso, deps.corsHeaders);
  } catch (error) {
    console.error("[autorizacion] Error comprobando permisos:", error instanceof Error ? error.message : error);
    return denegar(503, MENSAJES_AUTORIZACION.noVerificable, deps.corsHeaders);
  }
}

/**
 * Usuario con rol `admin` (is_admin) o super admin (is_super_admin, tabla
 * super_admins). Nunca por email del JWT (CT-REM-FN-12).
 */
export async function exigirAdmin(req: Request, deps: DependenciasAutorizacion): Promise<ResultadoAutorizacion> {
  const usuario = await exigirUsuario(req, deps);
  if (!usuario.ok) return usuario;
  try {
    const admin = clienteServicio(deps);
    if (await rpcBooleana(admin, "is_admin", { _user_id: usuario.userId })) return usuario;
    if (await rpcBooleana(admin, "is_super_admin", { _user_id: usuario.userId })) return usuario;
    return denegar(403, MENSAJES_AUTORIZACION.sinPermiso, deps.corsHeaders);
  } catch (error) {
    console.error("[autorizacion] Error comprobando rol de admin:", error instanceof Error ? error.message : error);
    return denegar(503, MENSAJES_AUTORIZACION.noVerificable, deps.corsHeaders);
  }
}

/**
 * SOLO super admin (`is_super_admin`, tabla super_admins): ser admin no basta.
 * Para lo que vive exclusivamente en Super Admin (p. ej. servicios-uso).
 */
export async function exigirSuperAdmin(req: Request, deps: DependenciasAutorizacion): Promise<ResultadoAutorizacion> {
  const usuario = await exigirUsuario(req, deps);
  if (!usuario.ok) return usuario;
  try {
    const admin = clienteServicio(deps);
    if (await rpcBooleana(admin, "is_super_admin", { _user_id: usuario.userId })) return usuario;
    return denegar(403, MENSAJES_AUTORIZACION.sinPermiso, deps.corsHeaders);
  } catch (error) {
    console.error("[autorizacion] Error comprobando super admin:", error instanceof Error ? error.message : error);
    return denegar(503, MENSAJES_AUTORIZACION.noVerificable, deps.corsHeaders);
  }
}
