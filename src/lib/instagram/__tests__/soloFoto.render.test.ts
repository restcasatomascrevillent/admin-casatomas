// @vitest-environment node
//
// «Solo foto» (ct-solo-foto / tz-solo-foto, 12/11/2026), con Chromium de verdad:
//  - la foto SIEMPRE se recorta a 4:5 a sangre (decisión del dueño), sin texto
//    ni logo: una vertical buena, una de la carta (1200×900) centrada y con
//    posicionX=30 (recorte horizontal);
//  - una pequeña (640×480) sigue valiendo, con el aviso «puede verse blanda».
// Y la validación: sin titular vale; con titular, en story o encuadre fuera de 0-100, no.
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
  esAptaPara,
  obtenerPlantilla,
  plantillaPara,
  plantillasVisibles,
  problemasDePlantilla,
  validarPieza,
  type DatosPieza,
  type Foto,
} from "..";
import { RECORTE_MINIMO, anchoRecorte } from "../plantillas/solo-foto";

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
  pequena: { foto: foto("carta:pequena", "casa-tomas", 640, 480), origen: ASSETS ? path.join(ASSETS, "fotos", "casa-tomas", "carne-plato.png") : null, color: "#3a2a22" },
} as const;
const CATALOGO = Object.values(FOTOS).map((f) => f.foto);

describe("«Solo foto»: registro y validación", () => {
  it("cumple el contrato, es la primera del selector de post y no sale en story", () => {
    for (const id of ["ct-solo-foto", "tz-solo-foto"]) {
      const p = obtenerPlantilla(id)!;
      expect(problemasDePlantilla(p)).toEqual([]);
      expect(p).toMatchObject({ nombre: "Solo foto", formatos: ["post"], admitidos: ["foto"], papel: "foto", sinTexto: true });
    }
    expect(plantillasVisibles("casa-tomas", "post")[0].id).toBe("ct-solo-foto");
    expect(plantillasVisibles("touza", "post")[0].id).toBe("tz-solo-foto");
    expect(plantillasVisibles("casa-tomas", "story").some((p) => p.sinTexto)).toBe(false);
    expect(plantillaPara("casa-tomas", "post", "foto")?.id).toBe("ct-solo-foto");
    expect(plantillaPara("casa-tomas", "post", "portada", "marco")?.id).toBe("ct-portada-marco");
  });

  it("sin titular vale con cualquier foto (también una de 640×480); con titular, en story o encuadre fuera de 0-100, no", () => {
    for (const f of Object.values(FOTOS)) {
      const r = validarPieza({ marca: "casa-tomas", plantilla: "ct-solo-foto", formato: "post", foto: f.foto.id }, { fotos: CATALOGO });
      expect(r.ok ? [] : r.problemas).toEqual([]);
      expect(r.datos?.titular).toBe("");
      expect(esAptaPara(f.foto, "post", obtenerPlantilla("ct-solo-foto"))).toBe(true);
    }
    const conTitular = validarPieza({ marca: "casa-tomas", plantilla: "ct-solo-foto", formato: "post", foto: "carta:chuleta", titular: "Chuleta" }, { fotos: CATALOGO });
    expect(conTitular.problemas?.join(" ")).toMatch(/va sin texto: quita el «titular»/);
    const story = validarPieza({ marca: "casa-tomas", plantilla: "ct-solo-foto", formato: "story", foto: "carta:chuleta" }, { fotos: CATALOGO });
    expect(story.problemas?.join(" ")).toMatch(/no tiene formato story/);
    const fuera = validarPieza({ marca: "casa-tomas", plantilla: "ct-solo-foto", formato: "post", foto: "carta:chuleta", posicionX: -5, posicionY: 140 }, { fotos: CATALOGO });
    expect(fuera.problemas).toEqual(["«posicionX» debe ser un número entre 0 y 100", "«posicionY» debe ser un número entre 0 y 100"]);
    const bien = validarPieza({ marca: "casa-tomas", plantilla: "ct-solo-foto", formato: "post", foto: "carta:chuleta", posicionX: 30, posicionY: 45 }, { fotos: CATALOGO });
    expect([bien.datos?.posicionX, bien.datos?.posicionY]).toEqual([30, 45]);
  });

  it("ancho real del recorte: vertical 1281, carta 720, 640×480 → 384 (< 600: aviso)", () => {
    expect(anchoRecorte({ ancho: 1281, alto: 1920 }, 1080, 1350)).toBe(1281);
    expect(anchoRecorte({ ancho: 1200, alto: 900 }, 1080, 1350)).toBe(720);
    expect(anchoRecorte({ ancho: 640, alto: 480 }, 1080, 1350)).toBe(384);
    expect(anchoRecorte(undefined, 1080, 1350)).toBeNull();
    expect(RECORTE_MINIMO).toBe(600);
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
        const img = document.querySelector(".sf__foto");
        const r = img.getBoundingClientRect();
        const cs = getComputedStyle(img);
        return {
          foto: { x: r.left - l.left, y: r.top - l.top, w: r.width, h: r.height, naturalW: img.naturalWidth, naturalH: img.naturalHeight, objectPosition: cs.objectPosition, objectFit: cs.objectFit },
          imagenes: document.images.length,
          textos: document.querySelectorAll("[data-campo]").length,
          letras: document.body.innerText.trim().length,
        };
      })()`)) as { foto: Caja & { objectFit: string }; imagenes: number; textos: number; letras: number };
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

  const pieza = (fotoId: string, extra: Partial<DatosPieza> = {}): DatosPieza => {
    const v = validarPieza({ marca: "casa-tomas", plantilla: "ct-solo-foto", formato: "post", foto: fotoId, ...extra }, { fotos: CATALOGO });
    expect(v.ok ? [] : v.problemas).toEqual([]);
    return v.datos!;
  };

  /** Siempre a sangre: la foto ocupa todo el lienzo, sin texto ni logo, con object-fit cover. */
  function aSangre(r: Awaited<ReturnType<typeof renderizar>>) {
    expect(r.fallos).toEqual([]);
    expect(r.errores).toEqual([]);
    expect(r.medidas).toMatchObject({ imagenes: 1, textos: 0, letras: 0 });
    const f = r.medidas.foto;
    expect([f.x, f.y, f.w, f.h, f.objectFit]).toEqual([0, 0, 1080, 1350, "cover"]);
  }

  it(
    "foto vertical buena (1281×1920): a sangre, sin aviso, encuadre vertical 40 %",
    async () => {
      const r = await renderizar(pieza("drive:vertical", { posicionY: 40 }));
      aSangre(r);
      expect(r.avisos).toEqual([]);
      expect(r.medidas.foto.objectPosition).toBe("50% 40%");
      await guardar(r.png, "ct-solo-foto-vertical.jpg");
    },
    LENTO,
  );

  it(
    "foto de la carta (1200×900): recortada a 4:5 a sangre y centrada; con posicionX=30 se ve más de la izquierda",
    async () => {
      const centrada = await renderizar(pieza("carta:chuleta"));
      aSangre(centrada);
      expect(centrada.avisos).toEqual([]); // 720 px reales de ancho: vale
      expect(centrada.medidas.foto.objectPosition).toBe("50% 50%");
      expect(centrada.medidas.foto.naturalW).toBe(1200);
      const izquierda = await renderizar(pieza("carta:chuleta", { posicionX: 30 }));
      aSangre(izquierda);
      expect(izquierda.medidas.foto.objectPosition).toBe("30% 50%");
      // Otro trozo de la foto: las capturas no son iguales.
      const a = await sharp(centrada.png).resize(54, 68).raw().toBuffer();
      const b = await sharp(izquierda.png).resize(54, 68).raw().toBuffer();
      let diferencia = 0;
      for (let i = 0; i < a.length; i++) diferencia += Math.abs(a[i] - b[i]);
      expect(diferencia / a.length).toBeGreaterThan(3);
      await guardar(centrada.png, "ct-solo-foto-carta-1200x900-centrada.jpg");
      await guardar(izquierda.png, "ct-solo-foto-carta-1200x900-x30.jpg");
    },
    LENTO,
  );

  it(
    "foto pequeña (640×480): sigue valiendo, a sangre, con el aviso «puede verse blanda»",
    async () => {
      const r = await renderizar(pieza("carta:pequena"));
      aSangre(r);
      expect(r.avisos).toHaveLength(1);
      expect(r.avisos[0]).toMatch(/^La foto es pequeña y puede verse blanda \(se ven 384 px de ancho/);
    },
    LENTO,
  );
});
