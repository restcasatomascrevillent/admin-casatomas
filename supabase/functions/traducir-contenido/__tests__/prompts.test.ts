/**
 * Tests para supabase/functions/traducir-contenido/prompts.ts (TS puro, sin
 * Deno): corre bajo vitest igual que los de chat-web.
 *
 * Lo que protegen: el glosario de cocina española. Medido sobre 264 llamadas
 * reales con gpt-4.1-mini, el modelo fallaba de forma DETERMINISTA con seis
 * términos ("Buey de la ría" -> "Ox of the Estuary" 8/8, "Arroz a banda" ->
 * "Rice a banda" 8/8...). El glosario tiene que seguir enganchado a los DOS
 * prompts por los que pasan nombres de plato — PLATO_SYSTEM y
 * MENU_TAPAS_SYSTEM — y no a los demás, y la lista cerrada de categorías de
 * PLATO_SYSTEM (que es el patrón que demostró funcionar) debe seguir intacta.
 */
import { describe, it, expect } from "vitest";
import {
  BEBIDA_SYSTEM,
  buildPromptSpec,
  COCTEL_SYSTEM,
  GLOSARIO_COCINA,
  MENU_TAPAS_SYSTEM,
  NOVEDAD_SYSTEM,
  PLATO_SYSTEM,
  camposNovedadSinTraducir,
  VINO_SYSTEM,
} from "../prompts.ts";

describe("GLOSARIO_COCINA", () => {
  it.each([
    ["buey de la ría", ["Brown Crab", "Tourteau"]],
    ["arroz a banda", ["Arroz a banda"]],
    ["cocochas", ["Hake Cheeks", "Joues de merlu"]],
    ["navajas", ["Razor Clams", "Couteaux"]],
    ["centollo", ["Spider Crab", "Araignée de mer"]],
    ["bonito", ["Albacore Tuna", "Thon blanc"]],
    ["zamburiñas", ["Variegated Scallops", "Pétoncles"]],
    ["cocido", ["Galician Cocido", "Cocido galicien"]],
  ])("cubre '%s' con su traducción correcta", (termino, traducciones) => {
    expect(GLOSARIO_COCINA).toContain(termino);
    for (const t of traducciones) expect(GLOSARIO_COCINA).toContain(t);
  });

  it("prohíbe explícitamente las traducciones que salían mal", () => {
    // "Buey de la ría" es un cangrejo, no un bovino.
    expect(GLOSARIO_COCINA).toContain('"ox"');
    expect(GLOSARIO_COCINA).toContain('"bœuf"');
    // "Arroz a banda" no se traduce.
    expect(GLOSARIO_COCINA).toContain('"Rice a banda"');
    // Las cocochas son de merluza, no de rape.
    expect(GLOSARIO_COCINA).toContain('"lotte"');
  });

  it("mantiene la excepción de 'buey' como bovino tras un corte de carne", () => {
    // Sin este matiz, "Solomillo de buey con foie" salía como "Sirloin of Brown
    // Crab" / "Filet de Tourteau" (medido).
    expect(GLOSARIO_COCINA).toContain("solomillo de buey");
    expect(GLOSARIO_COCINA).toContain("Beef Sirloin");
  });

  it("prohíbe cambiar de especie o de ingrediente", () => {
    expect(GLOSARIO_COCINA).toMatch(/NUNCA cambies la especie ni el ingrediente/);
  });
});

describe("a qué prompts se engancha el glosario", () => {
  // NOVEDAD_SYSTEM lo lleva desde el 2026-10-01: las novedades hablan de
  // platos ("Llega el cocido gallego", "zamburiñas con tuétano") y sin
  // glosario el modelo los llamaba distinto en cada idioma y que en la carta.
  it.each([
    ["PLATO_SYSTEM", PLATO_SYSTEM],
    ["MENU_TAPAS_SYSTEM", MENU_TAPAS_SYSTEM],
    ["NOVEDAD_SYSTEM", NOVEDAD_SYSTEM],
  ])("%s lo incluye (por ahí pasan nombres de plato)", (_n, prompt) => {
    expect(prompt).toContain(GLOSARIO_COCINA);
  });

  it.each([
    ["VINO_SYSTEM", VINO_SYSTEM],
    ["BEBIDA_SYSTEM", BEBIDA_SYSTEM],
    ["COCTEL_SYSTEM", COCTEL_SYSTEM],
  ])("%s NO lo incluye (sus nombres no se traducen)", (_n, prompt) => {
    expect(prompt).not.toContain(GLOSARIO_COCINA);
  });

  it("vino, bebida y cóctel siguen protegiendo el nombre por regla propia", () => {
    expect(VINO_SYSTEM).toMatch(/NO traduzcas el nombre del vino/);
    expect(BEBIDA_SYSTEM).toMatch(/NO traduzcas nombres comerciales/);
    expect(COCTEL_SYSTEM).toMatch(/NO traduzcas nombres de c[óo]cteles/);
  });
});

describe("PLATO_SYSTEM: la lista cerrada de categorías sigue completa", () => {
  it.each([
    "Rice Dishes", "Meats", "Salads", "Hot Starters", "Cold Starters", "Shellfish",
    "Today's Specials", "Fish", "Desserts", "Salt-cured Fish", "Snacks",
    "Plats de riz", "Viandes", "Salades", "Entrées chaudes", "Entrées froides",
    "Fruits de mer", "Suggestions du jour", "Poissons", "Salaisons",
  ])("incluye la categoría %s", (categoria) => {
    expect(PLATO_SYSTEM).toContain(categoria);
  });

  it("el glosario va DESPUÉS de las reglas de esquema y categorías", () => {
    expect(PLATO_SYSTEM.indexOf(GLOSARIO_COCINA)).toBeGreaterThan(PLATO_SYSTEM.indexOf("Salt-cured Fish"));
  });
});

describe("buildPromptSpec entrega el glosario al modelo", () => {
  it.each([
    ["plato", { nombre: "Buey de la ría", categoria: "MARISCOS" }],
    ["menu", { primero: "Navajas a la plancha", segundo: "Arroz a banda", postre: "Flan" }],
    ["tapas", { tapas: ["Cocochas al pil-pil", "Centollo gallego"] }],
    ["novedad", { titulo: "Llega el cocido gallego" }],
  ] as const)("tipo=%s lleva el glosario en el system", (tipo, datos) => {
    expect(buildPromptSpec(tipo, datos).system).toContain(GLOSARIO_COCINA);
  });

  it.each([
    ["vino", { nombre: "Vega Sicilia" }],
    ["bebida", { nombre: "Caña" }],
    ["coctel", { nombre: "Negroni" }],
  ] as const)("tipo=%s no lo lleva", (tipo, datos) => {
    expect(buildPromptSpec(tipo, datos).system).not.toContain(GLOSARIO_COCINA);
  });
});

// ---------------------------------------------------------------------------
// Novedades (2026-10-01). El prompt original pedía "reescribir como si se
// hubiera creado en cada idioma": con la novedad del cocido el francés decía
// "est de Retour" (vuelve) cuando el español dice "Llega", y el inglés
// llamaba "Galician Stew" al plato que el francés llamaba "Cocido".
// ---------------------------------------------------------------------------
describe("NOVEDAD_SYSTEM: fidelidad antes que marketing", () => {
  it("ya no pide reescribir ni adaptar libremente", () => {
    expect(NOVEDAD_SYSTEM).not.toMatch(/Reescribe los textos/);
    expect(NOVEDAD_SYSTEM).toMatch(/FIDELIDAD/);
    expect(NOVEDAD_SYSTEM).toMatch(/"llega", no digas que "vuelve"/);
  });

  it("pide el mismo nombre de plato en los dos idiomas", () => {
    expect(NOVEDAD_SYSTEM).toMatch(/Un plato se llama IGUAL en inglés y en francés/);
  });

  it("pide mayúsculas francesas en el título", () => {
    expect(NOVEDAD_SYSTEM).toMatch(/en francés, el título va en minúscula/);
  });

  it("pide conservar siglas y palabras en mayúsculas (QA-MDN-02)", () => {
    expect(NOVEDAD_SYSTEM).toMatch(/siglas \(QA, DJ, IVA, DO\.\.\.\) se copian siempre en mayúsculas/);
    expect(NOVEDAD_SYSTEM).toMatch(/nunca "Qa test dégustation"/);
  });

  it("pide el mismo número de bullets y tags", () => {
    expect(NOVEDAD_SYSTEM).toMatch(/MISMO número de elementos/);
  });

  it("mantiene la estructura JSON que lee mapResponse", () => {
    expect(NOVEDAD_SYSTEM).toContain('"traducciones"');
    for (const clave of ['"title"', '"description"', '"badge"', '"bullets"', '"tags"']) {
      expect(NOVEDAD_SYSTEM).toContain(clave);
    }
  });
});

describe("novedad: una traducción a medias no se da por buena", () => {
  const datos = {
    titulo: "Llega el cocido gallego",
    descripcion: "Garbanzos, lacón y grelos.",
    badge_text: "Nuevo",
    bullets: ["Precio: 18€", "Solo los jueves"],
    tags: ["Platos"],
  };
  const bloque = (titulo: string) => ({
    title: titulo,
    description: "Desc",
    badge: "New",
    bullets: ["a", "b"],
    tags: ["t"],
  });
  const completa = { traducciones: { en: bloque("Galician Cocido Is Here"), fr: bloque("Le cocido galicien arrive") } };

  it("mapea una respuesta completa a las columnas", () => {
    const cols = buildPromptSpec("novedad", datos).mapResponse(completa);
    expect(cols.titulo_en).toBe("Galician Cocido Is Here");
    expect(cols.titulo_fr).toBe("Le cocido galicien arrive");
    expect(cols.bullets_fr).toEqual(["a", "b"]);
  });

  it("lanza si falta un idioma entero (antes devolvía nulls con ok:true)", () => {
    const sinFrances = { traducciones: { en: bloque("Galician Cocido Is Here") } };
    expect(() => buildPromptSpec("novedad", datos).mapResponse(sinFrances)).toThrow(/fr\.title/);
  });

  it("lanza si el modelo usa otra estructura (sin 'traducciones')", () => {
    const otraForma = { en: bloque("x"), fr: bloque("y") };
    expect(() => buildPromptSpec("novedad", datos).mapResponse(otraForma)).toThrow(/incompleta/);
  });

  it("lanza si se come un bullet", () => {
    const r = structuredClone(completa);
    r.traducciones.en.bullets = ["a"];
    expect(() => buildPromptSpec("novedad", datos).mapResponse(r)).toThrow(/en\.bullets/);
  });

  it("no exige traducir lo que en español está vacío", () => {
    expect(
      camposNovedadSinTraducir({ titulo: "Solo título" }, { en: { title: "Only title" }, fr: { title: "Seul titre" } }),
    ).toEqual([]);
  });
});

describe("MENU_TAPAS_SYSTEM: mayúsculas (F-46)", () => {
  it("pide conservar siglas y palabras en mayúsculas, también en francés", () => {
    expect(MENU_TAPAS_SYSTEM).toMatch(/siglas \(DO, IGP, IVA\.\.\.\) se copian siempre en mayúsculas, también en francés/);
    expect(MENU_TAPAS_SYSTEM).toMatch(/la traducción lo mantiene en MAYÚSCULAS/);
  });
  it("no convierte en mayúsculas de título lo que el original escribe en minúscula", () => {
    expect(MENU_TAPAS_SYSTEM).toMatch(/nunca "Riz Aux Légumes"/);
  });
  it("el glosario sigue al final del prompt", () => {
    expect(MENU_TAPAS_SYSTEM.trimEnd().endsWith(GLOSARIO_COCINA)).toBe(true);
  });
});
