import { describe, expect, it } from "vitest";
import { erroresLongitud, erroresLongitudNovedad, MAX_DESCRIPCION, MAX_ETIQUETA, MAX_NOMBRE } from "../limites-textos";

const novedad = {
  titulo: "Llega el cocido",
  titulo_en: null,
  titulo_fr: null,
  descripcion: "",
  descripcion_en: null,
  descripcion_fr: null,
  badge_text: null,
  badge_text_en: null,
  badge_text_fr: null,
};

describe("limites-textos", () => {
  it("los máximos son los de la migración", () => {
    expect([MAX_NOMBRE, MAX_DESCRIPCION, MAX_ETIQUETA]).toEqual([150, 2000, 40]);
  });

  it("justo en el máximo cabe; uno más, no", () => {
    expect(erroresLongitud([{ etiqueta: "El nombre", valor: "a".repeat(150), max: 150 }])).toEqual([]);
    expect(erroresLongitud([{ etiqueta: "El nombre", valor: "a".repeat(151), max: 150 }])).toEqual([
      "El nombre no puede pasar de 150 caracteres (tiene 151).",
    ]);
  });

  it("cuenta como char_length (un emoji es 1 carácter) y usa separador de miles", () => {
    expect(erroresLongitud([{ etiqueta: "X", valor: "😀".repeat(40), max: 40 }])).toEqual([]);
    expect(erroresLongitud([{ etiqueta: "La descripción", valor: "a".repeat(2001), max: 2000 }])[0]).toMatch(
      /2\.000 caracteres \(tiene 2\.001\)/,
    );
  });

  it("novedad válida: sin errores; traducción larga: dice idioma y campo", () => {
    expect(erroresLongitudNovedad(novedad)).toEqual([]);
    expect(erroresLongitudNovedad({ ...novedad, badge_text_fr: "b".repeat(41) })).toEqual([
      "La etiqueta en francés no puede pasar de 40 caracteres (tiene 41).",
    ]);
  });
});
