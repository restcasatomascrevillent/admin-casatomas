/**
 * Edge Function rrss-embed-revoke — avisa a rrss en el momento en que a alguien le
 * quitan «Redes» (o se le borra del panel), para que pierda el acceso al instante
 * (revisión de seguridad A2, capa 2). Sin esto, rrss lo cortaría igual por caducidad,
 * pero hasta ~20 minutos después.
 *
 *   POST `${SUPABASE_URL}/functions/v1/rrss-embed-revoke`   x-rrss-revoke-secret: <secreto>
 *     { user_id }  → 200 { ok } · 401 sin el secreto · 409 si aún tiene «Redes» · 503 sin configurar
 *
 * La llama la base de datos (disparador de `user_permissions`, migración
 * 20261224100100) con el secreto de Vault `rrss_embed_revoke_secret`, que es el mismo
 * que el secreto de la función RRSS_EMBED_REVOKE_SECRET. Firma con la misma clave que
 * los pases un aviso `{typ: "rrss-revoke", sub, jti, exp}` (60 s, un solo uso) y lo
 * manda a rrss (RRSS_EMBED_REVOKE_URL = `…/functions/v1/embed-session/revoke`).
 */
import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";
import { firmarPase, leerConfig } from "../rrss-embed-pass/pase.ts";
import type { FabricaCliente } from "../_shared/autorizacion.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const VIDA_AVISO_SEGUNDOS = 60;

export interface DependenciasAviso {
  crearCliente: FabricaCliente;
  env?: (nombre: string) => string | undefined;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  ahora?: () => number;
  nuevoId?: () => string;
}

function envDeDeno(nombre: string): string | undefined {
  return (globalThis as typeof globalThis & { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(
    nombre,
  );
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function manejarAviso(req: Request, deps: DependenciasAviso): Promise<Response> {
  const env = deps.env ?? envDeDeno;
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  const secreto = env("RRSS_EMBED_REVOKE_SECRET") ?? "";
  const recibido = req.headers.get("x-rrss-revoke-secret") ?? "";
  if (secreto.length < 32 || !compararTiempoConstante(recibido, secreto)) {
    return json({ ok: false, error: "No autorizado" }, 401);
  }
  const config = leerConfig(env);
  const destino = env("RRSS_EMBED_REVOKE_URL")?.trim() ?? "";
  if (!config || !/^https:\/\/[^\s]+$/.test(destino)) {
    console.error("[rrss-embed-revoke] Falta la configuración (RRSS_EMBED_* o RRSS_EMBED_REVOKE_URL).");
    return json({ ok: false, error: "Sin configurar" }, 503);
  }
  const cuerpo = (await req.json().catch(() => null)) as { user_id?: unknown } | null;
  const userId = cuerpo?.user_id;
  if (typeof userId !== "string" || !UUID.test(userId)) return json({ ok: false, error: "Usuario no válido" }, 400);

  // Solo se avisa si de verdad ya no tiene «Redes» (p. ej., no al quitarle solo «Editar»).
  const servicio = deps.crearCliente(env("SUPABASE_URL") ?? "", env("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sigue, error } = await servicio.rpc("has_section_permission", {
    _user_id: userId,
    _section: "redes",
    _permission: "view",
  });
  if (error) return json({ ok: false, error: "No se pudo comprobar el permiso" }, 503);
  if (sigue === true) return json({ ok: false, error: "Aún tiene Redes" }, 409);

  const ahora = (deps.ahora ?? (() => Math.floor(Date.now() / 1000)))();
  const aviso = await firmarPase(config, {
    iss: config.issuer,
    aud: config.audience,
    sub: userId,
    brand: config.brandId,
    typ: "rrss-revoke",
    iat: ahora,
    exp: ahora + VIDA_AVISO_SEGUNDOS,
    jti: (deps.nuevoId ?? (() => crypto.randomUUID()))(),
  });
  const enviar = deps.fetch ?? ((url, init) => fetch(url, init));
  const respuesta = await enviar(destino, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notice: aviso }),
  }).catch(() => null);
  // 409: rrss ya lo había recibido (el mismo aviso no se aplica dos veces).
  if (!respuesta || (!respuesta.ok && respuesta.status !== 409)) {
    console.error("[rrss-embed-revoke] rrss no aceptó el aviso", JSON.stringify({ status: respuesta?.status ?? 0 }));
    return json({ ok: false, error: "rrss no respondió" }, 502);
  }
  console.log("[rrss-embed-revoke] aviso enviado");
  return json({ ok: true }, 200);
}
