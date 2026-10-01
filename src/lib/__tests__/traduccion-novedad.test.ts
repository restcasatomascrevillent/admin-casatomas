/**
 * Red del panel para la traducción de novedades (src/lib/traduccion-novedad.ts).
 * Si traducir-contenido devuelve una traducción a medias, el editor NO debe
 * guardarla: antes se guardaba y, al editar, machacaba la traducción buena.
 */
import { describe, it, expect } from "vitest";
import { camposSinTraducir, normalizarTraduccionNovedad } from "../traduccion-novedad";

const es = {
  titulo: "Llega el cocido gallego",
  descripcion: "Garbanzos, lacón y grelos.",
  badge_text: "Nuevo",
  bullets: ["Precio: 18€", "Solo los jueves"],
  tags: ["Platos"],
};

const completa = {
  titulo_en: "Galician Cocido Is Here",
  titulo_fr: "Le cocido galicien arrive",
  descripcion_en: "Chickpeas, cured pork shoulder and turnip greens.",
  descripcion_fr: "Pois chiches, épaule de porc et fanes de navet.",
  badge_text_en: "New",
  badge_text_fr: "Nouveau",
  bullets_en: ["Price: €18", "Thursdays only"],
  bullets_fr: ["Prix : 18€", "Uniquement le jeudi"],
  tags_en: ["Dishes"],
  tags_fr: ["Plats"],
};

describe("camposSinTraducir", () => {
  it("una traducción completa no tiene huecos", () => {
    expect(camposSinTraducir(es, normalizarTraduccionNovedad(completa))).toEqual([]);
  });

  it("detecta un idioma entero vacío (lo que devolvía la función con ok:true)", () => {
    const t = normalizarTraduccionNovedad({ ...completa, titulo_fr: null, descripcion_fr: null, badge_text_fr: null, bullets_fr: [], tags_fr: [] });
    expect(camposSinTraducir(es, t)).toEqual(["titulo_fr", "descripcion_fr", "badge_text_fr", "bullets_fr", "tags_fr"]);
  });

  it("detecta que falte un punto", () => {
    const t = normalizarTraduccionNovedad({ ...completa, bullets_en: ["Price: €18"] });
    expect(camposSinTraducir(es, t)).toEqual(["bullets_en"]);
  });

  it("un texto de solo espacios cuenta como vacío", () => {
    const t = normalizarTraduccionNovedad({ ...completa, titulo_en: "   " });
    expect(camposSinTraducir(es, t)).toEqual(["titulo_en"]);
  });

  it("no exige traducir lo que en español está vacío", () => {
    const t = normalizarTraduccionNovedad({ titulo_en: "Only title", titulo_fr: "Seul titre" });
    expect(camposSinTraducir({ titulo: "Solo título", descripcion: "", bullets: null, tags: [] }, t)).toEqual([]);
  });
});

describe("normalizarTraduccionNovedad", () => {
  it("convierte null/undefined en cadenas y arrays vacíos y limpia espacios", () => {
    expect(normalizarTraduccionNovedad({ titulo_en: "  Hi ", bullets_en: [" a ", "", 3] })).toMatchObject({
      titulo_en: "Hi",
      titulo_fr: "",
      bullets_en: ["a"],
      bullets_fr: [],
    });
  });

  it("acepta una respuesta sin translations", () => {
    expect(normalizarTraduccionNovedad(undefined).titulo_en).toBe("");
  });
});
