// Cifras que nunca se cortan (06/11/2026): de la forma más larga a la más corta.
import { describe, expect, it } from "vitest";
import { formasEntero, formasImporte, importeAbreviado, importeCompleto } from "../cifras";

const sinNbsp = (s: string) => s.replace(/\u00a0/g, " ");

describe("formasImporte", () => {
  it("completa → sin céntimos → abreviada («1,36 M €»)", () => {
    expect(formasImporte(1362491.57).map(sinNbsp)).toEqual(["1.362.491,57 €", "1.362.492 €", "1,36 M €"]);
  });

  it("los abonos con el «−» tipográfico en todas las formas", () => {
    expect(formasImporte(-14376.94).map(sinNbsp)).toEqual(["−14.376,94 €", "−14.377 €", "−14,4 k €"]);
  });

  it("sin repetir formas iguales (cifras pequeñas)", () => {
    expect(formasImporte(850).map(sinNbsp)).toEqual(["850,00 €", "850 €"]);
    expect(formasImporte(0).map(sinNbsp)).toEqual(["0,00 €", "0 €"]);
  });

  it("sin dato, un guion", () => {
    expect(formasImporte(null)).toEqual(["—"]);
    expect(formasImporte(Number.NaN)).toEqual(["—"]);
  });

  it("la completa es la misma que en el resto de Facturas (punto de miles también con 4 cifras)", () => {
    expect(sinNbsp(importeCompleto(1234.5))).toBe("1.234,50 €");
    expect(sinNbsp(importeAbreviado(28565.76))).toBe("28,6 k €");
    expect(sinNbsp(importeAbreviado(2_000_000))).toBe("2 M €");
  });
});

describe("formasEntero", () => {
  it("con punto de miles; la corta solo a partir de 10.000", () => {
    expect(formasEntero(39)).toEqual(["39"]);
    expect(formasEntero(1883)).toEqual(["1.883"]);
    expect(formasEntero(12321).map(sinNbsp)).toEqual(["12.321", "12,3 k"]);
  });
});
