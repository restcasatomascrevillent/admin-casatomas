import { describe, expect, it } from "vitest";
import { debeTrocear, planificarFranjas, UMBRAL_RELACION } from "../troceado";

// Tamaños REALES de los 19 originales (C:\Users\migue\Desktop\Oficiosos\facturas).
const BANCO: [string, number, number, boolean][] = [
  ["21 Osborne", 2040, 1148, false], ["22", 1600, 900, false], ["23 Guillén", 1152, 2048, false],
  ["24 Candela", 2040, 1148, false], ["25 Joselito", 1148, 2040, false], ["26 Garre", 2040, 1148, false],
  ["27 Osborne", 1600, 900, false], ["28 Joselito", 2040, 1148, false], ["29 Angelmar", 738, 1600, false],
  ["30 Campoluz", 899, 1599, false], ["31 Luga", 945, 2048, true], ["32 Enchenta", 1192, 2048, false],
  ["33 Campoluz", 899, 1599, false], ["34 Santacruz", 1290, 1867, false], ["35 33/35", 900, 1600, false],
  ["36 Equipalia", 945, 2048, true], ["37 Flope", 1290, 1971, false], ["38 Ínsula", 1148, 2040, false],
  ["39 Flope", 1236, 2048, false],
];

describe("umbral de troceado (fijado con el banco de 19 documentos)", () => {
  it.each(BANCO)("%s (%i×%i) → trocear=%s", (_n, w, h, esperado) => {
    expect(debeTrocear(w, h)).toBe(esperado);
  });
  it("solo las capturas de móvil de un PDF (relación ≥ 1,9) se trocean; una hoja A4 en foto no", () => {
    expect(UMBRAL_RELACION).toBeGreaterThan(297 / 210);
    expect(debeTrocear(1240, 1754)).toBe(false); // A4 a 150 DPI
    expect(debeTrocear(736, 1600)).toBe(false); // captura de WhatsApp (factura 374): 1 llamada, no 5 franjas
    expect(debeTrocear(400, 1200)).toBe(false); // ticket pequeño: no compensa
    expect(debeTrocear(0, 0)).toBe(false);
  });
});

describe("planificarFranjas", () => {
  it("Luga 945×2048: franjas de ~0,55×ancho con solape, cubren toda la imagen", () => {
    const f = planificarFranjas(945, 2048);
    expect(f.length).toBe(5);
    expect(f[0].y).toBe(0);
    expect(f[f.length - 1].y + f[f.length - 1].alto).toBe(2048);
    for (let i = 1; i < f.length; i++) {
      const solape = f[i - 1].y + f[i - 1].alto - f[i].y;
      expect(solape).toBeGreaterThanOrEqual(80);
      expect(solape).toBeLessThanOrEqual(90);
    }
    for (const x of f.slice(0, -1)) expect(x.alto / 945).toBeCloseTo(0.55, 1);
  });
  it("no deja una última franja enana", () => {
    const f = planificarFranjas(1000, 2210);
    expect(f[f.length - 1].alto).toBeGreaterThan(0.35 * 550);
  });
  it("una imagen poco más alta que una franja va entera", () => {
    expect(planificarFranjas(1000, 600)).toEqual([{ indice: 1, y: 0, alto: 600 }]);
  });
  it("una imagen larguísima se limita a 12 franjas que cubren todo", () => {
    const f = planificarFranjas(500, 20000);
    expect(f.length).toBe(12);
    expect(f[11].y + f[11].alto).toBe(20000);
    for (let i = 1; i < f.length; i++) expect(f[i].y).toBeLessThan(f[i - 1].y + f[i - 1].alto);
  });
});
