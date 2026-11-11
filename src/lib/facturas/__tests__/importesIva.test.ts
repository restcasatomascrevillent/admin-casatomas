import { describe, expect, it } from "vitest";
import { etiquetaIva, importesIva } from "../importesIva";

describe("importesIva", () => {
  it("base, IVA y su %", () => {
    const i = importesIva({ subtotal: 1100, iva: 231, total: 1331 });
    expect(i).toMatchObject({ base: 1100, iva: 231, ivaPct: 21, variosTipos: false, baseCalculada: false, ivaCalculado: false });
    expect(etiquetaIva(i)).toBe("IVA (21 %)");
  });

  it("varios tipos en el mismo documento: la media", () => {
    const i = importesIva({ subtotal: 200, iva: 31, total: 231 });
    expect(etiquetaIva(i)).toBe("IVA (mezcla, 15,5 %)");
  });

  it("lo que falta se calcula con el total (y la retención)", () => {
    expect(importesIva({ subtotal: null, iva: 21, total: 121 })).toMatchObject({ base: 100, baseCalculada: true, ivaPct: 21 });
    const i = importesIva({ subtotal: 1100, iva: null, total: 1122, retencion_irpf: 209 });
    expect(i).toMatchObject({ iva: 231, ivaCalculado: true });
    expect(etiquetaIva(i)).toBe("IVA (21 %, calculado)");
    expect(importesIva({ subtotal: null, iva: null, total: 50 })).toMatchObject({ base: null, iva: null, ivaPct: null });
  });
});
