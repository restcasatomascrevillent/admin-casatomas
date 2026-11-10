import { describe, expect, it } from "vitest";
import * as z from "zod";
import { cambiosCopaParker, camposCopaParker, copaParkerParaCampos, copaParkerParaGuardar, exigirPrecioCopa } from "@/components/carta/copaParker";

const esquema = z.object(camposCopaParker).superRefine(exigirPrecioCopa);
const errores = (valores: Record<string, unknown>) => {
  const r = esquema.safeParse(valores);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("copa y añada que se sirve en el formulario de vino", () => {
  it("por copas exige el precio de la copa", () => {
    expect(errores({ copeo: true, precio_copa_eur: "", anada: "", sin_anada: false }))
      .toEqual({ precio_copa_eur: "Pon el precio de la copa" });
    expect(errores({ copeo: false, precio_copa_eur: "", anada: "", sin_anada: false })).toEqual({});
  });
  it("acepta «5,50» y rechaza 0 o más de 999,99", () => {
    expect(esquema.parse({ copeo: true, precio_copa_eur: "5,50" }).precio_copa_eur).toBe(5.5);
    expect(errores({ copeo: true, precio_copa_eur: "0" })).toHaveProperty("precio_copa_eur");
    expect(errores({ copeo: true, precio_copa_eur: "1000" })).toHaveProperty("precio_copa_eur");
  });
  it("añada de cuatro cifras", () => {
    expect(esquema.parse({ copeo: false, anada: " 2019 " })).toMatchObject({ anada: 2019 });
    expect(errores({ copeo: false, anada: "19" })).toHaveProperty("anada");
    expect(errores({ copeo: false, anada: "2019b" })).toHaveProperty("anada");
  });
  it("el formulario ya no acepta puntos Parker a mano (los calcula la base de datos)", () => {
    expect(esquema.parse({ copeo: false, puntuacion_parker: "94" })).not.toHaveProperty("puntuacion_parker");
  });
  it("ida y vuelta con la base de datos", () => {
    expect(copaParkerParaCampos({ copeo: null, precio_copa_eur: null, anada: 2021, sin_anada: null }))
      .toEqual({ copeo: false, precio_copa_eur: "", anada: "2021", sin_anada: false });
    // Apagar la copa conserva el precio; un vino sin añada (NV) no lleva año.
    expect(copaParkerParaGuardar({ copeo: false, precio_copa_eur: 6, anada: 2019, sin_anada: true }))
      .toEqual({ copeo: false, precio_copa_eur: 6, anada: null, sin_anada: true });
  });
  it("solo manda lo que cambia (el panel sigue guardando aunque falte la migración)", () => {
    // Vino sin las columnas (migración sin aplicar) y sin tocar copa ni añada: nada.
    expect(cambiosCopaParker({ copeo: false })).toEqual({});
    expect(cambiosCopaParker({ copeo: false }, { copeo: false, precio_copa_eur: 6 })).toEqual({ precio_copa_eur: null });
    expect(cambiosCopaParker({ copeo: false, precio_copa_eur: 6, anada: 2021 }, { copeo: false, precio_copa_eur: 6, anada: 2020 }))
      .toEqual({ anada: 2021 });
    expect(cambiosCopaParker({ copeo: false, sin_anada: true }, { copeo: false, anada: 2020 })).toEqual({ anada: null, sin_anada: true });
    expect(cambiosCopaParker({ copeo: true, precio_copa_eur: 6 })).toEqual({ copeo: true, precio_copa_eur: 6 });
  });
});
