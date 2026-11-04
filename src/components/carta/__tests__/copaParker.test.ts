import { describe, expect, it } from "vitest";
import * as z from "zod";
import { camposCopaParker, copaParkerParaCampos, copaParkerParaGuardar, exigirPrecioCopa } from "@/components/carta/copaParker";

const esquema = z.object(camposCopaParker).superRefine(exigirPrecioCopa);
const errores = (valores: Record<string, unknown>) => {
  const r = esquema.safeParse(valores);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("copa y puntuación Parker en el formulario de vino", () => {
  it("por copas exige el precio de la copa", () => {
    expect(errores({ copeo: true, precio_copa_eur: "", puntuacion_parker: "", puntuacion_parker_anada: "" }))
      .toEqual({ precio_copa_eur: "Pon el precio de la copa" });
    expect(errores({ copeo: false, precio_copa_eur: "", puntuacion_parker: "", puntuacion_parker_anada: "" })).toEqual({});
  });
  it("acepta «5,50» y rechaza 0 o más de 999,99", () => {
    expect(esquema.parse({ copeo: true, precio_copa_eur: "5,50" }).precio_copa_eur).toBe(5.5);
    expect(errores({ copeo: true, precio_copa_eur: "0" })).toHaveProperty("precio_copa_eur");
    expect(errores({ copeo: true, precio_copa_eur: "1000" })).toHaveProperty("precio_copa_eur");
  });
  it("Parker de 50 a 100, entero; añada de cuatro cifras", () => {
    expect(esquema.parse({ copeo: false, puntuacion_parker: " 94 ", puntuacion_parker_anada: "2019" }))
      .toMatchObject({ puntuacion_parker: 94, puntuacion_parker_anada: 2019 });
    expect(errores({ copeo: false, puntuacion_parker: "101" })).toHaveProperty("puntuacion_parker");
    expect(errores({ copeo: false, puntuacion_parker: "49" })).toHaveProperty("puntuacion_parker");
    expect(errores({ copeo: false, puntuacion_parker: "94,5" })).toHaveProperty("puntuacion_parker");
    expect(errores({ copeo: false, puntuacion_parker_anada: "19" })).toHaveProperty("puntuacion_parker_anada");
  });
  it("ida y vuelta con la base de datos", () => {
    expect(copaParkerParaCampos({ copeo: null, precio_copa_eur: null, puntuacion_parker: 95, puntuacion_parker_anada: null }))
      .toEqual({ copeo: false, precio_copa_eur: "", puntuacion_parker: "95", puntuacion_parker_anada: "" });
    // Apagar la copa conserva el precio; sin puntuación no se guarda añada.
    expect(copaParkerParaGuardar({ copeo: false, precio_copa_eur: 6, puntuacion_parker: undefined, puntuacion_parker_anada: 2019 }))
      .toEqual({ copeo: false, precio_copa_eur: 6, puntuacion_parker: null, puntuacion_parker_anada: null });
  });
});
