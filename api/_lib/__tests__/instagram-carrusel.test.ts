// @vitest-environment node
/**
 * Render de CARRUSELES (POST /api/instagram-render con tipo «carrusel»):
 * validación de cada imagen con el esquema de siempre, un solo lote, subida de
 * N JPEG a piezas/AAAA-MM/<id>-NN.jpg y una sola fila con todas. Sin red; y,
 * si está el Chromium de Playwright, 6 imágenes reales con un solo navegador.
 */
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manejarRender } from "../../instagram-render";
import { enParalelo, ErrorRender, type Renderizador, type RenderizadorLote } from "../instagram/render";
import { MAX_DIAPOSITIVAS, mesDeRuta, rutaDiapositiva } from "../instagram/carrusel";
import { MAX_FOTOS_CARRUSEL } from "../../../src/lib/instagram/montar";
import { olvidarSecretos } from "../instagram/secretos";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.firmaSecretaDelUsuario123";
const SB = "https://sfonaclosuafvlhutkon.supabase.co";
const ENV_SB = { VITE_SUPABASE_URL: SB, VITE_SUPABASE_PUBLISHABLE_KEY: "clave-publica" };
const ID = "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f";

type Llamada = { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: string | null };

function resp(estado: number, cuerpo: unknown): Response {
  return new Response(cuerpo === null ? null : JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
}

/** Supabase simulado (Auth, permiso, instagram_piezas y Storage). */
function falso(o: { fila?: Record<string, unknown> | null } = {}) {
  const llamadas: Llamada[] = [];
  let fila = o.fila ?? null;
  const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    const metodo = (init.method ?? "GET").toUpperCase();
    const cabeceras = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    const cuerpo = typeof init.body === "string" ? init.body : init.body ? "[binario]" : null;
    llamadas.push({ url, metodo, cabeceras, cuerpo });
    if (url === `${SB}/auth/v1/user`) return resp(200, { id: "usuario-1" });
    if (url === `${SB}/rest/v1/rpc/can_edit_section`) return resp(200, true);
    if (url.startsWith(`${SB}/rest/v1/instagram_piezas`)) {
      if (metodo === "GET") return resp(200, fila ? [fila] : []);
      if (metodo === "POST") {
        fila = { caption: null, contenedor_id: null, media_id: null, permalink: null, ...JSON.parse(cuerpo!) };
        return resp(201, [fila]);
      }
      if (metodo === "PATCH") {
        fila = { ...fila, ...JSON.parse(cuerpo!) };
        return resp(200, [fila]);
      }
    }
    if (url === `${SB}/storage/v1/object/instagram` && metodo === "DELETE") {
      return resp(200, (JSON.parse(cuerpo!).prefixes as string[]).map((n) => ({ name: n })));
    }
    if (url.startsWith(`${SB}/storage/v1/object/instagram/`) && metodo === "POST") return resp(200, { Key: "instagram/x" });
    throw new Error(`URL inesperada en el test: ${metodo} ${url}`);
  });
  return { f, llamadas, fila: () => fila };
}

const peticion = (cuerpo: unknown) =>
  new Request("https://panel/api/instagram-render", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT}` },
    body: JSON.stringify(cuerpo),
  });

const jpgFalso: Renderizador = async (p) => ({
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
  ancho: p.ancho,
  alto: p.alto,
  calidad: 92,
  avisos: [],
  tiempos: { msArranque: 1, msPagina: 1, msCarga: 1, msCaptura: 1, msJpeg: 1 },
});

/** 6 imágenes tipográficas de Casa Tomás (sin fotos: no hace falta red). */
const TITULARES = ["Llegó del Cantábrico", "Ostras recién abiertas", "Bogavante vivo", "Percebes de roca", "Navajas a la plancha", "Te esperamos hoy"];
const SEIS = TITULARES.map((titular, i) => ({
  foto: null,
  plantilla: "ct-tipografica",
  datos: { antetitulo: `Producto fresco · ${i + 1}`, titular },
  altText: `Imagen ${i + 1}: ${titular}`,
}));
const CARRUSEL = { tipo: "carrusel", marca: "casa-tomas", diapositivas: SEIS, caption: "Hoy, marisco #casatomas" };

beforeEach(() => olvidarSecretos());
afterEach(() => vi.restoreAllMocks());

describe("utilidades del carrusel", () => {
  it("el máximo de imágenes es el del contrato «Montar con IA»", () => {
    expect(MAX_DIAPOSITIVAS).toBe(MAX_FOTOS_CARRUSEL);
  });

  it("rutas piezas/AAAA-MM/<id>-NN.jpg y el mes de una ruta", () => {
    expect(rutaDiapositiva(ID, 3, "2026-11")).toBe(`piezas/2026-11/${ID}-03.jpg`);
    expect(rutaDiapositiva(ID, 10, "2026-11")).toBe(`piezas/2026-11/${ID}-10.jpg`);
    expect(mesDeRuta(`piezas/2026-10/${ID}-01.jpg`)).toBe("2026-10");
    expect(mesDeRuta("tmp/x.jpg")).toBeNull();
  });

  it("enParalelo respeta la concurrencia y el orden", async () => {
    let vivas = 0;
    let maximo = 0;
    const r = await enParalelo(7, 3, async (i) => {
      vivas++;
      maximo = Math.max(maximo, vivas);
      await new Promise((ok) => setTimeout(ok, 5 + (7 - i)));
      vivas--;
      return i * 10;
    });
    expect(r).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(maximo).toBe(3);
  });
});

describe("POST /api/instagram-render (carrusel)", () => {
  it("200: un solo lote, 6 JPEG subidos con el JWT del usuario y UNA fila con todas las diapositivas", async () => {
    const { f, llamadas, fila } = falso();
    const lote = vi.fn<RenderizadorLote>(async (ps) => Promise.all(ps.map(async (p) => ({ ok: true as const, r: await jpgFalso(p) }))));
    const r = await manejarRender(peticion(CARRUSEL), { env: ENV_SB, fetch: f, renderizarLote: lote, ahora: () => new Date("2026-11-05T10:00:00Z"), nuevoId: () => ID });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(lote).toHaveBeenCalledTimes(1);
    expect(lote.mock.calls[0][0]).toHaveLength(6);
    expect(lote.mock.calls[0][0].every((p) => p.ancho === 1080 && p.alto === 1350)).toBe(true);
    expect(j).toMatchObject({ ok: true, id: ID, estado: "generada", tipoMedio: "carrusel", imagenRuta: `piezas/2026-11/${ID}-01.jpg` });
    expect(j.diapositivas.map((d: { imagenRuta: string }) => d.imagenRuta)).toEqual([1, 2, 3, 4, 5, 6].map((n) => rutaDiapositiva(ID, n, "2026-11")));
    const subidas = llamadas.filter((l) => l.url.startsWith(`${SB}/storage/v1/object/instagram/piezas/`));
    expect(subidas).toHaveLength(6);
    expect(subidas.every((l) => l.cabeceras.authorization === `Bearer ${JWT}`)).toBe(true);
    // Una sola escritura de la fila, después de subir todo.
    const escrituras = llamadas.filter((l) => l.url.startsWith(`${SB}/rest/v1/instagram_piezas`) && l.metodo !== "GET");
    expect(escrituras).toHaveLength(1);
    expect(llamadas.indexOf(escrituras[0])).toBeGreaterThan(llamadas.indexOf(subidas[5]));
    const guardada = fila()!;
    expect(guardada).toMatchObject({ formato: "carrusel", tipo_medio: "carrusel", plantilla: "ct-tipografica", estado: "generada", caption: "Hoy, marisco #casatomas" });
    const ds = guardada.diapositivas as Array<Record<string, unknown>>;
    expect(ds).toHaveLength(6);
    expect(ds[2]).toMatchObject({ plantilla: "ct-tipografica", alt_text: "Imagen 3: Bogavante vivo", imagen_ruta: rutaDiapositiva(ID, 3, "2026-11") });
    expect(ds[2].datos).toMatchObject({ marca: "casa-tomas", formato: "post", titular: "Bogavante vivo" });
  });

  it("422 con los problemas de TODAS las imágenes (esquema), sin renderizar ni subir nada", async () => {
    const { f, llamadas } = falso();
    const lote = vi.fn<RenderizadorLote>();
    const malas = [...SEIS];
    malas[1] = { ...SEIS[1], datos: { titular: "Un titular con muchas más palabras de las permitidas" } };
    malas[4] = { ...SEIS[4], plantilla: "no-existe" };
    const r = await manejarRender(peticion({ ...CARRUSEL, diapositivas: malas }), { env: ENV_SB, fetch: f, renderizarLote: lote });
    const j = await r.json();
    expect(r.status).toBe(422);
    expect(j.problemas.some((p: string) => p.startsWith("Imagen 2:") && /palabras/.test(p))).toBe(true);
    expect(j.problemas.some((p: string) => p.startsWith("Imagen 5:"))).toBe(true);
    expect(lote).not.toHaveBeenCalled();
    expect(llamadas.some((l) => l.url.includes("/storage/"))).toBe(false);
  });

  it("422 si llegan menos de 2 o más de 10 imágenes; 400 sin marca", async () => {
    const { f } = falso();
    expect((await manejarRender(peticion({ ...CARRUSEL, diapositivas: SEIS.slice(0, 1) }), { env: ENV_SB, fetch: f, renderizar: jpgFalso })).status).toBe(422);
    expect((await manejarRender(peticion({ ...CARRUSEL, diapositivas: [...SEIS, ...SEIS] }), { env: ENV_SB, fetch: f, renderizar: jpgFalso })).status).toBe(422);
    expect((await manejarRender(peticion({ ...CARRUSEL, marca: "otra" }), { env: ENV_SB, fetch: f, renderizar: jpgFalso })).status).toBe(400);
  });

  it("422 si una imagen no pasa la maquetación: dice cuál y no sube ninguna", async () => {
    const { f, llamadas } = falso();
    let n = 0;
    const renderizar: Renderizador = async (p) => {
      if (++n === 4) throw new ErrorRender("maquetacion", ["El campo «titular» se desborda"], "x");
      return jpgFalso(p);
    };
    const r = await manejarRender(peticion(CARRUSEL), { env: ENV_SB, fetch: f, renderizar });
    const j = await r.json();
    expect(r.status).toBe(422);
    expect(j).toMatchObject({ tipo: "maquetacion", imagenes: [4], problemas: ["Imagen 4: El campo «titular» se desborda"] });
    expect(llamadas.some((l) => l.url.includes("/storage/"))).toBe(false);
  });

  it("al regenerar con menos imágenes conserva el mes, actualiza la fila y borra las que sobran", async () => {
    const viejas = [1, 2, 3, 4, 5, 6].map((n) => ({ foto: null, plantilla: "ct-tipografica", datos: {}, alt_text: null, imagen_ruta: rutaDiapositiva(ID, n, "2026-10") }));
    const { f, llamadas, fila } = falso({
      fila: { id: ID, marca: "casa-tomas", estado: "error", tipo_medio: "carrusel", formato: "carrusel", imagen_ruta: viejas[0].imagen_ruta, diapositivas: viejas },
    });
    const r = await manejarRender(peticion({ ...CARRUSEL, id: ID, diapositivas: SEIS.slice(0, 4) }), { env: ENV_SB, fetch: f, renderizar: jpgFalso });
    expect(r.status).toBe(200);
    expect(fila()).toMatchObject({ estado: "generada", error: null, imagen_ruta: rutaDiapositiva(ID, 1, "2026-10") });
    const borrado = llamadas.find((l) => l.metodo === "DELETE")!;
    expect(JSON.parse(borrado.cuerpo!).prefixes).toEqual([rutaDiapositiva(ID, 5, "2026-10"), rutaDiapositiva(ID, 6, "2026-10")]);
    expect(llamadas.find((l) => l.metodo === "GET" && l.url.includes("instagram_piezas"))!.url).toContain("tipo_medio,diapositivas");
  });

  it("409 si la pieza ya está publicada o no es un carrusel", async () => {
    const pub = falso({ fila: { id: ID, estado: "publicada", tipo_medio: "carrusel" } });
    expect((await manejarRender(peticion({ ...CARRUSEL, id: ID }), { env: ENV_SB, fetch: pub.f, renderizar: jpgFalso })).status).toBe(409);
    const post = falso({ fila: { id: ID, estado: "generada", tipo_medio: "imagen" } });
    const r = await manejarRender(peticion({ ...CARRUSEL, id: ID }), { env: ENV_SB, fetch: post.f, renderizar: jpgFalso });
    expect(r.status).toBe(409);
    expect((await r.json()).tipo).toBe("no_es_carrusel");
  });
});

// ── Chromium real (si está instalado): 6 imágenes con un solo navegador ─────
let hayChromium = false;
try {
  const { chromium } = await import("playwright-core");
  hayChromium = existsSync(process.env.INSTAGRAM_CHROMIUM_PATH || chromium.executablePath());
} catch {
  hayChromium = false;
}

describe("render real del carrusel", () => {
  it.skipIf(!hayChromium)(
    "6 JPEG 1080×1350 en una llamada, con un solo Chromium y dentro del límite de Vercel (60 s)",
    async () => {
      const { f, llamadas } = falso();
      const t0 = performance.now();
      const r = await manejarRender(peticion(CARRUSEL), { env: ENV_SB, fetch: f, nuevoId: () => ID });
      const ms = performance.now() - t0;
      const j = await r.json();
      expect(r.status, JSON.stringify(j)).toBe(200);
      expect(j.diapositivas).toHaveLength(6);
      for (const d of j.diapositivas) expect([d.ancho, d.alto]).toEqual([1080, 1350]);
      const subidas = llamadas.filter((l) => l.url.startsWith(`${SB}/storage/v1/object/instagram/piezas/`));
      expect(subidas).toHaveLength(6);
      // Margen amplio para máquinas lentas: en Vercel la función tiene 60 s.
      expect(ms).toBeLessThan(50_000);
      console.info(`[carrusel real] 6 imágenes en ${Math.round(ms)} ms (render ${j.msRender} ms)`, JSON.stringify(j.diapositivas.map((d: { tiempos: unknown }) => d.tiempos)));
    },
    60_000,
  );
});

// ── Fotos subidas desde el móvil («subida:<uuid>» en tmp/<uuid>.jpg) ───────
describe("fotoPreparada «subida:<uuid>» (móvil)", () => {
  const U = "0b4f2c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b";
  const preparada = (url: string, id = `subida:${U}`) => ({ id, url, ancho: 3000, alto: 4000, tipo: "plato", marca: "casa-tomas" });
  const conFoto = (fotoPreparada: unknown) => ({
    tipo: "carrusel",
    marca: "casa-tomas",
    diapositivas: [
      { foto: `subida:${U}`, plantilla: "ct-foto-titular", datos: { antetitulo: "Hoy", titular: "Llegó del Cantábrico" }, fotoPreparada },
      SEIS[1],
    ],
  });

  it("se acepta si la URL es tmp/<ese uuid> de NUESTRO bucket", async () => {
    const { f } = falso();
    const r = await manejarRender(peticion(conFoto(preparada(`${SB}/storage/v1/object/public/instagram/tmp/${U}.jpg`))), { env: ENV_SB, fetch: f, renderizar: jpgFalso, nuevoId: () => ID });
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    const pieza = (await r.json()) as { ok: boolean };
    expect(pieza.ok).toBe(true);
  });

  it("400 si la URL es de otro sitio, de otra ruta del bucket o de OTRO uuid (sin SSRF)", async () => {
    for (const url of [
      `https://evil.example/storage/v1/object/public/instagram/tmp/${U}.jpg`,
      `${SB}/storage/v1/object/public/instagram/piezas/2026-11/${U}.jpg`,
      `${SB}/storage/v1/object/public/instagram/tmp/1b4f2c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b.jpg`,
    ]) {
      const { f } = falso();
      const r = await manejarRender(peticion(conFoto(preparada(url))), { env: ENV_SB, fetch: f, renderizar: jpgFalso });
      expect([400, 422], url).toContain(r.status);
      expect((await r.json()).ok).toBe(false);
    }
  });

  it("también en una pieza suelta ({ pieza, fotoPreparada })", async () => {
    const { f } = falso();
    const pieza = { marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post", foto: `subida:${U}`, antetitulo: "Hoy", titular: "Llegó del Cantábrico" };
    const r = await manejarRender(peticion({ pieza, fotoPreparada: preparada(`${SB}/storage/v1/object/public/instagram/tmp/${U}.jpg`) }), { env: ENV_SB, fetch: f, renderizar: jpgFalso, nuevoId: () => ID });
    expect(r.status).toBe(200);
  });
});
