import { describe, expect, it } from "vitest";
import {
  apertura,
  desenfoqueGauss,
  minMaxAUint8,
  normalizarEntrada,
  nucleoGauss,
  postprocesarMascara,
} from "../recorte/mascaraRecorte";

describe("normalizarEntrada (como rembg: im / max(im) - 0.5, CHW)", () => {
  it("divide por el máximo de la imagen y separa canales", () => {
    // 2×2: píxel 0 = (100, 50, 0), resto negro. Máximo = 100.
    const rgba = new Uint8ClampedArray(2 * 2 * 4);
    rgba.set([100, 50, 0, 255], 0);
    const t = normalizarEntrada(rgba, 2);
    expect(t.length).toBe(12);
    expect(t[0]).toBeCloseTo(0.5); // R píxel 0: 100/100 - 0.5
    expect(t[4]).toBeCloseTo(0); // G píxel 0: 50/100 - 0.5
    expect(t[8]).toBeCloseTo(-0.5); // B píxel 0
    expect(t[1]).toBeCloseTo(-0.5); // R píxel 1 (negro)
  });
});

describe("minMaxAUint8", () => {
  it("estira al rango 0–255", () => {
    expect(Array.from(minMaxAUint8([2, 4, 6]))).toEqual([0, 127, 255]);
  });
  it("mapa constante → todo 0", () => {
    expect(Array.from(minMaxAUint8([3, 3]))).toEqual([0, 0]);
  });
});

describe("postproceso de máscara (rembg post_process)", () => {
  it("la apertura quita un píxel suelto y conserva un bloque", () => {
    const w = 7;
    const m = new Uint8Array(w * w);
    m[0] = 255; // ruido aislado
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) m[y * w + x] = 255;
    const a = apertura(m, w, w);
    expect(a[0]).toBe(0);
    expect(a[3 * w + 3]).toBe(255);
  });

  it("el núcleo gaussiano suma 1 y tiene radio 4σ", () => {
    const k = nucleoGauss(2);
    expect(k.length).toBe(17);
    expect(k.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 5);
  });

  it("el desenfoque conserva una imagen constante", () => {
    const d = desenfoqueGauss(new Uint8Array(25).fill(200), 5, 5, 2);
    d.forEach((v) => expect(v).toBeCloseTo(200, 3));
  });

  it("devuelve máscara binaria: bloque grande dentro, fondo fuera", () => {
    const w = 40;
    const m = new Uint8Array(w * w);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) m[y * w + x] = 255;
    const out = postprocesarMascara(m, w, w);
    expect(new Set(out)).toEqual(new Set([0, 255]));
    expect(out[20 * w + 20]).toBe(255);
    expect(out[2 * w + 2]).toBe(0);
  });
});
