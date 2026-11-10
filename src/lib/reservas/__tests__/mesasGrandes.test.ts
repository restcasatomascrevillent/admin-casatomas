/**
 * Mesas grandes de «Hoy» de escritorio: rejilla por número, siempre dentro del hueco (el modo «Plano» se quitó
 * el 08/11/2026).
 */
import { describe, it, expect } from "vitest";
import { compararNombreMesa, medidasTarjetas, rejillaOrdenadas, unidadesMesas } from "../mesasGrandes";

describe("unidadesMesas", () => {
  it("las mesas unidas son una sola tarjeta", () => {
    const u = unidadesMesas([{ id: "a" }, { id: "b" }, { id: "c" }], [{ ids: ["a", "b"] }]);
    expect(u.map((x) => x.ids)).toEqual([["a", "b"], ["c"]]);
  });
});

describe("«Ordenadas»", () => {
  it("orden natural por número: el 10 después del 9", () => {
    expect(["10", "2", "1", "9", "14"].sort(compararNombreMesa)).toEqual(["1", "2", "9", "10", "14"]);
  });

  it("rejillaOrdenadas: todas caben sin scroll y las tarjetas no son más altas que anchas", () => {
    for (const [n, ancho, alto] of [[13, 760, 520], [16, 520, 470], [3, 900, 560], [1, 300, 200]]) {
      const r = rejillaOrdenadas(n, ancho, alto);
      expect(r.filas * r.columnas).toBeGreaterThanOrEqual(n);
      expect(r.columnas * r.tarjetaAncho + (r.columnas - 1) * r.hueco + 16).toBeLessThanOrEqual(ancho);
      expect(r.filas * r.tarjetaAlto + (r.filas - 1) * r.hueco + 16).toBeLessThanOrEqual(alto);
      expect(r.tarjetaAlto).toBeLessThanOrEqual(r.tarjetaAncho);
      expect(r.tarjetaAlto).toBeGreaterThanOrEqual(44);
    }
  });

  it("tarjetas pequeñas (10/11/2026): como mucho 144 × 100 aunque sobre sitio", () => {
    const r = rejillaOrdenadas(3, 1200, 800);
    expect(r.tarjetaAncho).toBeLessThanOrEqual(144);
    expect(r.tarjetaAlto).toBeLessThanOrEqual(100);
    expect(r.tarjetaAlto).toBeGreaterThanOrEqual(92); // con el nombre de la reserva dentro
  });

  it("medidasTarjetas nunca se pasa del hueco", () => {
    const { tarjetaAncho, tarjetaAlto, hueco } = medidasTarjetas(480, 560, 6, 3);
    expect(3 * tarjetaAncho + 2 * hueco + 16).toBeLessThanOrEqual(480);
    expect(6 * tarjetaAlto + 5 * hueco + 16).toBeLessThanOrEqual(560);
  });
});
