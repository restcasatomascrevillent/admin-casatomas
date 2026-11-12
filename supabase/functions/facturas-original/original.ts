/**
 * Edge Function facturas-original — el ORIGINAL de una factura o albarán que
 * vive en Google Drive, servido por el servidor con la cuenta del restaurante.
 *
 * Por qué (dueño, 12/11/2026): el panel incrustaba la vista previa de Drive
 * (`/file/d/<id>/preview`) en un iframe y solo se veía si ese navegador tenía
 * sesión de Google con una cuenta con acceso al archivo. Ahora el panel pide
 * los bytes aquí con su sesión de Supabase y los enseña como blob URL. Los
 * archivos de Drive NO se hacen públicos.
 *
 *   GET ?id=<facturas.id>
 *     200 con los bytes (image/* o application/pdf), `Cache-Control: private`.
 *     401 sin sesión · 403 sin «Ver» en Facturas · 404 si la factura no existe
 *     (o RLS no se la deja ver al usuario) o no tiene original en Drive ·
 *     415 si el archivo no es imagen ni PDF · 503 si faltan los secretos de
 *     Google o Google no da el token · 502 si Drive falla.
 *
 * Autorización: JWT de Supabase + `has_section_permission(facturas, view)`
 * (_shared/autorizacion.ts). La fila se lee COMO EL USUARIO (clave pública +
 * su JWT), así que RLS decide qué facturas ve. El id de Drive sale SIEMPRE de
 * `facturas.drive_url`, nunca de la petición: con el alcance `drive` el token
 * ve todo el Drive del restaurante y esta función no debe servir otra cosa.
 *
 * Secretos (los mismos que procesar-factura y facturas-originales-drive):
 * GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN. Nunca se
 * registra ni se devuelve un token: los errores al panel son textos fijos.
 */
import { exigirPermiso, type FabricaCliente } from "../_shared/autorizacion.ts";
import { ClienteDrive, ErrorDrive, URL_DRIVE, esIdDrive } from "../_shared/google-drive.ts";

export const CORS_ORIGINAL = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/** Tipos que se sirven. SVG no: es un documento con scripts, no una foto. */
const TIPOS_PERMITIDOS = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/bmp",
]);

/** Tope de tamaño (los escaneos y PDF de facturas no pasan de unos pocos MB). */
export const MAX_BYTES = 40 * 1024 * 1024;

/** El navegador puede reutilizar la respuesta 10 min, solo él (nunca un proxy). */
export const CACHE_PRIVADA = "private, max-age=600";

export interface DepsOriginal {
  crearCliente: FabricaCliente;
  env?: (nombre: string) => string | undefined;
  fetch?: typeof fetch;
}

function envDeDeno(nombre: string): string | undefined {
  return (globalThis as typeof globalThis & { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(nombre);
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_ORIGINAL, "Content-Type": "application/json" } });
}

/** Id de Drive de un `drive_url` (`…/d/<id>/…` o `?id=<id>`), solo de drive/docs.google.com. */
export function idDriveDeUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (!/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(u.hostname)) return null;
  const ruta = /\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname);
  const id = ruta ? ruta[1] : u.searchParams.get("id");
  return esIdDrive(id) ? id : null;
}

export async function manejarOriginal(req: Request, deps: DepsOriginal): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_ORIGINAL });
  if (req.method !== "GET") return json({ ok: false, error: "Método no permitido" }, 405);

  const env = deps.env ?? envDeDeno;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return json({ ok: false, error: "Falta el id del documento" }, 400);

  const auth = await exigirPermiso(req, "facturas", "view", { crearCliente: deps.crearCliente, env, corsHeaders: CORS_ORIGINAL });
  if (!auth.ok) return auth.response;

  // La fila, como el usuario: RLS decide si la ve.
  const usuario = deps.crearCliente(env("SUPABASE_URL") ?? "", env("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let driveUrl: unknown;
  try {
    const { data, error } = await usuario.from("facturas").select("id, drive_url").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return json({ ok: false, error: "No existe el documento o no tienes acceso" }, 404);
    driveUrl = data.drive_url;
  } catch (e) {
    console.error("[facturas-original] No se pudo leer la factura:", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "No se pudo leer el documento" }, 503);
  }

  const idDrive = idDriveDeUrl(driveUrl);
  if (!idDrive) return json({ ok: false, sinDrive: true, error: "Este documento no tiene original en Google Drive" }, 404);

  const drive = new ClienteDrive({
    config: { clientId: env("GOOGLE_CLIENT_ID"), clientSecret: env("GOOGLE_CLIENT_SECRET"), refreshToken: env("GOOGLE_REFRESH_TOKEN") },
    fetch: deps.fetch,
  });
  if (!drive.configurado) {
    console.error("[facturas-original] Faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET o GOOGLE_REFRESH_TOKEN");
    return json({ ok: false, error: "Google Drive no está configurado en el servidor" }, 503);
  }

  let r: Response;
  try {
    r = await drive.pedir(`${URL_DRIVE}/files/${idDrive}?alt=media&supportsAllDrives=true`, { signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    const motivo = e instanceof ErrorDrive ? e.motivo : "red";
    console.error(`[facturas-original] Drive falló con la factura ${id} (${motivo}):`, e instanceof Error ? e.message : e);
    if (motivo === "no_encontrado" || motivo === "permiso") {
      return json({ ok: false, error: "La cuenta de Google del restaurante no encuentra este archivo en Drive" }, 404);
    }
    if (motivo === "token" || motivo === "sin_config") return json({ ok: false, error: "Google Drive no aceptó la conexión del servidor" }, 503);
    if (motivo === "limite") return json({ ok: false, error: "Google Drive pide esperar un momento" }, 429);
    return json({ ok: false, error: "Google Drive no respondió" }, 502);
  }

  const tipo = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!TIPOS_PERMITIDOS.has(tipo)) {
    await r.body?.cancel().catch(() => undefined);
    return json({ ok: false, error: "El original no es una imagen ni un PDF" }, 415);
  }
  const largo = Number(r.headers.get("content-length"));
  if (Number.isFinite(largo) && largo > MAX_BYTES) {
    await r.body?.cancel().catch(() => undefined);
    return json({ ok: false, error: "El original es demasiado grande para verlo aquí" }, 413);
  }

  const cabeceras: Record<string, string> = {
    ...CORS_ORIGINAL,
    "Content-Type": tipo,
    "Cache-Control": CACHE_PRIVADA,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  };
  // Se pasa el cuerpo tal cual (sin cargarlo entero en memoria). Sin
  // Content-Length: fetch pudo descomprimirlo y el largo de Google ya no valdría.
  return new Response(r.body, { status: 200, headers: cabeceras });
}
