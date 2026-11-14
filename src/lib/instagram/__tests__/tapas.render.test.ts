// @vitest-environment node
//
// Story del jueves de tapas (12/11/2026) con Chromium de verdad: las dos
// plantillas (ct-tapas y ct-tapas-clasica) con 4, 7 y 10 tapas, cortas y
// largas, sin desbordes ni nada fuera de la zona segura; la mejorada además
// dentro de la zona segura del sistema de marca (220/320/64).
//
// Fondo: instagram-studio/propuesta/marca-base/assets/local/mesa-copas.jpg (la
// sala con copas, como la foto de la story actual); si no está, sintética. Se
// SALTA sin el Chromium de Playwright. Con INSTAGRAM_CAPTURAS_TAPAS=<carpeta>
// guarda los JPEG (las dos con las 7 tapas de la captura y el resto de casos).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "@playwright/test";
import sharp from "sharp";
import { CODIGO_COMPROBAR_MAQUETACION, CODIGO_ESPERAR_RECURSOS, TAPAS_EJEMPLO, baseRecursosPanel, construirDocumento, validarPieza, type Foto } from "..";
import { piezaStoryTapas } from "../tapas";
import { ZONA_SEGURA_MARCA } from "../plantillas/ct-tapas/index.js";

const LENTO = 180_000;
const PANEL = path.resolve(process.cwd(), "public");
const CAPTURAS = process.env.INSTAGRAM_CAPTURAS_TAPAS;
const FOTO_LOCAL = [
  path.resolve(process.cwd(), "..", "instagram-studio", "propuesta", "marca-base", "assets", "local", "mesa-copas.jpg"),
  path.resolve(process.cwd(), "..", "..", "instagram-studio", "propuesta", "marca-base", "assets", "local", "mesa-copas.jpg"),
].find((f) => fs.existsSync(f));

let chromiumInstalado = false;
try {
  chromiumInstalado = fs.existsSync(chromium.executablePath());
} catch {
  chromiumInstalado = false;
}
if (!chromiumInstalado) console.warn("[instagram tapas.render.test] SE SALTA: no está el Chromium de Playwright");

const CUATRO = ["Gambón rebozado", "Croqueta de cecina", "Bravas de la casa", "Tarta de queso"];
const DIEZ = [
  ...TAPAS_EJEMPLO,
  "Pulpo a la gallega con cachelos y pimentón de la Vera",
  "Zamburiñas gratinadas con jamón ibérico",
  "Mini hamburguesa de vaca madurada con cebolla caramelizada",
];
// 10 tapas de ~45 caracteres: el máximo realista que entra a buen tamaño (más, problemasTapas avisa).
const LARGAS = Array.from({ length: 10 }, (_, i) => `Tapa ${i + 1} de la casa con salsa de setas y trufa`.slice(0, 46));

function servidor(foto: Buffer): Promise<{ url: string; pagina(html: string): string; cerrar(): Promise<void> }> {
  const paginas = new Map<string, string>();
  let n = 0;
  const s = http.createServer((req, res) => {
    const ruta = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const html = paginas.get(ruta);
    if (html !== undefined) return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    if (ruta === "/fotos/casa-tomas/sala.jpg") return void res.writeHead(200, { "content-type": "image/jpeg" }).end(foto);
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

describe.skipIf(!chromiumInstalado)("story del jueves de tapas: render real", () => {
  let navegador: Browser;
  let srv: Awaited<ReturnType<typeof servidor>>;
  let catalogo: Foto[] = [];

  beforeAll(async () => {
    const buf = FOTO_LOCAL
      ? await sharp(FOTO_LOCAL).jpeg({ quality: 88 }).toBuffer()
      : await sharp({ create: { width: 1500, height: 2000, channels: 3, background: "#5a4a3c" } }).jpeg().toBuffer();
    const m = await sharp(buf).metadata();
    catalogo = [{ id: "drive:sala", marca: "casa-tomas", ruta: "fotos/casa-tomas/sala.jpg", ancho: m.width!, alto: m.height!, tipo: null, aptaPost: true, aptaStory: true, descripcion: "" }];
    srv = await servidor(buf);
    navegador = await chromium.launch();
    if (CAPTURAS) fs.mkdirSync(CAPTURAS, { recursive: true });
  }, LENTO);
  afterAll(async () => {
    await navegador?.close();
    await srv?.cerrar();
  }, LENTO);

  async function renderizar(tapas: readonly string[], plantilla: "ct-tapas" | "ct-tapas-clasica", conTurnos = true) {
    const json = piezaStoryTapas({ dia: "2026-11-12", tapas, plantilla, foto: "drive:sala", turnos: conTurnos ? "20:30 y 22:00" : null });
    const v = validarPieza(json, { fotos: catalogo });
    expect(v.ok ? [] : v.problemas).toEqual([]);
    const html = construirDocumento(v.datos!, { baseRecursos: baseRecursosPanel(srv.url), baseFotos: srv.url, fotos: catalogo });
    const page = await navegador.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    try {
      await page.goto(srv.pagina(html), { waitUntil: "load" });
      const fallos = (await page.evaluate(CODIGO_ESPERAR_RECURSOS)) as string[];
      const { errores, avisos } = (await page.evaluate(CODIGO_COMPROBAR_MAQUETACION)) as { errores: string[]; avisos: string[] };
      // Cajas de todo lo que lleva texto (para la zona segura de la marca).
      const cajas = (await page.evaluate(`Array.from(document.querySelectorAll("[data-campo]")).map((el) => {
        const r = el.getBoundingClientRect();
        const rs = Array.from(el.querySelectorAll("li")).map((li) => li.getBoundingClientRect());
        const top = rs.length ? Math.min(...rs.map((x) => x.top)) : r.top;
        const bottom = rs.length ? Math.max(...rs.map((x) => x.bottom)) : r.bottom;
        return { campo: el.getAttribute("data-campo"), top, bottom, left: r.left, right: r.right, cuerpo: parseFloat(getComputedStyle(el.querySelector("li") || el).fontSize) };
      })`)) as Array<{ campo: string; top: number; bottom: number; left: number; right: number; cuerpo: number }>;
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1080, height: 1920 } });
      return { fallos, errores, avisos, cajas, png };
    } finally {
      await page.close();
    }
  }

  const casos: Array<[string, readonly string[]]> = [
    ["4", CUATRO],
    ["7", TAPAS_EJEMPLO],
    ["10", DIEZ],
    ["10-largas", LARGAS],
  ];
  for (const plantilla of ["ct-tapas", "ct-tapas-clasica"] as const) {
    for (const [nombre, tapas] of casos) {
      it(`${plantilla} con ${nombre} tapas: sin desbordes ni nada fuera de la zona segura`, async () => {
        const r = await renderizar(tapas, plantilla);
        expect(r.fallos).toEqual([]);
        expect(r.errores).toEqual([]);
        expect(r.avisos).toEqual([]);
        const lista = r.cajas.find((c) => c.campo === "lista")!;
        expect(lista).toBeDefined();
        // Legible: nunca por debajo de 28 px.
        expect(lista.cuerpo).toBeGreaterThanOrEqual(28);
        if (plantilla === "ct-tapas") {
          for (const c of r.cajas) {
            expect(c.top, `${c.campo} arriba`).toBeGreaterThanOrEqual(ZONA_SEGURA_MARCA.arriba);
            expect(c.bottom, `${c.campo} abajo`).toBeLessThanOrEqual(1920 - ZONA_SEGURA_MARCA.abajo + 1);
            expect(c.left, `${c.campo} izquierda`).toBeGreaterThanOrEqual(ZONA_SEGURA_MARCA.lados);
            expect(c.right, `${c.campo} derecha`).toBeLessThanOrEqual(1080 - ZONA_SEGURA_MARCA.lados);
          }
        }
        if (CAPTURAS) {
          const fichero = nombre === "7" ? `${plantilla}.jpg` : `${plantilla}-${nombre}-tapas.jpg`;
          await sharp(r.png).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toFile(path.join(CAPTURAS, fichero));
        }
      }, LENTO);
    }
  }

  it("con menos tapas, letra más grande", async () => {
    const cuatro = (await renderizar(CUATRO, "ct-tapas")).cajas.find((c) => c.campo === "lista")!;
    const diez = (await renderizar(DIEZ, "ct-tapas")).cajas.find((c) => c.campo === "lista")!;
    expect(cuatro.cuerpo).toBeGreaterThan(diez.cuerpo);
  }, LENTO);

  it("una tapa descomunal desborda y el motor lo dice (no se recorta en silencio)", async () => {
    const enorme = Array.from({ length: 10 }, () => "Tapa ".repeat(16).trim());
    const json = piezaStoryTapas({ dia: "2026-11-12", tapas: enorme.map((t, i) => `${t} ${i}`), plantilla: "ct-tapas", foto: "drive:sala" });
    const v = validarPieza(json, { fotos: catalogo });
    expect(v.ok).toBe(true);
    // Se fuerza más texto del permitido sin pasar por problemasTapas: 10 tapas de ~200 caracteres.
    const datos = { ...v.datos!, lista: enorme.map((t) => ({ etiqueta: `${t} ${t} ${t}` })) };
    const html = construirDocumento(datos, { baseRecursos: baseRecursosPanel(srv.url), baseFotos: srv.url, fotos: catalogo });
    const page = await navegador.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    try {
      await page.goto(srv.pagina(html), { waitUntil: "load" });
      await page.evaluate(CODIGO_ESPERAR_RECURSOS);
      const { errores } = (await page.evaluate(CODIGO_COMPROBAR_MAQUETACION)) as { errores: string[] };
      expect(errores.join("\n")).toMatch(/«lista» se desborda/);
    } finally {
      await page.close();
    }
  }, LENTO);
});
