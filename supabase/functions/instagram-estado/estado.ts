/**
 * Edge Function instagram-estado — «Comprobar conexión» de Marketing →
 * Instagram: secretos de Meta en Supabase (presentes o no, NUNCA su valor;
 * del token como mucho «…abcd»), identidad de la cuenta (username e id,
 * ¿coincide con IG_USER_ID?), cuota de publicación, método con el que se
 * verificó el token y qué falta, con «cómo arreglarlo». No publica nada.
 * Antes era la función de Vercel api/instagram-estado.ts.
 *
 *   Petición: GET (o POST) `${SUPABASE_URL}/functions/v1/instagram-estado`
 *             con `Authorization: Bearer <JWT de Supabase>` (usuario con Marketing).
 *   200: { ok, variables: [{ nombre, presente, obligatoria, detalle, estado, comoArreglarlo? }],
 *          faltan: string[], identidad: { igUserId, username, nombre, publicaciones, coincide, cuentasVistas } | null,
 *          cuota: { usadas, total, restantes, ventanaHoras } | null,
 *          metodoVerificacion: "debug_token_app"|"debug_token_propio"|"me_permissions"|"inferencia"|null,
 *          versionApi, tokenEnmascarado, comprobaciones: [{ seccion, nombre, estado, detalle, comoArreglarlo? }],
 *          noVerificado: string[], entornoSupabase: "demo"|"produccion"|"otro",
 *          drive: { ok, alcance: "completo"|"drive.file"|"otro"|null, alcances: string[],
 *                   carpeta: { nombre, escribible } | null, comprobaciones: [{ nombre, estado, detalle, comoArreglarlo? }], avisos } }
 *   «drive» es la comprobación de Google Drive (archivo de fotos y piezas
 *   publicadas): secretos presentes o no (nunca su valor), alcance del token
 *   (nunca el token) y si la carpeta «marketing» se ve y se puede escribir.
 *   No cambia «ok», que sigue siendo «se puede publicar en Instagram».
 *   401 sin sesión · 403 sin Marketing.
 */
import { comprobarEstado } from "../_shared/instagram/comprobacion.ts";
import { comprobarDrive } from "../_shared/instagram/drive.ts";
import { entornoDeno } from "../_shared/instagram/entorno.ts";
import { json, jsonAuth, opciones } from "../_shared/instagram/http.ts";
import { registro } from "../_shared/instagram/secretos.ts";
import { autorizarMarketing } from "../_shared/instagram/supabase.ts";

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
  if (request.method === "OPTIONS") return opciones();
  if (request.method !== "GET" && request.method !== "POST") return json(405, { ok: false, error: "Método no permitido" });
  const env = deps.env ?? entornoDeno();
  const auth = await autorizarMarketing(request.headers.get("authorization"), { env, fetch: deps.fetch });
  if ("motivo" in auth) return jsonAuth(auth.estado, auth.motivo);
  try {
    const f = deps.fetch;
    const [r, drive] = await Promise.all([
      comprobarEstado(env, { fetch: f ? (u, i) => f(u, i) : undefined, dormir: deps.dormir }),
      comprobarDrive(env, { fetch: f }).catch((e) => {
        registro("error", "instagram-estado", "Drive", e);
        return { ok: false, alcance: null, alcances: [], carpeta: null, comprobaciones: [{ nombre: "Google Drive", estado: "falla" as const, detalle: "no se pudo comprobar" }], avisos: [] };
      }),
    ]);
    const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(auth.sesion.sb.url)?.[1] ?? "";
    return json(200, { ...r, entornoSupabase: PROYECTOS[ref] ?? "otro", drive });
  } catch (e) {
    registro("error", "instagram-estado", "fallo", e);
    return json(500, { ok: false, error: "No se pudo comprobar la conexión con Instagram" });
  }
}
