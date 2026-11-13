/**
 * Tarea 2.2 (13/11/2026) · si un plato nuevo llega sin descripción, la MISMA
 * llamada de traducción (mismo modelo) la redacta. Lo que protegen estos tests:
 *   · Sin la marca `redactarDescripcion`, o con una descripción escrita, el
 *     prompt y el mapeo son EXACTAMENTE los de antes (editar, bulk, otros tipos).
 *   · Las reglas del dueño: una frase corta, sobria, sin inventar ingredientes,
 *     técnicas ni alérgenos, y el glosario de nombres sigue ahí.
 *   · Una respuesta que no sirve no se guarda a medias: o descripción en los
 *     tres idiomas o ninguna, como hasta ahora.
 */
import { describe, expect, it } from "vitest";
import {
  buildPromptSpec,
  debeRedactarDescripcion,
  GLOSARIO_COCINA,
  LARGO_DESCRIPCION_IA,
  limpiarDescripcionRedactada,
  MAX_DESCRIPCION_IA,
  PLATO_REDACCION_SYSTEM,
  PLATO_SYSTEM,
} from "../prompts.ts";

const PLATO = {
  nombre: "Arroz meloso con corvina",
  descripcion: "",
  ingredientes: "Arroz, corvina, caldo de pescado",
  categoria: "ARROCES",
  alergenos: ["pescado"],
};

const respuesta = (extra: Record<string, unknown> = {}, en: Record<string, unknown> = {}, fr: Record<string, unknown> = {}) => ({
  nombre: "Arroz meloso con corvina",
  descripcion: null,
  descripcion_es: "Arroz meloso con corvina, hecho con caldo de pescado.",
  ...extra,
  traducciones: {
    en: {
      name: "Creamy Rice with Meagre",
      description: "Creamy rice with meagre, made with fish stock.",
      category: "Rice Dishes",
      allergens: ["fish"],
      ...en,
    },
    fr: {
      name: "Riz crémeux au maigre",
      description: "Riz crémeux au maigre, préparé avec un fumet de poisson.",
      category: "Plats de riz",
      allergens: ["poisson"],
      ...fr,
    },
  },
});

describe("cuándo se pide redactar la descripción", () => {
  it("solo en platos, con la marca y con la descripción vacía", () => {
    expect(debeRedactarDescripcion("plato", PLATO, { redactarDescripcion: true })).toBe(true);
    expect(debeRedactarDescripcion("plato", { ...PLATO, descripcion: "   " }, { redactarDescripcion: true })).toBe(true);
    expect(debeRedactarDescripcion("plato", { ...PLATO, descripcion: undefined }, { redactarDescripcion: true })).toBe(true);
  });

  it("nunca si el usuario escribió una descripción", () => {
    expect(debeRedactarDescripcion("plato", { ...PLATO, descripcion: "La de siempre." }, { redactarDescripcion: true })).toBe(false);
  });

  it("nunca sin la marca (editar un plato, bulk)", () => {
    expect(debeRedactarDescripcion("plato", PLATO)).toBe(false);
    expect(debeRedactarDescripcion("plato", PLATO, { redactarDescripcion: false })).toBe(false);
  });

  it.each(["bebida", "vino", "coctel", "novedad", "menu", "tapas"] as const)("nunca en tipo=%s", (tipo) => {
    expect(debeRedactarDescripcion(tipo, PLATO, { redactarDescripcion: true })).toBe(false);
  });
});

describe("sin redactar, el plato se pide y se lee exactamente como antes", () => {
  const ANTES = "Nombre: Arroz meloso con corvina\nDescripción: \nCategoria:  ARROCES\nAlergenos: pescado";

  it("mismo system y mismo mensaje (sin ingredientes)", () => {
    const spec = buildPromptSpec("plato", PLATO);
    expect(spec.system).toBe(PLATO_SYSTEM);
    expect(spec.userMessage).toBe(ANTES);
  });

  it("con la marca pero con descripción escrita, tampoco cambia nada", () => {
    const spec = buildPromptSpec("plato", { ...PLATO, descripcion: "Escrita a mano." }, { redactarDescripcion: true });
    expect(spec.system).toBe(PLATO_SYSTEM);
    expect(spec.userMessage).not.toContain("Ingredientes");
    expect(spec.userMessage).toContain("Descripción: Escrita a mano.");
  });

  it("ignora un descripcion_es que mande el modelo por su cuenta", () => {
    const cols = buildPromptSpec("plato", PLATO).mapResponse(respuesta());
    expect(cols).not.toHaveProperty("descripcion_es");
    expect(Object.keys(cols).sort()).toEqual([
      "alergenos_en", "alergenos_fr", "categoria_en", "categoria_fr",
      "descripcion_en", "descripcion_fr", "nombre_en", "nombre_fr",
    ]);
  });

  it("la marca no afecta a otros tipos", () => {
    expect(buildPromptSpec("bebida", { nombre: "Caña" }, { redactarDescripcion: true }))
      .toMatchObject({ system: buildPromptSpec("bebida", { nombre: "Caña" }).system });
  });
});

describe("PLATO_REDACCION_SYSTEM: las reglas del dueño", () => {
  it("pide una frase de 140 caracteres como máximo, en descripcion_es", () => {
    expect(LARGO_DESCRIPCION_IA).toBe(140);
    expect(PLATO_REDACCION_SYSTEM).toContain("Una sola frase, de 140 caracteres como máximo");
    expect(PLATO_REDACCION_SYSTEM).toContain('"descripcion_es"');
    expect(PLATO_REDACCION_SYSTEM).toContain("traducciones.en.description");
    expect(PLATO_REDACCION_SYSTEM).toContain("traducciones.fr.description");
  });

  it("tono de carta tradicional, sobrio", () => {
    expect(PLATO_REDACCION_SYSTEM).toMatch(/restaurante tradicional español: apetitosa pero sobria/);
    expect(PLATO_REDACCION_SYSTEM).toMatch(/sin exclamaciones, sin emojis, sin precios/);
  });

  it("prohíbe inventar ingredientes, técnicas, procedencias y alérgenos", () => {
    expect(PLATO_REDACCION_SYSTEM).toMatch(/Usa SOLO lo que dicen el nombre, los ingredientes, la categoría y los alérgenos/);
    expect(PLATO_REDACCION_SYSTEM).toMatch(/No añadas ningún ingrediente/);
    expect(PLATO_REDACCION_SYSTEM).toMatch(/No afirmes como hecho una técnica de cocción/);
    expect(PLATO_REDACCION_SYSTEM).toMatch(/no menciones nada que lleve un alérgeno que no esté en la lista/);
  });

  it("si no puede sin inventar, devuelve null", () => {
    expect(PLATO_REDACCION_SYSTEM).toContain('"descripcion_es": null');
  });

  it("se añade DESPUÉS de PLATO_SYSTEM: el glosario y las categorías siguen", () => {
    const spec = buildPromptSpec("plato", PLATO, { redactarDescripcion: true });
    expect(spec.system.startsWith(PLATO_SYSTEM)).toBe(true);
    expect(spec.system).toContain(GLOSARIO_COCINA);
    expect(spec.system.trimEnd().endsWith(PLATO_REDACCION_SYSTEM)).toBe(true);
  });

  it("el mensaje lleva los ingredientes (y lo dice si no hay)", () => {
    const con = buildPromptSpec("plato", PLATO, { redactarDescripcion: true }).userMessage;
    expect(con).toContain("Ingredientes: Arroz, corvina, caldo de pescado");
    expect(con).toContain("Alergenos: pescado");
    const sin = buildPromptSpec("plato", { ...PLATO, ingredientes: "" }, { redactarDescripcion: true }).userMessage;
    expect(sin).toContain("Ingredientes: (no indicados)");
  });
});

describe("lectura de la descripción redactada", () => {
  const spec = () => buildPromptSpec("plato", PLATO, { redactarDescripcion: true });

  it("devuelve descripcion_es con sus traducciones en las columnas de siempre", () => {
    const cols = spec().mapResponse(respuesta());
    expect(cols).toMatchObject({
      descripcion_es: "Arroz meloso con corvina, hecho con caldo de pescado.",
      descripcion_en: "Creamy rice with meagre, made with fish stock.",
      descripcion_fr: "Riz crémeux au maigre, préparé avec un fumet de poisson.",
      nombre_en: "Creamy Rice with Meagre",
      categoria_fr: "Plats de riz",
    });
  });

  it("acepta la descripción en 'descripcion' si el modelo no usa descripcion_es", () => {
    const cols = spec().mapResponse(respuesta({ descripcion_es: undefined, descripcion: "Arroz meloso con corvina." }));
    expect(cols.descripcion_es).toBe("Arroz meloso con corvina.");
  });

  it.each([
    ["null", { descripcion_es: null }, {}, {}],
    ["vacía", { descripcion_es: "  " }, {}, {}],
    ["demasiado larga", { descripcion_es: "a".repeat(MAX_DESCRIPCION_IA + 1) }, {}, {}],
    ["sin inglés", {}, { description: null }, {}],
    ["sin francés", {}, {}, { description: "" }],
  ])("%s: no se guarda ninguna descripción (como hasta ahora)", (_n, extra, en, fr) => {
    const cols = spec().mapResponse(respuesta(extra, en, fr));
    expect(cols).not.toHaveProperty("descripcion_es");
    expect(cols.descripcion_en).toBeNull();
    expect(cols.descripcion_fr).toBeNull();
    // El resto de la traducción sí se guarda.
    expect(cols.nombre_en).toBe("Creamy Rice with Meagre");
  });

  it("una respuesta vacía tampoco rompe", () => {
    const cols = spec().mapResponse({});
    expect(cols).not.toHaveProperty("descripcion_es");
    expect(cols.nombre_en).toBeNull();
  });
});

describe("limpiarDescripcionRedactada", () => {
  it("junta espacios y saltos de línea y quita comillas alrededor", () => {
    expect(limpiarDescripcionRedactada('  «Corvina   a la plancha\ncon ajo.»  ')).toBe("Corvina a la plancha con ajo.");
    expect(limpiarDescripcionRedactada('"Corvina."')).toBe("Corvina.");
  });
  it.each([[null], [42], [""], ["null"], ["NULL"]])("descarta %p", (valor) => {
    expect(limpiarDescripcionRedactada(valor)).toBeNull();
  });
  it("respeta el máximo", () => {
    expect(limpiarDescripcionRedactada("a".repeat(MAX_DESCRIPCION_IA))).toHaveLength(MAX_DESCRIPCION_IA);
    expect(limpiarDescripcionRedactada("a".repeat(MAX_DESCRIPCION_IA + 1))).toBeNull();
  });
});
