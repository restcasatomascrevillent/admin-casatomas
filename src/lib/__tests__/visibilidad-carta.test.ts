import { describe, expect, it } from "vitest";
import { filtrarPorVisibilidad, visibleEnCasaTomas, visibleEnTouza } from "@/lib/visibilidad-carta";

// Misma regla que la web (web-casatomas: `.eq("activado", true).is("restaurante", true)`).
const ITEMS = [
  { id: "activo-ct", activado: true, restaurante: true, touza: false },
  { id: "desactivado-ct", activado: false, restaurante: true, touza: true },
  { id: "activo-touza", activado: true, restaurante: false, touza: true },
  { id: "sin-dato", activado: null, restaurante: true, touza: null },
];
const ids = (lista: { id: string }[]) => lista.map((i) => i.id);

describe("Visibilidad de la carta en el Gestor web", () => {
  it("se ve en Casa Tomás si está activado Y en su carta (un plato desactivado ya no sale como visible)", () => {
    expect(ids(filtrarPorVisibilidad(ITEMS, "activos"))).toEqual(["activo-ct"]);
    expect(ids(filtrarPorVisibilidad(ITEMS, "inactivos_rest"))).toEqual(["desactivado-ct", "activo-touza", "sin-dato"]);
  });

  it("en Touza, igual con su carta", () => {
    expect(ids(filtrarPorVisibilidad(ITEMS, "activos_touza"))).toEqual(["activo-touza"]);
    expect(ids(filtrarPorVisibilidad(ITEMS, "inactivos_touza"))).toEqual(["activo-ct", "desactivado-ct", "sin-dato"]);
  });

  it("«Todos» no filtra", () => {
    expect(ids(filtrarPorVisibilidad(ITEMS, "todos"))).toEqual(ids(ITEMS));
  });

  it("activado sin valor no cuenta como visible (la web pide activado = true)", () => {
    expect(visibleEnCasaTomas({ activado: null, restaurante: true })).toBe(false);
    expect(visibleEnTouza({ activado: undefined, touza: true })).toBe(false);
  });
});
