// @vitest-environment node
//
// Plantillas v2 (ct-*/tz-* con «papel», 08/11/2026), con Chromium de verdad:
//  - cada plantilla v2, en post y story, sin errores ni avisos de maquetación,
//    con textos normales y con textos al límite de caracteres;
//  - más largos que el límite, el motor da error que nombra el campo;
//  - enmarcadas: la foto de la carta (1200×900) entera y sin ampliar;
//  - carruseles montados por papel (portada → platos → cierre), como hace
//    montar_pieza: Casa Tomás con fotos de la carta, Casa Tomás con fotos
//    verticales buenas y Touza.
//
// Fotos: instagram-studio/propuesta/marca-base/assets/local (las del dueño);
// si no están, sintéticas. Se SALTA sin el Chromium de Playwright.
// Con INSTAGRAM_CAPTURAS_V2=<carpeta> guarda los JPEG y una hoja de contacto.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "@playwright/test";
import sharp from "sharp";
import { IDS_CT_ESTILOS } from "../plantillas/ct-estilos/index.js";
import {
  CODIGO_COMPROBAR_MAQUETACION,
  CODIGO_ESPERAR_RECURSOS,
  FORMATOS,
  PLANTILLAS,
  baseRecursosPanel,
  construirDocumento,
  cubreFormato,
  encajeDe,
  esClasica,
  plantillaPara,
  validarPieza,
  type DatosPieza,
  type Foto,
  type FormatoId,
  type MarcaId,
  type PapelPlantilla,
} from "..";

const LENTO = 180_000;
const PANEL = path.resolve(process.cwd(), "public");
const CAPTURAS = process.env.INSTAGRAM_CAPTURAS_V2;

const LOCAL = [
  process.env.INSTAGRAM_MARCA_BASE_FOTOS,
  path.resolve(process.cwd(), "..", "instagram-studio", "propuesta", "marca-base", "assets", "local"),
  path.resolve(process.cwd(), "..", "..", "instagram-studio", "propuesta", "marca-base", "assets", "local"),
]
  .filter((x): x is string => !!x)
  .find((d) => fs.existsSync(path.join(d, "chuleton.jpg")));

let chromiumInstalado = false;
try {
  chromiumInstalado = fs.existsSync(chromium.executablePath());
} catch {
  chromiumInstalado = false;
}
if (!chromiumInstalado) console.warn("[instagram editorial.render.test] SE SALTA: no está el Chromium de Playwright");

// Las de «anuncio» (story del jueves de tapas) tienen su propia prueba (tapas.render.test.ts).
// «Solo foto» (sin texto) tiene su propia prueba: soloFoto.render.test.ts.
// Los estilos de las stories de ahora (ct-estilos), en estilos.render.test.ts.
const V2 = PLANTILLAS.filter((p) => !esClasica(p) && p.papel && p.papel !== "anuncio" && !p.sinTexto && p.id !== "tz-tipografica" && !IDS_CT_ESTILOS.includes(p.id));

// ── Fotos ────────────────────────────────────────────────────────────────────
interface FuenteFoto {
  id: string;
  marca: MarcaId;
  fichero: string;
  /** "carta": recortada a 4:3 y bajada a 1200×900 calidad 75 (como el bucket «platos»). */
  carta?: boolean;
}
const FUENTES: FuenteFoto[] = [
  ...["chuleton", "gambas", "arroz", "postre-nudo", "ostras", "tartar-atun"].flatMap((n) => [
    { id: `drive:${n}`, marca: "casa-tomas" as const, fichero: `${n}.jpg` },
    { id: `carta:${n}`, marca: "casa-tomas" as const, fichero: `${n}.jpg`, carta: true },
  ]),
  ...["touza-barra.jpg", "web-touza-5.webp", "web-touza-7.webp", "web-touza-8-1.webp"].flatMap((f) => {
    const n = f.replace(/\..*$/, "");
    return [
      { id: `drive:${n}`, marca: "touza" as const, fichero: f },
      { id: `carta:${n}`, marca: "touza" as const, fichero: f, carta: true },
    ];
  }),
];

async function bytesFoto(f: FuenteFoto): Promise<{ buf: Buffer; ancho: number; alto: number }> {
  const origen = LOCAL ? path.join(LOCAL, f.fichero) : null;
  const base =
    origen && fs.existsSync(origen)
      ? sharp(origen)
      : sharp({ create: { width: 1536, height: 2048, channels: 3, background: f.marca === "touza" ? "#1c140c" : "#6b4a2a" } });
  const buf = f.carta
    ? await base.resize(1200, 900, { fit: "cover", position: "attention" }).jpeg({ quality: 75 }).toBuffer()
    : await base.jpeg({ quality: 88 }).toBuffer();
  const m = await sharp(buf).metadata();
  return { buf, ancho: m.width!, alto: m.height! };
}

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

// ── Textos ───────────────────────────────────────────────────────────────────
type Textos = Partial<Record<"antetitulo" | "titular" | "cita" | "cta" | "pie", string>>;

/** Textos normales por papel y marca (solo se usan los campos que admite la plantilla). */
const NORMALES: Record<MarcaId, Partial<Record<PapelPlantilla, Textos>>> = {
  "casa-tomas": {
    portada: { antetitulo: "Nuevo", titular: "Zamburiñas con tuétano", cita: "El sabor del mar y la tierra, en un plato del norte.", cta: "Reservar mesa" },
    plato: { antetitulo: "Para compartir", titular: "Gambas a la plancha", cita: "Con sal gorda y limón" },
    cierre: { cita: "Nunca é longo o camiño que conduce á casa dun amigo.", cta: "Reservar mesa" },
    tipografica: { antetitulo: "Esta semana", titular: "Vuelve el cocido gallego" },
  },
  touza: {
    portada: { antetitulo: "Cocktail bar", titular: "Alquimia en cada copa", cita: "Cócteles de autor con raíces gallegas." },
    plato: { antetitulo: "Cóctel de autor", titular: "Clover Club", cita: "Gin, frambuesa, vermut seco, limón y clara" },
    cierre: { antetitulo: "Cócteles de autor", cita: "Donde la alquimia de los cócteles se encuentra con la excelencia.", cta: "Ver carta" },
    tipografica: { antetitulo: "Jueves a sábado", cita: "Raíces gallegas, alma mediterránea." },
  },
};

/** Texto de n caracteres con palabras reales (el titular, de 6 palabras). */
function largo(base: string, n: number): string {
  let t = base;
  while ([...t].length < n) t = `${t} ${base}`;
  return [...t].slice(0, n).join("").trimEnd();
}
const PALABRAS_TITULAR = ["Rodaballo", "salvaje", "con", "ajada", "gallega", "tradicional", "anticonstitucionalmente"];
function titularDe(n: number): string {
  // 6 palabras que sumen como mucho n caracteres.
  const ws = PALABRAS_TITULAR.slice(0, 6);
  let t = ws.join(" ");
  while ([...t].length < n - 1) {
    const i = ws.findIndex((w) => w.length < 14);
    if (i < 0) break;
    ws[i] = `${ws[i]}a`;
    t = ws.join(" ");
  }
  return [...t].slice(0, n).join("").trim();
}

function textosLargos(id: string): Textos {
  const p = PLANTILLAS.find((x) => x.id === id)!;
  const l = p.limites ?? {};
  const t: Textos = {};
  if (p.admitidos.includes("antetitulo") && l.antetitulo) t.antetitulo = largo("Cocina gallega de lonja", l.antetitulo);
  if (l.titular) t.titular = titularDe(l.titular);
  if (p.admitidos.includes("cita") && l.cita) t.cita = largo("con patatas panaderas pimientos de Padrón y aceite de oliva", l.cita);
  // Botón y pie: en la portada van juntos en una línea; se prueban al límite cada uno.
  if (p.admitidos.includes("cta") && l.cta) t.cta = largo("Ver la carta completa", l.cta);
  if (l.pie) t.pie = largo(p.marca === "touza" ? "@touzabar Crevillent" : "@casatomascrevillent Crevillent", l.pie);
  return t;
}

function soloAdmitidos(id: string, t: Textos): Textos {
  const p = PLANTILLAS.find((x) => x.id === id)!;
  const r: Textos = {};
  for (const [k, v] of Object.entries(t)) if (v && (k === "titular" || p.admitidos.includes(k as never))) r[k as keyof Textos] = v;
  // titular opcional sin cita: el titular hace falta.
  if (!r.titular && !r.cita) r.titular = "Te esperamos";
  return r;
}

// ── Pruebas ──────────────────────────────────────────────────────────────────
describe("plantillas v2: contrato", () => {
  it("cada marca tiene portada, plato y cierre a sangre y enmarcados, en post y story, y una tipográfica", () => {
    for (const marca of ["casa-tomas", "touza"] as const) {
      for (const formato of ["post", "story"] as const) {
        for (const papel of ["portada", "plato", "cierre"] as const) {
          expect(plantillaPara(marca, formato, papel, "sangre")?.id, `${marca} ${formato} ${papel} sangre`).toBeDefined();
          expect(plantillaPara(marca, formato, papel, "marco")?.id, `${marca} ${formato} ${papel} marco`).toBeDefined();
        }
        expect(plantillaPara(marca, formato, "tipografica")).toBeDefined();
      }
    }
  });
  it("plato no lleva botón ni logo; el botón solo en portada y cierre", () => {
    for (const p of V2) {
      if (p.papel === "plato") expect(p.admitidos).not.toContain("cta");
    }
  });
});

describe.skipIf(!chromiumInstalado)("plantillas v2: render real", () => {
  let navegador: Browser;
  let srv: Awaited<ReturnType<typeof servidor>>;
  const catalogo: Foto[] = [];

  beforeAll(async () => {
    const mapa = new Map<string, Buffer>();
    for (const f of FUENTES) {
      const { buf, ancho, alto } = await bytesFoto(f);
      const ruta = `fotos/${f.marca}/${f.id.replace(":", "-")}.jpg`;
      mapa.set(ruta, buf);
      catalogo.push({ id: f.id, marca: f.marca, ruta, ancho, alto, tipo: "plato", aptaPost: !f.carta, aptaStory: !f.carta, descripcion: "" });
    }
    srv = await servidor(mapa);
    navegador = await chromium.launch();
    if (CAPTURAS) fs.mkdirSync(CAPTURAS, { recursive: true });
  }, LENTO);
  afterAll(async () => {
    await navegador?.close();
    await srv?.cerrar();
  }, LENTO);

  async function renderizar(datos: DatosPieza) {
    const { ancho, alto } = FORMATOS[datos.formato];
    const html = construirDocumento(datos, { baseRecursos: baseRecursosPanel(srv.url), baseFotos: srv.url, fotos: catalogo });
    const page = await navegador.newPage({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1 });
    try {
      await page.goto(srv.pagina(html), { waitUntil: "load" });
      const fallos = (await page.evaluate(CODIGO_ESPERAR_RECURSOS)) as string[];
      const { errores, avisos } = (await page.evaluate(CODIGO_COMPROBAR_MAQUETACION)) as { errores: string[]; avisos: string[] };
      const foto = (await page.evaluate(`(() => {
        const img = document.querySelector("img[class$='__foto-marco']");
        if (!img) return null;
        const r = img.getBoundingClientRect();
        return { w: r.width, h: r.height, nw: img.naturalWidth, nh: img.naturalHeight };
      })()`)) as { w: number; h: number; nw: number; nh: number } | null;
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: ancho, height: alto } });
      return { fallos, errores, avisos, foto, png };
    } finally {
      await page.close();
    }
  }

  function pieza(id: string, formato: FormatoId, foto: string | undefined, textos: Textos) {
    const p = PLANTILLAS.find((x) => x.id === id)!;
    const v = validarPieza({ marca: p.marca, plantilla: id, formato, ...(p.admitidos.includes("foto") ? { foto } : {}), ...soloAdmitidos(id, textos) }, { fotos: catalogo });
    expect(v.ok ? [] : v.problemas, `${id} ${formato}`).toEqual([]);
    return v.datos!;
  }

  const fotoPara = (id: string) => {
    const p = PLANTILLAS.find((x) => x.id === id)!;
    if (!p.admitidos.includes("foto")) return undefined;
    const n = p.marca === "touza" ? "web-touza-5" : "chuleton";
    return encajeDe(p) === "marco" ? `carta:${n}` : `drive:${n}`;
  };

  for (const p of V2) {
    for (const formato of ["post", "story"] as const) {
      it(`${p.id} ${formato}: textos normales y al límite sin errores; más largos, error con el campo`, async () => {
        const normal = await renderizar(pieza(p.id, formato, fotoPara(p.id), NORMALES[p.marca][p.papel!] ?? {}));
        expect(normal.fallos).toEqual([]);
        expect(normal.errores).toEqual([]);
        expect(normal.avisos).toEqual([]);
        if (normal.foto) {
          expect([normal.foto.nw, normal.foto.nh]).toEqual([1200, 900]);
          expect(normal.foto.w).toBeLessThanOrEqual(1200);
          expect(Math.abs(normal.foto.w / normal.foto.h - 4 / 3)).toBeLessThan(0.01);
        }
        const limite = await renderizar(pieza(p.id, formato, fotoPara(p.id), textosLargos(p.id)));
        expect(limite.errores, "al límite").toEqual([]);

        const datos = pieza(p.id, formato, fotoPara(p.id), textosLargos(p.id));
        const roto = await renderizar({
          ...datos,
          titular: "Anticonstitucionalmente Desproporcionadamente Electroencefalografistas Otorrinolaringológicamente Esternocleidomastoideo",
          ...(datos.cita !== undefined ? { cita: `${datos.cita} ${datos.cita} ${datos.cita} ${datos.cita}` } : {}),
        });
        const todo = roto.errores.join("\n");
        expect(todo).toMatch(/«titular»/);
        if (datos.cita !== undefined) expect(todo).toMatch(/«cita»/);
      }, LENTO);
    }
  }

  // Carruseles montados por papel, como montar_pieza.
  const CARRUSELES: Array<{ nombre: string; marca: MarcaId; fotos: string[]; textos: Textos[] }> = [
    {
      nombre: "ct-carta",
      marca: "casa-tomas",
      fotos: ["carta:chuleton", "carta:gambas", "carta:arroz", "carta:postre-nudo"],
      textos: [
        { antetitulo: "De nuestra carta", titular: "Lo que nunca falta", cita: "Cuatro platos que nos pedís cada semana." },
        { antetitulo: "Para compartir", titular: "Gambas a la plancha" },
        { titular: "Arroz caldoso", cita: "Con bogavante, para dos" },
        { cita: "Nunca é longo o camiño que conduce á casa dun amigo.", cta: "Reservar mesa" },
      ],
    },
    {
      nombre: "ct-vertical",
      marca: "casa-tomas",
      fotos: ["drive:chuleton", "drive:ostras", "drive:tartar-atun", "drive:arroz"],
      textos: [
        { antetitulo: "Esta semana", titular: "Del mar y de la brasa", cita: "Lo que ha entrado hoy en cocina." },
        { antetitulo: "Recién abiertas", titular: "Ostras", cita: "Sobre hielo, con limón" },
        { titular: "Tartar de atún rojo" },
        { cita: "Nunca é longo o camiño que conduce á casa dun amigo.", cta: "Reservar mesa" },
      ],
    },
    {
      nombre: "tz-vertical",
      marca: "touza",
      fotos: ["drive:touza-barra", "drive:web-touza-5", "drive:web-touza-7", "drive:web-touza-8-1"],
      textos: [
        { antetitulo: "Cocktail bar", titular: "La noche empieza aquí", cita: "Cócteles de autor, de jueves a sábado." },
        { antetitulo: "Cóctel de autor", titular: "Clover Club", cita: "Gin, frambuesa, vermut seco, limón y clara" },
        { antetitulo: "De la casa", titular: "Highball de romero" },
        { antetitulo: "Cócteles de autor", cita: "Donde la alquimia de los cócteles se encuentra con la excelencia.", cta: "Ver carta", pie: "Jueves a sábado · 20:00 – 02:00" },
      ],
    },
    {
      nombre: "tz-carta",
      marca: "touza",
      fotos: ["carta:web-touza-7", "carta:web-touza-5", "carta:web-touza-8-1"],
      textos: [
        { antetitulo: "Nueva carta", titular: "Tres para empezar" },
        { antetitulo: "Cóctel de autor", titular: "Clover Club", cita: "Gin, frambuesa, vermut seco, limón y clara" },
        { cita: "Raíces gallegas, alma mediterránea.", cta: "Ver carta" },
      ],
    },
  ];

  const capturas: Array<{ fila: string; png: Buffer; formato: FormatoId }> = [];

  for (const c of CARRUSELES) {
    it(`carrusel ${c.nombre}: portada → platos → cierre sin errores`, async () => {
      for (let i = 0; i < c.fotos.length; i++) {
        const papel: PapelPlantilla = i === 0 ? "portada" : i === c.fotos.length - 1 ? "cierre" : "plato";
        const foto = catalogo.find((f) => f.id === c.fotos[i])!;
        const encaje = cubreFormato(foto, "post") ? "sangre" : "marco";
        const p = plantillaPara(c.marca, "post", papel, encaje)!;
        const r = await renderizar(pieza(p.id, "post", foto.id, c.textos[i]));
        expect(r.errores, `${c.nombre} ${i + 1} ${p.id}`).toEqual([]);
        capturas.push({ fila: c.nombre, png: r.png, formato: "post" });
        if (CAPTURAS) fs.writeFileSync(path.join(CAPTURAS, `${c.nombre}-${i + 1}-${p.id}.jpg`), await jpg(r.png));
      }
    }, LENTO);
  }

  it("sueltas: frases, cierres de marca y stories", async () => {
    const sueltas: Array<[string, FormatoId, string | undefined, Textos]> = [
      ["ct-frase", "post", undefined, { antetitulo: "Esta semana", titular: "Vuelve el cocido gallego" }],
      ["ct-frase", "post", undefined, { antetitulo: "Lo que decimos en casa", cita: "Que cada visita se sienta como volver a casa." }],
      ["ct-cierre-marca", "post", undefined, { cita: "«Nunca é longo o camiño que conduce á casa dun amigo.»" }],
      ["tz-frase", "post", undefined, { antetitulo: "Jueves a sábado", cita: "Touza no es solo un bar; es una declaración de intenciones." }],
      ["tz-cierre-marca", "post", undefined, { antetitulo: "Est. 2023 · Crevillent", cita: "Raíces gallegas, alma mediterránea.", cta: "Ver carta" }],
      ["ct-portada", "story", "drive:gambas", { antetitulo: "Nuevo", titular: "Gambas rojas de Santa Pola", cita: "Solo este fin de semana." }],
      ["ct-plato-marco", "story", "carta:arroz", { antetitulo: "De nuestra carta", titular: "Arroz caldoso", cita: "Con bogavante, para dos" }],
      ["ct-cierre-marca", "story", undefined, { cita: "Nunca é longo o camiño que conduce á casa dun amigo.", cta: "Reservar mesa" }],
      ["tz-portada", "story", "drive:web-touza-7", { antetitulo: "Cocktail bar", titular: "Cada cóctel cuenta una historia" }],
      ["tz-cierre", "story", "drive:touza-barra", { antetitulo: "Cocktail bar", cita: "Raíces gallegas, alma mediterránea.", cta: "Ver carta", pie: "Jueves a sábado · 20:00 – 02:00" }],
    ];
    for (const [id, formato, foto, textos] of sueltas) {
      const r = await renderizar(pieza(id, formato, foto, textos));
      expect(r.errores, `${id} ${formato}`).toEqual([]);
      capturas.push({ fila: formato === "story" ? "stories" : "sueltas", png: r.png, formato });
      if (CAPTURAS) fs.writeFileSync(path.join(CAPTURAS, `suelta-${id}-${formato}-${capturas.length}.jpg`), await jpg(r.png));
    }
    if (CAPTURAS) await hojaDeContacto(capturas, path.join(CAPTURAS, "hoja-de-contacto.jpg"));
  }, LENTO);
});

const jpg = (png: Buffer) => sharp(png).jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();

/** Una fila por carrusel (y otra para sueltas y stories), en miniatura y con su nombre. */
async function hojaDeContacto(capturas: Array<{ fila: string; png: Buffer; formato: FormatoId }>, destino: string): Promise<void> {
  const ALTO = 420;
  const HUECO = 24;
  const ROTULO = 44;
  const filas = [...new Set(capturas.map((c) => c.fila))];
  const anchoDe = (f: FormatoId) => Math.round((ALTO * FORMATOS[f].ancho) / FORMATOS[f].alto);
  const anchoFila = (fila: string) => capturas.filter((c) => c.fila === fila).reduce((s, c) => s + anchoDe(c.formato) + HUECO, HUECO);
  const ancho = Math.max(...filas.map(anchoFila));
  const alto = filas.length * (ALTO + ROTULO + HUECO) + HUECO;
  const capas: sharp.OverlayOptions[] = [];
  let y = HUECO;
  for (const fila of filas) {
    capas.push({
      input: Buffer.from(`<svg width="${ancho}" height="${ROTULO}"><text x="${HUECO}" y="30" font-family="Arial" font-size="24" fill="#333">${fila}</text></svg>`),
      left: 0,
      top: y,
    });
    let x = HUECO;
    for (const c of capturas.filter((k) => k.fila === fila)) {
      const w = anchoDe(c.formato);
      capas.push({ input: await sharp(c.png).resize(w, ALTO).toBuffer(), left: x, top: y + ROTULO });
      x += w + HUECO;
    }
    y += ALTO + ROTULO + HUECO;
  }
  await sharp({ create: { width: ancho, height: alto, channels: 3, background: "#e9e6e1" } })
    .composite(capas)
    .jpeg({ quality: 88 })
    .toFile(destino);
}
