// ============================================================================
//  Reseñas · cliente de Google OAuth y Google Business Profile
// ----------------------------------------------------------------------------
//  Sin Deno ni imports remotos: `fetch` se inyecta (tests sin red).
//
//  Necesita un cliente OAuth de Google Cloud (tipo «Aplicación web») con:
//    · la URI de redirección  <SUPABASE_URL>/functions/v1/resenas-contestador
//    · las APIs «My Business Account Management», «My Business Business
//      Information» y «Google My Business API» (v4, reseñas) habilitadas y
//      con cuota concedida (Google exige pedir acceso a la API de Business
//      Profile: formulario en developers.google.com/my-business).
//  Ámbito: https://www.googleapis.com/auth/business.manage
// ============================================================================

export const AMBITO_GBP = "https://www.googleapis.com/auth/business.manage";
const OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const CUENTAS = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const V4 = "https://mybusiness.googleapis.com/v4";
const MS = 20_000;

export class ErrorGoogle extends Error {
  constructor(message: string, readonly status: number, readonly codigo: string) {
    super(message);
    this.name = "ErrorGoogle";
  }
}

export interface CredencialesOAuth {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function urlAutorizacion(c: CredencialesOAuth, estado: string): string {
  const q = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: "code",
    scope: `${AMBITO_GBP} openid email`,
    access_type: "offline",
    // `consent` obliga a Google a devolver refresh_token también si la cuenta
    // ya había autorizado la app antes.
    prompt: "consent",
    include_granted_scopes: "true",
    state: estado,
  });
  return `${OAUTH_AUTH}?${q}`;
}

async function leer(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorDe(status: number, cuerpo: Record<string, unknown>, contexto: string): ErrorGoogle {
  const e = (cuerpo.error ?? {}) as Record<string, unknown> | string;
  const mensaje = typeof e === "string" ? `${e}${cuerpo.error_description ? `: ${cuerpo.error_description}` : ""}` : String(e.message ?? "");
  const estado = typeof e === "string" ? e : String(e.status ?? "");
  let codigo = "google_error";
  if (status === 401 || estado === "invalid_grant") codigo = "google_sin_permiso";
  else if (status === 403 && /quota|has not been used|disabled|SERVICE_DISABLED|not enabled/i.test(mensaje)) codigo = "google_api_sin_acceso";
  else if (status === 403) codigo = "google_prohibido";
  else if (status === 404) codigo = "google_no_encontrado";
  else if (status === 429) codigo = "google_cuota";
  return new ErrorGoogle(`${contexto}: ${status}${mensaje ? ` · ${mensaje.slice(0, 300)}` : ""}`, status, codigo);
}

export async function canjearCodigo(f: typeof fetch, c: CredencialesOAuth, code: string) {
  const res = await f(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(MS),
  });
  const j = await leer(res);
  if (!res.ok) throw errorDe(res.status, j, "Google OAuth (canje)");
  if (typeof j.refresh_token !== "string" || !j.refresh_token) {
    throw new ErrorGoogle("Google no devolvió refresh_token (vuelve a conectar y acepta todos los permisos)", 400, "google_sin_refresh");
  }
  return {
    refreshToken: j.refresh_token,
    accessToken: String(j.access_token ?? ""),
    scope: typeof j.scope === "string" ? j.scope : null,
    email: emailDeIdToken(j.id_token),
  };
}

/** Email de la cuenta (solo informativo, para enseñarlo en el panel). Sin verificar firma: no se usa para autorizar. */
export function emailDeIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const p = idToken.split(".")[1];
    const t = atob(p.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((p.length + 3) % 4));
    const email = JSON.parse(t)?.email;
    return typeof email === "string" ? email.slice(0, 200) : null;
  } catch {
    return null;
  }
}

export async function tokenDeAcceso(f: typeof fetch, c: Omit<CredencialesOAuth, "redirectUri">, refreshToken: string): Promise<string> {
  const res = await f(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(MS),
  });
  const j = await leer(res);
  if (!res.ok || typeof j.access_token !== "string") throw errorDe(res.status || 401, j, "Google OAuth (renovar)");
  return j.access_token;
}

export interface Ubicacion {
  name: string; // accounts/{a}/locations/{l}
  titulo: string;
  placeId: string | null;
  direccion: string | null;
}

export interface ClienteGbp {
  ubicaciones(): Promise<Ubicacion[]>;
  resenas(ubicacion: string, maxPaginas?: number): Promise<{ resenas: unknown[]; media: number | null; total: number | null }>;
  responder(resena: string, texto: string): Promise<void>;
}

export function crearClienteGbp(f: typeof fetch, accessToken: string): ClienteGbp {
  const get = async (url: string, contexto: string) => {
    const res = await f(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(MS) });
    const j = await leer(res);
    if (!res.ok) throw errorDe(res.status, j, contexto);
    return j;
  };
  return {
    async ubicaciones() {
      const salida: Ubicacion[] = [];
      const cuentas = ((await get(`${CUENTAS}?pageSize=20`, "Business Profile (cuentas)")).accounts ?? []) as Array<{ name?: string }>;
      for (const c of cuentas.slice(0, 10)) {
        if (!c.name || !/^accounts\/[0-9]+$/.test(c.name)) continue;
        const j = await get(`${INFO}/${c.name}/locations?pageSize=100&readMask=name,title,storefrontAddress,metadata`, "Business Profile (fichas)");
        for (const l of (j.locations ?? []) as Array<Record<string, unknown>>) {
          const id = String(l.name ?? "").replace(/^locations\//, "");
          if (!/^[0-9]+$/.test(id)) continue;
          const dir = l.storefrontAddress as { addressLines?: string[]; locality?: string } | undefined;
          salida.push({
            name: `${c.name}/locations/${id}`,
            titulo: String(l.title ?? "").slice(0, 200),
            placeId: typeof (l.metadata as Record<string, unknown>)?.placeId === "string" ? String((l.metadata as Record<string, unknown>).placeId) : null,
            direccion: dir ? [...(dir.addressLines ?? []), dir.locality].filter(Boolean).join(", ").slice(0, 300) : null,
          });
        }
      }
      return salida;
    },
    async resenas(ubicacion, maxPaginas = 5) {
      const lista: unknown[] = [];
      let token = "";
      let media: number | null = null;
      let total: number | null = null;
      for (let i = 0; i < maxPaginas; i++) {
        const j = await get(`${V4}/${ubicacion}/reviews?pageSize=50&orderBy=updateTime%20desc${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, "Business Profile (reseñas)");
        lista.push(...((j.reviews ?? []) as unknown[]));
        if (typeof j.averageRating === "number") media = j.averageRating;
        if (typeof j.totalReviewCount === "number") total = j.totalReviewCount;
        token = typeof j.nextPageToken === "string" ? j.nextPageToken : "";
        if (!token) break;
      }
      return { resenas: lista, media, total };
    },
    async responder(resena, texto) {
      const res = await f(`${V4}/${resena}/reply`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ comment: texto }),
        signal: AbortSignal.timeout(MS),
      });
      if (!res.ok) throw errorDe(res.status, await leer(res), "Business Profile (responder)");
    },
  };
}

/** Elige la ficha: la que tenga el place_id configurado o, si solo hay una, esa. */
export function elegirUbicacion(lista: Ubicacion[], placeId: string | null | undefined): Ubicacion | null {
  if (placeId) {
    const exacta = lista.find((u) => u.placeId === placeId);
    if (exacta) return exacta;
  }
  return lista.length === 1 ? lista[0] : null;
}
