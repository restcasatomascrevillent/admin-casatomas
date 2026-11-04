/**
 * GET /api/instagram-estado — «Comprobar conexión» de Marketing → Instagram:
 * variables de Meta en Vercel (presentes o no, NUNCA su valor; del token como
 * mucho «…abcd»), identidad de la cuenta (username e id, ¿coincide con
 * IG_USER_ID?), cuota de publicación, método con el que se verificó el token
 * y qué falta, con «cómo arreglarlo». No publica nada.
 *
 *   Petición: `Authorization: Bearer <JWT de Supabase>` (usuario con Marketing).
 *   200: { ok, variables: [{ nombre, presente, obligatoria, detalle, estado, comoArreglarlo? }],
 *          faltan: string[], identidad: { igUserId, username, nombre, publicaciones, coincide, cuentasVistas } | null,
 *          cuota: { usadas, total, restantes, ventanaHoras } | null,
 *          metodoVerificacion: "debug_token_app"|"debug_token_propio"|"me_permissions"|"inferencia"|null,
 *          versionApi, tokenEnmascarado, comprobaciones: [{ seccion, nombre, estado, detalle, comoArreglarlo? }],
 *          noVerificado: string[], entornoSupabase: "demo"|"produccion"|"otro" }
 *   401 sin sesión · 403 sin Marketing.
 */
import { comprobarEstado } from "./_lib/instagram/comprobacion.js";
import { json, jsonAuth } from "./_lib/instagram/http.js";
import { registro } from "./_lib/instagram/secretos.js";
import { autorizarMarketing } from "./_lib/instagram/supabase.js";

const PROYECTOS: Record<string, "demo" | "produccion"> = {
  sfonaclosuafvlhutkon: "demo",
  haqmmdfdzzatdnrrcgez: "produccion",
};

export interface DependenciasEstadoHttp {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
}

export async function manejarEstado(request: Request, deps: DependenciasEstadoHttp = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const auth = await autorizarMarketing(request.headers.get("authorization"), { env, fetch: deps.fetch });
  if ("motivo" in auth) return jsonAuth(auth.estado, auth.motivo);
  try {
    const f = deps.fetch;
    const r = await comprobarEstado(env, { fetch: f ? (u, i) => f(u, i) : undefined, dormir: deps.dormir });
    const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(auth.sesion.sb.url)?.[1] ?? "";
    return json(200, { ...r, entornoSupabase: PROYECTOS[ref] ?? "otro" });
  } catch (e) {
    registro("error", "instagram-estado", "fallo", e);
    return json(500, { ok: false, error: "No se pudo comprobar la conexión con Instagram" });
  }
}

export async function GET(request: Request): Promise<Response> {
  return manejarEstado(request);
}
