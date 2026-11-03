/**
 * Fotos de cámara de 24-48 Mpx (iPhone): Safari limita los lienzos a ~16,7 Mpx
 * y por encima el canvas/bitmap sale vacío o falla sin avisar. La foto se
 * decodifica YA reducida (createImageBitmap con resizeWidth), nunca entera.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bitmapReducido, MAX_PIXELES_LIENZO_IOS, medidasFoto } from "../medidasFoto";

/** JPEG mínimo: SOI + APP0 + SOF0 con las medidas dadas. */
function jpeg(ancho: number, alto: number): Blob {
  const b = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, alto >> 8, alto & 0xff, ancho >> 8, ancho & 0xff, 0x03, 0x01, 0x22, 0x00,
  ]);
  return new Blob([b], { type: "image/jpeg" });
}

/** createImageBitmap como el de iOS: por encima del tope de lienzo, sin reducir, sale vacío. */
function createImageBitmapIos(ancho: number, alto: number) {
  return vi.fn(async (_f: Blob, o: ImageBitmapOptions = {}) => {
    const w = o.resizeWidth ?? ancho;
    const h = o.resizeWidth ? Math.round((alto * o.resizeWidth) / ancho) : alto;
    if (w * h > MAX_PIXELES_LIENZO_IOS) return { width: 0, height: 0, close: vi.fn() } as unknown as ImageBitmap;
    return { width: w, height: h, close: vi.fn() } as unknown as ImageBitmap;
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("decodificar la foto ya reducida", () => {
  it("una foto de 48 Mpx (8064×6048) se decodifica a 1400 de lado, nunca entera", async () => {
    const cib = createImageBitmapIos(8064, 6048);
    vi.stubGlobal("createImageBitmap", cib);
    const foto = jpeg(8064, 6048);
    expect(await medidasFoto(foto)).toEqual({ ancho: 8064, alto: 6048 });
    const bmp = await bitmapReducido(foto, 1400);
    expect(cib).toHaveBeenCalledTimes(1);
    expect(cib.mock.calls[0][1]).toMatchObject({ resizeWidth: 1400, imageOrientation: "from-image" });
    expect([bmp.width, bmp.height]).toEqual([1400, 1050]);
    expect(bmp.width * bmp.height).toBeLessThan(MAX_PIXELES_LIENZO_IOS);
  });

  it("una foto de 24 Mpx vertical también (lado mayor ≤ ~1,4 × el pedido aunque el EXIF gire después)", async () => {
    vi.stubGlobal("createImageBitmap", createImageBitmapIos(5712, 4284));
    const bmp = await bitmapReducido(jpeg(5712, 4284), 1200);
    expect(Math.max(bmp.width, bmp.height)).toBeLessThanOrEqual(1200 * 1.4);
    expect(bmp.width).toBeGreaterThan(0);
  });

  it("si la foto ya es pequeña o no se reconoce, se decodifica tal cual", async () => {
    const cib = createImageBitmapIos(800, 600);
    vi.stubGlobal("createImageBitmap", cib);
    await bitmapReducido(jpeg(800, 600), 1400);
    expect(cib.mock.calls[0][1]).not.toHaveProperty("resizeWidth");
  });
});
