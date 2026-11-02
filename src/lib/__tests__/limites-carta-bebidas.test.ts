import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  LIMITES_CARTA,
  errorAlergenoPersonalizado,
  textoObligatorio,
  textoOpcional,
} from "../limites-carta";

const esquema = z.object({
  nombre: textoObligatorio(LIMITES_CARTA.nombre, "El nombre es obligatorio"),
  descripcion: textoOpcional(LIMITES_CARTA.descripcion),
});
const errores = (v: unknown) => {
  const r = esquema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("limites-carta", () => {
  it("acepta nombre y descripción en el máximo", () => {
    expect(errores({ nombre: "n".repeat(150), descripcion: "d".repeat(2000) })).toEqual([]);
    expect(errores({ nombre: "Mojito" })).toEqual([]);
  });

  it("rechaza nombre vacío o solo espacios con mensaje en castellano", () => {
    expect(errores({ nombre: "" })).toEqual(["El nombre es obligatorio"]);
    expect(errores({ nombre: "  \t" })).toEqual(["El nombre es obligatorio"]);
  });

  it("rechaza pasarse del máximo con mensaje en castellano", () => {
    expect(errores({ nombre: "n".repeat(151) })).toEqual(["Como máximo 150 caracteres"]);
    expect(errores({ nombre: "a", descripcion: "d".repeat(2001) })).toEqual(["Como máximo 2000 caracteres"]);
  });

  it("avisa si un alérgeno personalizado es demasiado largo", () => {
    expect(errorAlergenoPersonalizado("trazas de mango")).toBeNull();
    expect(errorAlergenoPersonalizado("a".repeat(101))).toBe("Cada alérgeno, como máximo 100 caracteres");
  });
});
