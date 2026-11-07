// public/sw.js en un «self» de mentira: las navegaciones van primero a la red (con plazo), guardan el
// index.html y sus /assets/*, y sin red abren con esa copia; /offline.html solo si no hay copia.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const CODIGO = readFileSync(path.resolve(__dirname, "../../../public/sw.js"), "utf8");
const ORIGEN = "https://admin-casatomas.vercel.app";
const HTML = '<!doctype html><script type="module" src="/assets/index-abc.js"></script><link rel="stylesheet" href="/assets/index-abc.css">';

/** Caché de mentira (una sola, por URL). */
function crearCaches() {
  const guardado = new Map<string, Response>();
  const clave = (r: string | Request) => new URL(typeof r === "string" ? r : r.url, ORIGEN).pathname;
  const cache = {
    put: vi.fn(async (r: string | Request, res: Response) => void guardado.set(clave(r), res)),
    match: vi.fn(async (r: string | Request) => guardado.get(clave(r))?.clone()),
    add: vi.fn(async (r: string) => void guardado.set(clave(r), new Response(`contenido de ${r}`))),
  };
  return {
    guardado,
    cache,
    caches: {
      open: vi.fn(async () => cache),
      match: vi.fn(async (r: string | Request) => guardado.get(clave(r))?.clone()),
      keys: vi.fn(async () => []),
      delete: vi.fn(async () => true),
    },
  };
}

/** `new Request` no deja crear peticiones `navigate`: basta con lo que lee el SW. */
const peticionNavegacion = (url: string) => ({ url, method: "GET", mode: "navigate" }) as unknown as Request;

function cargarSW(fetchFalso: (req: Request) => Promise<Response>) {
  const oyentes: Record<string, (e: unknown) => void> = {};
  const self = {
    location: new URL(`${ORIGEN}/sw.js?v=build1`),
    addEventListener: (tipo: string, fn: (e: unknown) => void) => {
      oyentes[tipo] = fn;
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const c = crearCaches();
  const importScripts = () => {
    throw new Error("sin sw-push en la prueba");
  };
  new Function("self", "caches", "fetch", "importScripts", CODIGO)(self, c.caches, fetchFalso, importScripts);
  return { oyentes, ...c };
}

/** Lanza una navegación y devuelve la respuesta y lo que quedó pendiente (`waitUntil`). */
async function navegar(sw: ReturnType<typeof cargarSW>, ruta = "/reservas") {
  let respuesta: Promise<Response> | undefined;
  const pendientes: Promise<unknown>[] = [];
  sw.oyentes.fetch({
    request: peticionNavegacion(`${ORIGEN}${ruta}`),
    respondWith: (p: Promise<Response>) => (respuesta = p),
    waitUntil: (p: Promise<unknown>) => pendientes.push(p),
  });
  const res = await respuesta!;
  await Promise.all(pendientes);
  return res;
}

const htmlBueno = () =>
  Promise.resolve(new Response(HTML, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }));

afterEach(() => {
  vi.useRealTimers();
});

describe("sw.js · navegaciones", () => {
  it("con red: sirve la de la red y guarda el index.html y los /assets/* que pide", async () => {
    const sw = cargarSW(htmlBueno);
    const res = await navegar(sw);

    expect(await res.text()).toBe(HTML);
    expect(sw.guardado.has("/index.html")).toBe(true);
    expect(sw.guardado.has("/assets/index-abc.js")).toBe(true);
    expect(sw.guardado.has("/assets/index-abc.css")).toBe(true);
  });

  it("sin red: abre con la copia del index.html", async () => {
    let conRed = true;
    const sw = cargarSW((req) => (conRed ? htmlBueno() : Promise.reject(new TypeError(`Failed to fetch ${req.url}`))));
    await navegar(sw);
    conRed = false;

    const res = await navegar(sw, "/reservas?tab=hoy");
    expect(await res.text()).toBe(HTML);
  });

  it("sin red y sin copia: /offline.html", async () => {
    const sw = cargarSW(() => Promise.reject(new TypeError("Failed to fetch")));
    sw.guardado.set("/offline.html", new Response("pagina offline"));

    const res = await navegar(sw);
    expect(await res.text()).toBe("pagina offline");
  });

  it("red que tarda más del plazo: abre con la copia sin esperar", async () => {
    let lenta = false;
    const sw = cargarSW(() => (lenta ? new Promise<Response>(() => {}) : htmlBueno()));
    await navegar(sw);
    lenta = true;

    vi.useFakeTimers();
    let respuesta: Promise<Response> | undefined;
    sw.oyentes.fetch({
      request: peticionNavegacion(`${ORIGEN}/reservas`),
      respondWith: (p: Promise<Response>) => (respuesta = p),
      waitUntil: () => {},
    });
    await vi.advanceTimersByTimeAsync(4_000);
    vi.useRealTimers();
    expect(await (await respuesta!).text()).toBe(HTML);
  });

  it("no guarda como index otra página .html (la de captura de reels)", async () => {
    const sw = cargarSW(htmlBueno);
    await navegar(sw, "/__reel-instagram.html");
    expect(sw.guardado.has("/index.html")).toBe(false);
  });

  it("Supabase, /api y /functions no pasan por el SW", () => {
    const sw = cargarSW(htmlBueno);
    for (const url of [
      "https://x.supabase.co/rest/v1/reservas",
      `${ORIGEN}/api/recortar-foto`,
      `${ORIGEN}/functions/v1/algo`,
    ]) {
      const respondWith = vi.fn();
      sw.oyentes.fetch({ request: new Request(url), respondWith, waitUntil: () => {} });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });
});
