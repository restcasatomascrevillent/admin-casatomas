/**
 * HTML de una pieza → JPEG para Instagram (portado de
 * instagram-studio/src/render/renderizar.ts).
 *
 *  1. Página con viewport = formato y deviceScaleFactor 1.
 *  2. Polyfill de `__name` (esbuild lo inyecta en el código que acaba en
 *     page.evaluate y en el navegador no existe).
 *  3. setContent + esperar a document.fonts y a que TODAS las imágenes
 *     (<img> y background-image) estén decodificadas. Fallos de red, fuentes
 *     o imágenes → ErrorRender «recursos» con la lista.
 *  4. Comprobaciones de maquetación del núcleo (CODIGO_COMPROBAR_MAQUETACION):
 *     sus avisos pasan a la respuesta; si hay errores → ErrorRender «maquetacion» (la función responde 422).
 *  5. Captura de `.lienzo` en PNG y JPEG con sharp: calidad 92, 4:4:4,
 *     mozjpeg, sRGB, ≤ 8 MB (si no cabe, baja la calidad y avisa).
 *
 * Los scripts que se evalúan en la página van como TEXTO: así no dependen de
 * cómo transpile Vercel este fichero.
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { Lanzador } from "./navegador.js";

export const MAX_JPEG_BYTES = 8 * 1024 * 1024;
export const CALIDAD_JPEG = 92;
const CALIDAD_JPEG_MINIMA = 70;

export class ErrorRender extends Error {
  readonly tipo: "recursos" | "maquetacion" | "tamano";
  readonly problemas: string[];
  constructor(tipo: ErrorRender["tipo"], problemas: string[], titulo: string) {
    super(`${titulo}: ${problemas.join(" · ")}`);
    this.name = "ErrorRender";
    this.tipo = tipo;
    this.problemas = problemas.length ? problemas : ["(sin detalle)"];
  }
}

export interface PeticionRender {
  html: string;
  ancho: number;
  alto: number;
  /**
   * Expresión JS (texto) de las comprobaciones de maquetación del núcleo
   * (CODIGO_COMPROBAR_MAQUETACION): devuelve `{ errores, avisos }` (o un
   * string[] de errores). También vale una función.
   */
  codigoComprobar: string;
  /** Expresión JS que espera fuentes e imágenes y devuelve string[] de fallos (por defecto, la propia). */
  codigoEsperar?: string;
  /** Color de fondo para aplanar transparencias (hex). */
  fondo?: string;
  /**
   * Fuentes y logos servidos por el panel (public/instagram): las peticiones a
   * `${origen}${prefijo}/…` se contestan desde `dir` (incluido en el bundle de
   * la función) sin salir a la red, y el documento se carga como
   * `${origen}/__pieza-instagram.html` para que las fuentes sean del MISMO
   * origen (las @font-face de otro origen exigen CORS).
   */
  recursosLocales?: RecursosLocales;
  timeoutMs?: number;
}

export interface ResultadoRender {
  jpg: Buffer;
  ancho: number;
  alto: number;
  calidad: number;
  avisos: string[];
  tiempos: { msArranque: number; msPagina: number; msCarga: number; msCaptura: number; msJpeg: number };
}

export type Renderizador = (p: PeticionRender) => Promise<ResultadoRender>;

export interface RecursosLocales {
  /** Origen del panel, p. ej. https://admin-casatomas.vercel.app */
  origen: string;
  /** Ruta URL de los recursos en el panel ("/instagram"). */
  prefijo: string;
  /** Carpeta en disco con esos ficheros (process.cwd()/public/instagram). */
  dir: string;
}

const RUTA_DOCUMENTO = "/__pieza-instagram.html";

/** Fichero de `dir` para una ruta URL bajo `prefijo` (null si no existe o se sale de `dir`). */
export function ficheroLocal(r: RecursosLocales, pathname: string): string | null {
  if (!pathname.startsWith(`${r.prefijo}/`)) return null;
  let relativa: string;
  try {
    relativa = decodeURIComponent(pathname.slice(r.prefijo.length + 1));
  } catch {
    return null;
  }
  const base = path.resolve(r.dir);
  const ruta = path.resolve(base, relativa);
  if (ruta !== base && !ruta.startsWith(base + path.sep)) return null;
  return existsSync(ruta) && statSync(ruta).isFile() ? ruta : null;
}

/** Carga el HTML en la página: con recursos locales, como documento del origen del panel. */
async function cargarDocumento(page: Page, p: PeticionRender, timeout: number): Promise<void> {
  const r = p.recursosLocales;
  if (!r) {
    await page.setContent(p.html, { waitUntil: "load", timeout });
    return;
  }
  const origen = r.origen.replace(/\/+$/, "");
  await page.route(`${origen}/**`, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === RUTA_DOCUMENTO) {
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: p.html });
      return;
    }
    const fichero = ficheroLocal(r, u.pathname);
    if (fichero) {
      await route.fulfill({ path: fichero, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
      return;
    }
    await route.continue();
  });
  await page.goto(`${origen}${RUTA_DOCUMENTO}`, { waitUntil: "load", timeout });
}

const POLYFILL_NAME = "globalThis.__name = globalThis.__name || ((f) => f);";

/** Espera fuentes e imágenes; devuelve la lista de fallos (texto). */
const CODIGO_ESPERAR_RECURSOS = `(async () => {
  const fallos = [];
  try { await document.fonts.ready; } catch (e) { fallos.push("Las fuentes no terminan de cargar"); }
  for (const f of document.fonts) {
    if (f.status === "error") fallos.push("La fuente «" + f.family + "» (" + f.weight + " " + f.style + ") no carga");
  }
  await Promise.all([...document.images].map(async (img) => {
    const src = img.currentSrc || img.src || "(sin src)";
    try {
      if (!img.complete) {
        await new Promise((ok, ko) => {
          img.addEventListener("load", () => ok(), { once: true });
          img.addEventListener("error", () => ko(new Error("carga")), { once: true });
        });
      }
      await img.decode();
      if (!img.naturalWidth) fallos.push("La imagen " + src + " no tiene tamaño (¿no ha cargado?)");
    } catch (e) {
      fallos.push("La imagen " + src + " no carga o no se puede decodificar");
    }
  }));
  const urls = new Set();
  for (const el of document.querySelectorAll("*")) {
    for (const pseudo of [null, "::before", "::after"]) {
      const bg = getComputedStyle(el, pseudo).backgroundImage;
      if (!bg || bg === "none") continue;
      for (const m of bg.matchAll(/url\\((["']?)(.*?)\\1\\)/g)) if (m[2] && !m[2].startsWith("data:")) urls.add(m[2]);
    }
  }
  await Promise.all([...urls].map(async (u) => {
    const im = new Image();
    im.src = u;
    try { await im.decode(); } catch (e) { fallos.push("La imagen de fondo " + u + " no carga o no se puede decodificar"); }
  }));
  return fallos;
})()`;

/**
 * Envuelve el código de comprobación del núcleo: admite una expresión o una
 * función, y un resultado `{ errores, avisos }` o un string[] (= errores).
 */
export function envolverComprobacion(codigo: string): string {
  return `(async () => {
  const __c = (${codigo});
  const __r = typeof __c === "function" ? await __c() : await __c;
  if (Array.isArray(__r)) return { errores: __r.map(String), avisos: [] };
  const e = __r && Array.isArray(__r.errores) ? __r.errores.map(String) : [];
  const a = __r && Array.isArray(__r.avisos) ? __r.avisos.map(String) : [];
  return { errores: e, avisos: a };
})()`;
}

async function aJpeg(png: Buffer, fondo: string, avisos: string[]): Promise<{ jpg: Buffer; calidad: number }> {
  const sharp = ((await import("sharp")) as unknown as { default: typeof import("sharp") }).default;
  let calidad = CALIDAD_JPEG;
  for (;;) {
    const jpg = await sharp(png)
      .flatten({ background: fondo })
      .removeAlpha()
      .toColourspace("srgb")
      .withIccProfile("srgb")
      .jpeg({ quality: calidad, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer();
    if (jpg.length <= MAX_JPEG_BYTES) {
      if (calidad !== CALIDAD_JPEG) avisos.push(`El JPEG pasaba de 8 MB: se ha bajado la calidad a ${calidad} (${(jpg.length / 1048576).toFixed(1)} MB)`);
      return { jpg, calidad };
    }
    if (calidad <= CALIDAD_JPEG_MINIMA) {
      throw new ErrorRender("tamano", [`El JPEG ocupa ${(jpg.length / 1048576).toFixed(1)} MB incluso con calidad ${calidad} (máximo 8 MB)`], "La imagen es demasiado pesada");
    }
    calidad -= 4;
  }
}

async function dimensiones(png: Buffer): Promise<{ width?: number; height?: number }> {
  const sharp = ((await import("sharp")) as unknown as { default: typeof import("sharp") }).default;
  return sharp(png).metadata();
}

/** Página preparada (listeners puestos) que se puede reutilizar para varias imágenes. */
interface PaginaRender {
  page: Page;
  fallosRed: string[];
  erroresJs: string[];
}

async function abrirPagina(contexto: BrowserContext): Promise<PaginaRender> {
  const page = await contexto.newPage();
  const pr: PaginaRender = { page, fallosRed: [], erroresJs: [] };
  page.on("response", (r) => {
    if (r.status() >= 400) pr.fallosRed.push(`HTTP ${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => pr.fallosRed.push(`Fallo de red ${r.url()}`));
  page.on("pageerror", (e) => pr.erroresJs.push(`Error JS en la plantilla: ${e.message}`));
  await page.addInitScript(POLYFILL_NAME);
  return pr;
}

/** Carga, comprueba y captura UNA imagen en una página ya abierta. */
async function renderizarEnPagina(pr: PaginaRender, p: PeticionRender, msArranque: number, msPagina: number): Promise<ResultadoRender> {
  const { page } = pr;
  const avisos: string[] = [];
  // Página reutilizada: fuera las rutas y los fallos de la imagen anterior.
  pr.fallosRed.length = 0;
  pr.erroresJs.length = 0;
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const vista = page.viewportSize();
  if (!vista || vista.width !== p.ancho || vista.height !== p.alto) await page.setViewportSize({ width: p.ancho, height: p.alto });

  const t0 = performance.now();
  await cargarDocumento(page, p, p.timeoutMs ?? 25_000);
  const fallosRecursos = (await page.evaluate(p.codigoEsperar ?? CODIGO_ESPERAR_RECURSOS)) as string[];
  const problemasCarga = [...new Set([...pr.fallosRed, ...fallosRecursos, ...pr.erroresJs])];
  if (problemasCarga.length) throw new ErrorRender("recursos", problemasCarga, "Hay recursos que no cargan");

  const comprobacion = (await page.evaluate(envolverComprobacion(p.codigoComprobar))) as { errores: string[]; avisos: string[] };
  if (comprobacion.errores.length) throw new ErrorRender("maquetacion", comprobacion.errores, "La pieza no pasa las comprobaciones de maquetación");
  avisos.push(...comprobacion.avisos);
  const msCarga = performance.now() - t0;

  const t1 = performance.now();
  const lienzo = page.locator(".lienzo").first();
  if ((await lienzo.count()) === 0) throw new ErrorRender("maquetacion", ["El documento no tiene elemento .lienzo"], "Documento no válido");
  const png = await lienzo.screenshot({ type: "png", animations: "disabled", caret: "hide", timeout: 15_000 });
  const msCaptura = performance.now() - t1;
  const meta = await dimensiones(png);
  if (meta.width !== p.ancho || meta.height !== p.alto) {
    throw new ErrorRender("tamano", [`La captura mide ${meta.width}×${meta.height} y debería medir ${p.ancho}×${p.alto}`], "Tamaño incorrecto");
  }
  const t2 = performance.now();
  const { jpg, calidad } = await aJpeg(png, p.fondo ?? "#ffffff", avisos);
  const msJpeg = performance.now() - t2;
  return {
    jpg,
    ancho: p.ancho,
    alto: p.alto,
    calidad,
    avisos,
    tiempos: { msArranque: Math.round(msArranque), msPagina: Math.round(msPagina), msCarga: Math.round(msCarga), msCaptura: Math.round(msCaptura), msJpeg: Math.round(msJpeg) },
  };
}

async function renderizarEn(navegador: Browser, p: PeticionRender, msArranque: number): Promise<ResultadoRender> {
  const tPagina = performance.now();
  const contexto = await navegador.newContext({ viewport: { width: p.ancho, height: p.alto }, deviceScaleFactor: 1 });
  try {
    const pr = await abrirPagina(contexto);
    return await renderizarEnPagina(pr, p, msArranque, performance.now() - tPagina);
  } finally {
    await contexto.close().catch(() => undefined);
  }
}

/** Resultado de una imagen de un lote: la imagen o su error (para avisar de todas a la vez). */
export type ResultadoLote = { ok: true; r: ResultadoRender } | { ok: false; error: unknown };

/**
 * Renderiza varias imágenes (un carrusel) en UNA llamada: un solo Chromium y
 * hasta `concurrencia` páginas a la vez (cada una en su contexto). El orden
 * del resultado es el de las peticiones. Nunca lanza por una imagen: la
 * devuelve como `{ ok: false, error }`; sí lanza si Chromium no arranca.
 */
export type RenderizadorLote = (ps: PeticionRender[], o?: { concurrencia?: number }) => Promise<ResultadoLote[]>;

/** Páginas a la vez por defecto (Vercel: 2 GB; Chromium + 3 páginas 1080×1350 caben de sobra). */
export const CONCURRENCIA_LOTE = 3;

/** Reparte `n` tareas entre `concurrencia` trabajadores, conservando el orden del resultado. */
export async function enParalelo<T>(n: number, concurrencia: number, tarea: (i: number) => Promise<T>): Promise<T[]> {
  const salida = new Array<T>(n);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < n) {
      const i = siguiente++;
      salida[i] = await tarea(i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrencia, n)) }, trabajador));
  return salida;
}

/**
 * Lote real: arranca Chromium UNA vez, abre `concurrencia` páginas (cada una
 * en su contexto) y cada página renderiza varias imágenes seguidas: abrir una
 * página cuesta más que renderizar en ella (≈ 1,5 s en Windows), así que se
 * reutilizan. Lo cierra todo al acabar.
 */
export function crearRenderizadorLote(lanzar: Lanzador): RenderizadorLote {
  return async (ps, o = {}) => {
    const t0 = performance.now();
    const navegador = await lanzar();
    const msArranque = performance.now() - t0;
    const salida = new Array<ResultadoLote>(ps.length);
    let siguiente = 0;
    const trabajador = async () => {
      if (siguiente >= ps.length) return;
      const tPagina = performance.now();
      let contexto: BrowserContext | null = null;
      let pr: PaginaRender | null = null;
      try {
        while (siguiente < ps.length) {
          const i = siguiente++;
          try {
            if (!pr) {
              contexto = await navegador.newContext({ viewport: { width: ps[i].ancho, height: ps[i].alto }, deviceScaleFactor: 1 });
              pr = await abrirPagina(contexto);
              salida[i] = { ok: true, r: await renderizarEnPagina(pr, ps[i], i === 0 ? msArranque : 0, performance.now() - tPagina) };
            } else {
              salida[i] = { ok: true, r: await renderizarEnPagina(pr, ps[i], 0, 0) };
            }
          } catch (error) {
            salida[i] = { ok: false, error };
            // Tras un fallo, página nueva para la siguiente (por si quedó a medias).
            await contexto?.close().catch(() => undefined);
            contexto = null;
            pr = null;
          }
        }
      } finally {
        await contexto?.close().catch(() => undefined);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrencia ?? CONCURRENCIA_LOTE, ps.length)) }, trabajador));
      return salida;
    } finally {
      await navegador.close().catch(() => undefined);
    }
  };
}

/** Lote a partir de un renderizador suelto (tests o diagnóstico): mismas reglas de concurrencia. */
export function loteDesde(renderizar: Renderizador): RenderizadorLote {
  return (ps, o = {}) =>
    enParalelo(ps.length, o.concurrencia ?? CONCURRENCIA_LOTE, async (i): Promise<ResultadoLote> => {
      try {
        return { ok: true, r: await renderizar(ps[i]) };
      } catch (error) {
        return { ok: false, error };
      }
    });
}

/** Renderizador real: arranca Chromium, renderiza y lo cierra. */
export function crearRenderizador(lanzar: Lanzador): Renderizador {
  return async (p) => {
    const t0 = performance.now();
    const navegador = await lanzar();
    const msArranque = performance.now() - t0;
    try {
      return await renderizarEn(navegador, p, msArranque);
    } finally {
      await navegador.close().catch(() => undefined);
    }
  };
}
