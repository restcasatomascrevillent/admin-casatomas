import { describe, expect, it } from "vitest";
import {
  normalizarUnidadPlato,
  gramosDeUnidad,
  opcionesUnidadPlato,
  guardarUnidadPlato,
  descomponerUnidad,
} from "../unidades-platos";

describe("unidades canónicas de platos", () => {
  it.each(["unidad", " Unidad ", "UNIDADES", "ud.", "uds", "pieza"])(
    "normaliza %s",
    (valor) => {
      expect(normalizarUnidadPlato(valor)).toBe("Unidad");
    },
  );
  it("agrupa variantes sin opciones duplicadas, manteniendo otras formas de venta", () => {
    expect(
      opcionesUnidadPlato([
        "Unidad",
        "unidad",
        "UD",
        "100g",
        "150 gramos",
        " KG ",
        "ración",
        "RACIONES",
      ]),
    ).toEqual(["Unidad", "kg", "gramos", "Ración"]);
  });
  it("conserva el peso y transforma las formas históricas", () => {
    expect(normalizarUnidadPlato("150gramos")).toBe("150 g");
    expect(gramosDeUnidad("100 G")).toBe(100);
    expect(descomponerUnidad("200g")).toEqual({
      unidad: "gramos",
      gramos: 200,
    });
    expect(guardarUnidadPlato("gramos", 150)).toBe("150 g");
    expect(() => guardarUnidadPlato("gramos", 0)).toThrow();
    expect(() => guardarUnidadPlato("gramos", NaN)).toThrow();
    expect(normalizarUnidadPlato("g")).toBe("1 g");
  });
});
