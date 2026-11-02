import { describe, it, expect } from "vitest";
import * as z from "zod";
import {
  MAX_DESCRIPCION_CARTA,
  MAX_NOMBRE_CARTA,
  MAX_PRECIO_CARTA,
  categoriaCarta,
  descripcionCarta,
  mensajePrecioMaximo,
  nombreCarta,
} from "../limites-carta";

const mensaje = (r: z.SafeParseReturnType<unknown, unknown>) =>
  r.success ? null : r.error.issues[0].message;

describe("límites de la carta (iguales que los CHECK de la BD)", () => {
  it("mismos máximos que la migración 20261101220000", () => {
    expect(MAX_NOMBRE_CARTA).toBe(150);
    expect(MAX_DESCRIPCION_CARTA).toBe(2000);
    expect(MAX_PRECIO_CARTA).toBe(9999.99);
  });

  it("nombre: obligatorio, recorta espacios y máximo 150 con mensaje en castellano", () => {
    expect(mensaje(nombreCarta.safeParse("   "))).toBe("El nombre es obligatorio");
    expect(nombreCarta.parse("  Arroz a banda  ")).toBe("Arroz a banda");
    expect(nombreCarta.safeParse("a".repeat(150)).success).toBe(true);
    expect(mensaje(nombreCarta.safeParse("a".repeat(151)))).toBe("El nombre no puede pasar de 150 caracteres");
  });

  it("categoría: no vale solo con espacios", () => {
    expect(mensaje(categoriaCarta.safeParse("  "))).toBe("La categoría es obligatoria");
    expect(categoriaCarta.parse(" Tintos ")).toBe("Tintos");
  });

  it("descripción: opcional, máximo 2.000", () => {
    expect(descripcionCarta.safeParse(undefined).success).toBe(true);
    expect(descripcionCarta.safeParse("d".repeat(2000)).success).toBe(true);
    expect(mensaje(descripcionCarta.safeParse("d".repeat(2001)))).toMatch(/^La descripción no puede pasar de 2\.?000 caracteres$/);
  });

  it("mensaje del precio máximo en formato español", () => {
    expect(mensajePrecioMaximo).toMatch(/^El precio no puede pasar de 9\.?999,99 €$/);
  });
});
