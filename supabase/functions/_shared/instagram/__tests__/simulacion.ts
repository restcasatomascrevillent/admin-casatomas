/**
 * Simulación compartida por los tests de las Edge Functions de Instagram
 * (instagram-publicar e instagram-estado): fetch falso de Supabase (Auth,
 * RPC, instagram_piezas, Storage) y de la Graph API de Meta. Sin red.
 */
import { vi } from "vitest";

export const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.firmaSecretaDelUsuario123";
export const TOKEN_META = "EAAGtokenSuperSecretoDeMetaParaPruebas0123456789abcd";
export const SECRETO_APP = "secretoDeLaAppDeMeta987";
export const SB = "https://sfonaclosuafvlhutkon.supabase.co";
export const ENV_SB = { SUPABASE_URL: SB, SUPABASE_ANON_KEY: "clave-publica" };
export const ENV_META = { ...ENV_SB, IG_ACCESS_TOKEN: TOKEN_META, IG_USER_ID: "17841400000000001", META_APP_ID: "1234567890", META_API_VERSION: "v26.0" };
export const ID = "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f";
export const GRAPH = "https://graph.facebook.com/v26.0";

export type Llamada = { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: string | null };
export type Manejador = (l: Llamada) => Response | Promise<Response> | undefined;

export function resp(estado: number, cuerpo: unknown, cabeceras: Record<string, string> = {}): Response {
  return new Response(cuerpo === null ? null : JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json", ...cabeceras } });
}

interface Escenario {
  usuario?: [number, unknown];
  permiso?: boolean;
  fila?: Record<string, unknown> | null;
  meta?: Manejador;
  head?: [number, string];
  /** Respuesta del DELETE en bloque de Storage (por defecto, el objeto borrado). */
  borrado?: [number, unknown];
}

/** fetch simulado: Supabase (Auth, RPC, instagram_piezas, Storage) + Meta. */
export function falso(e: Escenario = {}) {
  const llamadas: Llamada[] = [];
  let fila = e.fila === undefined ? null : e.fila;
  const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    const metodo = (init.method ?? "GET").toUpperCase();
    const cabeceras = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    const cuerpo = typeof init.body === "string" ? init.body : init.body ? "[binario]" : null;
    const l = { url, metodo, cabeceras, cuerpo };
    llamadas.push(l);
    if (url === `${SB}/auth/v1/user`) return resp(...(e.usuario ?? [200, { id: "usuario-1" }]));
    if (url === `${SB}/rest/v1/rpc/can_write_section`) return resp(200, e.permiso ?? true);
    if (url.startsWith(`${SB}/rest/v1/instagram_piezas`)) {
      if (metodo === "GET") return resp(200, fila ? [fila] : []);
      if (metodo === "POST") {
        fila = { caption: null, contenedor_id: null, media_id: null, permalink: null, ...JSON.parse(cuerpo!) };
        return resp(201, [fila]);
      }
      if (metodo === "PATCH") {
        if (!fila) return resp(200, []);
        fila = { ...fila, ...JSON.parse(cuerpo!) };
        return resp(200, [fila]);
      }
    }
    if (url.startsWith(`${SB}/storage/v1/object/public/instagram/`) && metodo === "HEAD") {
      const [estado, tipo] = e.head ?? [200, "image/jpeg"];
      return new Response(null, { status: estado, headers: { "Content-Type": tipo, "Content-Length": "120000" } });
    }
    if (url === `${SB}/storage/v1/object/instagram` && metodo === "DELETE") {
      return resp(...(e.borrado ?? [200, (JSON.parse(cuerpo!).prefixes as string[]).map((n) => ({ name: n, bucket_id: "instagram" }))]));
    }
    if (url.startsWith(`${SB}/storage/v1/object/instagram/`)) return resp(200, { Key: "instagram/x" });
    if (url.startsWith("https://graph.facebook.com/") && e.meta) {
      const r = await e.meta(l);
      if (r) return r;
    }
    throw new Error(`URL inesperada en el test: ${metodo} ${url}`);
  });
  return { f, llamadas, fila: () => fila };
}

export const peticion = (cuerpo: unknown, auth: string | null = `Bearer ${JWT}`, metodo = "POST") =>
  new Request("https://sfonaclosuafvlhutkon.supabase.co/functions/v1/x", {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    ...(metodo === "GET" ? {} : { body: JSON.stringify(cuerpo) }),
  });

export const FILA_GENERADA = {
  id: ID,
  marca: "casa-tomas",
  plantilla: "ct-tipografica",
  formato: "post",
  datos: {},
  caption: "Hola #casatomas",
  estado: "generada",
  imagen_ruta: `piezas/2026-11/${ID}.jpg`,
  contenedor_id: null,
  media_id: null,
  permalink: null,
  error: null,
  creado_por: "usuario-1",
};

/** Meta simulada para publicar: cuota, contenedor, estados, media_publish y permalink. */
export function metaPublicacion(o: { usadas?: number; total?: number; estados?: string[]; error?: { en: "media" | "publish" | "cuota"; cuerpo: unknown; estado?: number } } = {}) {
  const estados = [...(o.estados ?? ["FINISHED"])];
  const orden: string[] = [];
  const m: Manejador = (l) => {
    const ruta = l.url.replace(GRAPH, "");
    if (ruta.startsWith(`/${ENV_META.IG_USER_ID}/content_publishing_limit`)) {
      orden.push("cuota");
      if (o.error?.en === "cuota") return resp(o.error.estado ?? 400, o.error.cuerpo);
      return resp(200, { data: [{ quota_usage: o.usadas ?? 3, config: { quota_total: o.total ?? 100, quota_duration: 86400 } }] });
    }
    if (ruta === `/${ENV_META.IG_USER_ID}/media` && l.metodo === "POST") {
      orden.push("media");
      if (o.error?.en === "media") return resp(o.error.estado ?? 400, o.error.cuerpo);
      return resp(200, { id: "1790000000000001" });
    }
    if (ruta.startsWith("/1790000000000001?") && l.metodo === "GET") {
      const estado = estados.length > 1 ? estados.shift()! : estados[0];
      orden.push(`estado:${estado}`);
      return resp(200, { id: "1790000000000001", status_code: estado });
    }
    if (ruta === `/${ENV_META.IG_USER_ID}/media_publish` && l.metodo === "POST") {
      orden.push("publish");
      if (o.error?.en === "publish") return resp(o.error.estado ?? 400, o.error.cuerpo);
      return resp(200, { id: "1800000000000009" });
    }
    if (ruta.startsWith("/1800000000000009?")) {
      orden.push("permalink");
      return resp(200, { permalink: "https://www.instagram.com/p/ABC123/" });
    }
    return undefined;
  };
  return { m, orden };
}

export const depsRapidas = { dormir: async () => undefined };
