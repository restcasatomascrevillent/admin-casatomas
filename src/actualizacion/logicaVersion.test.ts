import { describe, expect, it } from "vitest";
import { hayVersionNueva, leerIdVersion, puedeRecargarSola } from "./logicaVersion";

describe("logicaVersion", () => {
  it("detecta versión nueva solo con id distinto y válido", () => {
    expect(hayVersionNueva("abc", "def")).toBe(true);
    expect(hayVersionNueva("abc", "abc")).toBe(false);
    expect(hayVersionNueva("abc", null)).toBe(false);
    expect(hayVersionNueva("abc", "")).toBe(false);
  });

  it("no recarga sola dos veces hacia el mismo id", () => {
    expect(puedeRecargarSola("def", null)).toBe(true);
    expect(puedeRecargarSola("def", "xyz")).toBe(true);
    expect(puedeRecargarSola("def", "def")).toBe(false);
  });

  it("lee el id de version.json", () => {
    expect(leerIdVersion({ id: "abc" })).toBe("abc");
    expect(leerIdVersion({ id: 3 })).toBeNull();
    expect(leerIdVersion(null)).toBeNull();
    expect(leerIdVersion("x")).toBeNull();
  });
});
