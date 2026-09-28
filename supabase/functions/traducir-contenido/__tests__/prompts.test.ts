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
  it.each([
    ["PLATO_SYSTEM", PLATO_SYSTEM],
    ["MENU_TAPAS_SYSTEM", MENU_TAPAS_SYSTEM],
  ])("%s lo incluye (por ahí pasan nombres de plato)", (_n, prompt) => {
    expect(prompt).toContain(GLOSARIO_COCINA);
  });

  it.each([
    ["VINO_SYSTEM", VINO_SYSTEM],
    ["BEBIDA_SYSTEM", BEBIDA_SYSTEM],
    ["COCTEL_SYSTEM", COCTEL_SYSTEM],
    ["NOVEDAD_SYSTEM", NOVEDAD_SYSTEM],
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
  ] as const)("tipo=%s lleva el glosario en el system", (tipo, datos) => {
    expect(buildPromptSpec(tipo, datos).system).toContain(GLOSARIO_COCINA);
  });

  it.each([
    ["vino", { nombre: "Vega Sicilia" }],
    ["bebida", { nombre: "Caña" }],
    ["coctel", { nombre: "Negroni" }],
    ["novedad", { titulo: "Nueva temporada" }],
  ] as const)("tipo=%s no lo lleva", (tipo, datos) => {
    expect(buildPromptSpec(tipo, datos).system).not.toContain(GLOSARIO_COCINA);
  });
});
