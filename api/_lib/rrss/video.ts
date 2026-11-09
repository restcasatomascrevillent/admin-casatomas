/**
 * RRSS · motor de VÍDEO (ffmpeg estático, el de `ffmpeg-static`). Monta de
 * verdad el MP4 a partir de los clips y fotos originales:
 *
 *   tomas (fragmentos elegidos de cada clip, o fotos)
 *     ─► recorte al formato (centro + zoom), HDR → SDR si hace falta, 30 fps
 *     ─► corrección + tratamiento del estilo (eq, balance de color, nitidez, viñeta)
 *     ─► fotos: movimiento (acercar, alejar, paneo) con zoompan
 *     ─► transiciones (fundido, deslizar, zoom) o cortes, también en el audio
 *     ─► cierre con el logo y la llamada a la acción (opcional)
 *     ─► títulos y subtítulos con las fuentes de marca (libass) y logo en una esquina
 *     ─► H.264 high 4:2:0 + AAC 48 kHz, moov delante y sin listas de edición
 *         (lo que pide Meta para reels y stories)
 *
 * Los originales nunca se tocan: se leen de una copia local en /tmp.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type sharpTipo from "sharp";
import { ESTILOS, factoresFoto, filtrosVideo, sumarTratamientos, type ComposicionMarca, type EstiloId, type Transicion, type Tratamiento } from "../../../src/lib/rrss/estilos.js";
import type { FormatoSalida, ZonaSegura } from "../../../src/lib/rrss/formatos.js";
import { rectanguloRecorte } from "../../../src/lib/rrss/geometria.js";
import { DURACION_CIERRE, duracionToma, type Movimiento, type PiezaVideo, type Toma, type TituloVideo } from "../../../src/lib/rrss/plan.js";
import type { MarcaId } from "../../../src/lib/instagram/tokens.js";
import { dirFuentes, ficheroLogo, FUENTES_MOTOR } from "./recursos.js";

type Sharp = typeof sharpTipo;

export const FPS = 30;
export { DURACION_CIERRE };

export interface InfoMedio {
  duracion: number;
  /** Medidas ya giradas (las que se ven). */
  ancho: number;
  alto: number;
  rotacion: number;
  fps: number | null;
  codec: string | null;
  tieneAudio: boolean;
  hdr: boolean;
}

export interface FuenteToma {
  /** Ruta local del original (copia en /tmp). */
  ruta: string;
  medio: "foto" | "video";
  ancho: number;
  alto: number;
  tieneAudio: boolean;
  hdr: boolean;
}

export interface Segmento {
  inicio: number;
  fin: number;
  texto: string;
}

export interface RecetaVideo {
  marca: MarcaId;
  estilo: EstiloId;
  ancho: number;
  alto: number;
  zonaSegura: ZonaSegura;
  tomas: Array<Toma & { fuente: FuenteToma }>;
  transicion: Transicion;
  duracionTransicion: number;
  tratamiento: Tratamiento;
  audio: "original" | "silencio";
  titulos: TituloVideo[];
  /** Subtítulos ya en el tiempo del vídeo final. */
  subtitulos: Segmento[];
  cierre: { mostrar: boolean; titulo?: string; cta?: string };
  logo: boolean;
  composicion: ComposicionMarca;
  /** 0-1: cuánto se mueven las fotos (ritmo del estilo). */
  movimiento: number;
}

export class ErrorVideoMotor extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorVideoMotor";
  }
}

// ── ffmpeg ──────────────────────────────────────────────────────────────────

export interface ResultadoProceso {
  codigo: number;
  stdout: string;
  stderr: string;
}

export function ejecutar(binario: string, args: string[], opts: { alSalir?: (linea: string) => void; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ResultadoProceso> {
  return new Promise((resolve, reject) => {
    const p = spawn(binario, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let resto = "";
    const temporizador = opts.timeoutMs ? setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs) : null;
    const abortar = () => p.kill("SIGKILL");
    opts.signal?.addEventListener("abort", abortar, { once: true });
    p.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      if (stdout.length < 200_000) stdout += s;
      if (opts.alSalir) {
        resto += s;
        const lineas = resto.split("\n");
        resto = lineas.pop() ?? "";
        for (const l of lineas) opts.alSalir(l);
      }
    });
    p.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 400_000) stderr = stderr.slice(-200_000);
    });
    p.on("error", (e) => {
      if (temporizador) clearTimeout(temporizador);
      reject(e);
    });
    p.on("close", (codigo) => {
      if (temporizador) clearTimeout(temporizador);
      opts.signal?.removeEventListener("abort", abortar);
      resolve({ codigo: codigo ?? -1, stdout, stderr });
    });
  });
}

/**
 * Ruta del ffmpeg estático: RRSS_FFMPEG, o el binario de `ffmpeg-static` que
 * va dentro del bundle de la función (vercel.json → includeFiles), o el que
 * resuelva el paquete en local.
 */
export async function rutaFfmpeg(): Promise<string> {
  if (process.env.RRSS_FFMPEG) return process.env.RRSS_FFMPEG;
  const { existsSync } = await import("node:fs");
  for (const raiz of [process.cwd(), "/var/task"]) {
    const p = path.join(raiz, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    if (existsSync(p)) return p;
  }
  try {
    const mod = (await import("ffmpeg-static")) as unknown as { default?: string } | string;
    const ruta = typeof mod === "string" ? mod : mod.default;
    if (ruta && existsSync(ruta)) return ruta;
  } catch {
    /* sin el paquete */
  }
  throw new ErrorVideoMotor("No hay binario de ffmpeg en este servidor");
}

const aSegundos = (h: string, m: string, s: string) => Number(h) * 3600 + Number(m) * 60 + Number(s);

/** Lee la cabecera que imprime `ffmpeg -i` (no hay ffprobe en ffmpeg-static). */
export function parsearInfo(stderr: string): InfoMedio {
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const video = /Stream #\d+:\d+[^\n]*?: Video: ([^\n]+)/.exec(stderr);
  if (!video) throw new ErrorVideoMotor("El archivo no tiene pista de vídeo legible");
  const linea = video[1];
  const medidas = /,\s*(\d{2,5})x(\d{2,5})[\s,[]/.exec(linea);
  const fps = /,\s*([\d.]+)\s*fps/.exec(linea);
  const codec = /^(\w+)/.exec(linea);
  const rot = /rotation of (-?[\d.]+) degrees/.exec(stderr) ?? /rotate\s*:\s*(-?\d+)/.exec(stderr);
  const rotacion = rot ? Math.round(Number(rot[1])) : 0;
  let ancho = medidas ? Number(medidas[1]) : 0;
  let alto = medidas ? Number(medidas[2]) : 0;
  if (Math.abs(rotacion) % 180 === 90) [ancho, alto] = [alto, ancho];
  return {
    duracion: dur ? Math.round(aSegundos(dur[1], dur[2], dur[3]) * 100) / 100 : 0,
    ancho,
    alto,
    rotacion,
    fps: fps ? Number(fps[1]) : null,
    codec: codec ? codec[1] : null,
    tieneAudio: /Stream #\d+:\d+[^\n]*?: Audio:/.test(stderr),
    hdr: /arib-std-b67|smpte2084/.test(linea),
  };
}

export async function analizarMedio(ffmpeg: string, ruta: string): Promise<InfoMedio> {
  const r = await ejecutar(ffmpeg, ["-hide_banner", "-i", ruta], { timeoutMs: 30_000 });
  return parsearInfo(r.stderr);
}

const ts = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = s - h * 3600 - m * 60;
  return `${h}:${String(m).padStart(2, "0")}:${seg.toFixed(2).padStart(5, "0")}`;
};

/**
 * Hoja de contactos: 9 fotogramas repartidos por el clip con su segundo, en una
 * sola imagen (es lo que «ve» la IA del vídeo: barato y suficiente para elegir fragmentos).
 */
export async function hojaContactos(ffmpeg: string, sharp: Sharp, ruta: string, info: InfoMedio, dirTrabajo: string): Promise<{ jpeg: Buffer; instantes: number[] }> {
  const n = 9;
  const instantes = Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * info.duracion * 100) / n) / 100);
  const lado = 320;
  const fotos: Buffer[] = [];
  for (let i = 0; i < n; i += 3) {
    const lote = await Promise.all(
      instantes.slice(i, i + 3).map(async (t, j) => {
        const destino = path.join(dirTrabajo, `hoja-${i + j}.jpg`);
        const r = await ejecutar(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(t), "-i", ruta, "-frames:v", "1", "-vf", `scale=${lado}:${lado}:force_original_aspect_ratio=decrease`, "-q:v", "4", destino], { timeoutMs: 30_000 });
        if (r.codigo !== 0) return null;
        return readFile(destino).catch(() => null);
      }),
    );
    for (const f of lote) if (f) fotos.push(f);
  }
  if (fotos.length === 0) throw new ErrorVideoMotor("No se pudo leer ningún fotograma del vídeo");
  const celda = { w: lado, h: lado + 34 };
  const capas: sharpTipo.OverlayOptions[] = [];
  for (let i = 0; i < fotos.length; i++) {
    const x = (i % 3) * celda.w;
    const y = Math.floor(i / 3) * celda.h;
    const meta = await sharp(fotos[i]).metadata();
    capas.push({ input: fotos[i], left: x + Math.round((lado - (meta.width ?? lado)) / 2), top: y + Math.round((lado - (meta.height ?? lado)) / 2) });
    const etiqueta = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="34"><rect width="100%" height="100%" fill="#111"/><text x="10" y="24" font-family="sans-serif" font-size="20" fill="#fff">${instantes[i].toFixed(1)} s</text></svg>`);
    capas.push({ input: etiqueta, left: x, top: y + lado });
  }
  const jpeg = await sharp({ create: { width: celda.w * 3, height: celda.h * Math.ceil(fotos.length / 3), channels: 3, background: "#000" } })
    .composite(capas)
    .jpeg({ quality: 80 })
    .toBuffer();
  return { jpeg, instantes };
}

/** Audio mono a 16 kHz (para transcribir) y su volumen medio en dB (null si no hay audio). */
export async function extraerAudio(ffmpeg: string, ruta: string, destino: string): Promise<{ ruta: string; volumenMedio: number | null } | null> {
  const r = await ejecutar(ffmpeg, ["-hide_banner", "-y", "-i", ruta, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "32k", "-t", "600", "-af", "volumedetect", destino], { timeoutMs: 120_000 });
  if (r.codigo !== 0) return null;
  const vol = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
  return { ruta: destino, volumenMedio: vol ? Number(vol[1]) : null };
}

// ── Receta ──────────────────────────────────────────────────────────────────

/** Momento del vídeo final en que empieza cada toma (con los solapes de las transiciones). */
export function inicioTomas(duraciones: number[], transicion: Transicion, T: number): number[] {
  const solape = transicion === "corte" ? 0 : T;
  const inicios: number[] = [];
  let t = 0;
  for (let i = 0; i < duraciones.length; i++) {
    inicios.push(Math.round(t * 1000) / 1000);
    t += duraciones[i] - solape;
  }
  return inicios;
}

/** Trocea un texto en líneas de como mucho `max` caracteres (por palabras). */
export function trocearLineas(texto: string, max = 38): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const lineas: string[] = [];
  let actual = "";
  for (const p of palabras) {
    if (!actual) actual = p;
    else if ((actual + " " + p).length <= max) actual += " " + p;
    else {
      lineas.push(actual);
      actual = p;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

/**
 * Subtítulos en el tiempo del vídeo final: los segmentos de la transcripción
 * de cada clip que caen dentro de su toma, desplazados a cuando sale la toma.
 * Cada subtítulo, como mucho dos líneas; los largos se reparten en el tiempo.
 */
export function subtitulosDeTomas(tomas: Array<Pick<Toma, "archivo" | "medio" | "inicio" | "fin">>, inicios: number[], transcripciones: Map<string, Segmento[]>): Segmento[] {
  const out: Segmento[] = [];
  tomas.forEach((t, k) => {
    if (t.medio !== "video") return;
    const segs = transcripciones.get(t.archivo) ?? [];
    for (const s of segs) {
      const a = Math.max(s.inicio, t.inicio);
      const b = Math.min(s.fin, t.fin);
      if (b - a < 0.3 || !s.texto.trim()) continue;
      const ini = inicios[k] + (a - t.inicio);
      const fin = inicios[k] + (b - t.inicio);
      const lineas = trocearLineas(s.texto.trim());
      const bloques: string[] = [];
      for (let i = 0; i < lineas.length; i += 2) bloques.push(lineas.slice(i, i + 2).join("\n"));
      const paso = (fin - ini) / bloques.length;
      bloques.forEach((txt, i) => out.push({ inicio: Math.round((ini + i * paso) * 100) / 100, fin: Math.round((ini + (i + 1) * paso) * 100) / 100, texto: txt }));
    }
  });
  return out.sort((x, y) => x.inicio - y.inicio);
}

export function recetaVideo(
  p: PiezaVideo,
  marca: MarcaId,
  estilo: EstiloId,
  f: Pick<FormatoSalida, "ancho" | "alto" | "zonaSegura">,
  fuentes: Map<string, FuenteToma>,
  transcripciones: Map<string, Segmento[]> = new Map(),
): RecetaVideo {
  const e = ESTILOS[estilo];
  const tomas = p.tomas
    .map((t) => ({ ...t, fuente: fuentes.get(t.archivo) as FuenteToma }))
    .filter((t) => !!t.fuente);
  if (tomas.length === 0) throw new ErrorVideoMotor("El vídeo no tiene ninguna toma con archivo");
  const T = p.transicion === "corte" ? 0 : p.duracionTransicion;
  const inicios = inicioTomas(tomas.map(duracionToma), p.transicion, T);
  return {
    marca,
    estilo,
    ancho: f.ancho,
    alto: f.alto,
    zonaSegura: f.zonaSegura,
    tomas,
    transicion: p.transicion,
    duracionTransicion: T,
    tratamiento: sumarTratamientos(p.correccion, e.tratamiento[marca]),
    audio: p.audio,
    titulos: p.titulos,
    subtitulos: p.subtitulos ? subtitulosDeTomas(tomas, inicios, transcripciones) : [],
    cierre: p.cierre,
    logo: p.logo,
    composicion: e.composicion[marca],
    movimiento: e.ritmo.movimiento,
  };
}

/** Duraciones de cada tramo (tomas + cierre) e inicio de cada uno en el vídeo final. */
export function planTiempo(r: RecetaVideo) {
  const duraciones = r.tomas.map(duracionToma);
  if (r.cierre.mostrar) duraciones.push(DURACION_CIERRE);
  const T = r.transicion === "corte" ? 0 : r.duracionTransicion;
  // El cierre entra siempre con un fundido (aunque las tomas vayan al corte).
  const inicios = inicioTomas(duraciones, r.transicion, T);
  const total = Math.round((duraciones.reduce((s, d) => s + d, 0) - (r.transicion === "corte" ? 0 : T * (duraciones.length - 1))) * 1000) / 1000;
  return { duraciones, inicios, total, T };
}

// ── Subtítulos y títulos (ASS) ──────────────────────────────────────────────

/** #rrggbb / rgba() → &HAABBGGRR de ASS. */
export function colorAss(c: string, alfaExtra?: number): string {
  let r = 255;
  let g = 255;
  let b = 255;
  let a = 1;
  const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?\s*\)/i.exec(c);
  if (hex) {
    r = parseInt(hex[1].slice(0, 2), 16);
    g = parseInt(hex[1].slice(2, 4), 16);
    b = parseInt(hex[1].slice(4, 6), 16);
  } else if (m) {
    r = Number(m[1]);
    g = Number(m[2]);
    b = Number(m[3]);
    if (m[4] !== undefined) a = Number(m[4]);
  }
  if (alfaExtra !== undefined) a = alfaExtra;
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0").toUpperCase();
  return `&H${h((1 - a) * 255)}${h(b)}${h(g)}${h(r)}`;
}

const textoAss = (s: string) => s.replace(/\\/g, "＼").replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");

export function construirAss(r: RecetaVideo): string {
  const { ancho: W, alto: H, composicion: c, zonaSegura: z } = r;
  const vertical = z.arriba > 100;
  const lados = Math.max(72, z.lados);
  const caja = c.tipo === "bloque" || c.tipo === "banda" || c.tipo === "marco" || c.tipo === "cartel";
  const fTit = FUENTES_MOTOR[c.titular].familia;
  const fTxt = FUENTES_MOTOR["montserrat-seminegrita"].familia;
  const tamTit = Math.round(W * c.escalaTitular * (vertical ? 1.1 : 0.95));
  const tamSub = Math.round(W * 0.04);
  const abajo = vertical ? z.abajo + 30 : 110;
  const arriba = vertical ? z.arriba + 20 : 110;
  const conSubs = r.subtitulos.length > 0;
  const estilos = [
    // Titulo: caja de la composición o texto con sombra.
    `Style: Titulo,${fTit},${tamTit},${colorAss(c.colorTexto)},&H000000FF,${caja ? colorAss(c.colorFondo, 1) : "&H00000000"},${caja ? colorAss(c.colorFondo) : "&H78000000"},0,0,0,0,100,100,0,0,${caja ? 3 : 1},${caja ? Math.round(W * 0.02) : 0},${caja ? 0 : 3},2,${lados},${lados},${abajo + (conSubs ? Math.round(tamSub * 3.2) : 0)},1`,
    `Style: Sub,${fTxt},${tamSub},&H00FFFFFF,&H000000FF,&H00000000,&H66000000,0,0,0,0,100,100,0,0,3,${Math.round(W * 0.012)},0,2,${lados},${lados},${abajo},1`,
    `Style: CierreTitulo,${fTit},${Math.round(tamTit * 1.05)},${colorAss(c.colorTexto)},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,${lados},${lados},0,1`,
    `Style: CierreCta,${fTxt},${Math.round(W * 0.034)},${colorAss(c.colorSobreAcento)},&H000000FF,${colorAss(c.colorAcento)},${colorAss(c.colorAcento)},0,0,0,0,100,100,${Math.round(W * 0.002)},0,3,${Math.round(W * 0.018)},0,5,${lados},${lados},0,1`,
  ];
  const { inicios, total } = planTiempo(r);
  const eventos: string[] = [];
  const alineacion = (pos: TituloVideo["posicion"]) => {
    const izq = c.alinear === "izquierda";
    if (pos === "arriba") return izq ? 7 : 8;
    if (pos === "centro") return izq ? 4 : 5;
    return izq ? 1 : 2;
  };
  const finTomas = r.cierre.mostrar ? inicios[inicios.length - 1] : total;
  for (const t of r.titulos) {
    const ini = Math.max(0, t.inicio);
    const fin = Math.min(finTomas, t.fin);
    if (fin - ini < 0.3) continue;
    const texto = c.mayusculasTitular ? t.texto.toLocaleUpperCase("es") : t.texto;
    const margenV = t.posicion === "arriba" ? arriba : 0;
    eventos.push(`Dialogue: 1,${ts(ini)},${ts(fin)},Titulo,,0,0,${margenV},,{\\an${alineacion(t.posicion)}\\fad(250,250)}${textoAss(texto)}`);
  }
  for (const s of r.subtitulos) {
    if (s.inicio >= finTomas) continue;
    eventos.push(`Dialogue: 0,${ts(s.inicio)},${ts(Math.min(s.fin, finTomas))},Sub,,0,0,0,,${textoAss(s.texto)}`);
  }
  if (r.cierre.mostrar) {
    const ini = inicios[inicios.length - 1] + 0.3;
    if (r.cierre.titulo) {
      const texto = c.mayusculasTitular ? r.cierre.titulo.toLocaleUpperCase("es") : r.cierre.titulo;
      eventos.push(`Dialogue: 1,${ts(ini)},${ts(total)},CierreTitulo,,0,0,0,,{\\pos(${W / 2},${Math.round(H * 0.6)})\\fad(300,0)}${textoAss(texto)}`);
    }
    if (r.cierre.cta) eventos.push(`Dialogue: 1,${ts(ini + 0.3)},${ts(total)},CierreCta,,0,0,0,,{\\pos(${W / 2},${Math.round(H * 0.72)})\\fad(300,0)}${textoAss(r.cierre.cta.toLocaleUpperCase("es"))}`);
  }
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...estilos,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...eventos,
    "",
  ].join("\n");
}

// ── Preparación de fotos y cierre (sharp) ───────────────────────────────────

/** Foto recortada al formato, al doble de tamaño (margen para el movimiento) y ya graduada como las fotos. */
async function prepararFoto(sharp: Sharp, t: Toma & { fuente: FuenteToma }, r: RecetaVideo, destino: string): Promise<void> {
  const original = await readFile(t.fuente.ruta);
  const meta = await sharp(original).metadata();
  const girada = (meta.orientation ?? 1) >= 5;
  const W = girada ? meta.height! : meta.width!;
  const H = girada ? meta.width! : meta.height!;
  const rc = rectanguloRecorte(W, H, r.ancho, r.alto, t.encuadre);
  const f = factoresFoto(r.tratamiento);
  let g = sharp(original, { failOn: "none", limitInputPixels: 120_000_000 })
    .rotate()
    .extract(rc)
    .resize(r.ancho * 2, r.alto * 2, { fit: "fill", kernel: "lanczos3" })
    .modulate({ brightness: f.brillo, saturation: f.saturacion })
    .linear(f.linealA, f.linealB)
    .recomb([
      [f.rojo, 0, 0],
      [0, 1, 0],
      [0, 0, f.azul],
    ]);
  if (f.nitidezSigma) g = g.sharpen({ sigma: f.nitidezSigma });
  await writeFile(destino, await g.toColourspace("srgb").jpeg({ quality: 92 }).toBuffer());
}

/** Fondo del cierre: color de la marca con el logo grande arriba del centro. */
async function prepararCierre(sharp: Sharp, r: RecetaVideo, destino: string): Promise<void> {
  const fondo = r.marca === "touza" ? "#0a0a0a" : "#394147";
  const logoNombre = r.marca === "touza" ? "touza-cruz-tau-oro.png" : "casa-tomas-logo-blanco.png";
  const capas: sharpTipo.OverlayOptions[] = [];
  try {
    const logo = await sharp(ficheroLogo(logoNombre)).resize({ width: Math.round(r.ancho * (r.marca === "touza" ? 0.22 : 0.42)) }).png().toBuffer({ resolveWithObject: true });
    capas.push({ input: logo.data, left: Math.round((r.ancho - logo.info.width) / 2), top: Math.round(r.alto * 0.42 - logo.info.height) });
  } catch {
    /* sin logo, solo color */
  }
  await sharp({ create: { width: r.ancho, height: r.alto, channels: 3, background: fondo } }).composite(capas).jpeg({ quality: 92 }).toFile(destino);
}

// ── Filtros ─────────────────────────────────────────────────────────────────

const XFADE: Record<Exclude<Transicion, "corte">, string> = { fundido: "fade", deslizar: "slideleft", zoom: "zoomin" };

function zoompan(mov: Movimiento, frames: number, W: number, H: number, fuerza: number): string {
  const A = (0.06 + 0.14 * fuerza).toFixed(3);
  const N = Math.max(1, frames - 1);
  const centro = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
  let z = "1";
  let pos = centro;
  if (mov === "acercar") z = `1+${A}*on/${N}`;
  else if (mov === "alejar") z = `1+${A}-${A}*on/${N}`;
  else if (mov === "izquierda") {
    z = `1+${A}`;
    pos = `x='(iw-iw/zoom)*(1-on/${N})':y='ih/2-(ih/zoom/2)'`;
  } else if (mov === "derecha") {
    z = `1+${A}`;
    pos = `x='(iw-iw/zoom)*on/${N}':y='ih/2-(ih/zoom/2)'`;
  }
  return `zoompan=z='${z}':${pos}:d=1:s=${W}x${H}:fps=${FPS}`;
}

const HDR_A_SDR = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

export interface MontajeArgs {
  args: string[];
  total: number;
}

/**
 * Argumentos de ffmpeg del montaje completo (una sola codificación).
 * `fotosPreparadas[i]` es la ruta de la foto preparada de la toma i (si es foto);
 * `cierre` la del fondo del cierre.
 */
export function argumentosMontaje(r: RecetaVideo, rutas: { fotosPreparadas: (string | null)[]; cierre: string | null; logo: string | null; ass: string; salida: string; fuentes: string }): MontajeArgs {
  const { duraciones, total, T } = planTiempo(r);
  const W = r.ancho;
  const H = r.alto;
  const entradas: string[] = [];
  const filtros: string[] = [];
  const graduacion = filtrosVideo(r.tratamiento).join(",");
  let n = 0;
  const etiquetasV: string[] = [];
  const etiquetasA: string[] = [];

  r.tomas.forEach((t, i) => {
    const d = duraciones[i];
    const frames = Math.round(d * FPS);
    if (t.fuente.medio === "foto") {
      entradas.push("-loop", "1", "-framerate", String(FPS), "-t", d.toFixed(3), "-i", rutas.fotosPreparadas[i] as string);
      const mov = t.movimiento === "ninguno" ? "ninguno" : t.movimiento;
      filtros.push(`[${n}:v]${zoompan(mov, frames, W, H, r.movimiento)},setsar=1,format=yuv420p,trim=duration=${d.toFixed(3)},settb=AVTB,setpts=PTS-STARTPTS[v${i}]`);
      filtros.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    } else {
      entradas.push("-ss", t.inicio.toFixed(3), "-t", d.toFixed(3), "-i", t.fuente.ruta);
      const rc = rectanguloRecorte(t.fuente.ancho, t.fuente.alto, W, H, t.encuadre);
      const cadena = [
        t.fuente.hdr ? HDR_A_SDR : null,
        `crop=${rc.width}:${rc.height}:${rc.left}:${rc.top}`,
        `scale=${W}:${H}:flags=lanczos`,
        "setsar=1",
        `fps=${FPS}`,
        "format=yuv420p",
        graduacion || null,
        `trim=duration=${d.toFixed(3)}`,
        "settb=AVTB",
        "setpts=PTS-STARTPTS",
      ].filter(Boolean);
      filtros.push(`[${n}:v]${cadena.join(",")}[v${i}]`);
      if (r.audio === "original" && t.fuente.tieneAudio) {
        filtros.push(`[${n}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,apad,atrim=duration=${d.toFixed(3)}[a${i}]`);
      } else {
        filtros.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
      }
    }
    etiquetasV.push(`v${i}`);
    etiquetasA.push(`a${i}`);
    n++;
  });

  if (r.cierre.mostrar && rutas.cierre) {
    const i = r.tomas.length;
    const d = DURACION_CIERRE;
    entradas.push("-loop", "1", "-framerate", String(FPS), "-t", d.toFixed(3), "-i", rutas.cierre);
    filtros.push(`[${n}:v]scale=${W}:${H},setsar=1,format=yuv420p,trim=duration=${d.toFixed(3)},settb=AVTB,setpts=PTS-STARTPTS[v${i}]`);
    filtros.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    etiquetasV.push(`v${i}`);
    etiquetasA.push(`a${i}`);
    n++;
  }

  // Encadenar: cortes con concat; transiciones con xfade + acrossfade.
  let vSalida: string;
  let aSalida: string;
  if (etiquetasV.length === 1) {
    vSalida = etiquetasV[0];
    aSalida = etiquetasA[0];
  } else if (r.transicion === "corte" || T === 0) {
    filtros.push(`${etiquetasV.map((v, i) => `[${v}][${etiquetasA[i]}]`).join("")}concat=n=${etiquetasV.length}:v=1:a=1[vcat][acat]`);
    vSalida = "vcat";
    aSalida = "acat";
  } else {
    const tipo = XFADE[r.transicion as Exclude<Transicion, "corte">];
    let previoV = etiquetasV[0];
    let previoA = etiquetasA[0];
    let offset = 0;
    for (let i = 1; i < etiquetasV.length; i++) {
      offset += duraciones[i - 1] - T;
      const esCierre = r.cierre.mostrar && i === etiquetasV.length - 1;
      const nv = `vx${i}`;
      const na = `ax${i}`;
      filtros.push(`[${previoV}][${etiquetasV[i]}]xfade=transition=${esCierre ? "fade" : tipo}:duration=${T.toFixed(3)}:offset=${offset.toFixed(3)}[${nv}]`);
      filtros.push(`[${previoA}][${etiquetasA[i]}]acrossfade=d=${T.toFixed(3)}:c1=tri:c2=tri[${na}]`);
      previoV = nv;
      previoA = na;
    }
    vSalida = previoV;
    aSalida = previoA;
  }

  // Logo en la esquina (no en el cierre, que ya lo lleva grande).
  if (r.logo && rutas.logo) {
    entradas.push("-i", rutas.logo);
    const lados = Math.max(56, r.zonaSegura.lados);
    const arriba = r.zonaSegura.arriba > 100 ? r.zonaSegura.arriba : 56;
    const finLogo = r.cierre.mostrar ? planTiempo(r).inicios[planTiempo(r).inicios.length - 1] : total + 1;
    filtros.push(`[${n}:v]format=rgba[logo]`);
    filtros.push(`[${vSalida}][logo]overlay=x=W-w-${lados}:y=${arriba}:enable='lt(t,${finLogo.toFixed(3)})'[vlogo]`);
    vSalida = "vlogo";
    n++;
  }

  // Títulos, subtítulos y textos del cierre con las fuentes de marca.
  filtros.push(`[${vSalida}]ass=${rutas.ass}:fontsdir=${rutas.fuentes},format=yuv420p[vout]`);
  filtros.push(`[${aSalida}]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);

  const args = [
    "-hide_banner",
    "-y",
    "-nostats",
    ...entradas,
    "-filter_complex",
    filtros.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-t",
    total.toFixed(3),
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-preset",
    process.env.RRSS_X264_PRESET || "veryfast",
    "-crf",
    "21",
    "-maxrate",
    "8M",
    "-bufsize",
    "16M",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-g",
    String(FPS * 2),
    "-flags",
    "+cgop",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-color_range",
    "tv",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    "-use_editlist",
    "0",
    "-progress",
    "pipe:1",
    rutas.salida,
  ];
  return { args, total };
}

export interface VideoMontado {
  mp4: Buffer;
  portada: Buffer;
  duracion: number;
  ancho: number;
  alto: number;
  avisos: string[];
}

export interface OpcionesMontaje {
  ffmpeg: string;
  sharp: Sharp;
  dirTrabajo: string;
  alProgreso?: (fraccion: number) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Monta el vídeo y comprueba el resultado (medidas, duración, H.264 + AAC). */
export async function montarVideo(r: RecetaVideo, o: OpcionesMontaje): Promise<VideoMontado> {
  await mkdir(o.dirTrabajo, { recursive: true });
  const avisos: string[] = [];
  const fotosPreparadas: (string | null)[] = [];
  for (let i = 0; i < r.tomas.length; i++) {
    const t = r.tomas[i];
    if (t.fuente.medio === "foto") {
      const destino = path.join(o.dirTrabajo, `foto-${i}.jpg`);
      await prepararFoto(o.sharp, t, r, destino);
      fotosPreparadas.push(destino);
    } else fotosPreparadas.push(null);
  }
  let cierre: string | null = null;
  if (r.cierre.mostrar) {
    cierre = path.join(o.dirTrabajo, "cierre.jpg");
    await prepararCierre(o.sharp, r, cierre);
  }
  let logo: string | null = null;
  if (r.logo) {
    try {
      logo = path.join(o.dirTrabajo, "logo.png");
      await o.sharp(ficheroLogo(r.composicion.logo)).resize({ width: Math.round(r.ancho * 0.13) }).png().toFile(logo);
    } catch {
      logo = null;
      avisos.push("No se pudo cargar el logo");
    }
  }
  const ass = path.join(o.dirTrabajo, "rotulos.ass");
  await writeFile(ass, construirAss(r), "utf8");
  const salida = path.join(o.dirTrabajo, "salida.mp4");
  const { args, total } = argumentosMontaje(r, { fotosPreparadas, cierre, logo, ass, salida, fuentes: dirFuentes() });
  let ultimo = 0;
  const res = await ejecutar(o.ffmpeg, args, {
    timeoutMs: o.timeoutMs ?? 240_000,
    signal: o.signal,
    alSalir: (l) => {
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(l);
      if (!m || !o.alProgreso) return;
      const t = Number(m[1]) / 1e6;
      const fr = Math.max(0, Math.min(1, t / Math.max(0.1, total)));
      if (fr - ultimo >= 0.05) {
        ultimo = fr;
        o.alProgreso(fr);
      }
    },
  });
  if (res.codigo !== 0) {
    const cola = res.stderr.split("\n").filter((l) => l.trim()).slice(-6).join(" · ");
    throw new ErrorVideoMotor(`ffmpeg no pudo montar el vídeo: ${cola.slice(0, 600)}`);
  }
  const info = await analizarMedio(o.ffmpeg, salida);
  if (info.ancho !== r.ancho || info.alto !== r.alto) throw new ErrorVideoMotor(`El vídeo salió de ${info.ancho}×${info.alto} y no de ${r.ancho}×${r.alto}`);
  if (Math.abs(info.duracion - total) > 0.6) avisos.push(`El vídeo dura ${info.duracion.toFixed(1)} s (se esperaban ${total.toFixed(1)} s)`);
  if (info.codec !== "h264" || !info.tieneAudio) throw new ErrorVideoMotor("El vídeo no salió en H.264 con audio AAC");
  const portadaRuta = path.join(o.dirTrabajo, "portada.jpg");
  await ejecutar(o.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(Math.min(1.2, total / 2)), "-i", salida, "-frames:v", "1", "-q:v", "3", portadaRuta], { timeoutMs: 30_000 });
  const [mp4, portada] = await Promise.all([readFile(salida), readFile(portadaRuta)]);
  const st = await stat(salida);
  if (st.size > 50 * 1024 * 1024) throw new ErrorVideoMotor("El vídeo editado pasa de 50 MB");
  return { mp4, portada, duracion: info.duracion, ancho: info.ancho, alto: info.alto, avisos };
}

export async function limpiar(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}
