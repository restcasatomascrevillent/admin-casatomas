// @vitest-environment node
/**
 * Trabajador de render de reels (docs/instagram-video.md).
 *
 *  - Sin dependencias externas: argumentos de ffmpeg, bitrate objetivo,
 *    análisis de las cajas del MP4 y lista blanca de URLs de la página.
 *  - Con ffmpeg y el Chromium de Playwright en la máquina: renderiza DE VERDAD
 *    los 2 primeros segundos de la base «Del mar» (con sus fotos de muestra) (página de captura servida por
 *    Vite) y comprueba el MP4 (H.264 1080×1920 30 fps, AAC, moov delante, sin
 *    edts) y la portada. Si falta ffmpeg o Chromium, se salta con un aviso.
 */
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { crearReelDesdeBase } from "@/lib/instagram/reels";
import {
  analizarMp4,
  argumentosFfmpeg,
  buscarFfmpeg,
  maxrateParaObjetivo,
  renderizarReel,
  servirPagina,
  urlPermitida,
} from "../render-reels-lib.mjs";
import { fotosPermitidas, leerConfig, rutasSalida } from "../render-reels.mjs";

const carpetas: string[] = [];
afterAll(async () => {
  for (const c of carpetas) await rm(c, { recursive: true, force: true }).catch(() => {});
});

describe("render-reels: piezas sin dependencias", () => {
  it("ffmpeg: 30 fps, H.264 high yuv420p, AAC 48 kHz estéreo, faststart y sin listas de edición; silencio si no hay pista", () => {
    const a = argumentosFfmpeg({ duracion: 20.5, salida: "out.mp4" }).join(" ");
    for (const trozo of ["-framerate 30", "-c:v libx264", "-profile:v high", "-pix_fmt yuv420p", "-r 30", "-flags +cgop", "-c:a aac", "-b:a 128k", "-ar 48000", "-ac 2", "-movflags +faststart", "-use_editlist 0", "-t 20.500"]) {
      expect(a).toContain(trozo);
    }
    expect(a).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    const conPista = argumentosFfmpeg({ duracion: 20, salida: "o.mp4", audio: "pista.m4a" }).join(" ");
    expect(conPista).toContain("-i pista.m4a");
    expect(conPista).toContain("afade=t=out");
    expect(conPista).not.toContain("anullsrc");
  });

  it("bitrate: un reel de 90 s no pasa de 25 MB; uno corto se queda en 8 Mbps", () => {
    const m = maxrateParaObjetivo(90, 25);
    expect(((m + 128_000) * 90) / 8 / 1048576).toBeLessThan(25);
    expect(maxrateParaObjetivo(10, 25)).toBe(8_000_000);
  });

  it("analizarMp4 distingue moov delante/detrás, edts y lee la duración del mvhd", () => {
    const caja = (tipo: string, cuerpo: Buffer) => {
      const c = Buffer.alloc(8 + cuerpo.length);
      c.writeUInt32BE(8 + cuerpo.length, 0);
      c.write(tipo, 4, "latin1");
      cuerpo.copy(c, 8);
      return c;
    };
    const mvhd = Buffer.alloc(100);
    mvhd.writeUInt32BE(1000, 12); // timescale (versión 0)
    mvhd.writeUInt32BE(20500, 16); // duración
    const moov = caja("moov", caja("mvhd", mvhd));
    const mdat = caja("mdat", Buffer.alloc(16));
    const ftyp = caja("ftyp", Buffer.from("isom0000", "latin1"));
    expect(analizarMp4(Buffer.concat([ftyp, moov, mdat]))).toMatchObject({ faststart: true, edts: false, duracion: 20.5 });
    expect(analizarMp4(Buffer.concat([ftyp, mdat, moov])).faststart).toBe(false);
    const conEdts = caja("moov", Buffer.concat([caja("mvhd", mvhd), caja("trak", caja("edts", Buffer.alloc(8)))]));
    expect(analizarMp4(Buffer.concat([ftyp, conEdts, mdat])).edts).toBe(true);
  });

  it("la página solo puede pedir su origen, las fotos del trabajo y las copias tmp/", () => {
    const o = { origenPagina: "http://127.0.0.1:5000", fotos: ["https://x.supabase.co/storage/v1/object/public/instagram/tmp/a.jpg"], prefijos: ["https://x.supabase.co/storage/v1/object/public/instagram/tmp/"] };
    expect(urlPermitida("http://127.0.0.1:5000/instagram/fuentes/a.woff2", o)).toBe(true);
    expect(urlPermitida("https://x.supabase.co/storage/v1/object/public/instagram/tmp/b.jpg", o)).toBe(true);
    expect(urlPermitida("http://192.168.1.1/admin", o)).toBe(false);
    expect(urlPermitida("https://fonts.googleapis.com/css", o)).toBe(false);
  });
});

describe("render-reels: configuración del trabajador", () => {
  it("pide las variables que faltan sin enseñar valores y acota los números", () => {
    const c = leerConfig({ RENDER_SUPABASE_URL: "https://abc.supabase.co", RENDER_SUPABASE_ANON_KEY: "pub", RENDER_EMAIL: "render@x", RENDER_PASSWORD: "secreta", RENDER_OBJETIVO_MB: "500", RENDER_PAGINA: "vite" });
    expect(c.faltan).toEqual([]);
    expect(c.objetivoMb).toBe(45);
    expect(c.pagina).toBe("vite");
    const mal = leerConfig({ RENDER_SUPABASE_URL: "http://192.168.1.1" });
    expect(mal.faltan.join(" ")).toMatch(/RENDER_SUPABASE_URL.*RENDER_SUPABASE_ANON_KEY.*RENDER_EMAIL.*RENDER_PASSWORD/);
  });

  it("rutas del cubo con la forma que exige instagram_render_terminar", () => {
    const r = rutasSalida({ id: "11111111-2222-4333-8444-555555555555", pieza_id: "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f" }, new Date(Date.UTC(2026, 10, 9)));
    expect(r).toEqual({ video: "reels/2026-11/3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f-11111111.mp4", portada: "reels/2026-11/3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f-11111111.jpg" });
    expect(r.video).toMatch(/^reels\/[0-9]{4}-[0-9]{2}\/[0-9a-f-]{36}-[0-9a-f]{8}\.mp4$/);
  });

  it("solo acepta fotos que son copias tmp/ del cubo instagram de su Supabase", () => {
    const sb = "https://abc.supabase.co";
    const r = fotosPermitidas({ "drive:a": `${sb}/storage/v1/object/public/instagram/tmp/a.jpg`, "drive:b": "https://evil.example/b.jpg", "carta:c": `${sb}/storage/v1/object/public/instagram/tmp/../piezas/x.jpg` }, sb);
    expect(Object.keys(r.buenas)).toEqual(["drive:a"]);
    expect(r.malas).toEqual(["drive:b", "carta:c"]);
  });
});

describe("render-reels: MP4 real de 2 s", async () => {
  const { ffmpeg, ffprobe, origen } = await buscarFfmpeg();
  let chromium = true;
  try {
    const { chromium: c } = await import("playwright-core");
    const nav = await c.launch({ headless: true });
    await nav.close();
  } catch {
    chromium = false;
  }
  const motivo = !ffmpeg ? "no hay ffmpeg en esta máquina" : !chromium ? "no está el Chromium de Playwright (npx playwright install chromium)" : null;
  if (motivo) console.warn(`[render-reels] Se salta la prueba del MP4 real: ${motivo}.`);

  it.skipIf(!!motivo)(
    `genera un MP4 válido para Instagram (ffmpeg: ${origen ?? "—"}, ffprobe: ${ffprobe ? "sí" : "no"})`,
    async () => {
      const carpeta = await mkdtemp(path.join(os.tmpdir(), "reel-prueba-"));
      carpetas.push(carpeta);
      const pagina = await servirPagina({ modo: "vite" });
      try {
        const reel = crearReelDesdeBase("del-mar");
        const progresos: number[] = [];
        const r = await renderizarReel({
          datos: { reel, fotos: {}, limiteSegundos: 2 },
          urlPagina: pagina.url,
          carpeta,
          ffmpeg,
          ffprobe,
          alProgreso: async (p: number) => {
            progresos.push(p);
          },
        });
        expect(r.fotogramas).toBe(60);
        // El AAC añade unas décimas de relleno (priming) a la pista de audio.
        expect(Math.abs(r.duracion - 2)).toBeLessThan(0.1);
        expect(r.bytes).toBeGreaterThan(10_000);
        expect(r.bytes).toBeLessThan(25 * 1024 * 1024);
        expect(progresos.at(-1)).toBe(98);
        const mp4 = await readFile(r.mp4);
        expect(analizarMp4(mp4)).toMatchObject({ faststart: true, edts: false });
        const portada = await readFile(r.portada);
        expect(portada.subarray(0, 2).toString("hex")).toBe("ffd8"); // JPEG
        // RENDER_PRUEBA_GUARDAR=<carpeta>: deja el MP4 y la portada para verlos.
        if (process.env.RENDER_PRUEBA_GUARDAR) {
          await copyFile(r.mp4, path.join(process.env.RENDER_PRUEBA_GUARDAR, "reel-prueba.mp4"));
          await copyFile(r.portada, path.join(process.env.RENDER_PRUEBA_GUARDAR, "reel-prueba-portada.jpg"));
        }
        // El reel de muestra tiene avisos (fotos de muestra), no problemas.
        expect(r.avisos.some((a: string) => /muestra/i.test(a))).toBe(true);
      } finally {
        await pagina.cerrar();
      }
    },
    120_000,
  );
});
