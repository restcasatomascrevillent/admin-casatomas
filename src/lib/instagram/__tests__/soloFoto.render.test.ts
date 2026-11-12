// @vitest-environment node
//
// «Solo foto» (ct-solo-foto / tz-solo-foto, 12/11/2026), con Chromium de verdad:
//  - una foto vertical buena se recorta a 1080×1350 (cubre), sin ningún texto
//    ni logo, con el punto de interés vertical (posicionY);
//  - una de la carta (1200×900) va ENTERA, centrada, con margen fino y NUNCA
//    ampliada, sobre un fondo del color de la propia foto;
//  - una pequeña (900×700) se queda en su tamaño natural.
// Y la validación: sin titular vale; con titular, error; < 800 px, no vale.
//
// Fotos de instagram-studio/assets (como marco.render.test.ts); si no están,
// sintéticas. Se SALTA sin el Chromium de Playwright. Con
// INSTAGRAM_CAPTURAS_SOLO_FOTO=<carpeta> guarda los JPEG de muestra ahí.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "@playwright/test";
import sharp from "sharp";
import {
  CODIGO_COMPROBAR_MAQUETACION,
  CODIGO_ESPERAR_RECURSOS,
  baseRecursosPanel,
  construirDocumento,
  obtenerPlantilla,
  plantillaPara,
  plantillasVisibles,
  problemasDePlantilla,
  validarPieza,
  type DatosPieza,
  type Foto,
} from "..";
import { MARGEN_SOLO_FOTO, modoSoloFoto } from "../plantillas/solo-foto";

const LENTO = 120_000;
const PANEL = path.resolve(process.cwd(), "public");
const CAPTURAS = process.env.INSTAGRAM_CAPTURAS_SOLO_FOTO;

const ASSETS = [
  process.env.INSTAGRAM_STUDIO_ASSETS,
  path.resolve(process.cwd(), "..", "instagram-studio", "assets"),
  path.resolve(process.cwd(), "..", "..", "instagram-studio", "assets"),
]
  .filter((x): x is string => !!x)
  .find((d) => fs.existsSync(path.join(d, "fotos", "fotos.json")));

let chromiumInstalado = false;
try {
  chromiumInstalado = fs.existsSync(chromium.executablePath());
} catch {
  chromiumInstalado = false;
}
if (!chromiumInstalado) console.warn("[instagram soloFoto.render.test] SE SALTA: no está el Chromium de Playwright");

/** Foto de ancho×alto (JPEG 80): la real recortada a esa proporción o una sintética. */
async function hacerFoto(origen: string | null, ancho: number, alto: number, color: string): Promise<Buffer> {
  const base =
    origen && fs.existsSync(origen)
      ? sharp(origen)
      : sharp(
          await sharp({ create: { width: ancho * 2, height: alto * 2, channels: 3, background: color } })
            .composite([
              {
                input: Buffer.from(
                  `<svg width="${ancho * 2}" height="${alto * 2}"><circle cx="${ancho}" cy="${alto}" r="${Math.min(ancho, alto) * 0.7}" fill="#f4efe6"/><circle cx="${ancho * 0.95}" cy="${alto * 0.93}" r="${Math.min(ancho, alto) * 0.42}" fill="#7a2e1f"/></svg>`,
                ),
              },
            ])
            .png()
            .toBuffer(),
        );
  return base.resize(ancho, alto, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();
}

const foto = (id: string, marca: Foto["marca"], ancho: number, alto: number): Foto => ({
  id,
  marca,
  ruta: `fotos/${marca}/${id.replace(":", "-")}.jpg`,
  ancho,
  alto,
  tipo: "plato",
  aptaPost: true,
  aptaStory: false,
  descripcion: "",
});

const FOTOS = {
  vertical: { foto: foto("drive:vertical", "casa-tomas", 1281, 1920), origen: ASSETS ? path.join(ASSETS, "fotos", "casa-tomas", "champan.png") : null, color: "#5a4632" },
  carta: { foto: foto("carta:chuleta", "casa-tomas", 1200, 900), origen: ASSETS ? path.join(ASSETS, "fotos", "casa-tomas", "carne-plato.png") : null, color: "#3a2a22" },
  pequena: { foto: foto("carta:pequena", "casa-tomas", 900, 700), origen: ASSETS ? path.join(ASSETS, "fotos", "casa-tomas", "carne-plato.png") : null, color: "#3a2a22" },
  touza: { foto: foto("carta:vermut", "touza", 1200, 900), origen: ASSETS ? path.join(ASSETS, "fotos", "touza", "touza-2.webp") : null, color: "#1c140c" },
} as const;
const CATALOGO = Object.values(FOTOS).map((f) => f.foto);

describe("«Solo foto»: registro y validación", () => {
  it("cumple el contrato, es la primera del selector de post y no sale en story", () => {
    for (const id of ["ct-solo-foto", "tz-solo-foto"]) {
      const p = obtenerPlantilla(id)!;
      expect(problemasDePlantilla(p)).toEqual([]);
      expect(p).toMatchObject({ nombre: "Solo foto", formatos: ["post"], admitidos: ["foto"], papel: "foto", sinTexto: true, encaje: "marco" });
    }
    expect(plantillasVisibles("casa-tomas", "post")[0].id).toBe("ct-solo-foto");
    expect(plantillasVisibles("touza", "post")[0].id).toBe("tz-solo-foto");
    expect(plantillasVisibles("casa-tomas", "story").some((p) => p.sinTexto)).toBe(false);
    expect(plantillaPara("casa-tomas", "post", "foto")?.id).toBe("ct-solo-foto");
    // La portada enmarcada sigue siendo la de siempre.
    expect(plantillaPara("casa-tomas", "post", "portada", "marco")?.id).toBe("ct-portada-marco");
  });

  it("sin titular vale (vertical, carta y pequeña de 900×700); con titular o con foto de < 800 px, no", () => {
    for (const f of [FOTOS.vertical, FOTOS.carta, FOTOS.pequena]) {
      const r = validarPieza({ marca: "casa-tomas", plantilla: "ct-solo-foto", formato: "post", foto: f.foto.id }, { fotos: CATALOGO });
      expect(r.ok ? [] : r.problemas).toEqual([]);
      expect(r.datos?.titular).toBe("");
    }
    const conTitular = validarPieza({ marca: "casa-tomas", plantilla: "ct-solo-foto", formato: "post", foto: "carta:chuleta", titular: "Chuleta" }, { fotos: CATALOGO });
    expect(conTitular.problemas?.join(" ")).toMatch(/va sin texto: quita el «titular»/);
    const story = validarPieza({ marca: "casa-tomas", plantilla: "ct-solo-foto", formato: "story", foto: "carta:chuleta" }, { fotos: CATALOGO });
    expect(story.problemas?.join(" ")).toMatch(/no tiene formato story/);
    const diminuta = { ...FOTOS.carta.foto, id: "carta:diminuta", ancho: 640, alto: 480 };
    const r = validarPieza({ marca: "casa-tomas", plantilla: "ct-solo-foto", formato: "post", foto: "carta:diminuta" }, { fotos: [diminuta] });
    expect(r.problemas?.join(" ")).toMatch(/demasiado pequeña.*800 px/);
    const fuera = validarPieza({ marca: "casa-tomas", plantilla: "ct-solo-foto", formato: "post", foto: "drive:vertical", posicionY: 140 }, { fotos: CATALOGO });
    expect(fuera.problemas).toEqual(["«posicionY» debe ser un número entre 0 y 100"]);
    const bien = validarPieza({ marca: "casa-tomas", plantilla: "ct-solo-foto", formato: "post", foto: "drive:vertical", posicionY: 30 }, { fotos: CATALOGO });
    expect(bien.datos?.posicionY).toBe(30);
  });

  it("modo: recorta si cubre (≤ 5 %), si no entera y sin ampliar dentro del margen", () => {
    expect(modoSoloFoto({ ancho: 1281, alto: 1920 }, 1080, 1350)).toEqual({ modo: "cubre" });
    expect(modoSoloFoto(undefined, 1080, 1350)).toEqual({ modo: "cubre" });
    expect(modoSoloFoto({ ancho: 1200, alto: 900 }, 1080, 1350)).toEqual({ modo: "marco", ancho: 1080 - 2 * MARGEN_SOLO_FOTO, alto: 738 });
    expect(modoSoloFoto({ ancho: 900, alto: 700 }, 1080, 1350)).toEqual({ modo: "marco", ancho: 900, alto: 700 });
  });
});

function servidor(fotos: Map<string, Buffer>): Promise<{ url: string; pagina(html: string): string; cerrar(): Promise<void> }> {
  const paginas = new Map<string, string>();
  let n = 0;
  const s = http.createServer((req, res) => {
    const ruta = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const html = paginas.get(ruta);
    if (html !== undefined) return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    const f = fotos.get(ruta.replace(/^\//, ""));
    if (f) return void res.writeHead(200, { "content-type": "image/jpeg" }).end(f);
    const partes = ruta.split("/").filter(Boolean);
    if (partes[0] === "instagram" && !partes.includes("..")) {
      const fichero = path.join(PANEL, ...partes);
      if (fs.existsSync(fichero)) {
        const tipo = fichero.endsWith(".woff2") ? "font/woff2" : fichero.endsWith(".png") ? "image/png" : "application/octet-stream";
        return void res.writeHead(200, { "content-type": tipo }).end(fs.readFileSync(fichero));
      }
    }
    res.writeHead(404).end();
  });
  return new Promise((ok) =>
    s.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
      ok({
        url,
        pagina: (h) => {
          const r = `/pieza/${++n}.html`;
          paginas.set(r, h);
          return url + r;
        },
        cerrar: () => new Promise<void>((fin) => s.close(() => fin())),
      });
    }),
  );
}

interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
  naturalW: number;
  naturalH: number;
  objectPosition: string;
}

describe.skipIf(!chromiumInstalado)("render real de «Solo foto»", () => {
  let navegador: Browser;
  let srv: Awaited<ReturnType<typeof servidor>>;

  beforeAll(async () => {
    const mapa = new Map<string, Buffer>();
    for (const f of Object.values(FOTOS)) mapa.set(f.foto.ruta, await hacerFoto(f.origen, f.foto.ancho, f.foto.alto, f.color));
    srv = await servidor(mapa);
    navegador = await chromium.launch();
    if (CAPTURAS) fs.mkdirSync(CAPTURAS, { recursive: true });
  }, LENTO);
  afterAll(async () => {
    await navegador?.close();
    await srv?.cerrar();
  }, LENTO);

  async function renderizar(datos: DatosPieza) {
    const html = construirDocumento(datos, { baseRecursos: baseRecursosPanel(srv.url), baseFotos: srv.url, fotos: CATALOGO });
    const page = await navegador.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    try {
      await page.goto(srv.pagina(html), { waitUntil: "load" });
      const fallos = (await page.evaluate(CODIGO_ESPERAR_RECURSOS)) as string[];
      const { errores, avisos } = (await page.evaluate(CODIGO_COMPROBAR_MAQUETACION)) as { errores: string[]; avisos: string[] };
      const medidas = (await page.evaluate(`(() => {
        const l = document.querySelector(".lienzo").getBoundingClientRect();
        const caja = (img) => {
          if (!img) return null;
          const r = img.getBoundingClientRect();
          return { x: r.left - l.left, y: r.top - l.top, w: r.width, h: r.height, naturalW: img.naturalWidth, naturalH: img.naturalHeight, objectPosition: getComputedStyle(img).objectPosition };
        };
        return {
          modo: document.querySelector(".sf").getAttribute("data-modo"),
          foto: caja(document.querySelector(".sf__foto") || document.querySelector(".sf__entera")),
          fondo: caja(document.querySelector(".sf__fondo")),
          textos: document.querySelectorAll("[data-campo]").length,
          letras: document.body.innerText.trim().length,
          logos: Array.from(document.images).filter((i) => !i.className.startsWith("sf__")).length,
        };
      })()`)) as { modo: string; foto: Caja; fondo: Caja | null; textos: number; letras: number; logos: number };
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1080, height: 1350 } });
      return { fallos, errores, avisos, medidas, png };
    } finally {
      await page.close();
    }
  }

  async function guardar(png: Buffer, nombre: string) {
    if (!CAPTURAS) return;
    const jpg = await sharp(png).jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
    fs.writeFileSync(path.join(CAPTURAS, nombre), jpg);
  }

  const pieza = (marca: DatosPieza["marca"], fotoId: string, extra: Partial<DatosPieza> = {}): DatosPieza => {
    const v = validarPieza({ marca, plantilla: marca === "touza" ? "tz-solo-foto" : "ct-solo-foto", formato: "post", foto: fotoId, ...extra }, { fotos: CATALOGO });
    expect(v.ok ? [] : v.problemas).toEqual([]);
    return v.datos!;
  };

  it(
    "foto vertical buena (1281×1920): recortada a 1080×1350, sin texto ni logo, centrada en posicionY",
    async () => {
      const r = await renderizar(pieza("casa-tomas", "drive:vertical", { posicionY: 40 }));
      expect(r.fallos).toEqual([]);
      expect(r.errores).toEqual([]);
      expect(r.avisos).toEqual([]);
      expect(r.medidas.modo).toBe("cubre");
      expect(r.medidas).toMatchObject({ textos: 0, letras: 0, logos: 0, fondo: null });
      const f = r.medidas.foto;
      expect([f.x, f.y, f.w, f.h]).toEqual([0, 0, 1080, 1350]);
      expect(f.objectPosition).toBe("50% 40%");
      await guardar(r.png, "ct-solo-foto-vertical.jpg");
    },
    LENTO,
  );

  for (const [clave, marca, nombre] of [
    ["carta", "casa-tomas", "ct-solo-foto-carta-1200x900.jpg"],
    ["touza", "touza", "tz-solo-foto-carta-1200x900.jpg"],
  ] as const) {
    it(
      `${marca}: foto de la carta 1200×900 entera, centrada, con margen fino y sin ampliar, sobre su propio color`,
      async () => {
        const r = await renderizar(pieza(marca, FOTOS[clave].foto.id));
        expect(r.fallos).toEqual([]);
        expect(r.errores).toEqual([]);
        expect(r.medidas.modo).toBe("marco");
        expect(r.medidas).toMatchObject({ textos: 0, letras: 0, logos: 0 });
        const f = r.medidas.foto;
        expect([f.naturalW, f.naturalH]).toEqual([1200, 900]);
        // Entera (misma proporción), nunca ampliada, centrada y con el margen fino a los lados.
        expect(Math.abs(f.w / f.h - 1200 / 900)).toBeLessThan(0.01);
        expect(f.w).toBeLessThanOrEqual(1200);
        expect(Math.round(f.x)).toBe(MARGEN_SOLO_FOTO);
        expect(Math.abs(f.y + f.h / 2 - 675)).toBeLessThan(1);
        // El fondo es la propia foto (desenfocada) y cubre todo el lienzo.
        expect(r.medidas.fondo?.naturalW).toBe(1200);
        expect(r.medidas.fondo!.w).toBeGreaterThanOrEqual(1080);
        // El fondo no es el de la marca: toma el color de la foto (la esquina no es blanca ni el papel).
        const { data } = await sharp(r.png).extract({ left: 4, top: 4, width: 8, height: 8 }).raw().toBuffer({ resolveWithObject: true });
        expect(Math.min(data[0], data[1], data[2])).toBeLessThan(235);
        await guardar(r.png, nombre);
      },
      LENTO,
    );
  }

  it(
    "foto pequeña (900×700): se queda en su tamaño natural, centrada",
    async () => {
      const r = await renderizar(pieza("casa-tomas", "carta:pequena"));
      expect(r.errores).toEqual([]);
      const f = r.medidas.foto;
      expect([f.w, f.h]).toEqual([900, 700]);
      expect(Math.abs(f.x + f.w / 2 - 540)).toBeLessThan(1);
    },
    LENTO,
  );
});
