/**
 * Tests para supabase/functions/chat-web/busqueda-carta.ts (TS puro, sin Deno).
 *
 * Caso real (eval carta-precio-multiturno-es, 2026-09-26): los arroces se
 * llaman "Con mero", "De rape"... en la categoría "Arroces melosos". En el
 * turno 2 el modelo buscaba "arroz con mero" y el filtro antiguo
 * (`nombre.includes(busqueda)`) devolvía 0 platos → "no encuentro ese arroz".
 */
import { describe, it, expect } from "vitest";
import { buscarFilas, coincideCategoria, plegarTexto, raiz, terminos } from "../busqueda-carta.ts";

const PLATOS = [
  { nombre: "Con mero", nombre_en: "With grouper", categoria: "Arroces melosos", categoria_en: "Creamy rice dishes", precio_eur: 24 },
  { nombre: "De langosta", nombre_en: "With spiny lobster", categoria: "Arroces melosos", categoria_en: "Creamy rice dishes", precio_eur: 28.5 },
  { nombre: "De rape", nombre_en: "With monkfish", categoria: "Arroces melosos", categoria_en: "Creamy rice dishes", precio_eur: 21 },
  { nombre: "Mero a la plancha", nombre_en: "Grilled grouper", categoria: "Pescados", categoria_en: "Fish", precio_eur: 26 },
  { nombre: "Tarta de queso", nombre_en: "Cheesecake", categoria: "Postres", categoria_en: "Desserts", descripcion: "Con frutos rojos", precio_eur: 7 },
  { nombre: "Calamares a la romana", categoria: "Frituras", precio_eur: 12 },
];

const nombres = (r: { filas: Array<{ nombre: string }> }) => r.filas.map((p) => p.nombre);

describe("plegarTexto / raiz / terminos", () => {
  it("quita acentos y mayúsculas", () => {
    expect(plegarTexto("  Café ÁRBOL ")).toBe("cafe arbol");
  });
  it.each([
    ["arroces", "arroz"],
    ["arroz", "arroz"],
    ["postres", "postr"],
    ["postre", "postr"],
    ["calamares", "calamar"],
    ["calamar", "calamar"],
    ["melosos", "meloso"],
    ["dishes", "dish"],
    ["dish", "dish"],
  ])("raiz(%s) = %s", (a, b) => {
    expect(raiz(a)).toBe(b);
  });
  it("descarta palabras vacías es/en/fr", () => {
    expect(terminos("el arroz con mero")).toEqual(["arroz", "mero"]);
    expect(terminos("the rice with grouper")).toEqual(["ric", "grouper"]);
    expect(terminos("le riz au mérou")).toEqual(["riz", "merou"]);
  });
});

describe("buscarFilas", () => {
  it("'arroz con mero' encuentra 'Con mero' (nombre) de 'Arroces melosos' (categoría)", () => {
    const r = buscarFilas(PLATOS, "es", "arroz con mero");
    expect(r.coincidencia).toBe("completa");
    expect(nombres(r)).toEqual(["Con mero"]);
  });

  it("'arroz meloso con mero' y 'ARROZ CON MERO' también", () => {
    expect(nombres(buscarFilas(PLATOS, "es", "arroz meloso con mero"))).toEqual(["Con mero"]);
    expect(nombres(buscarFilas(PLATOS, "es", "ARROZ CON MERO"))).toEqual(["Con mero"]);
  });

  it("'arroz' / 'arroces' devuelve todos los arroces (por categoría, plural indiferente)", () => {
    const esperado = ["Con mero", "De langosta", "De rape"];
    expect(nombres(buscarFilas(PLATOS, "es", "arroz"))).toEqual(esperado);
    expect(nombres(buscarFilas(PLATOS, "es", "arroces"))).toEqual(esperado);
  });

  it("'mero' prioriza los que lo tienen en el NOMBRE", () => {
    const r = buscarFilas(PLATOS, "es", "mero");
    expect(nombres(r)).toEqual(["Con mero", "Mero a la plancha"]);
  });

  it("busca también en el idioma del widget (en) y en español", () => {
    expect(nombres(buscarFilas(PLATOS, "en", "grouper rice"))).toEqual(["Con mero"]);
    expect(nombres(buscarFilas(PLATOS, "en", "arroz con mero"))).toEqual(["Con mero"]);
  });

  it("busca en la descripción", () => {
    expect(nombres(buscarFilas(PLATOS, "es", "frutos rojos"))).toEqual(["Tarta de queso"]);
  });

  it("prefijos de ≥ 4 letras ('lango' → langosta) y plurales ('calamar')", () => {
    expect(nombres(buscarFilas(PLATOS, "es", "lango"))).toEqual(["De langosta"]);
    expect(nombres(buscarFilas(PLATOS, "es", "calamar"))).toEqual(["Calamares a la romana"]);
  });

  it("si ninguna fila tiene TODAS las palabras, devuelve parciales marcadas", () => {
    const r = buscarFilas(PLATOS, "es", "arroz con bogavante");
    expect(r.coincidencia).toBe("parcial");
    expect(nombres(r)).toEqual(["Con mero", "De langosta", "De rape"]);
  });

  it("sin nada en común → ninguna", () => {
    const r = buscarFilas(PLATOS, "en", "kangaroo");
    expect(r).toEqual({ filas: [], coincidencia: "ninguna" });
  });

  it("búsqueda vacía o solo palabras vacías → todo, sin filtrar", () => {
    expect(buscarFilas(PLATOS, "es", "  ").filas).toHaveLength(PLATOS.length);
    expect(buscarFilas(PLATOS, "es", "el de la").filas).toHaveLength(PLATOS.length);
  });
});

describe("coincideCategoria", () => {
  it("singular/plural y acentos", () => {
    const arroz = PLATOS[0];
    expect(coincideCategoria(arroz, "es", "arroz")).toBe(true);
    expect(coincideCategoria(arroz, "es", "Arroces")).toBe(true);
    expect(coincideCategoria(arroz, "es", "arroces melosos")).toBe(true);
    expect(coincideCategoria(arroz, "en", "rice dishes")).toBe(true);
    expect(coincideCategoria(arroz, "es", "postres")).toBe(false);
    expect(coincideCategoria(PLATOS[4], "es", "postre")).toBe(true);
  });
});
