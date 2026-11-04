import { describe, expect, it } from "vitest";
import { cambioVegetariano, esVegetariano } from "@/lib/dietas-plato";

describe("Casilla «Vegetariano» de los platos", () => {
  it("lee lo guardado (y un vegano cuenta como vegetariano)", () => {
    expect(esVegetariano(null)).toBe(false);
    expect(esVegetariano(undefined)).toBe(false);
    expect(esVegetariano([])).toBe(false);
    expect(esVegetariano(["vegetariano"])).toBe(true);
    expect(esVegetariano(["vegano"])).toBe(true);
    expect(esVegetariano('["vegetariano"]')).toBe(true);
    expect(esVegetariano(["sin gluten"])).toBe(false);
  });
  it("solo manda la columna si cambia", () => {
    expect(cambioVegetariano(undefined, false)).toEqual({});
    expect(cambioVegetariano(["vegetariano"], true)).toEqual({});
    expect(cambioVegetariano(null, true)).toEqual({ etiquetas_dieteticas: ["vegetariano"] });
    expect(cambioVegetariano(["vegano"], true)).toEqual({});
    expect(cambioVegetariano(["vegetariano", "vegano"], false)).toEqual({ etiquetas_dieteticas: null });
  });
});
