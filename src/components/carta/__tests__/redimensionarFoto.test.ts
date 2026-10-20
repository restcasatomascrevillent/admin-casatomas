import { describe, expect, it } from "vitest";
import { LADO_MAX, medidasDestino, pareceVacia } from "../redimensionarFoto";

describe("medidasDestino", () => {
  it("reduce una foto de cámara 4000x3000 al lado máximo manteniendo proporción", () => {
    expect(medidasDestino(4000, 3000)).toEqual({ ancho: LADO_MAX, alto: Math.round(3000 * (LADO_MAX / 4000)) });
  });
  it("foto vertical 3000x4000: el lado mayor es el alto", () => {
    const r = medidasDestino(3000, 4000);
    expect(r.alto).toBe(LADO_MAX);
    expect(r.ancho).toBe(Math.round(3000 * (LADO_MAX / 4000)));
  });
  it("no amplía fotos pequeñas", () => {
    expect(medidasDestino(800, 600)).toEqual({ ancho: 800, alto: 600 });
  });
});

describe("pareceVacia", () => {
  const rgba = (n: number, px: [number, number, number, number]) => {
    const a = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) a.set(px, i * 4);
    return a;
  };
  it("detecta un lienzo negro", () => expect(pareceVacia(rgba(4096, [0, 0, 0, 255]))).toBe(true));
  it("detecta un lienzo transparente", () => expect(pareceVacia(rgba(4096, [200, 200, 200, 0]))).toBe(true));
  it("una imagen con contenido no está vacía", () => {
    const a = rgba(4096, [0, 0, 0, 255]);
    a.set([180, 30, 40, 255], 2000 * 4);
    // muestreo cada 2 píxeles con 4096 → el 2000 se visita
    expect(pareceVacia(a)).toBe(false);
  });
  it("una foto normal (gris medio) no está vacía", () => expect(pareceVacia(rgba(4096, [120, 110, 100, 255]))).toBe(false));
});
