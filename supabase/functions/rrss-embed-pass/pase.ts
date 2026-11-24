/**
 * Edge Function rrss-embed-pass — pase de un solo uso para abrir rrss dentro
 * del panel (sección «Redes»). Diseño en el repo de rrss:
 * docs/integracion-casatomas.md.
 *
 *   POST `${SUPABASE_URL}/functions/v1/rrss-embed-pass`   Authorization: Bearer <JWT del panel>
 *     { cnf }  huella (SHA-256, base64url) del secreto que generó el iframe de rrss
 *     → 200 { pase, caducaEn }      el panel se lo pasa al iframe por postMessage
 *     → 400 sin huella · 401 sin sesión · 403 sin «Ver» en Redes · 503 sin configurar
 *
 * Prueba de posesión: el pase lleva `cnf` y rrss solo lo acepta junto al secreto,
 * que nunca sale del iframe. El pase no viaja en la dirección. Mientras Redes está
 * abierta, rrss pide uno nuevo cada 10 minutos: si aquí ya no se da (le han quitado
 * «Redes»), rrss corta el acceso como mucho unos 20 minutos después.
 *
 * El pase es un JWT ES256 firmado con la clave PRIVADA de este servidor
 * (secreto RRSS_EMBED_PRIVATE_JWK). rrss solo tiene la pública. Lleva:
 *   iss  RRSS_EMBED_ISSUER          aud   RRSS_EMBED_AUDIENCE (por defecto «rrss»)
 *   sub  id del usuario del panel   brand RRSS_EMBED_BRAND_ID (la marca de rrss)
 *   role nivel en Redes: «superadmin», «editar» (Ver + Puede editar) o «ver»
 *   name nombre visible del usuario (nunca su correo)
 *   iat, exp (60 s), jti (aleatorio: rrss solo lo acepta una vez)
 * Qué puede hacer cada nivel en rrss lo decide rrss (su configuración de la
 * integración), no este panel.
 */
import { exigirPermiso, respuestaJson, type DependenciasAutorizacion } from "../_shared/autorizacion.ts";

export const SECCION_REDES = "redes";
/** Vida del pase: lo justo para cargar el iframe. */
export const VIDA_PASE_SEGUNDOS = 60;

export type NivelRedes = "superadmin" | "editar" | "ver";

export interface ConfigPase {
  issuer: string;
  audience: string;
  brandId: string;
  kid: string;
  clavePrivada: { kty: string; crv: string; x: string; y: string; d: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lee la configuración de los secretos. null si falta algo o no es válido (la función no emite nada). */
export function leerConfig(env: (n: string) => string | undefined): ConfigPase | null {
  const issuer = env("RRSS_EMBED_ISSUER")?.trim() ?? "";
  const audience = env("RRSS_EMBED_AUDIENCE")?.trim() || "rrss";
  const brandId = env("RRSS_EMBED_BRAND_ID")?.trim() ?? "";
  const kid = env("RRSS_EMBED_KID")?.trim() ?? "";
  let clave: Record<string, unknown> | null = null;
  try {
    clave = JSON.parse(env("RRSS_EMBED_PRIVATE_JWK") ?? "null") as Record<string, unknown> | null;
  } catch {
    clave = null;
  }
  if (issuer.length < 3 || !UUID.test(brandId) || !/^[A-Za-z0-9._:-]{1,100}$/.test(kid)) return null;
  if (!clave || clave.kty !== "EC" || clave.crv !== "P-256") return null;
  for (const k of ["x", "y", "d"]) if (typeof clave[k] !== "string") return null;
  return {
    issuer,
    audience,
    brandId: brandId.toLowerCase(),
    kid,
    clavePrivada: { kty: "EC", crv: "P-256", x: String(clave.x), y: String(clave.y), d: String(clave.d) },
  };
}

function base64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const codificador = new TextEncoder();

/** JWT compacto ES256 (firma P1363 de 64 bytes, la que pide JWS). */
export async function firmarPase(config: ConfigPase, claims: Record<string, unknown>): Promise<string> {
  const cabecera = { alg: "ES256", typ: "JWT", kid: config.kid };
  const parte = (v: unknown) => base64Url(codificador.encode(JSON.stringify(v)));
  const entrada = `${parte(cabecera)}.${parte(claims)}`;
  const clave = await crypto.subtle.importKey(
    "jwk",
    { ...config.clavePrivada, ext: false } as never,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const firma = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, clave, codificador.encode(entrada)),
  );
  return `${entrada}.${base64Url(firma)}`;
}

export interface DependenciasPase extends DependenciasAutorizacion {
  /** Segundos desde 1970 (pruebas). */
  ahora?: () => number;
  /** Identificador único del pase (pruebas). */
  nuevoId?: () => string;
}

function envDeDeno(nombre: string): string | undefined {
  return (globalThis as typeof globalThis & { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(
    nombre,
  );
}

/** CORS: solo los orígenes del panel (RRSS_EMBED_PANEL_ORIGINS, separados por comas). */
export function cabecerasCors(req: Request, env: (n: string) => string | undefined): Record<string, string> {
  const permitidos = (env("RRSS_EMBED_PANEL_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const origen = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
    ...(permitidos.includes(origen) ? { "Access-Control-Allow-Origin": origen } : {}),
  };
}

const HUELLA = /^[A-Za-z0-9_-]{43}$/;

/** Nombre visible del usuario del panel (`display_name`), sin correo. */
async function nombreVisible(userId: string, deps: DependenciasPase): Promise<string | null> {
  const env = deps.env ?? envDeDeno;
  try {
    const servicio = deps.crearCliente(env("SUPABASE_URL") ?? "", env("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await servicio.auth.admin.getUserById(userId);
    const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
    const nombre = [meta.display_name, meta.full_name].find((v) => typeof v === "string" && v.trim());
    return typeof nombre === "string" && !nombre.includes("@") ? nombre.trim().slice(0, 120) : null;
  } catch {
    return null;
  }
}

/** Nivel del usuario en Redes, con la clave de servicio (has_section_permission ya cuenta a los super admins). */
async function nivelRedes(userId: string, deps: DependenciasPase): Promise<NivelRedes | null> {
  const env = deps.env ?? envDeDeno;
  const servicio = deps.crearCliente(env("SUPABASE_URL") ?? "", env("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await servicio.rpc(fn, args);
    if (error) throw new Error(fn);
    return data === true;
  };
  if (await rpc("is_super_admin", { _user_id: userId })) return "superadmin";
  if (await rpc("has_section_permission", { _user_id: userId, _section: SECCION_REDES, _permission: "edit" })) {
    return "editar";
  }
  if (await rpc("has_section_permission", { _user_id: userId, _section: SECCION_REDES, _permission: "view" })) {
    return "ver";
  }
  return null;
}

export async function manejarPase(req: Request, deps: DependenciasPase): Promise<Response> {
  const env = deps.env ?? envDeDeno;
  const cors = cabecerasCors(req, env);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return respuestaJson({ success: false, error: "Método no permitido" }, 405, cors);

  const config = leerConfig(env);
  if (!config) {
    console.error("[rrss-embed-pass] Falta la configuración (RRSS_EMBED_*).");
    return respuestaJson({ success: false, error: "Redes no está configurada en este entorno." }, 503, cors);
  }
  const usuario = await exigirPermiso(req, SECCION_REDES, "view", { ...deps, corsHeaders: cors });
  if (!usuario.ok) return usuario.response;
  const cuerpo = (await req.json().catch(() => null)) as { cnf?: unknown } | null;
  const cnf = cuerpo?.cnf;
  if (typeof cnf !== "string" || !HUELLA.test(cnf)) {
    return respuestaJson({ success: false, error: "Falta la huella del iframe de Redes." }, 400, cors);
  }

  let nivel: NivelRedes | null;
  try {
    nivel = await nivelRedes(usuario.userId, deps);
  } catch {
    return respuestaJson({ success: false, error: "No se pudo comprobar tu permiso." }, 503, cors);
  }
  if (!nivel) return respuestaJson({ success: false, error: "No tienes permiso para Redes." }, 403, cors);

  const ahora = (deps.ahora ?? (() => Math.floor(Date.now() / 1000)))();
  const nombre = await nombreVisible(usuario.userId, deps);
  const pase = await firmarPase(config, {
    iss: config.issuer,
    aud: config.audience,
    sub: usuario.userId,
    brand: config.brandId,
    role: nivel,
    ...(nombre ? { name: nombre } : {}),
    iat: ahora,
    exp: ahora + VIDA_PASE_SEGUNDOS,
    jti: (deps.nuevoId ?? (() => crypto.randomUUID()))(),
    cnf,
  });
  console.log("[rrss-embed-pass] pase emitido", JSON.stringify({ nivel }));
  return new Response(JSON.stringify({ success: true, pase, caducaEn: VIDA_PASE_SEGUNDOS }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
