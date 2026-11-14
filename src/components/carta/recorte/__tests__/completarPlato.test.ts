import { describe, expect, it } from "vitest";
import { areaEnvolvente, regionPlato } from "../completarPlato";

const W = 120;
const H = 90;

/** Mesa gris con un plato (elipse blanca) y la comida (círculo rojo) en el centro; el modelo solo marcó la comida. */
function escena({ plato = true, mesaComoPlato = false } = {}) {
  const rgb = new Uint8Array(W * H * 3);
  const alfa = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const dx = x - 60, dy = y - 45;
      const enPlato = plato && (dx / 40) ** 2 + (dy / 32) ** 2 <= 1;
      const enComida = dx * dx + dy * dy <= 14 * 14;
      // mesa con un degradado suave (sombra) que la inundación debe cruzar
      let c = [90 + Math.round(x / 6), 90 + Math.round(x / 6), 95 + Math.round(x / 6)];
      if (mesaComoPlato || enPlato) c = [240, 238, 232];
      if (enComida) c = [190, 40, 30];
      rgb.set(c, i * 3);
      if (enComida) alfa[i] = 255;
    }
  }
  return { rgb, alfa };
}

const area = (m: Uint8Array) => m.reduce((s, v) => s + (v ? 1 : 0), 0);

describe("regionPlato", () => {
  it("añade el plato entero alrededor de la comida", () => {
    const { rgb, alfa } = escena();
    const r = regionPlato(rgb, alfa, W, H);
    expect(r.mascara).not.toBeNull();
    const a = area(r.mascara!);
    const elipse = Math.PI * 40 * 32;
    expect(a).toBeGreaterThan(elipse * 0.9);
    expect(a).toBeLessThan(elipse * 1.1);
    // la mesa no entra
    expect(r.mascara![0]).toBe(0);
    expect(r.mascara![5 * W + 5]).toBe(0);
  });

  it("si no hay plato, deja el recorte del modelo", () => {
    const { rgb, alfa } = escena({ plato: false });
    expect(regionPlato(rgb, alfa, W, H).mascara).toBeNull();
  });

  it("si no se ve el canto (todo es «plato»), no inventa nada", () => {
    const { rgb, alfa } = escena({ mesaComoPlato: true });
    expect(regionPlato(rgb, alfa, W, H).mascara).toBeNull();
  });

  it("sin nada del modelo, null", () => {
    const { rgb } = escena();
    expect(regionPlato(rgb, new Uint8Array(W * H), W, H).mascara).toBeNull();
  });
});

describe("areaEnvolvente", () => {
  it("un rectángulo lleno mide su área", () => {
    const m = new Uint8Array(10 * 10);
    for (let y = 2; y < 6; y++) for (let x = 3; x < 8; x++) m[y * 10 + x] = 1;
    expect(areaEnvolvente(m, 10, 10)).toBe(20);
  });
});
