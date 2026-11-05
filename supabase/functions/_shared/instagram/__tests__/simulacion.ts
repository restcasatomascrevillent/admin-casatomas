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

export type Llamada = { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: string | null; bruto?: unknown };
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
  /** Google (token, Drive y miniaturas): ver driveFalso(). */
  drive?: Manejador;
  /** Objetos de tmp/ que devuelve el listado del bucket. */
  listado?: Array<{ name: string; created_at: string }>;
  /** Filas de instagram_fotos (GET) y respuesta al insertar (POST). */
  fotos?: Array<Record<string, unknown>>;
  insertarFoto?: [number, unknown];
  /** Respuesta de la RPC del cerrojo (por defecto, reservada). [404, …] = migración sin aplicar. */
  reserva?: [number, unknown];
  /** Respuesta al PATCH de alt_text (por defecto, 204). */
  altText?: [number, unknown];
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
    const l = { url, metodo, cabeceras, cuerpo, bruto: init.body };
    llamadas.push(l);
    if (url === `${SB}/auth/v1/user`) return resp(...(e.usuario ?? [200, { id: "usuario-1" }]));
    if (url === `${SB}/rest/v1/rpc/can_write_section`) return resp(200, e.permiso ?? true);
    if (url === `${SB}/rest/v1/rpc/instagram_pieza_reservar_publicacion`) {
      return resp(...(e.reserva ?? [200, { ok: true, bloqueo: "b0000000-0000-4000-8000-000000000001" }]));
    }
    if (url === `${SB}/rest/v1/rpc/instagram_pieza_liberar_publicacion`) return resp(200, true);
    if (url.startsWith(`${SB}/rest/v1/instagram_piezas`)) {
      if (metodo === "PATCH" && cuerpo && Object.keys(JSON.parse(cuerpo)).join() === "alt_text") {
        const [estado, c] = e.altText ?? [204, null];
        if (estado < 300 && fila) fila = { ...fila, ...JSON.parse(cuerpo) };
        return resp(estado, c);
      }
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
    if (url.startsWith(`${SB}/rest/v1/instagram_fotos`)) {
      if (metodo === "GET") return resp(200, e.fotos ?? []);
      if (metodo === "POST") return resp(...(e.insertarFoto ?? [201, [JSON.parse(cuerpo!)]]));
    }
    if (url.startsWith(`${SB}/storage/v1/object/public/instagram/`) && metodo === "GET") {
      return new Response(JPEG_MINIMO, { status: 200, headers: { "Content-Type": "image/jpeg" } });
    }
    if (url === `${SB}/storage/v1/object/list/instagram` && metodo === "POST") return resp(200, e.listado ?? []);
    if (/^https:\/\/(oauth2\.googleapis\.com|www\.googleapis\.com|[a-z0-9-]+\.googleusercontent\.com)\//.test(url) && e.drive) {
      const r = await e.drive(l);
      if (r) return r;
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

// ── Google Drive simulado ────────────────────────────────────────────────────

/** JPEG mínimo con cabecera SOF0 (lo justo para medidasJpeg). */
export function jpegDe(ancho: number, alto: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, alto >> 8, alto & 255, ancho >> 8, ancho & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);
}
export const JPEG_MINIMO = jpegDe(1080, 1350);

export const RAIZ_DRIVE = "1RaizMarketing0000000000001";
export const TOKEN_GOOGLE = "ya29.tokenDeAccesoDeGoogleSecreto123";
export const REFRESH_GOOGLE = "1//refreshTokenDeGoogleSuperSecreto";
export const SECRETO_GOOGLE = "GOCSPX-secretoDelClienteGoogle";
export const ENV_DRIVE = {
  // Con salto de línea, como el GOOGLE_CLIENT_ID real del 04-nov-2026.
  GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com\n",
  GOOGLE_CLIENT_SECRET: SECRETO_GOOGLE,
  GOOGLE_REFRESH_TOKEN: `${REFRESH_GOOGLE}\n`,
  GOOGLE_DRIVE_MARKETING_FOLDER_ID: RAIZ_DRIVE,
};
const CARPETA = "application/vnd.google-apps.folder";

export interface FicheroFalso {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  size?: string;
  trashed?: boolean;
  createdTime?: string;
  thumbnailLink?: string;
  imageMediaMetadata?: { width?: number; height?: number; rotation?: number };
  capabilities?: { canAddChildren?: boolean };
  bytes?: Uint8Array;
}

/**
 * Drive en memoria: token (con el alcance pedido), búsqueda de carpetas,
 * creación, listado de imágenes, metadatos, descarga, subida multipart y
 * miniaturas. `raizVisible: false` simula el alcance drive.file con una
 * carpeta creada a mano (404).
 */
export function driveFalso(o: { alcance?: string; raizVisible?: boolean; escribible?: boolean; tokenFalla?: boolean; subidaFalla?: boolean } = {}) {
  const ficheros = new Map<string, FicheroFalso>();
  if (o.raizVisible !== false) ficheros.set(RAIZ_DRIVE, { id: RAIZ_DRIVE, name: "marketing", mimeType: CARPETA, capabilities: { canAddChildren: o.escribible ?? true } });
  let n = 0;
  const nuevoId = () => `1Drive${String(++n).padStart(22, "0")}`;
  const peticionesToken: Llamada[] = [];
  const subidas: Array<{ meta: { name: string; parents: string[] }; bytes: number }> = [];

  const m: Manejador = (l) => {
    if (l.url === "https://oauth2.googleapis.com/token") {
      peticionesToken.push(l);
      if (o.tokenFalla) return resp(400, { error: "invalid_client", error_description: "Unauthorized" });
      return resp(200, { access_token: TOKEN_GOOGLE, expires_in: 3599, scope: o.alcance ?? "https://www.googleapis.com/auth/drive", token_type: "Bearer" });
    }
    if (l.cabeceras.authorization !== `Bearer ${TOKEN_GOOGLE}`) return resp(401, { error: { message: "Invalid Credentials" } });
    const u = new URL(l.url);
    if (u.hostname.endsWith("googleusercontent.com")) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    if (u.pathname === "/upload/drive/v3/files" && l.metodo === "POST") {
      if (o.subidaFalla) return resp(500, { error: { message: "Backend Error" } });
      const texto = new TextDecoder("utf-8").decode(l.bruto as Uint8Array);
      const meta = JSON.parse(texto.split("\r\n\r\n")[1].split("\r\n--")[0]) as { name: string; parents: string[] };
      const id = nuevoId();
      subidas.push({ meta, bytes: (l.bruto as Uint8Array).length });
      ficheros.set(id, { id, name: meta.name, mimeType: "image/jpeg", parents: meta.parents, size: "100", createdTime: "2026-11-05T10:00:00Z" });
      return resp(200, { id, name: meta.name, mimeType: "image/jpeg", parents: meta.parents });
    }
    if (u.pathname === "/drive/v3/files" && l.metodo === "GET") {
      const q = u.searchParams.get("q") ?? "";
      const padre = /'([^']+)' in parents/.exec(q)?.[1];
      const nombre = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1];
      const lista = [...ficheros.values()].filter((f) => f.parents?.includes(padre ?? "") && !f.trashed);
      if (q.includes(`mimeType='${CARPETA}'`)) return resp(200, { files: lista.filter((f) => f.mimeType === CARPETA && f.name === nombre) });
      return resp(200, { files: lista.filter((f) => f.mimeType.startsWith("image/")).map(({ bytes: _b, ...f }) => f) });
    }
    if (u.pathname === "/drive/v3/files" && l.metodo === "POST") {
      const meta = JSON.parse(l.cuerpo!) as { name: string; parents: string[]; mimeType: string };
      if (!ficheros.has(meta.parents[0])) return resp(404, { error: { message: "File not found" } });
      const id = nuevoId();
      ficheros.set(id, { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents });
      return resp(200, { id });
    }
    const ruta = /^\/drive\/v3\/files\/([A-Za-z0-9_-]+)$/.exec(u.pathname);
    if (ruta && l.metodo === "GET") {
      const f = ficheros.get(ruta[1]);
      if (!f) return resp(404, { error: { message: `File not found: ${ruta[1]}.` } });
      if (u.searchParams.get("alt") === "media") return new Response(f.bytes ?? JPEG_MINIMO, { status: 200, headers: { "Content-Type": f.mimeType } });
      const { bytes: _b, ...meta } = f;
      return resp(200, meta);
    }
    return undefined;
  };

  /** Crea (si falta) la carpeta de fotos de una marca y mete ahí un fichero. Devuelve el id de la carpeta. */
  const ponerFoto = (marca: string, f: Partial<FicheroFalso> & { id: string }) => {
    const buscar = (nombre: string, padre: string) => {
      const hay = [...ficheros.values()].find((x) => x.name === nombre && x.parents?.includes(padre));
      if (hay) return hay.id;
      const id = nuevoId();
      ficheros.set(id, { id, name: nombre, mimeType: CARPETA, parents: [padre] });
      return id;
    };
    const carpeta = buscar(marca, buscar("fotos", buscar("instagram", RAIZ_DRIVE)));
    ficheros.set(f.id, { name: `${f.id}.jpg`, mimeType: "image/jpeg", size: "200000", createdTime: "2026-11-01T10:00:00Z", parents: [carpeta], ...f });
    return carpeta;
  };

  return { m, ficheros, subidas, peticionesToken, ponerFoto };
}
