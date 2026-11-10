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

describe("«Apto para celíacos» y «Apto sin lactosa» a mano", () => {
  it("solo true/false cuentan como decidido a mano", async () => {
    const { leerAptitudManual } = await import("@/lib/dietas-plato");
    expect(leerAptitudManual(true)).toBe(true);
    expect(leerAptitudManual(false)).toBe(false);
    expect(leerAptitudManual(null)).toBeNull();
    expect(leerAptitudManual(undefined)).toBeNull();
    expect(leerAptitudManual("true")).toBeNull();
  });
  it("al pulsar, si coincide con los alérgenos vuelve a automático", async () => {
    const { aptitudTrasPulsar } = await import("@/lib/dietas-plato");
    expect(aptitudTrasPulsar(true, true)).toBeNull();
    expect(aptitudTrasPulsar(false, false)).toBeNull();
    expect(aptitudTrasPulsar(false, true)).toBe(false);
    expect(aptitudTrasPulsar(true, false)).toBe(true);
  });
  it("solo manda la columna que cambia", async () => {
    const { cambiosAptitudesManuales } = await import("@/lib/dietas-plato");
    expect(cambiosAptitudesManuales({}, { apto_celiacos: null, apto_sin_lactosa: null })).toEqual({});
    expect(cambiosAptitudesManuales({ apto_celiacos: null }, { apto_celiacos: true, apto_sin_lactosa: null })).toEqual({ apto_celiacos: true });
    expect(cambiosAptitudesManuales({ apto_celiacos: true, apto_sin_lactosa: false }, { apto_celiacos: true, apto_sin_lactosa: null }))
      .toEqual({ apto_sin_lactosa: null });
  });
  it("detecta si la BD ya tiene las columnas", async () => {
    const { aptitudesManualesDisponibles } = await import("@/lib/dietas-plato");
    expect(aptitudesManualesDisponibles({ id: "p", apto_celiacos: null })).toBe(true);
    expect(aptitudesManualesDisponibles({ id: "p" })).toBe(false);
    expect(aptitudesManualesDisponibles(null)).toBe(false);
  });
});
