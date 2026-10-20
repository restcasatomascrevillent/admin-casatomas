import { describe, expect, it } from "vitest";
import type { ConfigBotWeb, DraftBotWeb } from "@/hooks/useConfigBotWeb";
import {
  camposATraducir,
  construirUpdateTraducido,
  estadoTraduccion,
  mapearNombres,
  tonoEquivalente,
} from "../traduccionBot";

const draftEs: DraftBotWeb = {
  tono: "divertido",
  mensaje_bienvenida: "¡Hola! Soy Tomy.",
  platos: ["Arroz negro", "Plato sin traducir", "Plato borrado"],
  vinos: ["Muga"],
  instrucciones_extra: "- Horario: 09:30-23:00\n- Teléfono: 966 10 78 87",
  frases_personalizadas: "",
};

const catalogos = {
  platos: [
    { nombre: "Arroz negro", nombre_en: "Black rice", nombre_fr: "Riz noir" },
    { nombre: "Plato sin traducir", nombre_en: "  ", nombre_fr: null },
  ],
  vinos: [{ nombre: "Muga", nombre_en: "Muga", nombre_fr: "Muga" }],
};

function fila(idioma: string, updated_at: string): ConfigBotWeb {
  return {
    id: idioma,
    idioma,
    tono: "",
    mensaje_bienvenida: "",
    platos_recomendados: "",
    vinos_recomendados: "",
    instrucciones_extra: "",
    frases_personalizadas: "",
    created_at: updated_at,
    updated_at,
  };
}

describe("tonoEquivalente", () => {
  it("mapea por posición", () => {
    expect(tonoEquivalente("divertido", "en")).toBe("fun");
    expect(tonoEquivalente("cercano", "fr")).toBe("chaleureux");
  });
  it("tono personalizado → null", () => {
    expect(tonoEquivalente("pirata", "en")).toBeNull();
  });
});

describe("mapearNombres", () => {
  it("usa nombre_<idioma> y cae al español si falta o no existe", () => {
    expect(mapearNombres(draftEs.platos, catalogos.platos, "en")).toEqual([
      "Black rice",
      "Plato sin traducir",
      "Plato borrado",
    ]);
    expect(mapearNombres(["arroz negro"], catalogos.platos, "fr")).toEqual(["Riz noir"]);
  });
});

describe("camposATraducir", () => {
  it("no manda el tono si es uno de los conocidos", () => {
    expect(Object.keys(camposATraducir(draftEs)).sort()).toEqual([
      "frases_personalizadas",
      "instrucciones_extra",
      "mensaje_bienvenida",
    ]);
  });
  it("manda el tono personalizado para traducirlo", () => {
    expect(camposATraducir({ ...draftEs, tono: "pirata" }).tono).toBe("pirata");
  });
});

describe("construirUpdateTraducido", () => {
  it("combina traducciones, tono equivalente y nombres de la carta", () => {
    const u = construirUpdateTraducido(
      draftEs,
      { mensaje_bienvenida: "Hi! I'm Tomy.", instrucciones_extra: "- Hours: 09:30-23:00\n- Phone: 966 10 78 87", frases_personalizadas: "" },
      "en",
      catalogos,
    );
    expect(u).toEqual({
      tono: "fun",
      mensaje_bienvenida: "Hi! I'm Tomy.",
      instrucciones_extra: "- Hours: 09:30-23:00\n- Phone: 966 10 78 87",
      frases_personalizadas: "",
      platos_recomendados: "Black rice, Plato sin traducir, Plato borrado",
      vinos_recomendados: "Muga",
    });
  });

  it("lanza si falta la traducción de un texto no vacío (nunca vacía EN/FR)", () => {
    expect(() =>
      construirUpdateTraducido(draftEs, { mensaje_bienvenida: "Salut", instrucciones_extra: "" }, "fr", catalogos),
    ).toThrow(/instrucciones_extra/);
    expect(() => construirUpdateTraducido(draftEs, undefined, "fr", catalogos)).toThrow();
  });
});

describe("estadoTraduccion", () => {
  it("al día / desactualizado / sin traducir", () => {
    const es = fila("es", "2026-09-26T10:00:00Z");
    expect(estadoTraduccion(es, fila("en", "2026-09-26T10:00:01Z"))).toBe("al_dia");
    expect(estadoTraduccion(es, fila("en", "2026-09-26T09:59:00Z"))).toBe("desactualizado");
    expect(estadoTraduccion(es, null)).toBe("sin_traducir");
  });
});
