// Núcleo del trabajador de render de reels (docs/instagram-video.md): página
// de captura, Chromium (Playwright), ffmpeg/ffprobe y comprobación del MP4.
// Sin Supabase: lo usa scripts/instagram/render-reels.mjs (la cola) y su
// prueba (scripts/instagram/__tests__/render-reels.test.mjs).
//
//   renderizarReel({ datos, urlPagina, carpeta, ffmpeg, ffprobe, ... })
//     → { mp4, portada, duracion, bytes, fotogramas, avisos }   (lanza ErrorRender si no vale)
//
// Requisitos de Meta para reels (developers.facebook.com/docs/instagram-platform/
// instagram-graph-api/reference/ig-user/media, «Reel Specifications», consultada el 05/11/2026):
// MP4 con el moov delante y sin listas de edición; H.264 progresivo, GOP
// cerrado, 4:2:0; 23-60 fps; ≤ 1920 px de ancho; ≤ 25 Mbps; AAC ≤ 48 kHz,
// 1-2 canales, 128 kbps; de 3 s a 15 min; ≤ 300 MB. Nuestro objetivo: 1080×1920,
// 30 fps, < 25 MB y ≤ 90 s.
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as crearServidorRed } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ANCHO = 1080;
export const ALTO = 1920;
export const FPS = 30;
export const DURACION_MAX_S = 90;
export const DURACION_MIN_META_S = 3;
/** Objetivo de peso (Meta admite 300 MB; el cubo, 50 MB). */
export const OBJETIVO_MB_POR_DEFECTO = 25;
export const MAX_BYTES_CUBO = 50 * 1024 * 1024;
export const BITRATE_AUDIO = 128_000;

const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export class ErrorRender extends Error {
  constructor(mensaje, problemas = []) {
    super(mensaje);
    this.name = "ErrorRender";
    this.problemas = problemas;
  }
}

// ── ffmpeg y ffprobe ────────────────────────────────────────────────────────

function funciona(bin) {
  try {
    const r = spawnSync(bin, ["-version"], { stdio: "ignore", timeout: 15_000, windowsHide: true });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * ffmpeg: RENDER_FFMPEG → el del sistema (PATH) → ffmpeg-static (ya está en
 * devDependencies). ffprobe: RENDER_FFPROBE → PATH → junto a ffmpeg → null
 * (sin ffprobe se comprueba solo la estructura del MP4, con un aviso).
 */
export async function buscarFfmpeg(env = process.env) {
  let ffmpeg = null;
  let origen = null;
  if (env.RENDER_FFMPEG && funciona(env.RENDER_FFMPEG)) [ffmpeg, origen] = [env.RENDER_FFMPEG, "RENDER_FFMPEG"];
  else if (funciona("ffmpeg")) [ffmpeg, origen] = ["ffmpeg", "sistema"];
  else {
    try {
      const estatico = (await import("ffmpeg-static")).default;
      if (estatico && funciona(estatico)) [ffmpeg, origen] = [estatico, "ffmpeg-static"];
    } catch {
      /* sin ffmpeg-static */
    }
  }
  let ffprobe = null;
  if (env.RENDER_FFPROBE && funciona(env.RENDER_FFPROBE)) ffprobe = env.RENDER_FFPROBE;
  else if (funciona("ffprobe")) ffprobe = "ffprobe";
  else if (ffmpeg && ffmpeg !== "ffmpeg") {
    const junto = path.join(path.dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    if (existsSync(junto) && funciona(junto)) ffprobe = junto;
  }
  return { ffmpeg, ffprobe, origen };
}

/** Bitrate máximo de vídeo para no pasar de `objetivoMb` (con margen y el audio). */
export function maxrateParaObjetivo(duracion, objetivoMb = OBJETIVO_MB_POR_DEFECTO) {
  const bits = objetivoMb * 1024 * 1024 * 8 * 0.9;
  const porSegundo = Math.floor(bits / Math.max(1, duracion) - BITRATE_AUDIO);
  return Math.max(1_500_000, Math.min(8_000_000, porSegundo));
}

/**
 * Argumentos de ffmpeg: fotogramas JPEG por la entrada estándar + pista de
 * audio (o silencio AAC estéreo a 48 kHz). H.264 high, yuv420p (BT.709, rango
 * limitado), 30 fps, GOP cerrado de 2 s, AAC 128 kbps, moov delante y sin
 * listas de edición.
 */
export function argumentosFfmpeg({ duracion, salida, audio = null, crf = 20, maxrate = maxrateParaObjetivo(duracion) }) {
  const d = duracion.toFixed(3);
  const entradaAudio = audio ? ["-i", audio] : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"];
  const fundido = Math.min(1.5, duracion / 3);
  const filtroAudio = audio ? ["-af", `apad,afade=t=out:st=${Math.max(0, duracion - fundido).toFixed(3)}:d=${fundido.toFixed(3)}`] : [];
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0",
    ...entradaAudio,
    "-map", "0:v:0", "-map", "1:a:0",
    "-vf", `scale=${ANCHO}:${ALTO}:flags=bicubic:out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-r", String(FPS), "-g", String(FPS * 2), "-flags", "+cgop",
    "-crf", String(crf), "-maxrate", String(maxrate), "-bufsize", String(maxrate * 2),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    ...filtroAudio,
    "-t", d,
    "-movflags", "+faststart", "-use_editlist", "0",
    "-f", "mp4", salida,
  ];
}

/** Lanza ffmpeg y devuelve { escribir(buffer), terminar() }. */
export function abrirCodificador(ffmpeg, args) {
  const proc = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  let errores = "";
  proc.stderr.on("data", (d) => {
    errores = (errores + d.toString()).slice(-4000);
  });
  const fin = new Promise((resolver, rechazar) => {
    proc.on("error", rechazar);
    proc.on("close", (codigo) => (codigo === 0 ? resolver() : rechazar(new ErrorRender(`ffmpeg terminó con código ${codigo}: ${errores.trim().slice(-600)}`))));
  });
  fin.catch(() => {});
  return {
    async escribir(buffer) {
      if (!proc.stdin.write(buffer)) await new Promise((r) => proc.stdin.once("drain", r));
    },
    async terminar() {
      proc.stdin.end();
      await fin;
    },
    abortar() {
      proc.kill("SIGKILL");
    },
  };
}

// ── Comprobación del MP4 ────────────────────────────────────────────────────

/**
 * Cajas de primer nivel del MP4: si el moov va delante del mdat (faststart),
 * si hay listas de edición (edts) y la duración del mvhd.
 */
export function analizarMp4(buf) {
  const cajas = [];
  let o = 0;
  while (o + 8 <= buf.length) {
    let tam = buf.readUInt32BE(o);
    const tipo = buf.toString("latin1", o + 4, o + 8);
    let cab = 8;
    if (tam === 1) {
      tam = Number(buf.readBigUInt64BE(o + 8));
      cab = 16;
    } else if (tam === 0) tam = buf.length - o;
    if (tam < cab) break;
    cajas.push({ tipo, inicio: o, tam, cab });
    o += tam;
  }
  const moov = cajas.find((c) => c.tipo === "moov");
  const mdat = cajas.find((c) => c.tipo === "mdat");
  let duracion = null;
  let edts = false;
  if (moov) {
    const cuerpo = buf.subarray(moov.inicio + moov.cab, moov.inicio + moov.tam);
    edts = cuerpo.includes(Buffer.from("edts", "latin1"));
    const i = cuerpo.indexOf(Buffer.from("mvhd", "latin1"));
    if (i >= 0) {
      const v = cuerpo[i + 4];
      const escala = v === 1 ? cuerpo.readUInt32BE(i + 4 + 20) : cuerpo.readUInt32BE(i + 4 + 12);
      const dur = v === 1 ? Number(cuerpo.readBigUInt64BE(i + 4 + 24)) : cuerpo.readUInt32BE(i + 4 + 16);
      if (escala > 0) duracion = dur / escala;
    }
  }
  return {
    cajas: cajas.map((c) => c.tipo),
    faststart: !!moov && !!mdat && moov.inicio < mdat.inicio,
    edts,
    duracion,
  };
}

/** ffprobe → problemas frente a lo que pide Meta (vacío si vale). */
export function comprobarConFfprobe(ffprobe, archivo, duracionEsperada) {
  const r = spawnSync(ffprobe, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", archivo], { encoding: "utf8", timeout: 60_000, windowsHide: true });
  if (r.status !== 0) return [`ffprobe no pudo leer el MP4: ${(r.stderr || "").trim().slice(0, 300)}`];
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  const p = [];
  if (!v) p.push("El MP4 no tiene vídeo");
  else {
    if (v.codec_name !== "h264") p.push(`Códec de vídeo ${v.codec_name} (se espera h264)`);
    if (v.pix_fmt !== "yuv420p") p.push(`Formato de píxel ${v.pix_fmt} (se espera yuv420p)`);
    if (v.width !== ANCHO || v.height !== ALTO) p.push(`Tamaño ${v.width}×${v.height} (se espera ${ANCHO}×${ALTO})`);
    const [num, den] = String(v.r_frame_rate ?? "0/1").split("/").map(Number);
    if (Math.abs(num / (den || 1) - FPS) > 0.01) p.push(`${v.r_frame_rate} fps (se esperan ${FPS})`);
  }
  if (!a) p.push("El MP4 no tiene audio");
  else {
    if (a.codec_name !== "aac") p.push(`Códec de audio ${a.codec_name} (se espera aac)`);
    if (Number(a.sample_rate) > 48000) p.push(`Audio a ${a.sample_rate} Hz (máximo 48 kHz)`);
    if (a.channels > 2) p.push(`Audio con ${a.channels} canales (máximo 2)`);
  }
  const dur = Number(j.format?.duration);
  if (Number.isFinite(dur) && Math.abs(dur - duracionEsperada) > 0.25) p.push(`Dura ${dur.toFixed(2)} s y se esperaban ${duracionEsperada.toFixed(2)} s`);
  return p;
}

// ── Página de captura ───────────────────────────────────────────────────────

export async function puertoLibre() {
  return await new Promise((resolver, rechazar) => {
    const s = crearServidorRed();
    s.once("error", rechazar);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolver(port));
    });
  });
}

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".wasm": "application/wasm",
};

/**
 * Sirve la página de captura y devuelve { url, cerrar }:
 *   modo "url"   RENDER_PAGINA=https://… (el panel publicado: mismo código que ve el usuario)
 *   modo "dist"  el build local (npm run build) con un servidor estático mínimo
 *   modo "vite"  el servidor de desarrollo de Vite (sin build; necesita las devDependencies)
 */
export async function servirPagina({ modo, url, raiz = RAIZ_REPO } = {}) {
  if (modo === "url") {
    if (!/^https?:\/\//.test(url ?? "")) throw new ErrorRender("RENDER_PAGINA tiene que ser una URL http(s) del panel");
    return { url: `${url.replace(/\/+$/, "")}/__reel-instagram.html`, cerrar: async () => {} };
  }
  const puerto = await puertoLibre();
  if (modo === "dist") {
    const dist = path.join(raiz, "dist");
    if (!existsSync(path.join(dist, "__reel-instagram.html"))) throw new ErrorRender("No hay build: ejecuta «npm run build» o usa RENDER_PAGINA=vite");
    const servidor = createServer((req, res) => {
      const ruta = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const fichero = path.normalize(path.join(dist, ruta));
      if (!fichero.startsWith(dist) || !existsSync(fichero)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": TIPOS[path.extname(fichero).toLowerCase()] ?? "application/octet-stream" });
      createReadStream(fichero).pipe(res);
    });
    await new Promise((r) => servidor.listen(puerto, "127.0.0.1", r));
    return { url: `http://127.0.0.1:${puerto}/__reel-instagram.html`, cerrar: () => new Promise((r) => servidor.close(() => r())) };
  }
  // Vite (desarrollo)
  const { createServer: crearVite } = await import("vite");
  const vite = await crearVite({
    root: raiz,
    configFile: path.join(raiz, "vite.config.ts"),
    logLevel: "error",
    server: { host: "127.0.0.1", port: puerto, strictPort: true, hmr: false },
  });
  await vite.listen();
  return { url: `http://127.0.0.1:${puerto}/__reel-instagram.html`, cerrar: () => vite.close() };
}

// ── Render ──────────────────────────────────────────────────────────────────

/**
 * ¿Puede la página pedir esta URL? Su propio origen (código, fuentes, logos,
 * muestras), las fotos del trabajo y, si se da, el prefijo de las copias
 * temporales del cubo. Todo lo demás se bloquea (sin salir a otras webs).
 */
export function urlPermitida(url, { origenPagina, fotos = [], prefijos = [] }) {
  if (url.startsWith("data:") || url.startsWith("blob:")) return true;
  if (url.startsWith(`${origenPagina}/`)) return true;
  if (fotos.includes(url)) return true;
  return prefijos.some((p) => url.startsWith(p));
}

/**
 * Renderiza un reel a MP4 + portada JPEG en `carpeta`.
 *   datos      { reel, fotos, baseRecursos?, portada_s?, limiteSegundos? } (DatosCaptura)
 *   urlPagina  de servirPagina
 *   audio      fichero de la pista propia o null (silencio)
 *   alProgreso (0-100, fotogramas) → promesa (latido)
 */
export async function renderizarReel({
  datos,
  urlPagina,
  carpeta,
  ffmpeg,
  ffprobe = null,
  audio = null,
  objetivoMb = OBJETIVO_MB_POR_DEFECTO,
  crf = 20,
  calidadJpeg = 92,
  chromiumPath = undefined,
  prefijosPermitidos = [],
  alProgreso = async () => {},
  registro = () => {},
}) {
  if (!ffmpeg) throw new ErrorRender("No hay ffmpeg: instálalo (winget install Gyan.FFmpeg) o pon RENDER_FFMPEG con su ruta");
  await mkdir(carpeta, { recursive: true });
  const { chromium } = await import("playwright-core");
  const navegador = await chromium.launch({ headless: true, ...(chromiumPath ? { executablePath: chromiumPath } : {}) });
  const avisos = [];
  try {
    const contexto = await navegador.newContext({ viewport: { width: ANCHO, height: ALTO }, deviceScaleFactor: 1, serviceWorkers: "block" });
    const pagina = await contexto.newPage();
    const origenPagina = new URL(urlPagina).origin;
    const fotos = Object.values(datos.fotos ?? {});
    const bloqueadas = [];
    await pagina.route("**/*", (ruta) => {
      const u = ruta.request().url();
      if (urlPermitida(u, { origenPagina, fotos, prefijos: prefijosPermitidos })) return ruta.continue();
      bloqueadas.push(u);
      return ruta.abort("blockedbyclient");
    });
    const erroresPagina = [];
    pagina.on("pageerror", (e) => erroresPagina.push(e.message));
    await pagina.addInitScript((d) => {
      window.__REEL_CAPTURA__ = d;
    }, datos);
    await pagina.goto(urlPagina, { waitUntil: "load", timeout: 120_000 });
    await pagina.waitForFunction(() => !!window.__reelEstado && typeof window.__fijarTiempo === "function", null, { timeout: 60_000 }).catch(() => null);
    const estado = await pagina.evaluate(() => window.__reelEstado ?? null);
    if (!estado) throw new ErrorRender(`La página de captura no arrancó${erroresPagina.length ? `: ${erroresPagina[0]}` : ""}`);
    if (!estado.ok) throw new ErrorRender("El reel no es válido", estado.problemas);
    avisos.push(...estado.avisos);
    if (estado.duracion > DURACION_MAX_S) throw new ErrorRender(`El reel dura ${estado.duracion} s (máximo ${DURACION_MAX_S})`);

    const listo = await pagina.evaluate(() => window.__listo());
    if (listo.fotosFallidas.length) {
      throw new ErrorRender(
        "No se pudieron cargar algunas fotos (las copias temporales caducan a las 24 h: vuelve a pulsar «Generar vídeo»)",
        listo.fotosFallidas.map((id) => `Foto «${id}»`),
      );
    }
    if (bloqueadas.length) avisos.push(`Se bloquearon ${bloqueadas.length} peticiones a otras webs desde la página de captura.`);

    // Medición exacta de los textos en el DOM, con cada rótulo ya quieto.
    const problemasTexto = [];
    for (const t of estado.instantesMedida) {
      await pagina.evaluate((x) => window.__fijarTiempo(x), t);
      const m = await pagina.evaluate(() => window.__medirTextos());
      problemasTexto.push(...m.problemas);
      avisos.push(...m.avisos);
    }
    if (problemasTexto.length) throw new ErrorRender("Hay textos que se salen del vídeo", [...new Set(problemasTexto)]);

    // Fotogramas t = n / 30 → ffmpeg.
    const duracion = estado.fotogramas / FPS;
    const mp4 = path.join(carpeta, "reel.mp4");
    const args = argumentosFfmpeg({ duracion, salida: mp4, audio, crf, maxrate: maxrateParaObjetivo(duracion, objetivoMb) });
    const cod = abrirCodificador(ffmpeg, args);
    const inicio = Date.now();
    let ultimo = 0;
    try {
      for (let n = 0; n < estado.fotogramas; n++) {
        await pagina.evaluate((x) => window.__fijarTiempo(x), n / FPS);
        const jpeg = await pagina.screenshot({ type: "jpeg", quality: calidadJpeg, clip: { x: 0, y: 0, width: ANCHO, height: ALTO }, caret: "hide" });
        await cod.escribir(jpeg);
        const progreso = Math.floor(((n + 1) / estado.fotogramas) * 95);
        if (Date.now() - ultimo > 5_000 || n === estado.fotogramas - 1) {
          ultimo = Date.now();
          await alProgreso(progreso, estado.fotogramas);
        }
      }
      await cod.terminar();
    } catch (e) {
      cod.abortar();
      throw e;
    }
    registro(`${estado.fotogramas} fotogramas en ${((Date.now() - inicio) / 1000).toFixed(1)} s`);

    // Portada: el mismo lienzo en el instante elegido.
    await pagina.evaluate((x) => window.__fijarTiempo(x), estado.portada_s);
    const portada = path.join(carpeta, "portada.jpg");
    await writeFile(portada, await pagina.screenshot({ type: "jpeg", quality: 90, clip: { x: 0, y: 0, width: ANCHO, height: ALTO } }));

    // Comprobaciones del MP4.
    const bytes = (await stat(mp4)).size;
    const estructura = analizarMp4(await readFile(mp4));
    const problemas = [];
    if (!estructura.faststart) problemas.push("El moov no va al principio del MP4 (faststart)");
    if (estructura.edts) problemas.push("El MP4 tiene listas de edición (edts); Meta pide que no");
    if (bytes > MAX_BYTES_CUBO) problemas.push(`El MP4 pesa ${(bytes / 1048576).toFixed(1)} MB (máximo 50 MB en el cubo)`);
    const durReal = estructura.duracion ?? duracion;
    if (ffprobe) problemas.push(...comprobarConFfprobe(ffprobe, mp4, duracion));
    else avisos.push("Sin ffprobe: solo se ha comprobado la estructura del MP4 (instala ffprobe para comprobar códecs y fps).");
    if (problemas.length) throw new ErrorRender("El MP4 no cumple lo que pide Instagram", problemas);
    if (bytes > objetivoMb * 1024 * 1024) avisos.push(`El MP4 pesa ${(bytes / 1048576).toFixed(1)} MB (objetivo: menos de ${objetivoMb} MB).`);
    if (durReal < DURACION_MIN_META_S) avisos.push(`El vídeo dura ${durReal.toFixed(1)} s: Instagram pide al menos ${DURACION_MIN_META_S} s.`);
    await alProgreso(98, estado.fotogramas);
    return { mp4, portada, duracion: Math.round(durReal * 100) / 100, bytes, fotogramas: estado.fotogramas, avisos: [...new Set(avisos)] };
  } finally {
    await navegador.close().catch(() => {});
  }
}
