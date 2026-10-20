import { describe, expect, it } from "vitest";
import { normalizarUnidadFactura } from "../unidad";

describe("normalizarUnidadFactura (mismo mapa que magnitudes.ts y la función SQL)", () => {
  it.each([
    ["uds", "ud"], ["unidades", "ud"], ["Ud.", "ud"], [" U ", "ud"], ["UN", "ud"], ["unid.", "ud"], ["Unidád", "ud"],
    ["kg", "kg"], ["kgs", "kg"], ["Kilos", "kg"], ["KG.", "kg"], ["k g", "kg"],
    ["l", "l"], ["lt", "l"], ["Litros", "l"],
  ])("%s → %s", (entrada, esperado) => {
    expect(normalizarUnidadFactura(entrada)).toBe(esperado);
  });

  it("vacío, espacios o null → ud", () => {
    expect(normalizarUnidadFactura("")).toBe("ud");
    expect(normalizarUnidadFactura("  .  ")).toBe("ud");
    expect(normalizarUnidadFactura(null)).toBe("ud");
    expect(normalizarUnidadFactura(undefined)).toBe("ud");
  });

  it("no inventa equivalencias: caja, ca, docena, m, ml, g se dejan en minúsculas", () => {
    expect(normalizarUnidadFactura("Caja")).toBe("caja");
    expect(normalizarUnidadFactura("CA")).toBe("ca");
    expect(normalizarUnidadFactura(" Docena ")).toBe("docena");
    expect(normalizarUnidadFactura("m")).toBe("m");
    expect(normalizarUnidadFactura("ml")).toBe("ml");
    expect(normalizarUnidadFactura("g")).toBe("g");
    expect(normalizarUnidadFactura("Pza.")).toBe("pza.");
  });

  it("es idempotente", () => {
    for (const u of ["uds", "Kilos", "lt", "caja", "", null]) {
      const una = normalizarUnidadFactura(u);
      expect(normalizarUnidadFactura(una)).toBe(una);
    }
  });
});
