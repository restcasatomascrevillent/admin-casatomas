import { describe, expect, it } from "vitest";
import { debeConstruir, versionAceptada } from "../vercel-produccion.mjs";

const PROD = { VERCEL_ENV: "production" };

describe("solo se publica en producción una release aceptada en un PR", () => {
  it("publica el merge commit de un PR desde release/X.Y.Z con la misma versión en versionado.json", () => {
    expect(debeConstruir(PROD, "Merge pull request #31 from restcasatomascrevillent/release/1.2.0\n\nRelease v1.2.0", "1.2.0")).toBe(true);
    expect(versionAceptada("Merge pull request #31 from org/release/1.2.0")).toBe("1.2.0");
  });
  it("no publica si versionado.json no coincide con la rama", () => {
    expect(debeConstruir(PROD, "Merge pull request #31 from org/release/1.2.0", "1.1.0")).toBe(false);
    expect(debeConstruir(PROD, "Merge pull request #31 from org/release/1.2.0", null)).toBe(false);
  });
  it("no publica staging entero, un push directo, un squash ni otras ramas", () => {
    expect(debeConstruir(PROD, "Merge pull request #12 from restcasatomascrevillent/staging", "1.2.0")).toBe(false);
    expect(debeConstruir(PROD, "fix(cheques): arreglo rápido", "1.2.0")).toBe(false);
    expect(debeConstruir(PROD, "Release v1.2.0 (#31)", "1.2.0")).toBe(false); // squash
    expect(debeConstruir(PROD, "Merge pull request #13 from org/feature/x", "1.2.0")).toBe(false);
    expect(debeConstruir(PROD, "Merge pull request #14 from org/release/1.2", "1.2")).toBe(false);
    expect(debeConstruir(PROD, "Merge pull request #15 from org/release/1.2.0-viejo", "1.2.0")).toBe(false);
    expect(debeConstruir(PROD, "", "1.2.0")).toBe(false);
  });
  it("la demo y las previews (también las de release/*) se construyen siempre", () => {
    expect(debeConstruir({ VERCEL_ENV: "preview" }, "cualquier cosa", null)).toBe(true);
    expect(debeConstruir({}, "", null)).toBe(true);
  });
});
