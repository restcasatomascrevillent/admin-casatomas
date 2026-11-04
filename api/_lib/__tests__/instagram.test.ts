// @vitest-environment node
/**
 * Funciones de Instagram (api/instagram-render, -publicar, -estado) sin red
 * ni Chromium: fetch simulado (Supabase Auth/PostgREST/Storage y Graph API de
 * Meta) y renderizador simulado. Ver docs/instagram.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manejarRender } from "../../instagram-render";
import { manejarPublicar } from "../../instagram-publicar";
import { manejarEstado } from "../../instagram-estado";
import { ErrorRender, envolverComprobacion, ficheroLocal, type Renderizador } from "../instagram/render";
import { clasificarError, mapearErrorGraph } from "../instagram/errores";
import { olvidarSecretos, registrarSecreto, sanear, sanearUrl } from "../instagram/secretos";
import { usarChromiumServerless } from "../instagram/navegador";
import { contarHashtags, validarCaption } from "../instagram/validacion";
import { EJEMPLOS } from "../../../src/lib/instagram/ejemplos";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.firmaSecretaDelUsuario123";
const TOKEN_META = "EAAGtokenSuperSecretoDeMetaParaPruebas0123456789abcd";
const SECRETO_APP = "secretoDeLaAppDeMeta987";
const SB = "https://sfonaclosuafvlhutkon.supabase.co";
const ENV_SB = { VITE_SUPABASE_URL: SB, VITE_SUPABASE_PUBLISHABLE_KEY: "clave-publica" };
const ENV_META = { ...ENV_SB, IG_ACCESS_TOKEN: TOKEN_META, IG_USER_ID: "17841400000000001", META_APP_ID: "1234567890", META_API_VERSION: "v26.0" };
const ID = "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f";
const PIEZA = EJEMPLOS.find((e) => e.id === "ct-tipografica-post")!.json;
const GRAPH = "https://graph.facebook.com/v26.0";

type Llamada = { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: string | null };
type Manejador = (l: Llamada) => Response | Promise<Response> | undefined;

function resp(estado: number, cuerpo: unknown, cabeceras: Record<string, string> = {}): Response {
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
function falso(e: Escenario = {}) {
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

const peticion = (cuerpo: unknown, auth: string | null = `Bearer ${JWT}`, metodo = "POST") =>
  new Request("https://panel/api/x", {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    ...(metodo === "GET" ? {} : { body: JSON.stringify(cuerpo) }),
  });

const jpgFalso: Renderizador = async (p) => ({
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
  ancho: p.ancho,
  alto: p.alto,
  calidad: 92,
  avisos: [],
  tiempos: { msArranque: 1, msPagina: 1, msCarga: 1, msCaptura: 1, msJpeg: 1 },
});

const FILA_GENERADA = {
  id: ID,
  marca: "casa-tomas",
  plantilla: "ct-tipografica",
  formato: "post",
  datos: PIEZA,
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
function metaPublicacion(o: { usadas?: number; total?: number; estados?: string[]; error?: { en: "media" | "publish" | "cuota"; cuerpo: unknown; estado?: number } } = {}) {
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

const depsRapidas = { dormir: async () => undefined };

beforeEach(() => olvidarSecretos());
afterEach(() => vi.restoreAllMocks());

// ── Saneado ────────────────────────────────────────────────────────────────

describe("saneado de secretos", () => {
  it("tapa secretos registrados, Bearer, access_token= y JWT/EAA sueltos", () => {
    registrarSecreto(SECRETO_APP);
    const t = sanear(`fallo ${SECRETO_APP} Authorization: Bearer abc.def.ghi ${JWT} ?access_token=XYZ123 ${TOKEN_META}`);
    expect(t).not.toContain(SECRETO_APP);
    expect(t).not.toContain(JWT);
    expect(t).not.toContain("XYZ123");
    expect(t).not.toContain(TOKEN_META);
    expect(t).toContain("[OCULTO]");
    expect(sanearUrl(`${GRAPH}/debug_token?input_token=${TOKEN_META}&access_token=1|${SECRETO_APP}`)).not.toMatch(/EAAG|secretoDeLaApp/);
  });

  it("cuenta hashtags y valida el caption (2200 / 30 # / 20 @)", () => {
    expect(contarHashtags("#a #b c#d")).toBe(2);
    expect(validarCaption("x".repeat(2201)).ok).toBe(false);
    expect(validarCaption(Array.from({ length: 31 }, (_, i) => `#h${i}`).join(" ")).errores[0]).toMatch(/31 hashtags/);
    expect(validarCaption(Array.from({ length: 21 }, (_, i) => `@u${i}`).join(" ")).errores[0]).toMatch(/21 menciones/);
    expect(validarCaption("Hola #casatomas @amigo").ok).toBe(true);
  });
});

describe("mapeo de errores de Meta", () => {
  it("190 → token, 2207042 → límite de publicación, 9004 → URL no descargable", () => {
    expect(clasificarError(190, 463, "", 400)).toBe("token");
    expect(clasificarError(4, 2207042, "", 400)).toBe("limite_publicacion");
    expect(clasificarError(9004, null, "", 400)).toBe("url_no_descargable");
    const e = mapearErrorGraph({ estadoHttp: 400, cuerpo: { error: { code: 190, error_subcode: 463, message: `Token ${TOKEN_META} expired`, fbtrace_id: "Abc" } } });
    expect(e.tipo).toBe("token");
    expect(e.message).toMatch(/caducado/);
    expect(e.comoArreglarlo).toMatch(/Vercel/);
    expect(e.message).not.toContain(TOKEN_META);
  });
});

describe("arranque de Chromium", () => {
  it("usa @sparticuz/chromium solo en Linux serverless; en Windows, el Chromium de Playwright", () => {
    expect(usarChromiumServerless({ VERCEL: "1" }, "linux")).toBe(true);
    expect(usarChromiumServerless({ VERCEL: "1" }, "win32")).toBe(false);
    expect(usarChromiumServerless({}, "linux")).toBe(false);
    expect(usarChromiumServerless({ VERCEL: "1", INSTAGRAM_CHROMIUM_PATH: "/x" }, "linux")).toBe(false);
  });

  it("sirve desde disco solo ficheros de public/instagram (sin salirse de la carpeta)", () => {
    const r = { origen: "https://panel", prefijo: "/instagram", dir: `${process.cwd()}/public/instagram` };
    expect(ficheroLocal(r, "/instagram/fuentes/libre-baskerville/OFL.txt")).toMatch(/OFL\.txt$/);
    expect(ficheroLocal(r, "/instagram/no-existe.woff2")).toBeNull();
    expect(ficheroLocal(r, "/instagram/..%2F..%2Fpackage.json")).toBeNull();
    expect(ficheroLocal(r, "/otra/cosa")).toBeNull();
  });

  it("envuelve las comprobaciones del núcleo ({ errores, avisos } o string[])", async () => {
    const evaluar = (codigo: string) => new Function(`return ${codigo};`)();
    expect(await evaluar(envolverComprobacion(`(() => ({ errores: ["a"], avisos: ["b"] }))()`))).toEqual({ errores: ["a"], avisos: ["b"] });
    expect(await evaluar(envolverComprobacion(`["x"]`))).toEqual({ errores: ["x"], avisos: [] });
    expect(await evaluar(envolverComprobacion(`() => []`))).toEqual({ errores: [], avisos: [] });
  });
});

// ── Render ─────────────────────────────────────────────────────────────────

describe("POST /api/instagram-render", () => {
  it("401 sin token (sin llamar a Supabase ni renderizar)", async () => {
    const { f } = falso();
    const renderizar = vi.fn(jpgFalso);
    const r = await manejarRender(peticion({ pieza: PIEZA }, null), { env: ENV_SB, fetch: f, renderizar });
    expect(r.status).toBe(401);
    expect(r.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(f).not.toHaveBeenCalled();
    expect(renderizar).not.toHaveBeenCalled();
  });

  it("401 con sesión caducada", async () => {
    const { f } = falso({ usuario: [401, { msg: "invalid JWT" }] });
    expect((await manejarRender(peticion({ pieza: PIEZA }), { env: ENV_SB, fetch: f, renderizar: jpgFalso })).status).toBe(401);
  });

  it("403 sin permiso de Marketing (can_write_section('marketing') = false)", async () => {
    const { f, llamadas } = falso({ permiso: false });
    const renderizar = vi.fn(jpgFalso);
    const r = await manejarRender(peticion({ pieza: PIEZA }), { env: ENV_SB, fetch: f, renderizar });
    expect(r.status).toBe(403);
    expect(renderizar).not.toHaveBeenCalled();
    const permiso = llamadas.find((l) => l.url.endsWith("can_write_section"))!;
    expect(JSON.parse(permiso.cuerpo!)).toEqual({ _section: "marketing" });
    expect(permiso.cabeceras.authorization).toBe(`Bearer ${JWT}`);
  });

  it("422 con la lista de problemas si la pieza no es válida", async () => {
    const { f } = falso();
    const renderizar = vi.fn(jpgFalso);
    const r = await manejarRender(peticion({ pieza: { ...PIEZA, titular: "Uno dos tres cuatro cinco seis siete ocho" } }), { env: ENV_SB, fetch: f, renderizar });
    expect(r.status).toBe(422);
    const j = await r.json();
    expect(j.problemas.join(" ")).toMatch(/palabras/);
    expect(renderizar).not.toHaveBeenCalled();
  });

  it("422 si no pasa la maquetación (no sube nada)", async () => {
    const { f, llamadas } = falso();
    const renderizar: Renderizador = async () => {
      throw new ErrorRender("maquetacion", ["El campo «titular» se desborda (12 px de alto): acórtalo"], "x");
    };
    const r = await manejarRender(peticion({ pieza: PIEZA }), { env: ENV_SB, fetch: f, renderizar });
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ ok: false, tipo: "maquetacion", problemas: ["El campo «titular» se desborda (12 px de alto): acórtalo"] });
    expect(llamadas.some((l) => l.url.includes("/storage/"))).toBe(false);
  });

  it("200: sube el JPEG con el JWT del usuario a instagram/piezas/AAAA-MM/<id>.jpg y guarda la fila «generada»", async () => {
    const { f, llamadas, fila } = falso();
    const renderizar = vi.fn(jpgFalso);
    const r = await manejarRender(peticion({ pieza: PIEZA, caption: "Texto" }), {
      env: ENV_SB,
      fetch: f,
      renderizar,
      ahora: () => new Date("2026-11-04T12:00:00Z"),
      nuevoId: () => ID,
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, id: ID, estado: "generada", ancho: 1080, alto: 1350, imagenRuta: `piezas/2026-11/${ID}.jpg` });
    expect(j.urlJpeg).toMatch(new RegExp(`^${SB}/storage/v1/object/public/instagram/piezas/2026-11/${ID}\\.jpg\\?v=\\d+$`));
    expect(renderizar.mock.calls[0][0]).toMatchObject({ ancho: 1080, alto: 1350 });
    // Fuentes y logos del panel (servidos desde disco a Chromium); fotos del bucket.
    expect(renderizar.mock.calls[0][0].html).toContain("https://panel/instagram/fuentes/");
    expect(renderizar.mock.calls[0][0].recursosLocales).toMatchObject({ origen: "https://panel", prefijo: "/instagram" });
    expect(renderizar.mock.calls[0][0].recursosLocales!.dir).toMatch(/public[\\/]instagram$/);
    const subida = llamadas.find((l) => l.url.startsWith(`${SB}/storage/v1/object/instagram/`))!;
    expect(subida.url).toBe(`${SB}/storage/v1/object/instagram/piezas/2026-11/${ID}.jpg`);
    expect(subida.cabeceras.authorization).toBe(`Bearer ${JWT}`);
    expect(subida.cabeceras.apikey).toBe("clave-publica");
    expect(subida.cabeceras["content-type"]).toBe("image/jpeg");
    expect(fila()).toMatchObject({ id: ID, estado: "generada", plantilla: "ct-tipografica", formato: "post", caption: "Texto" });
  });

  it("409 al regenerar una pieza ya publicada; 404 si el id no existe", async () => {
    const pub = falso({ fila: { ...FILA_GENERADA, estado: "publicada", permalink: "https://www.instagram.com/p/X/" } });
    expect((await manejarRender(peticion({ pieza: PIEZA, id: ID }), { env: ENV_SB, fetch: pub.f, renderizar: jpgFalso })).status).toBe(409);
    const nada = falso({ fila: null });
    expect((await manejarRender(peticion({ pieza: PIEZA, id: ID }), { env: ENV_SB, fetch: nada.f, renderizar: jpgFalso })).status).toBe(404);
  });

  it("al regenerar conserva la ruta y vuelve a «generada»", async () => {
    const { f, fila } = falso({ fila: { ...FILA_GENERADA, estado: "error", error: "x", imagen_ruta: `piezas/2026-10/${ID}.jpg` } });
    const r = await manejarRender(peticion({ pieza: PIEZA, id: ID }), { env: ENV_SB, fetch: f, renderizar: jpgFalso });
    expect(r.status).toBe(200);
    expect(fila()).toMatchObject({ estado: "generada", error: null, imagen_ruta: `piezas/2026-10/${ID}.jpg` });
  });
});

// ── Publicar ───────────────────────────────────────────────────────────────

describe("POST /api/instagram-publicar", () => {
  it("401 sin token y 403 sin Marketing (sin llamar a Meta)", async () => {
    const meta = vi.fn(() => undefined);
    const a = falso({ meta });
    expect((await manejarPublicar(peticion({ id: ID, dryRun: true }, null), { env: ENV_META, fetch: a.f })).status).toBe(401);
    const b = falso({ permiso: false, meta });
    expect((await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: b.f })).status).toBe(403);
    expect(meta).not.toHaveBeenCalled();
  });

  it("503 si faltan variables de Meta, nombrándolas sin valores", async () => {
    const { f } = falso({ fila: FILA_GENERADA });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: { ...ENV_SB, IG_ACCESS_TOKEN: TOKEN_META }, fetch: f });
    expect(r.status).toBe(503);
    const texto = await r.text();
    expect(JSON.parse(texto).faltan).toEqual(["IG_USER_ID", "META_APP_ID"]);
    expect(texto).not.toContain(TOKEN_META);
  });

  it("422 si el caption pasa de 30 hashtags (sin gastar cuota)", async () => {
    const { m, orden } = metaPublicacion();
    const { f } = falso({ fila: FILA_GENERADA, meta: m });
    const caption = Array.from({ length: 31 }, (_, i) => `#h${i}`).join(" ");
    const r = await manejarPublicar(peticion({ id: ID, caption, dryRun: true }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(422);
    expect(orden).toEqual([]);
  });

  it("422 si la URL pública no sirve un JPEG", async () => {
    const { m, orden } = metaPublicacion();
    const { f, fila } = falso({ fila: FILA_GENERADA, meta: m, head: [404, "application/json"] });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(422);
    expect(orden).toEqual([]);
    expect(fila()).toMatchObject({ estado: "error" });
  });

  it("cuota agotada → 429 y no crea contenedor", async () => {
    const { m, orden } = metaPublicacion({ usadas: 100, total: 100 });
    const { f } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ cuota: { usadas: 100, total: 100, restantes: 0 } });
    expect(orden).toEqual(["cuota"]);
  });

  it("dry-run: crea el contenedor, espera FINISHED y NUNCA llama a media_publish", async () => {
    const { m, orden } = metaPublicacion({ estados: ["IN_PROGRESS", "FINISHED"] });
    const { f, llamadas, fila } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, dryRun: true, publicado: false, estado: "prueba_ok", contenedor: { id: "1790000000000001", estado: "FINISHED" }, mediaId: null });
    expect(orden).toEqual(["cuota", "media", "estado:IN_PROGRESS", "estado:FINISHED"]);
    expect(llamadas.some((l) => l.url.includes("media_publish"))).toBe(false);
    // En prueba el JPEG se queda en el bucket: el contenedor necesita la URL.
    expect(llamadas.some((l) => l.metodo === "DELETE")).toBe(false);
    expect(fila()).toMatchObject({ estado: "prueba_ok", contenedor_id: "1790000000000001" });
    const media = llamadas.find((l) => l.url.endsWith("/media"))!;
    const cuerpo = new URLSearchParams(media.cuerpo!);
    expect(cuerpo.get("image_url")).toBe(`${SB}/storage/v1/object/public/instagram/piezas/2026-11/${ID}.jpg`);
    expect(cuerpo.get("caption")).toBe("Hola #casatomas");
    expect(media.cabeceras.authorization).toBe(`Bearer ${TOKEN_META}`);
    expect(media.url).not.toContain("access_token");
  });

  it("publicación real: media_publish solo DESPUÉS de FINISHED, con permalink y fila «publicada»", async () => {
    const { m, orden } = metaPublicacion({ estados: ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"] });
    const { f, fila } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, caption: "Nuevo texto", dryRun: false }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      publicado: true,
      estado: "publicada",
      mediaId: "1800000000000009",
      permalink: "https://www.instagram.com/p/ABC123/",
      cuota: { usadas: 4, total: 100, restantes: 96 },
    });
    expect(orden).toEqual(["cuota", "media", "estado:IN_PROGRESS", "estado:IN_PROGRESS", "estado:FINISHED", "publish", "permalink"]);
    expect(fila()).toMatchObject({ estado: "publicada", media_id: "1800000000000009", permalink: "https://www.instagram.com/p/ABC123/", caption: "Nuevo texto", error: null });
  });

  it("tras publicar de verdad borra el JPEG del bucket con el JWT del usuario (y conserva imagen_ruta)", async () => {
    const { m } = metaPublicacion();
    const { f, llamadas, fila } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(await r.json()).toMatchObject({ publicado: true, imagenEnBucket: false });
    const i = llamadas.findIndex((l) => l.metodo === "DELETE");
    expect(i).toBeGreaterThan(llamadas.findIndex((l) => l.url.endsWith("/media_publish")));
    const borrado = llamadas[i];
    expect(borrado.url).toBe(`${SB}/storage/v1/object/instagram`);
    expect(JSON.parse(borrado.cuerpo!)).toEqual({ prefixes: [`piezas/2026-11/${ID}.jpg`] });
    expect(borrado.cabeceras.authorization).toBe(`Bearer ${JWT}`);
    expect(fila()).toMatchObject({ estado: "publicada", imagen_ruta: `piezas/2026-11/${ID}.jpg`, error: null });
  });

  it("si la RLS no deja borrar el JPEG: sigue publicada, avisa y lo anota en «error»", async () => {
    const { m } = metaPublicacion();
    const { f, fila } = falso({ fila: FILA_GENERADA, meta: m, borrado: [200, []] });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: f, ...depsRapidas });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ publicado: true, imagenEnBucket: true });
    expect(j.avisos.join(" ")).toMatch(/no se pudo borrar el JPEG/);
    expect(fila()).toMatchObject({ estado: "publicada" });
    expect(String(fila()!.error)).toMatch(/^Publicada, pero el JPEG no se pudo borrar/);
  });

  it("un contenedor en ERROR no se publica", async () => {
    const { m, orden } = metaPublicacion({ estados: ["ERROR"] });
    const { f, fila } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(422);
    expect(orden).not.toContain("publish");
    expect(fila()).toMatchObject({ estado: "error" });
  });

  it("story: media_type=STORIES y sin caption", async () => {
    const { m } = metaPublicacion();
    const { f, llamadas } = falso({ fila: { ...FILA_GENERADA, formato: "story" }, meta: m });
    await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: f, ...depsRapidas });
    const cuerpo = new URLSearchParams(llamadas.find((l) => l.url.endsWith("/media"))!.cuerpo!);
    expect(cuerpo.get("media_type")).toBe("STORIES");
    expect(cuerpo.has("caption")).toBe(false);
  });

  it("sin FINISHED dentro del tiempo → 202 «en_proceso» con el contenedor; el reintento con contenedorId no crea otro", async () => {
    let t = 0;
    const ahora = () => (t += 10_000);
    const lento = metaPublicacion({ estados: ["IN_PROGRESS"] });
    const a = falso({ fila: FILA_GENERADA, meta: lento.m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: a.f, ...depsRapidas, ahora, presupuestoMs: 25_000 });
    expect(r.status).toBe(202);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, estado: "en_proceso", contenedor: { id: "1790000000000001", estado: "IN_PROGRESS" }, reintentar: { id: ID, contenedorId: "1790000000000001", dryRun: false } });
    expect(lento.orden).not.toContain("publish");
    expect(a.fila()).toMatchObject({ contenedor_id: "1790000000000001", estado: "generada" });

    const listo = metaPublicacion({ estados: ["FINISHED"] });
    const b = falso({ fila: a.fila(), meta: listo.m });
    const r2 = await manejarPublicar(peticion({ id: ID, dryRun: false, contenedorId: "1790000000000001" }), { env: ENV_META, fetch: b.f, ...depsRapidas });
    expect(r2.status).toBe(200);
    expect(listo.orden).toEqual(["cuota", "estado:FINISHED", "publish", "permalink"]);
  });

  it("error 190 (token) → 502 con «cómo arreglarlo», fila «error» y sin el token en la respuesta", async () => {
    const { m } = metaPublicacion({ error: { en: "cuota", estado: 401, cuerpo: { error: { code: 190, message: `Invalid OAuth access token ${TOKEN_META}`, fbtrace_id: "T1" } } } });
    const { f, fila } = falso({ fila: FILA_GENERADA, meta: m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: f, ...depsRapidas });
    expect(r.status).toBe(502);
    const texto = await r.text();
    expect(JSON.parse(texto)).toMatchObject({ ok: false, tipo: "token", codigo: 190 });
    expect(JSON.parse(texto).comoArreglarlo).toMatch(/IG_ACCESS_TOKEN/);
    expect(texto).not.toContain(TOKEN_META);
    expect(fila()).toMatchObject({ estado: "error" });
    expect(String(fila()!.error)).not.toContain(TOKEN_META);
  });

  it("2207042 (límite de publicación) → 429; 9004 (URL no descargable) → 422", async () => {
    const limite = metaPublicacion({ error: { en: "publish", cuerpo: { error: { code: 4, error_subcode: 2207042, message: "Limit" } } } });
    const a = falso({ fila: FILA_GENERADA, meta: limite.m });
    const r1 = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: a.f, ...depsRapidas });
    expect(r1.status).toBe(429);
    expect(await r1.json()).toMatchObject({ tipo: "limite_publicacion" });

    const url = metaPublicacion({ error: { en: "media", cuerpo: { error: { code: 9004, error_subcode: 2207052, message: "Only photo or video can be accepted" } } } });
    const b = falso({ fila: FILA_GENERADA, meta: url.m });
    const r2 = await manejarPublicar(peticion({ id: ID, dryRun: true }), { env: ENV_META, fetch: b.f, ...depsRapidas });
    expect(r2.status).toBe(422);
    expect(await r2.json()).toMatchObject({ tipo: "url_no_descargable" });
  });

  it("nunca escribe secretos en consola (ni el token de Meta ni el JWT)", async () => {
    const salida: string[] = [];
    for (const nivel of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => {
        salida.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === "string" ? x : JSON.stringify(x))).join(" "));
      });
    }
    const err = metaPublicacion({ error: { en: "media", estado: 500, cuerpo: { error: { code: 2, message: `Fallo con ${TOKEN_META} y Bearer ${JWT}` } } } });
    const a = falso({ fila: FILA_GENERADA, meta: err.m });
    const r = await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: a.f, ...depsRapidas });
    const ok = metaPublicacion();
    const b = falso({ fila: FILA_GENERADA, meta: ok.m });
    await manejarPublicar(peticion({ id: ID, dryRun: false }), { env: ENV_META, fetch: b.f, ...depsRapidas });
    const texto = salida.join("\n") + (await r.text());
    expect(salida.length).toBeGreaterThan(0);
    expect(texto).not.toContain(TOKEN_META);
    expect(texto).not.toContain(JWT);
    expect(texto).not.toContain("firmaSecretaDelUsuario");
  });
});

// ── Estado ─────────────────────────────────────────────────────────────────

describe("GET /api/instagram-estado", () => {
  const metaEstado: Manejador = (l) => {
    const ruta = l.url.replace(GRAPH, "");
    if (ruta.startsWith("/me/assigned_instagram_accounts")) return resp(200, { data: [{ id: ENV_META.IG_USER_ID, username: "oficiososia" }] });
    if (ruta.startsWith(`/${ENV_META.IG_USER_ID}?`)) return resp(200, { id: ENV_META.IG_USER_ID, username: "oficiososia", name: "Oficiosos IA", media_count: 3 });
    if (ruta.startsWith(`/${ENV_META.IG_USER_ID}/content_publishing_limit`)) return resp(200, { data: [{ quota_usage: 1, config: { quota_total: 100, quota_duration: 86400 } }] });
    if (ruta.startsWith("/debug_token")) {
      return resp(200, { data: { app_id: "1234567890", type: "SYSTEM_USER", is_valid: true, expires_at: 0, scopes: ["instagram_basic", "instagram_content_publish"] } });
    }
    return undefined;
  };

  it("401 sin token y 403 sin Marketing", async () => {
    expect((await manejarEstado(peticion(null, null, "GET"), { env: ENV_META, fetch: falso().f })).status).toBe(401);
    expect((await manejarEstado(peticion(null, `Bearer ${JWT}`, "GET"), { env: ENV_META, fetch: falso({ permiso: false }).f })).status).toBe(403);
  });

  it("identidad, cuota y método (debug_token con token de app) sin devolver secretos", async () => {
    const { f, llamadas } = falso({ meta: metaEstado });
    const r = await manejarEstado(peticion(null, `Bearer ${JWT}`, "GET"), { env: { ...ENV_META, META_APP_SECRET: SECRETO_APP }, fetch: f, ...depsRapidas });
    expect(r.status).toBe(200);
    const texto = await r.text();
    const j = JSON.parse(texto);
    expect(j).toMatchObject({
      ok: true,
      faltan: [],
      metodoVerificacion: "debug_token_app",
      identidad: { igUserId: ENV_META.IG_USER_ID, username: "oficiososia", coincide: true },
      cuota: { usadas: 1, total: 100, restantes: 99, ventanaHoras: 24 },
      tokenEnmascarado: "…abcd",
      entornoSupabase: "demo",
    });
    expect(texto).not.toContain(TOKEN_META);
    expect(texto).not.toContain(SECRETO_APP);
    // debug_token lleva el token en la URL (lo exige Meta), pero solo hacia graph.facebook.com.
    expect(llamadas.filter((l) => l.url.includes(TOKEN_META)).every((l) => l.url.startsWith(`${GRAPH}/debug_token`))).toBe(true);
  });

  it("sin variables: dice cuáles faltan con «cómo arreglarlo» y no llama a Meta", async () => {
    const meta = vi.fn(() => undefined);
    const { f } = falso({ meta });
    const r = await manejarEstado(peticion(null, `Bearer ${JWT}`, "GET"), { env: ENV_SB, fetch: f });
    const j = await r.json();
    expect(j.ok).toBe(false);
    expect(j.faltan).toEqual(["IG_ACCESS_TOKEN", "IG_USER_ID", "META_APP_ID"]);
    expect(j.variables.find((v: { nombre: string }) => v.nombre === "IG_ACCESS_TOKEN").comoArreglarlo).toMatch(/Vercel/);
    expect(meta).not.toHaveBeenCalled();
  });
});
