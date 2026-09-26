/**
 * Tests para supabase/functions/chat-web/alergenos.ts (TS puro, sin Deno):
 * corre bajo vitest igual que session-token.test.ts.
 *
 * Lo crítico (seguridad alimentaria): el filtro excluir_alergenos comparaba
 * cadenas exactas, así que "frutos secos" no excluía `frutos_cascara` ni
 * "marisco" excluía `crustáceos`. Y un plato SIN datos no puede salir como apto.
 */
import { describe, it, expect } from "vitest";
import {
  alergenosDeFila,
  alergenosParaModelo,
  contieneAlguno,
  normalizarAlergeno,
  prepararExclusion,
  SIN_INFO_ALERGENOS,
} from "../alergenos.ts";

describe("normalizarAlergeno", () => {
  it.each([
    ["frutos_cascara", ["frutos_cascara"]],
    ["Frutos de cáscara", ["frutos_cascara"]],
    ["fruits à coque", ["frutos_cascara"]],
    ["tree nuts", ["frutos_cascara"]],
    ["crustaceos", ["crustaceos"]],
    ["Crustáceos", ["crustaceos"]],
    ["gluten-free", ["gluten"]],
    ["sin gluten", ["gluten"]],
    ["sans gluten", ["gluten"]],
    ["lactosa", ["lacteos"]],
    ["lactose", ["lacteos"]],
    ["dairy", ["lacteos"]],
    ["Sésamo", ["sesamo"]],
    ["SO2", ["sulfitos"]],
    ["sulphites", ["sulfitos"]],
    ["huevo", ["huevos"]],
    ["eggs", ["huevos"]],
  ])("%s -> %j", (entrada, esperado) => {
    expect(normalizarAlergeno(entrada).sort()).toEqual([...esperado].sort());
  });

  it("términos paraguas se expanden (lo seguro al excluir)", () => {
    expect(normalizarAlergeno("marisco").sort()).toEqual(["crustaceos", "moluscos"]);
    expect(normalizarAlergeno("seafood").sort()).toEqual(["crustaceos", "moluscos"]);
    expect(normalizarAlergeno("allergie aux fruits de mer").sort()).toEqual(["crustaceos", "moluscos"]);
    expect(normalizarAlergeno("frutos secos").sort()).toEqual(["cacahuetes", "frutos_cascara"]);
    expect(normalizarAlergeno("nuts").sort()).toEqual(["cacahuetes", "frutos_cascara"]);
    expect(normalizarAlergeno("allergic to nuts").sort()).toEqual(["cacahuetes", "frutos_cascara"]);
  });

  it("no reconoce lo que no es de los 14", () => {
    expect(normalizarAlergeno("alcohol")).toEqual([]);
    expect(normalizarAlergeno("")).toEqual([]);
    expect(normalizarAlergeno(null)).toEqual([]);
  });
});

describe("filtro de exclusión", () => {
  const conCascara = { alergenos_oficiales: ["frutos_cascara", "lácteos"] };
  const conMarisco = { alergenos_oficiales: '["crustáceos"]' };
  const sinDatos = { alergenos_oficiales: [], alergenos_inferidos: null };
  const inferido = { alergenos_oficiales: null, alergenos_inferidos: ["huevo"] };

  it("'frutos secos' excluye un plato guardado como frutos_cascara", () => {
    expect(contieneAlguno(alergenosDeFila(conCascara), prepararExclusion(["frutos secos"]))).toBe(true);
    expect(contieneAlguno(alergenosDeFila(conCascara), prepararExclusion(["nuts"]))).toBe(true);
  });

  it("'marisco' / 'shellfish' excluye crustáceos", () => {
    expect(contieneAlguno(alergenosDeFila(conMarisco), prepararExclusion(["marisco"]))).toBe(true);
    expect(contieneAlguno(alergenosDeFila(conMarisco), prepararExclusion(["shellfish"]))).toBe(true);
  });

  it("'lactose' excluye lácteos; 'gluten' no excluye un plato sin gluten", () => {
    expect(contieneAlguno(alergenosDeFila(conCascara), prepararExclusion(["lactose"]))).toBe(true);
    expect(contieneAlguno(alergenosDeFila(conCascara), prepararExclusion(["gluten-free"]))).toBe(false);
  });

  it("usa los inferidos si no hay oficiales", () => {
    expect(contieneAlguno(alergenosDeFila(inferido), prepararExclusion(["egg"]))).toBe(true);
  });

  it("un plato sin datos NO se presenta como apto", () => {
    const info = alergenosDeFila(sinDatos);
    expect(info.conocido).toBe(false);
    expect(alergenosParaModelo(info)).toBe(SIN_INFO_ALERGENOS);
  });

  it("términos no reconocidos se informan y se comparan como texto", () => {
    const excl = prepararExclusion(["kiwi"]);
    expect(excl.noReconocidos).toEqual(["kiwi"]);
    expect(contieneAlguno(alergenosDeFila({ alergenos_oficiales: ["Kiwi"] }), excl)).toBe(true);
  });
});
