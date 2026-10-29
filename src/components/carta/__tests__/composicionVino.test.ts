import { describe, expect, it } from "vitest";
import {
  ALTURA_BOTELLA,
  ANCHO_MAX_BOTELLA,
  LIENZO_ALTO,
  LIENZO_ANCHO,
  LINEA_BASE,
  anchoBaseOpaca,
  cajaOpaca,
  conAlfaMitad,
  planComposicion,
} from "../composicionVino";
import { esFotoCarta, nombreSubida, rutaCartaDesdeOriginal, rutaOriginalDesdeCarta } from "../rutasFotoCarta";

/** Buffer RGBA ancho×alto con un rectángulo opaco (alfa 255). */
function rgbaConRect(ancho: number, alto: number, r: { x: number; y: number; w: number; h: number }) {
  const d = new Uint8ClampedArray(ancho * alto * 4);
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) d[(y * ancho + x) * 4 + 3] = 255;
  return d;
}

describe("cajaOpaca", () => {
  it("recorta los márgenes transparentes", () => {
    const d = rgbaConRect(40, 60, { x: 10, y: 5, w: 8, h: 50 });
    expect(cajaOpaca(d, 40, 60)).toEqual({ x: 10, y: 5, w: 8, h: 50 });
  });
  it("ignora el alfa por debajo del umbral (halo del recorte)", () => {
    const d = rgbaConRect(20, 20, { x: 5, y: 5, w: 4, h: 4 });
    d[(0 * 20 + 0) * 4 + 3] = 10;
    expect(cajaOpaca(d, 20, 20)).toEqual({ x: 5, y: 5, w: 4, h: 4 });
  });
  it("null si todo es transparente", () => {
    expect(cajaOpaca(new Uint8ClampedArray(10 * 10 * 4), 10, 10)).toBeNull();
  });
});

describe("anchoBaseOpaca", () => {
  it("mide el ancho de las últimas filas (base), no el de la caja", () => {
    // Botella: cuello estrecho arriba (2 px) y cuerpo de 8 px abajo, caja de 8.
    const d = rgbaConRect(20, 50, { x: 6, y: 0, w: 2, h: 20 });
    const cuerpo = rgbaConRect(20, 50, { x: 3, y: 20, w: 8, h: 30 });
    for (let i = 3; i < d.length; i += 4) d[i] = Math.max(d[i], cuerpo[i]);
    const caja = cajaOpaca(d, 20, 50)!;
    expect(anchoBaseOpaca(d, 20, caja)).toBe(8);
  });
});

describe("planComposicion", () => {
  it("escala a la misma altura y apoya en la misma línea de base", () => {
    const base = Math.round(LIENZO_ALTO * LINEA_BASE);
    for (const origen of [
      { x: 0, y: 0, w: 200, h: 900 },
      { x: 50, y: 10, w: 400, h: 1500 },
    ]) {
      const p = planComposicion(origen, origen.w);
      expect(p.destino.h).toBe(Math.round(LIENZO_ALTO * ALTURA_BOTELLA));
      expect(p.destino.y + p.destino.h).toBe(base);
      expect(p.base).toBe(base);
      // centrada
      expect(Math.abs(p.destino.x * 2 + p.destino.w - LIENZO_ANCHO)).toBeLessThanOrEqual(1);
    }
  });
  it("limita el ancho de botellas muy anchas", () => {
    const p = planComposicion({ x: 0, y: 0, w: 1000, h: 1000 }, 1000);
    expect(p.destino.w).toBeLessThanOrEqual(Math.round(LIENZO_ANCHO * ANCHO_MAX_BOTELLA));
    expect(p.destino.y + p.destino.h).toBe(p.base);
  });
  it("escala el ancho de la base", () => {
    const p = planComposicion({ x: 0, y: 0, w: 100, h: 960 }, 80);
    expect(p.anchoBase).toBe(Math.round(80 * p.escala));
  });
});

describe("conAlfaMitad", () => {
  it("divide el alfa entre dos", () => {
    expect(conAlfaMitad("rgba(10, 20, 30, 0.5)")).toBe("rgba(10, 20, 30, 0.25)");
    expect(conAlfaMitad("#fff")).toBe("#fff");
  });
});

describe("rutas de foto de carta", () => {
  const url = "https://x.supabase.co/storage/v1/object/public/vinos/6d6c-aa.webp?t=1";
  it("deriva la ruta de carta sin perder la extensión original", () => {
    expect(rutaCartaDesdeOriginal("6d6c-aa.webp")).toBe("6d6c-aa-carta-webp.webp");
    expect(rutaCartaDesdeOriginal("dir/foto.JPEG")).toBe("dir/foto-carta-jpeg.webp");
  });
  it("vuelve a la original (deshacer) y quita el ?t=", () => {
    const carta = url.replace("6d6c-aa.webp", "6d6c-aa-carta-webp.webp");
    expect(rutaOriginalDesdeCarta(carta)).toBe(url.split("?")[0]);
    expect(rutaOriginalDesdeCarta("x/abc-carta.webp")).toBeNull();
    expect(rutaOriginalDesdeCarta(url)).toBeNull();
  });
  it("detecta las procesadas", () => {
    expect(esFotoCarta(url)).toBe(false);
    expect(esFotoCarta("a-carta-jpg.webp?t=2")).toBe(true);
    expect(esFotoCarta("id-carta.jpg")).toBe(true);
  });
  it("nombra las subidas del formulario", () => {
    expect(nombreSubida("v1", new File(["x"], "botella-carta.webp"))).toBe("v1-carta.webp");
    expect(nombreSubida("v1", new File(["x"], "IMG_1.JPG"))).toBe("v1.jpg");
  });
});
