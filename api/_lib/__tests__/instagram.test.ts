// @vitest-environment node
/**
 * Función de Instagram que queda en Vercel (api/instagram-render) sin red
 * ni Chromium: fetch simulado (Supabase Auth/PostgREST/Storage y Graph API de
 * Meta) y renderizador simulado. Ver docs/instagram.md. La publicación y
 * la comprobación son Edge Functions: supabase/functions/instagram-*.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manejarRender } from "../../instagram-render";
import { ErrorRender, envolverComprobacion, ficheroLocal, type Renderizador } from "../instagram/render";
import { olvidarSecretos, registrarSecreto, sanear, sanearUrl } from "../instagram/secretos";
import { usarChromiumServerless } from "../instagram/navegador";
import { contarHashtags, validarCaption } from "../instagram/validacion";
import { EJEMPLOS } from "../../../src/lib/instagram/ejemplos";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.firmaSecretaDelUsuario123";
const TOKEN_META = "EAAGtokenSuperSecretoDeMetaParaPruebas0123456789abcd";
const SECRETO_APP = "secretoDeLaAppDeMeta987";
const SB = "https://sfonaclosuafvlhutkon.supabase.co";
const ENV_SB = { VITE_SUPABASE_URL: SB, VITE_SUPABASE_PUBLISHABLE_KEY: "clave-publica" };
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
