/**
 * Conversión de la foto en el navegador (createImageBitmap + OffscreenCanvas
 * simulados: jsdom no decodifica ni pinta) y aptitud para post/story.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALIDAD_JPEG,
  MENSAJE_FORMATO_ILEGIBLE,
  MENSAJE_FORMATO_NO_ADMITIDO,
  aptitudFoto,
  claseDeFichero,
  convertirFoto,
  medidasReducidas,
} from "../convertirFoto";

interface Lienzo {
  ancho: number;
  alto: number;
  ctx: { fillRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn>; fillStyle?: string; imageSmoothingQuality?: string };
  opciones: unknown;
  convertToBlob: ReturnType<typeof vi.fn>;
}

let lienzos: Lienzo[];
/** Tamaño (bytes) del JPEG que «produce» cada calidad. */
let tamanoPorCalidad: (q: number) => number;

function instalar(bitmap: { width: number; height: number } | Error) {
  const close = vi.fn();
  const crear = vi.fn(async () => {
    if (bitmap instanceof Error) throw bitmap;
    return { ...bitmap, close };
  });
  vi.stubGlobal("createImageBitmap", crear);
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      l: Lienzo;
      constructor(ancho: number, alto: number) {
        this.l = {
          ancho,
          alto,
          ctx: { fillRect: vi.fn(), drawImage: vi.fn() },
          opciones: null,
          convertToBlob: vi.fn(async ({ type, quality }: { type: string; quality: number }) => new Blob([new Uint8Array(tamanoPorCalidad(quality))], { type })),
        };
        lienzos.push(this.l);
      }
      getContext(_tipo: string, opciones: unknown) {
        this.l.opciones = opciones;
        return this.l.ctx;
      }
      convertToBlob(o: { type: string; quality: number }) {
        return this.l.convertToBlob(o);
      }
    },
  );
  return { crear, close };
}

const fichero = (nombre: string, tipo: string) => new File([new Uint8Array(10)], nombre, { type: tipo });

beforeEach(() => {
  lienzos = [];
  tamanoPorCalidad = () => 1_500_000;
});
afterEach(() => vi.unstubAllGlobals());

describe("convertirFoto", () => {
  it("aplica la orientación EXIF, reduce el lado mayor a 2560 y saca JPEG sRGB calidad 0,9 con fondo blanco", async () => {
    // Foto de móvil en vertical: el bitmap YA viene girado (imageOrientation: from-image).
    const { crear, close } = instalar({ width: 3024, height: 4032 });
    const r = await convertirFoto(fichero("IMG_0001.jpg", "image/jpeg"));

    expect(crear).toHaveBeenCalledWith(expect.any(File), { imageOrientation: "from-image" });
    expect(r).toMatchObject({ ancho: 1920, alto: 2560, anchoOriginal: 3024, altoOriginal: 4032, calidad: CALIDAD_JPEG });
    expect(r.blob.type).toBe("image/jpeg");
    const [l] = lienzos;
    expect([l.ancho, l.alto]).toEqual([1920, 2560]);
    expect(l.opciones).toMatchObject({ colorSpace: "srgb" });
    expect(l.ctx.fillStyle).toBe("#ffffff");
    expect(l.ctx.fillRect).toHaveBeenCalledWith(0, 0, 1920, 2560);
    expect(l.ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1920, 2560);
    expect(l.convertToBlob).toHaveBeenCalledWith({ type: "image/jpeg", quality: 0.9 });
    expect(close).toHaveBeenCalled();
  });

  it("no amplía las fotos pequeñas", async () => {
    instalar({ width: 800, height: 600 });
    const r = await convertirFoto(fichero("foto.png", "image/png"));
    expect([r.ancho, r.alto]).toEqual([800, 600]);
  });

  it("si pasa de 8 MB baja la calidad; si ni a 0,7 cabe, lo rechaza", async () => {
    instalar({ width: 2560, height: 2560 });
    tamanoPorCalidad = (q) => (q > 0.85 ? 9 * 1024 * 1024 : 7 * 1024 * 1024);
    const r = await convertirFoto(fichero("a.webp", "image/webp"));
    expect(r.calidad).toBe(0.8);

    tamanoPorCalidad = () => 9 * 1024 * 1024;
    await expect(convertirFoto(fichero("a.webp", "image/webp"))).rejects.toThrow(/incluso comprimida; el máximo es 8 MB/);
  });

  it("HEIC que el navegador no sabe leer: mensaje claro", async () => {
    instalar(new Error("InvalidStateError"));
    await expect(convertirFoto(fichero("IMG_0002.HEIC", ""))).rejects.toThrow(MENSAJE_FORMATO_ILEGIBLE);
    await expect(convertirFoto(fichero("x.heif", "image/heif"))).rejects.toThrow(MENSAJE_FORMATO_ILEGIBLE);
  });

  it("HEIC que el navegador sí lee (Safari): se convierte como las demás", async () => {
    instalar({ width: 4032, height: 3024 });
    const r = await convertirFoto(fichero("IMG_0003.heic", "image/heic"));
    expect([r.ancho, r.alto]).toEqual([2560, 1920]);
  });

  it("rechaza lo que no es una foto admitida sin intentar leerlo", async () => {
    const { crear } = instalar({ width: 10, height: 10 });
    await expect(convertirFoto(fichero("menu.pdf", "application/pdf"))).rejects.toThrow(MENSAJE_FORMATO_NO_ADMITIDO);
    await expect(convertirFoto(fichero("anim.gif", "image/gif"))).rejects.toThrow(MENSAJE_FORMATO_NO_ADMITIDO);
    expect(crear).not.toHaveBeenCalled();
  });
});

describe("medidas y aptitud", () => {
  it("medidasReducidas respeta la proporción", () => {
    expect(medidasReducidas(6000, 4000)).toEqual({ ancho: 2560, alto: 1707 });
    expect(medidasReducidas(1000, 1000)).toEqual({ ancho: 1000, alto: 1000 });
  });

  it("claseDeFichero: por tipo MIME o, si no hay, por extensión", () => {
    expect(claseDeFichero({ type: "image/jpeg", name: "x" })).toBe("normal");
    expect(claseDeFichero({ type: "", name: "x.HEIC" })).toBe("heic");
    expect(claseDeFichero({ type: "image/gif", name: "x.gif" })).toBeNull();
  });

  it("misma regla que esAptaPara: post 1080×1350 y story 1080×1920", () => {
    expect(aptitudFoto(1708, 2560)).toEqual({ post: true, story: true, mensaje: null });
    const soloPost = aptitudFoto(1050, 1400);
    expect([soloPost.post, soloPost.story]).toEqual([true, false]);
    expect(soloPost.mensaje).toMatch(/Sirve para post, no para story/);
    const nada = aptitudFoto(500, 500);
    expect([nada.post, nada.story]).toEqual([false, false]);
    expect(nada.mensaje).toMatch(/^Es pequeña: no sirve a sangre en post ni story/);
    expect(nada.mensaje).toMatch(/Puedes subirla igualmente/);
  });
});
