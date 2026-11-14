// @vitest-environment node
//
// Render REAL con Chromium (Playwright) de los ejemplos y de casos rotos, con
// el mismo código que usarán el panel y la función de Vercel
// (construirDocumento + CODIGO_ESPERAR_RECURSOS + CODIGO_COMPROBAR_MAQUETACION).
//
// Dos servidores locales en orígenes distintos, como en producción (no
// depende de Supabase): uno imita el panel (public/instagram: fuentes y logos,
// con Access-Control-Allow-Origin como en vercel.json) y otro el bucket (las
// fotos, desde instagram-studio/assets) y sirve los documentos. Se SALTA si no
// está instagram-studio/assets (p. ej. en CI, que solo tiene este repo) o si no
// está instalado el Chromium de @playwright/test (npx playwright install chromium).
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
  EJEMPLOS,
  EJEMPLOS_V2,
  FORMATOS,
  FUENTES,
  PLANTILLAS,
  baseRecursosPanel,
  construirDocumento,
  validarPieza,
  type DatosPieza,
  type FormatoId,
  type Plantilla,
} from "..";
import { plantillaPrueba } from "./fixtures/plantilla-prueba";
import { carasExtraEstilos } from "../plantillas/ct-estilos/index.js";

const LENTO = 120_000;
const TITULAR_LARGO =
  "Anticonstitucionalmente Desproporcionadamente Electroencefalografistas Otorrinolaringológicamente Esternocleidomastoideos Interdisciplinariedades";

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
const motivo = !ASSETS
  ? "no está instagram-studio/assets (fotos de prueba); define INSTAGRAM_STUDIO_ASSETS"
  : !chromiumInstalado
    ? "no está instalado el Chromium de Playwright (npx playwright install chromium)"
    : "";
if (motivo) console.warn(`[instagram render.test] SE SALTA: ${motivo}`);

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
};

const PANEL = path.resolve(process.cwd(), "public");

/**
 * Servidor local. `raiz` = public/ del panel (sirve /instagram/fuentes y
 * /instagram/logos, con CORS abierto) o los assets del prototipo (sirve
 * /fotos/<marca>/<nombre>.jpg → el original con ese nombre, como el bucket).
 */
function arrancarServidor(raiz: string, tipo: "panel" | "bucket"): Promise<{ url: string; pagina(html: string): string; cerrar(): Promise<void> }> {
  const paginas = new Map<string, string>();
  let n = 0;
  const servidor = http.createServer((req, res) => {
    const ruta = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const enMemoria = paginas.get(ruta);
    if (enMemoria !== undefined) {
      res.writeHead(200, { "content-type": TIPOS[".html"] }).end(enMemoria);
      return;
    }
    let fichero: string | undefined;
    const partes = ruta.split("/").filter(Boolean);
    if (partes.some((p) => p === ".." || p.includes("\\"))) {
      res.writeHead(403).end();
      return;
    }
    if (tipo === "panel" && partes[0] === "instagram" && (partes[1] === "fuentes" || partes[1] === "logos")) {
      fichero = path.join(raiz, ...partes);
    } else if (tipo === "bucket" && partes[0] === "fotos" && partes.length === 3) {
      const dir = path.join(raiz, "fotos", partes[1]);
      const nombre = path.basename(partes[2], path.extname(partes[2]));
      const hallado = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => path.basename(f, path.extname(f)) === nombre) : undefined;
      if (hallado) fichero = path.join(dir, hallado);
    }
    if (!fichero || !fs.existsSync(fichero)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": TIPOS[path.extname(fichero).toLowerCase()] ?? "application/octet-stream",
      ...(tipo === "panel" ? { "access-control-allow-origin": "*" } : {}),
    });
    res.end(fs.readFileSync(fichero));
  });
  return new Promise((ok) =>
    servidor.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
      ok({
        url,
        pagina(html) {
          const r = `/pieza/${++n}.html`;
          paginas.set(r, html);
          return url + r;
        },
        cerrar: () => new Promise<void>((fin) => servidor.close(() => fin())),
      });
    }),
  );
}

interface Resultado {
  png: Buffer;
  fallosCarga: string[];
  errores: string[];
  avisos: string[];
  caras: number;
}

describe.skipIf(!!motivo)("render real con Chromium", () => {
  let navegador: Browser;
  let servidor: Awaited<ReturnType<typeof arrancarServidor>>;
  let panel: Awaited<ReturnType<typeof arrancarServidor>>;

  beforeAll(async () => {
    servidor = await arrancarServidor(ASSETS!, "bucket");
    panel = await arrancarServidor(PANEL, "panel");
    navegador = await chromium.launch();
  }, LENTO);
  afterAll(async () => {
    await navegador?.close();
    await servidor?.cerrar();
    await panel?.cerrar();
  }, LENTO);

  async function renderizar(datos: DatosPieza, plantilla?: Plantilla): Promise<Resultado> {
    const { ancho, alto } = FORMATOS[datos.formato];
    const html = construirDocumento(datos, { baseRecursos: baseRecursosPanel(panel.url), baseFotos: servidor.url, plantilla });
    const page = await navegador.newPage({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1 });
    const fallosRed: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400) fallosRed.push(`HTTP ${r.status()} ${r.url()}`);
    });
    try {
      await page.goto(servidor.pagina(html), { waitUntil: "load" });
      const fallos = (await page.evaluate(CODIGO_ESPERAR_RECURSOS)) as string[];
      const { errores, avisos } = (await page.evaluate(CODIGO_COMPROBAR_MAQUETACION)) as { errores: string[]; avisos: string[] };
      const caras = (await page.evaluate("document.fonts.size")) as number;
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: ancho, height: alto }, animations: "disabled", caret: "hide" });
      return { png, fallosCarga: [...fallosRed, ...fallos], errores, avisos, caras };
    } finally {
      await page.close();
    }
  }

  async function comprobarImagen(png: Buffer, formato: FormatoId): Promise<void> {
    const { ancho, alto } = FORMATOS[formato];
    const meta = await sharp(png).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", ancho, alto]);
    // No está en blanco: la luminancia varía y no es un único color.
    const canal = (await sharp(png).greyscale().stats()).channels[0];
    expect(canal.stdev).toBeGreaterThan(4);
    expect(canal.max - canal.min).toBeGreaterThan(40);
  }

  for (const e of [...EJEMPLOS, ...EJEMPLOS_V2]) {
    it(`ejemplo ${e.id}: ${e.json.formato} exacto, no en blanco, sin problemas de maquetación`, async () => {
      const v = validarPieza(e.json);
      expect(v.ok ? [] : v.problemas).toEqual([]);
      if (!v.ok) return;
      const r = await renderizar(v.datos);
      expect(r.fallosCarga).toEqual([]);
      // La story clásica del jueves de tapas trae además Montserrat 300 y 400 (latin y latin-ext).
      // Los estilos de ct-estilos declaran además sus caras de Montserrat y Cormorant.
      expect(r.caras).toBe(FUENTES[v.datos.marca].length + (v.datos.plantilla === "ct-tapas-clasica" ? 4 : 0) + carasExtraEstilos(v.datos.plantilla));
      expect(r.errores).toEqual([]);
      expect(r.avisos).toEqual([]);
      await comprobarImagen(r.png, v.datos.formato);
    }, LENTO);
  }

  // «Solo foto» no tiene titular (soloFoto.render.test.ts).
  for (const p of PLANTILLAS.filter((x) => !x.sinTexto)) {
    for (const formato of p.formatos) {
      it(`${p.id} ${formato}: titular de 6 palabras larguísimas → error que nombra «titular»`, async () => {
        const e = [...EJEMPLOS, ...EJEMPLOS_V2].find((x) => x.json.plantilla === p.id && x.json.formato === formato);
        expect(e, "falta un ejemplo para esta plantilla y formato").toBeDefined();
        // Sin pasar por el esquema (los límites de caracteres ya lo pararían).
        const datos = { ...(e!.json as DatosPieza), titular: TITULAR_LARGO };
        const r = await renderizar(datos);
        expect(r.errores.join("\n")).toMatch(/«titular»/);
      }, LENTO);
    }
  }

  it("ct-tipografica: titular pequeño + cita, correcto", async () => {
    const e = EJEMPLOS.find((x) => x.id === "ct-tipografica-lema")!;
    const v = validarPieza({ ...e.json, titular: "Cocina gallega de siempre en Crevillente" });
    expect(v.ok ? [] : v.problemas).toEqual([]);
    if (!v.ok) return;
    const r = await renderizar(v.datos);
    expect([...r.fallosCarga, ...r.errores]).toEqual([]);
    await comprobarImagen(r.png, "post");
  }, LENTO);

  it("ct-tipografica: cita de 90 caracteres (sin esquema) → «cita» se desborda", async () => {
    const cita = "O mellor da casa sempre foi a xente que se senta á mesa e volve, ano tras ano, a por máis.";
    expect([...cita].length).toBe(90);
    const datos: DatosPieza = { marca: "casa-tomas", plantilla: "ct-tipografica", formato: "post", antetitulo: "Desde 1998", titular: "", cita };
    const r = await renderizar(datos);
    expect(r.errores.join(" | ")).toMatch(/El campo «cita» se desborda/);
  }, LENTO);

  it("detecta margen, zona segura, campos vacíos y avisa del titular de más de 3 líneas", async () => {
    const rota: Plantilla = {
      ...plantillaPrueba(),
      html: (d) => `<style>p { position: absolute; font-size: 40px; }</style>
        <p data-campo="antetitulo" style="left: 10px; top: 400px">Fuera del margen</p>
        <p data-campo="titular" style="left: 72px; top: 120px; width: 300px; line-height: 1">${d.titular}</p>
        <p data-campo="cta" style="left: 72px; top: 900px"></p>`,
    };
    const datos: DatosPieza = { marca: "casa-tomas", plantilla: "prueba-casa-tomas", formato: "story", titular: "uno dos tres cuatro cinco seis" };
    const r = await renderizar(datos, rota);
    const t = r.errores.join("\n");
    expect(t).toMatch(/«antetitulo» invade la zona segura.*izquierda x=10 < 72/);
    expect(t).toMatch(/«titular» invade la zona segura.*arriba y=120 < 250/);
    expect(t).toMatch(/«cta» está vacío/);

    const estrecha: Plantilla = {
      ...plantillaPrueba(),
      html: (d) =>
        `<p data-campo="titular" style="position:absolute; left:72px; top:300px; width:200px; font-size:40px; line-height:1.2">${d.titular}</p>`,
    };
    const ok = await renderizar(datos, estrecha);
    expect(ok.errores).toEqual([]);
    expect(ok.avisos.join("\n")).toMatch(/El titular ocupa \d+ líneas/);
  }, LENTO);

  it("una imagen que no carga sale en los fallos de carga", async () => {
    const pl: Plantilla = {
      ...plantillaPrueba(),
      html: () => `<img src="/fotos/casa-tomas/no-existe.jpg"><p data-campo="titular" style="margin:300px 72px">Hola</p>`,
    };
    const r = await renderizar({ marca: "casa-tomas", plantilla: "x", formato: "post", titular: "Hola" }, pl);
    expect(r.fallosCarga.join("\n")).toMatch(/no-existe\.jpg/);
  }, LENTO);
});
