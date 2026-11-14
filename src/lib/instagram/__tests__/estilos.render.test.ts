// @vitest-environment node
//
// Estilos de las stories de ahora (plantillas/ct-estilos, 12/11/2026) con
// Chromium de verdad: cada plantilla en sus formatos con textos normales y al
// límite sin errores ni avisos del motor; más largos, error con el campo; el
// hilo acaba donde se le pide; la reseña ajusta el cuerpo a su largo; la
// portada de destacada pone el icono que toca.
//
// Fotos: instagram-studio/propuesta/marca-base/assets/local (platos reales);
// si no están, sintéticas. Se SALTA sin el Chromium de Playwright. Con
// INSTAGRAM_CAPTURAS_ESTILOS=<carpeta> guarda los JPEG de muestra.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "@playwright/test";
import sharp from "sharp";
import { CODIGO_COMPROBAR_MAQUETACION, CODIGO_ESPERAR_RECURSOS, FORMATOS, TAPAS_EJEMPLO, baseRecursosPanel, construirDocumento, obtenerPlantilla, validarPieza, type DatosPieza, type FormatoId, type Foto, type Plantilla } from "..";
import { IDS_CT_ESTILOS, MAX_RESENA, carasExtraEstilos, cuerpoResena, htmlRotuloHilo, iconoPara, yLlegada } from "../plantillas/ct-estilos/index.js";

const LENTO = 240_000;
const PANEL = path.resolve(process.cwd(), "public");
const CAPTURAS = process.env.INSTAGRAM_CAPTURAS_ESTILOS;
const LOCAL = [
  path.resolve(process.cwd(), "..", "instagram-studio", "propuesta", "marca-base", "assets", "local"),
  path.resolve(process.cwd(), "..", "..", "instagram-studio", "propuesta", "marca-base", "assets", "local"),
].find((d) => fs.existsSync(d));

let chromiumInstalado = false;
try {
  chromiumInstalado = fs.existsSync(chromium.executablePath());
} catch {
  chromiumInstalado = false;
}
if (!chromiumInstalado) console.warn("[instagram estilos.render.test] SE SALTA: no está el Chromium de Playwright");

/** Fotos de prueba (id → fichero de assets/local). «carta:*» = recortada a 1200×900, como las de la carta. */
const FICHEROS = [
  "ostras.jpg",
  "gambas.jpg",
  "chuleton.jpg",
  "steak-tartar.jpg",
  "tartar-atun.jpg",
  "arroz.jpg",
  "postre-nudo.jpg",
  "alcachofas.jpg",
  "cecina.jpg",
  "mesa-copas.jpg",
  "salazones.jpg",
  "vitrina-gallega.jpg",
  "web-touza-7.webp",
  "sala.jpg",
];

const RESENA_CORTA = "Comida excelente y un trato de diez. Volveremos pronto.";
const RESENA_MEDIA =
  "Sin duda uno de los mejores restaurantes de la provincia. Trato exquisito por parte de todo el personal y una gran variedad de productos frescos. Además, una gran bodega. Imprescindible.";
const RESENA_LARGA = (
  "Fuimos esta semana después de tanto tiempo queriendo ir. Nada más entrar ya notas que el ambiente es diferente, con una sala cuidada y un servicio atento sin agobiar. " +
  "El producto es espectacular: el marisco fresquísimo, la carne en su punto y los postres caseros. Nos aconsejaron muy bien con el vino. Un trato excepcional de principio a fin. " +
  "Repetiremos seguro, y con más gente. Gracias a todo el equipo."
).slice(0, MAX_RESENA);

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

type Textos = Partial<Record<"antetitulo" | "titular" | "cita" | "pie", string>>;

/** Caso normal por plantilla: foto y textos reales (los de la captura de cada estilo). */
const NORMALES: Record<string, Array<{ nombre: string; foto?: string; formatos?: FormatoId[]; textos: Textos }>> = {
  "ct-rotulo-hilo": [
    { nombre: "ostras", foto: "drive:ostras", textos: { titular: "Ostras Gillardeau" } },
    { nombre: "gambas", foto: "drive:gambas", textos: { titular: "El mejor producto fresco", cita: "Gamba roja de Santa Pola" } },
  ],
  "ct-rotulo-recuadro": [{ nombre: "steak", foto: "drive:steak-tartar", textos: { titular: "Steak tartar", cita: "Cortado a cuchillo y aliñado en la mesa" } }],
  "ct-rotulo-titular": [
    { nombre: "tartar", foto: "drive:tartar-atun", textos: { titular: "Tartar de atún", cita: "con aguacate y sésamo" } },
    { nombre: "arroz", foto: "drive:arroz", textos: { titular: "Ensaladilla", cita: "de marisco" } },
  ],
  "ct-rotulo-manuscrita": [{ nombre: "postre", foto: "drive:postre-nudo", textos: { titular: "Tarta de queso", cita: "Con helado" } }],
  "ct-resena": [
    { nombre: "media", textos: { antetitulo: "Gonzalo M.", cita: RESENA_MEDIA } },
    { nombre: "corta", textos: { antetitulo: "María M.", cita: RESENA_CORTA } },
    { nombre: "larga", textos: { antetitulo: "Andrés F.", cita: RESENA_LARGA } },
  ],
  "ct-resena-foto": [{ nombre: "chuleton", foto: "carta:chuleton", textos: { antetitulo: "Gonzalo M.", cita: RESENA_MEDIA } }],
  "ct-vosotros-celebracion": [{ nombre: "copas", foto: "drive:mesa-copas", textos: { titular: "Vicente Muñoz y Vicente Menargues", cita: "celebrando su 75 cumpleaños" } }],
  "ct-vosotros-gracias": [{ nombre: "cecina", foto: "drive:cecina", textos: { titular: "Gracias por visitarnos", pie: "@tu.usuario" } }],
  "ct-reserva-mesa": [{ nombre: "salazones", foto: "drive:salazones", textos: { titular: "Reserva mesa", cita: "en tu restaurante favorito" } }],
  "ct-touza-descubre": [{ nombre: "coctel", foto: "drive:web-touza-7", textos: { titular: "Descubre Touza", pie: "Cocktail bar · Crevillent" } }],
  "ct-tapas-poster": [{ nombre: "alcachofas", foto: "drive:alcachofas", textos: { antetitulo: "Jueves de", titular: "Tapas y cóctel", pie: "¡Te esperamos!" } }],
  "ct-icono-destacada": ["Opináis", "Jueves de tapas", "Platos", "Vosotros", "Touza", "Vinos"].map((t) => ({ nombre: t, textos: { titular: t } })),
};

/** Texto de n caracteres con palabras reales. */
function largo(base: string, n: number): string {
  let t = base;
  while ([...t].length < n) t = `${t} ${base}`;
  return [...t].slice(0, n).join("").trimEnd();
}

describe("ct-estilos: contrato", () => {
  it("todas registradas, con caras y sin pisar plantillaPara", () => {
    for (const id of IDS_CT_ESTILOS) expect(obtenerPlantilla(id), id).toBeDefined();
    expect(carasExtraEstilos("ct-rotulo-hilo")).toBe(2);
    expect(carasExtraEstilos("ct-portada")).toBe(0);
  });
  it("iconoPara reconoce las cinco destacadas y deja el resto al medallón", () => {
    expect(["Opináis", "Jueves de tapas", "Platos 🍽", "Vosotros", "TOUZA", "Vinos"].map(iconoPara)).toEqual(["opinais", "tapas", "platos", "vosotros", "touza", null]);
  });
  it("la reseña: más larga, letra más pequeña; nunca por debajo de 24 px", () => {
    const corta = cuerpoResena(RESENA_CORTA, true).cuerpo;
    const larga = cuerpoResena(RESENA_LARGA, true).cuerpo;
    expect(corta).toBeGreaterThan(larga);
    expect(larga).toBeGreaterThanOrEqual(24);
    expect(cuerpoResena(RESENA_LARGA, false).cabe).toBe(true);
  });
  it("el punto de llegada del hilo se acota", () => {
    expect(yLlegada(true)).toBe(960);
    expect(yLlegada(true, 5)).toBe(Math.round(1920 * 0.32));
    expect(yLlegada(false, 99)).toBe(Math.round(1350 * 0.8));
  });
});

describe.skipIf(!chromiumInstalado)("ct-estilos: render real", () => {
  let navegador: Browser;
  let srv: Awaited<ReturnType<typeof servidor>>;
  const catalogo: Foto[] = [];

  beforeAll(async () => {
    const mapa = new Map<string, Buffer>();
    for (const f of FICHEROS) {
      const n = f.replace(/\..*$/, "");
      const origen = LOCAL ? path.join(LOCAL, f) : null;
      const base = () => (origen && fs.existsSync(origen) ? sharp(origen) : sharp({ create: { width: 1536, height: 2048, channels: 3, background: "#6b4a2a" } }));
      for (const carta of [false, true]) {
        const buf = carta ? await base().resize(1200, 900, { fit: "cover", position: "attention" }).jpeg({ quality: 80 }).toBuffer() : await base().jpeg({ quality: 90 }).toBuffer();
        const m = await sharp(buf).metadata();
        const id = `${carta ? "carta" : "drive"}:${n}`;
        const ruta = `fotos/casa-tomas/${id.replace(":", "-")}.jpg`;
        mapa.set(ruta, buf);
        catalogo.push({ id, marca: "casa-tomas", ruta, ancho: m.width!, alto: m.height!, tipo: null, aptaPost: !carta, aptaStory: !carta, descripcion: "" });
      }
    }
    srv = await servidor(mapa);
    navegador = await chromium.launch();
    if (CAPTURAS) fs.mkdirSync(CAPTURAS, { recursive: true });
  }, LENTO);
  afterAll(async () => {
    await navegador?.close();
    await srv?.cerrar();
  }, LENTO);

  function pieza(id: string, formato: FormatoId, foto: string | undefined, textos: Textos): DatosPieza {
    const p = obtenerPlantilla(id)!;
    const v = validarPieza({ marca: "casa-tomas", plantilla: id, formato, ...(p.admitidos.includes("foto") ? { foto } : {}), ...textos }, { fotos: catalogo });
    expect(v.ok ? [] : v.problemas, `${id} ${formato}`).toEqual([]);
    return v.datos!;
  }

  async function renderizar(datos: DatosPieza, plantilla?: Plantilla) {
    const { ancho, alto } = FORMATOS[datos.formato];
    const html = construirDocumento(datos, { baseRecursos: baseRecursosPanel(srv.url), baseFotos: srv.url, fotos: catalogo, plantilla });
    const page = await navegador.newPage({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1 });
    try {
      await page.goto(srv.pagina(html), { waitUntil: "load" });
      const fallos = (await page.evaluate(CODIGO_ESPERAR_RECURSOS)) as string[];
      const { errores, avisos } = (await page.evaluate(CODIGO_COMPROBAR_MAQUETACION)) as { errores: string[]; avisos: string[] };
      const caras = (await page.evaluate("document.fonts.size")) as number;
      const hilo = (await page.evaluate(`(() => { const h = document.querySelector(".ctsh__hilo"); return h ? h.getBoundingClientRect().bottom : null; })()`)) as number | null;
      const cuerpo = (await page.evaluate(`(() => { const t = document.querySelector(".ctsn__texto"); return t ? parseFloat(getComputedStyle(t).fontSize) : null; })()`)) as number | null;
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: ancho, height: alto } });
      return { fallos, errores, avisos, caras, hilo, cuerpo, png };
    } finally {
      await page.close();
    }
  }

  const guardar = async (nombre: string, png: Buffer) => {
    if (CAPTURAS) await sharp(png).jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true }).toFile(path.join(CAPTURAS, `${nombre}.jpg`));
  };

  for (const id of IDS_CT_ESTILOS) {
    it(`${id}: casos reales sin errores; al límite sin errores; más largo, error con el campo`, async () => {
      const p = obtenerPlantilla(id)!;
      for (const formato of p.formatos) {
        for (const caso of NORMALES[id]) {
          const r = await renderizar(pieza(id, formato, caso.foto, caso.textos));
          expect(r.fallos, `${id} ${formato} ${caso.nombre}`).toEqual([]);
          expect(r.errores, `${id} ${formato} ${caso.nombre}`).toEqual([]);
          expect(r.avisos, `${id} ${formato} ${caso.nombre}`).toEqual([]);
          expect(r.caras).toBe(2 + carasExtraEstilos(id));
          await guardar(`${id}-${formato}-${caso.nombre}`, r.png);
        }
        // Al límite de caracteres de cada campo.
        const base = NORMALES[id][0];
        const l = p.limites ?? {};
        const limite: Textos = { ...base.textos };
        for (const c of ["antetitulo", "titular", "cita", "pie"] as const) {
          if (!l[c] || !(c in base.textos)) continue;
          if (c === "titular") limite.titular = largo(id === "ct-icono-destacada" ? "Jueves" : "Gamba roja", l[c]!).split(" ").slice(0, 6).join(" ");
          else if (c === "pie" && id === "ct-vosotros-gracias") limite.pie = `@${"a".repeat(l[c]! - 1)}`;
          else limite[c] = largo(c === "cita" && id.startsWith("ct-resena") ? RESENA_LARGA : "con salsa de tuétano", l[c]!);
        }
        const r = await renderizar(pieza(id, formato, base.foto, limite));
        expect(r.errores, `${id} ${formato} al límite`).toEqual([]);
        await guardar(`limite-${id}-${formato}`, r.png);
        // Más largo: error que nombra el campo.
        const datos = pieza(id, formato, base.foto, base.textos);
        const roto = await renderizar({
          ...datos,
          titular: "Anticonstitucionalmente Desproporcionadamente Electroencefalografistas Otorrinolaringológicamente",
          ...(datos.cita !== undefined ? { cita: `${datos.cita} `.repeat(id.startsWith("ct-resena") ? 12 : 8).trim() } : {}),
        });
        const todo = roto.errores.join("\n");
        expect(todo).toMatch(/«titular»/);
        if (datos.cita !== undefined) expect(todo).toMatch(/«cita»/);
      }
    }, LENTO);
  }

  it("el hilo acaba en el punto de llegada pedido", async () => {
    const hilo = obtenerPlantilla("ct-rotulo-hilo")!;
    for (const [formato, llegada] of [
      ["story", 40],
      ["story", 62],
      ["post", 70],
    ] as Array<[FormatoId, number]>) {
      const variante: Plantilla = { ...hilo, html: (d, c) => htmlRotuloHilo(d, c, { llegada }) };
      const r = await renderizar(pieza("ct-rotulo-hilo", formato, "drive:ostras", { titular: "Ostras Gillardeau" }), variante);
      expect(r.errores).toEqual([]);
      expect(Math.abs((r.hilo ?? 0) - yLlegada(formato === "story", llegada))).toBeLessThanOrEqual(1);
      await guardar(`ct-rotulo-hilo-${formato}-llegada-${llegada}`, r.png);
    }
  }, LENTO);

  it("la reseña ajusta el cuerpo: corta grande, larga pequeña y legible", async () => {
    const corta = await renderizar(pieza("ct-resena", "story", undefined, { antetitulo: "María M.", cita: RESENA_CORTA }));
    const larga = await renderizar(pieza("ct-resena", "story", undefined, { antetitulo: "Andrés F.", cita: RESENA_LARGA }));
    expect(corta.cuerpo!).toBeGreaterThan(larga.cuerpo!);
    expect(larga.cuerpo!).toBeGreaterThanOrEqual(24);
    expect(larga.errores).toEqual([]);
  }, LENTO);

  // Muestras de las de tapas que ya existían (estilo A), para la hoja comparativa.
  it.runIf(!!CAPTURAS)("muestras del jueves de tapas existentes", async () => {
    const lista = TAPAS_EJEMPLO.map((etiqueta) => ({ etiqueta }));
    for (const id of ["ct-tapas-clasica", "ct-tapas"]) {
      const datos = { marca: "casa-tomas", plantilla: id, formato: "story", foto: "drive:sala", titular: "Jueves", antetitulo: "De tapas", lista, ...(id === "ct-tapas" ? { cita: "13 de noviembre", pie: "Turnos 20:30 y 22:00" } : {}) };
      const v = validarPieza(datos, { fotos: catalogo });
      expect(v.ok ? [] : v.problemas).toEqual([]);
      const r = await renderizar(v.datos!);
      expect(r.errores).toEqual([]);
      await guardar(`${id}-story-sala`, r.png);
    }
  }, LENTO);
});
