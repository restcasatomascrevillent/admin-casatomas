import { describe, expect, it } from "vitest";
import { planRecorte, recorteValido } from "../recorteFoto";

describe("recorteValido", () => {
  it("rechaza null, valores no numéricos, fuera de rango y áreas diminutas", () => {
    expect(recorteValido(null)).toBeNull();
    expect(recorteValido({ x: "0", y: 0, w: 1, h: 1 })).toBeNull();
    expect(recorteValido({ x: 0.5, y: 0, w: 0.8, h: 1 })).toBeNull();
    expect(recorteValido({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 })).toBeNull(); // 1 %
    expect(recorteValido({ x: 0, y: 0, w: 0, h: 1 })).toBeNull();
  });
  it("acepta un recorte normal y ajusta pequeños desbordes", () => {
    const n = recorteValido({ x: 0.3, y: 0.1, w: 0.4, h: 0.8 })!;
    expect(n.x).toBeCloseTo(0.3);
    expect(n.w).toBeCloseTo(0.4);
    expect(n.h).toBeCloseTo(0.8);
    const r = recorteValido({ x: -0.01, y: 0.1, w: 0.5, h: 0.905 });
    expect(r?.x).toBe(0);
    expect(r!.y + r!.h).toBeLessThanOrEqual(1);
  });
});

describe("planRecorte", () => {
  it("botella vertical: margen 8 %, lienzo 3:4 y botella centrada", () => {
    const p = planRecorte({ x: 0.4, y: 0.1, w: 0.2, h: 0.8 }, 1000, 1000)!;
    // margen: 0.2*0.08=0.016 en x, 0.8*0.08=0.064 en y
    expect(p.origen).toEqual({ x: 384, y: 36, w: 232, h: 928 });
    expect(p.lienzo.ancho / p.lienzo.alto).toBeCloseTo(3 / 4, 2);
    expect(p.destino.h).toBe(p.lienzo.alto); // limitada por el alto
    expect(p.destino.x).toBe(Math.round((p.lienzo.ancho - p.destino.w) / 2));
  });
  it("el margen no sale de la foto", () => {
    const p = planRecorte({ x: 0, y: 0, w: 0.5, h: 1 }, 800, 1200)!;
    expect(p.origen.x).toBe(0);
    expect(p.origen.y).toBe(0);
    expect(p.origen.h).toBe(1200);
  });
  it("recorte apaisado: se ajusta por el ancho y queda centrado en vertical", () => {
    const p = planRecorte({ x: 0, y: 0.4, w: 1, h: 0.2 }, 1000, 1000)!;
    expect(p.destino.w).toBe(p.lienzo.ancho);
    expect(p.destino.y).toBeGreaterThan(0);
  });
  it("limita el lienzo al lado máximo", () => {
    const p = planRecorte({ x: 0, y: 0, w: 1, h: 1 }, 4000, 4000, 0.08, 3 / 4, 1200)!;
    expect(Math.max(p.lienzo.ancho, p.lienzo.alto)).toBeLessThanOrEqual(1200);
  });
  it("null si el recorte no vale (se usa la foto entera)", () => {
    expect(planRecorte(null, 1000, 1000)).toBeNull();
    expect(planRecorte({ x: 0, y: 0, w: 0.1, h: 0.1 }, 1000, 1000)).toBeNull();
  });
});
