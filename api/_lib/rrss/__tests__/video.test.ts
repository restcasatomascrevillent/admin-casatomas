// @vitest-environment node
/**
 * Motor de vídeo con el ffmpeg estático REAL (ffmpeg-static): clips de prueba
 * hechos con lavfi + una foto de la carta → MP4 montado. Se comprueban las
 * medidas, la duración, los códecs (H.264 + AAC), que los rótulos quedan en
 * la imagen y que las fotos se mueven. Con RRSS_GUARDAR=<carpeta> deja los MP4.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  analizarMedio, argumentosMontaje, colorAss, construirAss, ejecutar, extraerAudio, hojaContactos, inicioTomas, limpiar, montarVideo, parsearInfo,
  recetaVideo, rutaFfmpeg, subtitulosDeTomas, trocearLineas, type FuenteToma,
} from "../video";
import { formatoSalida } from "../../../../src/lib/rrss/formatos";
import type { PiezaVideo } from "../../../../src/lib/rrss/plan";

const FOTO = path.resolve(__dirname, "../../../../public/instagram/reels/muestras/chuleton.jpg");
let ffmpeg = "";
let dir = "";
const guardar = process.env.RRSS_GUARDAR;

async function fotograma(mp4: string, t: number): Promise<Buffer> {
  const destino = path.join(dir, `f-${t}-${Math.random().toString(36).slice(2)}.png`);
  await ejecutar(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(t), "-i", mp4, "-frames:v", "1", destino]);
  return readFileSync(destino);
}

async function diferencia(a: Buffer, b: Buffer, r: { left: number; top: number; width: number; height: number }) {
  const [x, y] = await Promise.all([sharp(a).extract(r).raw().toBuffer(), sharp(b).extract(r).raw().toBuffer()]);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]);
  return s / x.length;
}

beforeAll(async () => {
  ffmpeg = await rutaFfmpeg();
  if (guardar) mkdirSync(guardar, { recursive: true });
  dir = mkdtempSync(path.join(os.tmpdir(), "rrss-video-"));
  // Clip apaisado con audio (tono) y clip vertical girado (metadato de rotación) sin audio.
  await ejecutar(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4:sample_rate=48000", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dir, "apaisado.mp4")]);
  await ejecutar(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=720x1280:r=30:d=3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path.join(dir, "girado.mp4")]);
  copyFileSync(FOTO, path.join(dir, "foto.jpg"));
}, 60_000);

afterAll(async () => {
  if (dir) await limpiar(dir);
});

describe("análisis", () => {
  it("lee duración, medidas giradas, audio y HDR de la cabecera de ffmpeg", async () => {
    const a = await analizarMedio(ffmpeg, path.join(dir, "apaisado.mp4"));
    expect([a.ancho, a.alto, a.tieneAudio, a.codec, a.hdr]).toEqual([1920, 1080, true, "h264", false]);
    expect(a.duracion).toBeCloseTo(4, 0);
    const g = await analizarMedio(ffmpeg, path.join(dir, "girado.mp4"));
    expect([g.ancho, g.alto, g.tieneAudio]).toEqual([720, 1280, false]);
    // Móvil en vertical: 1920x1080 con la matriz de rotación → se ve 1080x1920.
    const movil = parsearInfo("Duration: 00:00:03.00,\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080, 30 fps\n    Side data:\n      displaymatrix: rotation of -90.00 degrees");
    expect([movil.ancho, movil.alto, movil.rotacion]).toEqual([1080, 1920, -90]);
    expect(parsearInfo("Duration: 00:00:05.00,\n  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 1920x1080, 29.97 fps").hdr).toBe(true);
  });

  it("hace la hoja de contactos (9 fotogramas con su segundo) y saca el audio para transcribir", async () => {
    const info = await analizarMedio(ffmpeg, path.join(dir, "apaisado.mp4"));
    const h = await hojaContactos(ffmpeg, sharp, path.join(dir, "apaisado.mp4"), info, dir);
    const m = await sharp(h.jpeg).metadata();
    expect(m.width).toBe(960);
    expect(h.instantes).toHaveLength(9);
    const audio = await extraerAudio(ffmpeg, path.join(dir, "apaisado.mp4"), path.join(dir, "audio.m4a"));
    expect(audio?.volumenMedio).toBeGreaterThan(-40);
    const ai = await ejecutar(ffmpeg, ["-hide_banner", "-i", audio!.ruta]);
    expect(ai.stderr).toMatch(/Audio: aac[^\n]*16000 Hz, mono/);
  }, 60_000);
});

describe("receta y textos", () => {
  it("calcula cuándo entra cada toma con los solapes", () => {
    expect(inicioTomas([3, 2, 4], "fundido", 0.5)).toEqual([0, 2.5, 4]);
    expect(inicioTomas([3, 2, 4], "corte", 0.5)).toEqual([0, 3, 5]);
  });

  it("pasa la transcripción al tiempo del vídeo final y la trocea en dos líneas", () => {
    const subs = subtitulosDeTomas(
      [{ archivo: "a", medio: "video", inicio: 10, fin: 14 }, { archivo: "b", medio: "video", inicio: 0, fin: 3 }],
      [0, 3.5],
      new Map([
        ["a", [{ inicio: 9, fin: 11, texto: "hola" }, { inicio: 12, fin: 13, texto: "esto es una frase bastante larga que hay que partir en varias líneas para que se lea bien" }]],
        ["b", [{ inicio: 1, fin: 2, texto: "segundo clip" }]],
      ]),
    );
    expect(subs[0]).toEqual({ inicio: 0, fin: 1, texto: "hola" });
    expect(subs.at(-1)).toEqual({ inicio: 4.5, fin: 5.5, texto: "segundo clip" });
    expect(subs.every((s) => s.texto.split("\n").length <= 2)).toBe(true);
    expect(trocearLineas("a b c", 3)).toEqual(["a b", "c"]);
  });

  it("colores ASS", () => {
    expect(colorAss("#394147")).toBe("&H00474139");
    expect(colorAss("rgba(10,10,10,0.5)")).toBe("&H800A0A0A");
  });
});

function fuentes(): Map<string, FuenteToma> {
  return new Map<string, FuenteToma>([
    ["clipA", { ruta: path.join(dir, "apaisado.mp4"), medio: "video", ancho: 1920, alto: 1080, tieneAudio: true, hdr: false }],
    ["clipB", { ruta: path.join(dir, "girado.mp4"), medio: "video", ancho: 720, alto: 1280, tieneAudio: false, hdr: false }],
    ["foto", { ruta: path.join(dir, "foto.jpg"), medio: "foto", ancho: 720, alto: 755, tieneAudio: false, hdr: false }],
  ]);
}

describe("montarVideo", () => {
  it("monta un reel 9:16 con clips, foto en movimiento, transiciones, títulos, subtítulos, logo y cierre", async () => {
    const pieza: PiezaVideo = {
      tipo: "video",
      tomas: [
        { archivo: "clipA", medio: "video", inicio: 0.5, fin: 3, encuadre: { x: 0.5, y: 0.5, zoom: 1 }, movimiento: "ninguno", motivo: "" },
        { archivo: "foto", medio: "foto", inicio: 0, fin: 2.5, encuadre: { x: 0.5, y: 0.5, zoom: 1 }, movimiento: "acercar", motivo: "" },
        { archivo: "clipB", medio: "video", inicio: 0, fin: 2.5, encuadre: { x: 0.5, y: 0.5, zoom: 1.2 }, movimiento: "ninguno", motivo: "" },
      ],
      titulos: [{ texto: "Chuletón a la brasa", inicio: 0.2, fin: 2.2, posicion: "abajo" }],
      subtitulos: true,
      transicion: "fundido",
      duracionTransicion: 0.5,
      audio: "original",
      correccion: { exposicion: 0, contraste: 0, saturacion: 0, temperatura: 0, nitidez: 0 },
      cierre: { mostrar: true, titulo: "Te esperamos", cta: "Reserva tu mesa" },
      logo: true,
      nota: "",
    };
    const r = recetaVideo(pieza, "casa-tomas", "elegante", formatoSalida("instagram", "reel", true), fuentes(), new Map([["clipA", [{ inicio: 1, fin: 2.4, texto: "Así sale de la brasa" }]]]));
    expect(r.subtitulos).toEqual([{ inicio: 0.5, fin: 1.9, texto: "Así sale de la brasa" }]);
    expect(construirAss(r)).toMatch(/Dialogue: 1,0:00:00.20,0:00:02.20,Titulo/);
    const v = await montarVideo(r, { ffmpeg, sharp, dirTrabajo: path.join(dir, "reel") });
    expect([v.ancho, v.alto]).toEqual([1080, 1920]);
    // 2,5 + 2,5 + 2,5 + cierre 2,6 − 3 fundidos de 0,5 = 8,6 s
    expect(v.duracion).toBeGreaterThan(8.2);
    expect(v.duracion).toBeLessThan(9);
    const salida = path.join(dir, "reel", "salida.mp4");
    const info = await ejecutar(ffmpeg, ["-hide_banner", "-i", salida]);
    expect(info.stderr).toMatch(/Video: h264 \(High\)[^\n]*yuv420p/);
    expect(info.stderr).toMatch(/Audio: aac[^\n]*48000 Hz, stereo/);
    expect((await sharp(v.portada).metadata()).width).toBe(1080);
    // Título a 1 s: zona baja distinta de la del mismo clip sin título (a 2,4 s ya se ha ido).
    const conTitulo = await fotograma(salida, 1.0);
    const zonaTitulo = { left: 100, top: 1920 - 320 - 30 - 260, width: 880, height: 200 };
    const sinTitulo = await fotograma(salida, 2.45);
    expect(await diferencia(conTitulo, sinTitulo, zonaTitulo)).toBeGreaterThan(5);
    // La foto se mueve: dos instantes de su toma difieren.
    const f1 = await fotograma(salida, 2.7);
    const f2 = await fotograma(salida, 4.3);
    expect(await diferencia(f1, f2, { left: 200, top: 600, width: 680, height: 700 })).toBeGreaterThan(2);
    // Cierre: fondo pizarra de la marca.
    const cierre = await fotograma(salida, 8.3);
    const st = await sharp(cierre).extract({ left: 0, top: 1700, width: 200, height: 100 }).stats();
    expect(st.channels[0].mean).toBeGreaterThan(45);
    expect(st.channels[0].mean).toBeLessThan(70);
    if (guardar) {
      mkdirSync(guardar, { recursive: true });
      writeFileSync(path.join(guardar, "reel.mp4"), v.mp4);
      writeFileSync(path.join(guardar, "reel-portada.jpg"), v.portada);
      writeFileSync(path.join(guardar, "reel-titulo.png"), conTitulo);
    }
  }, 180_000);

  it("pieza animada de fotos al corte, 1:1 para Facebook, en silencio", async () => {
    const pieza: PiezaVideo = {
      tipo: "video",
      tomas: [
        { archivo: "foto", medio: "foto", inicio: 0, fin: 2, encuadre: { x: 0.5, y: 0.5, zoom: 1 }, movimiento: "izquierda", motivo: "" },
        { archivo: "foto", medio: "foto", inicio: 0, fin: 2, encuadre: { x: 0.4, y: 0.5, zoom: 1.5 }, movimiento: "alejar", motivo: "" },
      ],
      titulos: [],
      subtitulos: false,
      transicion: "corte",
      duracionTransicion: 0,
      audio: "silencio",
      correccion: { exposicion: 0.2, contraste: 0, saturacion: 0, temperatura: 0, nitidez: 0 },
      cierre: { mostrar: false },
      logo: false,
      nota: "",
    };
    const r = recetaVideo(pieza, "touza", "moderno", formatoSalida("facebook", "animada"), fuentes());
    const { args } = argumentosMontaje(r, { fotosPreparadas: ["a", "b"], cierre: null, logo: null, ass: "x.ass", salida: "s.mp4", fuentes: "/f" });
    expect(args.join(" ")).toMatch(/concat=n=2:v=1:a=1/);
    const v = await montarVideo(r, { ffmpeg, sharp, dirTrabajo: path.join(dir, "animada") });
    expect([v.ancho, v.alto]).toEqual([1080, 1080]);
    expect(v.duracion).toBeCloseTo(4, 0);
    if (guardar) writeFileSync(path.join(guardar, "animada.mp4"), v.mp4);
  }, 120_000);
});
