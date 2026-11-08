// @vitest-environment node
/**
 * POST /api/instagram-render con la plantilla «Foto enmarcada» y una foto de
 * la carta de 1200×900 («carta:<id>», preparada en tmp/ del bucket), con
 * Chromium DE VERDAD: una pieza suelta (post y story) y un carrusel de 3. La
 * copia tmp/ del bucket se sirve desde memoria (ruta del contexto de
 * Chromium), sin red. Comprueba que pasa la validación y la maquetación, que
 * sale un JPEG del tamaño exacto y que la plantilla a sangre la rechaza
 * recomendando la enmarcada.
 *
 * Fotos: las reales del prototipo (instagram-studio/assets) recortadas y
 * bajadas a 1200×900 si están; si no, sintéticas. Se SALTA sin el Chromium de
 * Playwright. Con INSTAGRAM_CAPTURAS_MARCO=<carpeta> guarda ahí 2 JPEG de
 * muestra (post de Casa Tomás y story de Touza, tal como salen del render).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { Browser } from "playwright-core";
import { manejarRender } from "../../instagram-render";
import { crearRenderizador, crearRenderizadorLote } from "../instagram/render";
import { lanzarNavegador, type Lanzador } from "../instagram/navegador";
import { olvidarSecretos } from "../instagram/secretos";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.firmaSecretaDelUsuario123";
const SB = "https://sfonaclosuafvlhutkon.supabase.co";
const ENV_SB = { VITE_SUPABASE_URL: SB, VITE_SUPABASE_PUBLISHABLE_KEY: "clave-publica" };
const ID = "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f";
const CAPTURAS = process.env.INSTAGRAM_CAPTURAS_MARCO;

const U = ["0b4f2c1e-5a6d-4e7f-8a9b-0c1d2e3f4a51", "0b4f2c1e-5a6d-4e7f-8a9b-0c1d2e3f4a52", "0b4f2c1e-5a6d-4e7f-8a9b-0c1d2e3f4a53"];
const tmp = (u: string) => `${SB}/storage/v1/object/public/instagram/tmp/${u}.jpg`;
const preparada = (i: number, marca = "casa-tomas") => ({ id: `carta:plato-${i}`, url: tmp(U[i]), ancho: 1200, alto: 900, tipo: "plato", marca });

let hayChromium = false;
try {
  const { chromium } = await import("playwright-core");
  hayChromium = existsSync(process.env.INSTAGRAM_CHROMIUM_PATH || chromium.executablePath());
} catch {
  hayChromium = false;
}

const resp = (estado: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

/** Supabase simulado; guarda los JPEG que se suben. */
function falso() {
  const subidos: Array<{ ruta: string; jpg: Buffer }> = [];
  let fila: Record<string, unknown> | null = null;
  const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    const metodo = (init.method ?? "GET").toUpperCase();
    if (url === `${SB}/auth/v1/user`) return resp(200, { id: "usuario-1" });
    if (url === `${SB}/rest/v1/rpc/can_edit_section`) return resp(200, true);
    if (url.startsWith(`${SB}/rest/v1/instagram_piezas`)) {
      if (metodo === "GET") return resp(200, fila ? [fila] : []);
      fila = { caption: null, contenedor_id: null, media_id: null, permalink: null, ...(fila ?? {}), ...JSON.parse(String(init.body)) };
      return resp(metodo === "POST" ? 201 : 200, [fila]);
    }
    if (url.startsWith(`${SB}/storage/v1/object/instagram/`) && metodo === "POST") {
      subidos.push({ ruta: url.slice(`${SB}/storage/v1/object/instagram/`.length), jpg: Buffer.from(init.body as Uint8Array) });
      return resp(200, { Key: "instagram/x" });
    }
    if (url === `${SB}/storage/v1/object/instagram` && metodo === "DELETE") return resp(200, []);
    throw new Error(`fetch no previsto: ${metodo} ${url}`);
  });
  return { f, subidos };
}

/** Chromium real cuyas peticiones a tmp/ del bucket se contestan con las fotos de memoria. */
function lanzadorConFotos(fotos: Map<string, Buffer>): Lanzador {
  return async () => {
    const nav = (await lanzarNavegador()) as Browser;
    const original = nav.newContext.bind(nav);
    nav.newContext = (async (...args: Parameters<Browser["newContext"]>) => {
      const ctx = await original(...args);
      await ctx.route(`${SB}/storage/v1/object/public/instagram/tmp/**`, (route) => {
        const nombre = route.request().url().split("/tmp/")[1]?.replace(/\.jpg$/, "") ?? "";
        const jpg = fotos.get(nombre);
        return jpg ? route.fulfill({ status: 200, contentType: "image/jpeg", body: jpg }) : route.fulfill({ status: 404, body: "" });
      });
      return ctx;
    }) as Browser["newContext"];
    return nav;
  };
}

/** Fotos reales del prototipo (instagram-studio/assets), si están: se recortan a 4:3 y se bajan a 1200×900. */
const ASSETS = [
  process.env.INSTAGRAM_STUDIO_ASSETS,
  path.resolve(process.cwd(), "..", "instagram-studio", "assets"),
  path.resolve(process.cwd(), "..", "..", "instagram-studio", "assets"),
]
  .filter((x): x is string => !!x)
  .find((d) => existsSync(path.join(d, "fotos", "fotos.json")));

/**
 * Foto «de la carta»: 1200×900, JPEG calidad 75. La real del prototipo si
 * está (`real`, relativa a assets/fotos); si no, una sintética (un plato sobre mesa oscura).
 */
async function fotoCarta(tono: string, real?: string): Promise<Buffer> {
  const origen = ASSETS && real ? path.join(ASSETS, "fotos", real) : null;
  if (origen && existsSync(origen)) return sharp(origen).resize(1200, 900, { fit: "cover" }).jpeg({ quality: 75 }).toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
    <defs><radialGradient id="l" cx="40%" cy="35%" r="80%"><stop offset="0" stop-color="#6b5440"/><stop offset="1" stop-color="#1d1611"/></radialGradient></defs>
    <rect width="1200" height="900" fill="url(#l)"/>
    <ellipse cx="600" cy="480" rx="420" ry="300" fill="#f3eee6"/>
    <ellipse cx="600" cy="470" rx="300" ry="200" fill="${tono}"/>
    <ellipse cx="520" cy="420" rx="90" ry="50" fill="#e0b25a" opacity=".9"/>
    <path d="M760 380 q60 60 0 140" stroke="#3f6b2a" stroke-width="14" fill="none"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 75 }).toBuffer();
}

const peticion = (cuerpo: unknown) =>
  new Request("https://panel/api/instagram-render", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT}` },
    body: JSON.stringify(cuerpo),
  });

beforeEach(() => olvidarSecretos());
afterEach(() => vi.restoreAllMocks());

describe("render de «Foto enmarcada» con una foto de la carta (1200×900)", () => {
  it("la plantilla a sangre la rechaza (422) y recomienda la enmarcada, sin renderizar", async () => {
    const { f } = falso();
    const renderizar = vi.fn();
    const pieza = { marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post", foto: "carta:plato-0", titular: "Brasa, sal y paciencia" };
    const r = await manejarRender(peticion({ pieza, fotoPreparada: preparada(0) }), { env: ENV_SB, fetch: f, renderizar });
    expect(r.status).toBe(422);
    expect((await r.json()).problemas.join(" ")).toMatch(/ampliarse un 50 %.*Usa la plantilla «Foto enmarcada» \(«ct-marco»\)/);
    expect(renderizar).not.toHaveBeenCalled();
  });

  describe.skipIf(!hayChromium)("con Chromium", () => {
    const fotos = new Map<string, Buffer>();
    beforeEach(async () => {
      if (!fotos.size) {
        fotos.set(U[0], await fotoCarta("#7a2e1f", "casa-tomas/carne-plato.png"));
        fotos.set(U[1], await fotoCarta("#b86b2d", "casa-tomas/salon-2.jpg"));
        fotos.set(U[2], await fotoCarta("#5c1f2b", "touza/touza-2.webp"));
      }
      if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });
    });

    for (const [marca, plantilla, formato] of [
      ["casa-tomas", "ct-marco", "post"],
      ["casa-tomas", "ct-marco", "story"],
      ["touza", "tz-marco", "story"],
    ] as const) {
      it(`pieza suelta ${plantilla} ${formato}: 200 y JPEG ${formato === "story" ? "1080×1920" : "1080×1350"}`, async () => {
        const { f, subidos } = falso();
        const pieza = {
          marca,
          plantilla,
          formato,
          foto: `carta:plato-${marca === "touza" ? 2 : 0}`,
          antetitulo: marca === "touza" ? "Para empezar la noche" : "De nuestra carta",
          titular: marca === "touza" ? "Un rincón para quedarse" : "Brasa, sal y paciencia",
          cita: marca === "touza" ? "Sofá, mármol y luz baja" : "Chuleta de vaca madurada",
          cta: marca === "touza" ? "Ver carta" : "Reservar mesa",
        };
        const r = await manejarRender(peticion({ pieza, fotoPreparada: preparada(marca === "touza" ? 2 : 0, marca) }), {
          env: ENV_SB,
          fetch: f,
          renderizar: crearRenderizador(lanzadorConFotos(fotos)),
          nuevoId: () => ID,
        });
        const j = await r.json();
        expect(r.status, JSON.stringify(j)).toBe(200);
        expect(subidos).toHaveLength(1);
        const meta = await sharp(subidos[0].jpg).metadata();
        expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1080, formato === "story" ? 1920 : 1350]);
        // Muestras para el dueño: el post de Casa Tomás y la story de Touza.
        if (CAPTURAS && (formato === "post" || marca === "touza")) writeFileSync(path.join(CAPTURAS, `${plantilla}-${formato}-1200x900.jpg`), subidos[0].jpg);
      }, 90_000);
    }

    it("carrusel de 3 imágenes enmarcadas con fotos de la carta: 200, 3 JPEG 1080×1350 en un lote", async () => {
      const { f, subidos } = falso();
      const titulares = ["Brasa, sal y paciencia", "Del mar a la mesa", "Para compartir"];
      const diapositivas = [0, 1, 2].map((i) => ({
        foto: `carta:plato-${i}`,
        plantilla: "ct-marco",
        datos: { antetitulo: i === 0 ? "De nuestra carta" : undefined, titular: titulares[i], cita: "Plato de la carta" },
        altText: `Plato ${i + 1} de la carta.`,
        fotoPreparada: preparada(i),
      }));
      const r = await manejarRender(peticion({ tipo: "carrusel", marca: "casa-tomas", diapositivas, caption: "Tres de la carta" }), {
        env: ENV_SB,
        fetch: f,
        renderizarLote: crearRenderizadorLote(lanzadorConFotos(fotos)),
        nuevoId: () => ID,
      });
      const j = await r.json();
      expect(r.status, JSON.stringify(j)).toBe(200);
      expect(j.diapositivas).toHaveLength(3);
      expect(subidos).toHaveLength(3);
      for (const s of subidos) {
        const meta = await sharp(s.jpg).metadata();
        expect([meta.width, meta.height]).toEqual([1080, 1350]);
      }
    }, 120_000);
  });
});
