// @vitest-environment node
//
// «Foto enmarcada» (ct-marco / tz-marco) con una foto como las de la carta
// (1200×900, apaisada y comprimida), con Chromium de verdad:
//  - post y story de las dos marcas sin errores ni avisos de maquetación;
//  - la foto se ve ENTERA (misma proporción) y nunca ampliada;
//  - en story la foto cae en el tercio central y los textos dentro de la zona
//    segura del sistema de marca (220 arriba, 320 abajo, 64 a los lados);
//  - textos largos dentro de los límites caben; más largos, error que nombra el campo.
//
// La foto sale de instagram-studio/assets (como render.test.ts) recortada a
// 4:3 y bajada a 1200×900 con calidad 75; si no está, se genera una sintética.
// Se SALTA sin el Chromium de Playwright. Con INSTAGRAM_CAPTURAS_MARCO_NUCLEO=<carpeta>
// guarda los JPEG de muestra ahí.
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
  FORMATOS,
  baseRecursosPanel,
  construirDocumento,
  obtenerPlantilla,
  validarPieza,
  type DatosPieza,
  type Foto,
  type FormatoId,
  type MarcaId,
} from "..";

const LENTO = 120_000;
const PANEL = path.resolve(process.cwd(), "public");
const CAPTURAS = process.env.INSTAGRAM_CAPTURAS_MARCO_NUCLEO;

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
if (!chromiumInstalado) console.warn("[instagram marco.render.test] SE SALTA: no está el Chromium de Playwright");

/** Foto «de la carta»: 1200×900 JPEG calidad 75 (como el bucket «platos»). */
async function fotoCarta(origen: string | null, color: string): Promise<Buffer> {
  // La sintética se compone y se guarda ANTES de redimensionar: en una misma cadena sharp aplica el `composite`
  // después del `resize`, y la capa de 1600×1200 no cabría en la foto de 1200×900.
  const base =
    origen && fs.existsSync(origen)
      ? sharp(origen)
      : sharp(
          await sharp({ create: { width: 1600, height: 1200, channels: 3, background: color } })
            .composite([
              { input: Buffer.from(`<svg width="1600" height="1200"><circle cx="800" cy="600" r="420" fill="#f4efe6"/><circle cx="760" cy="560" r="260" fill="#7a2e1f"/></svg>`) },
            ])
            .png()
            .toBuffer(),
        );
  return base.resize(1200, 900, { fit: "cover" }).jpeg({ quality: 75 }).toBuffer();
}

const MARCAS: Record<MarcaId, { plantilla: string; foto: Foto; origen: string | null; color: string }> = {
  "casa-tomas": {
    plantilla: "ct-marco",
    foto: { id: "carta:prueba-ct", marca: "casa-tomas", ruta: "fotos/casa-tomas/carta-ct.jpg", ancho: 1200, alto: 900, tipo: "plato", aptaPost: false, aptaStory: false, descripcion: "" },
    origen: ASSETS ? path.join(ASSETS, "fotos", "casa-tomas", "carne-plato.png") : null,
    color: "#3a2a22",
  },
  touza: {
    plantilla: "tz-marco",
    foto: { id: "carta:prueba-tz", marca: "touza", ruta: "fotos/touza/carta-tz.jpg", ancho: 1200, alto: 900, tipo: "plato", aptaPost: false, aptaStory: false, descripcion: "" },
    origen: ASSETS ? path.join(ASSETS, "fotos", "touza", "touza-2.webp") : null,
    color: "#1c140c",
  },
};
const CATALOGO = Object.values(MARCAS).map((m) => m.foto);

const TEXTOS = {
  "casa-tomas": { antetitulo: "De nuestra carta", titular: "Brasa, sal y paciencia", cita: "Chuleta de vaca madurada", cta: "Reservar mesa" },
  touza: { antetitulo: "Para empezar la noche", titular: "Un rincón para quedarse", cita: "Sofá, mármol y luz baja", cta: "Ver carta" },
} as const;

/** Textos al límite de caracteres de la plantilla (palabras reales, titular de 6). */
const LARGOS = {
  "casa-tomas": {
    antetitulo: "Cocina gallega · Producto de lonja", // 34
    titular: "Rodaballo salvaje con ajada y patatas", // 37, 6 palabras
    cita: "Con patatas panaderas, pimientos de Padrón y aceite de oliva virgen", // 68
    cta: "Reservar mesa para cenar", // 24
    pie: "@casatomascrevillent · Crevillent · Alicante", // 44
  },
  touza: {
    antetitulo: "Cócteles de autor · Desde 2023", // 30
    titular: "Vermut de grifo con aceitunas gordal", // 36, 6 palabras
    cita: "Con piel de naranja, hielo transparente y un toque de romero ahumado", // 68
    cta: "Ver la carta completa", // 21
    pie: "@touzabar · Calle San Vicente 14", // 32
  },
} as const;

function servidor(fotos: Map<string, Buffer>): Promise<{ url: string; pagina(html: string): string; cerrar(): Promise<void> }> {
  const paginas = new Map<string, string>();
  let n = 0;
  const s = http.createServer((req, res) => {
    const ruta = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const html = paginas.get(ruta);
    if (html !== undefined) return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    const foto = fotos.get(ruta.replace(/^\//, ""));
    if (foto) return void res.writeHead(200, { "content-type": "image/jpeg" }).end(foto);
    const partes = ruta.split("/").filter(Boolean);
    if (partes[0] === "instagram" && !partes.includes("..")) {
      const f = path.join(PANEL, ...partes);
      if (fs.existsSync(f)) {
        const tipo = f.endsWith(".woff2") ? "font/woff2" : f.endsWith(".png") ? "image/png" : "application/octet-stream";
        return void res.writeHead(200, { "content-type": tipo }).end(fs.readFileSync(f));
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

interface Medidas {
  foto: { x: number; y: number; w: number; h: number; naturalW: number; naturalH: number };
  campos: Array<{ campo: string; x0: number; x1: number; y0: number; y1: number }>;
}

describe("validación de «Foto enmarcada» con una foto de la carta", () => {
  for (const marca of ["casa-tomas", "touza"] as const) {
    const m = MARCAS[marca];
    for (const formato of ["post", "story"] as const) {
      it(`${m.plantilla} ${formato}: la foto 1200×900 vale; en la plantilla a sangre, no y se recomienda la enmarcada`, () => {
        const pieza = { marca, plantilla: m.plantilla, formato, foto: m.foto.id, ...TEXTOS[marca] };
        const ok = validarPieza(pieza, { fotos: CATALOGO });
        expect(ok.ok ? [] : ok.problemas).toEqual([]);
        const sangre = marca === "touza" ? "tz-foto-titular" : "ct-foto-titular";
        const { cita: _c, ...sinCita } = TEXTOS[marca];
        const mal = validarPieza({ ...pieza, ...sinCita, plantilla: sangre }, { fotos: CATALOGO });
        expect(mal.ok).toBe(false);
        expect(mal.problemas?.join("\n")).toMatch(new RegExp(`ampliarse.*Usa la plantilla «${obtenerPlantilla(m.plantilla)!.nombre}» \\(«${m.plantilla}»\\)`));
      });
    }
  }
  it("una foto con el lado largo de menos de 800 px no vale ni enmarcada", () => {
    const pequena = { ...MARCAS["casa-tomas"].foto, id: "carta:pequena", ancho: 640, alto: 480 };
    const r = validarPieza({ marca: "casa-tomas", plantilla: "ct-marco", formato: "post", foto: "carta:pequena", titular: "Hola" }, { fotos: [pequena] });
    expect(r.problemas?.join(" ")).toMatch(/demasiado pequeña.*800 px/);
  });
});

describe.skipIf(!chromiumInstalado)("render real de «Foto enmarcada» (1200×900)", () => {
  let navegador: Browser;
  let srv: Awaited<ReturnType<typeof servidor>>;

  beforeAll(async () => {
    const fotos = new Map<string, Buffer>();
    for (const m of Object.values(MARCAS)) fotos.set(m.foto.ruta, await fotoCarta(m.origen, m.color));
    srv = await servidor(fotos);
    navegador = await chromium.launch();
    if (CAPTURAS) fs.mkdirSync(CAPTURAS, { recursive: true });
  }, LENTO);
  afterAll(async () => {
    await navegador?.close();
    await srv?.cerrar();
  }, LENTO);

  async function renderizar(datos: DatosPieza) {
    const { ancho, alto } = FORMATOS[datos.formato];
    const html = construirDocumento(datos, { baseRecursos: baseRecursosPanel(srv.url), baseFotos: srv.url, fotos: CATALOGO });
    const page = await navegador.newPage({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1 });
    try {
      await page.goto(srv.pagina(html), { waitUntil: "load" });
      const fallos = (await page.evaluate(CODIGO_ESPERAR_RECURSOS)) as string[];
      const { errores, avisos } = (await page.evaluate(CODIGO_COMPROBAR_MAQUETACION)) as { errores: string[]; avisos: string[] };
      const medidas = (await page.evaluate(`(() => {
        const l = document.querySelector(".lienzo").getBoundingClientRect();
        const img = document.querySelector("img[class$='__foto']");
        const r = img.getBoundingClientRect();
        return {
          foto: { x: r.left - l.left, y: r.top - l.top, w: r.width, h: r.height, naturalW: img.naturalWidth, naturalH: img.naturalHeight },
          campos: Array.from(document.querySelectorAll("[data-campo]")).map((e) => {
            const c = e.getBoundingClientRect();
            return { campo: e.getAttribute("data-campo"), x0: c.left - l.left, x1: c.right - l.left, y0: c.top - l.top, y1: c.bottom - l.top };
          }),
        };
      })()`)) as Medidas;
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: ancho, height: alto } });
      return { fallos, errores, avisos, medidas, png };
    } finally {
      await page.close();
    }
  }

  for (const marca of ["casa-tomas", "touza"] as const) {
    const m = MARCAS[marca];
    for (const formato of ["post", "story"] as const satisfies readonly FormatoId[]) {
      it(`${m.plantilla} ${formato}: sin errores, foto entera y sin ampliar${formato === "story" ? ", en el tercio central y textos en la zona segura" : ""}`, async () => {
        const v = validarPieza({ marca, plantilla: m.plantilla, formato, foto: m.foto.id, ...TEXTOS[marca] }, { fotos: CATALOGO });
        expect(v.ok ? [] : v.problemas).toEqual([]);
        const r = await renderizar(v.datos!);
        expect(r.fallos).toEqual([]);
        expect(r.errores).toEqual([]);
        expect(r.avisos).toEqual([]);
        const f = r.medidas.foto;
        expect([f.naturalW, f.naturalH]).toEqual([1200, 900]);
        // Entera (misma proporción) y nunca ampliada.
        expect(Math.abs(f.w / f.h - 1200 / 900)).toBeLessThan(0.01);
        expect(f.w).toBeLessThanOrEqual(1200);
        // Grande de verdad: al menos el 70 % del ancho útil.
        expect(f.w).toBeGreaterThan((1080 - 2 * 72) * 0.7);
        if (formato === "story") {
          const centro = f.y + f.h / 2;
          expect(centro).toBeGreaterThan(640);
          expect(centro).toBeLessThan(1280);
          for (const c of r.medidas.campos) {
            expect(c.y0, c.campo).toBeGreaterThanOrEqual(220 - 1);
            expect(c.y1, c.campo).toBeLessThanOrEqual(1920 - 320 + 1);
            expect(c.x0, c.campo).toBeGreaterThanOrEqual(64);
            expect(c.x1, c.campo).toBeLessThanOrEqual(1080 - 64);
            // Texto arriba o abajo de la foto, nunca encima.
            expect(c.y1 <= f.y || c.y0 >= f.y + f.h, `${c.campo} pisa la foto`).toBe(true);
          }
        }
        if (CAPTURAS) {
          const jpg = await sharp(r.png).jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
          fs.writeFileSync(path.join(CAPTURAS, `${m.plantilla}-${formato}.jpg`), jpg);
        }
      }, LENTO);

      it(`${m.plantilla} ${formato}: textos largos dentro de los límites caben; más largos, error que nombra el campo`, async () => {
        const v = validarPieza({ marca, plantilla: m.plantilla, formato, foto: m.foto.id, ...LARGOS[marca] }, { fotos: CATALOGO });
        expect(v.ok ? [] : v.problemas).toEqual([]);
        const r = await renderizar(v.datos!);
        expect(r.errores).toEqual([]);
        // Sin pasar por el esquema: más largos que el límite → el motor da error con el campo.
        const datos = {
          ...v.datos!,
          titular: "Anticonstitucionalmente Desproporcionadamente Electroencefalografistas Otorrinolaringológicamente",
          cita: `${LARGOS[marca].cita} ${LARGOS[marca].cita} ${LARGOS[marca].cita}`,
          antetitulo: `${LARGOS[marca].antetitulo} · ${LARGOS[marca].antetitulo}`,
        };
        const roto = await renderizar(datos);
        const todo = roto.errores.join("\n");
        expect(todo).toMatch(/«titular»/);
        expect(todo).toMatch(/«cita»/);
        expect(todo).toMatch(/«antetitulo»/);
      }, LENTO);
    }
  }
});
