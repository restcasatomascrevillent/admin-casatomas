import { describe, expect, it } from "vitest";
import { debeConstruir } from "../vercel-produccion.mjs";

const PROD = { VERCEL_ENV: "production" };

describe("solo se publica en producción lo aceptado en un PR desde staging", () => {
  it("publica el merge commit de un PR desde staging", () => {
    expect(debeConstruir(PROD, "Merge pull request #12 from restcasatomascrevillent/staging\n\nProducción: v0.14")).toBe(true);
  });
  it("no publica un push directo, un squash ni un PR desde otra rama", () => {
    expect(debeConstruir(PROD, "fix(cheques): arreglo rápido")).toBe(false);
    expect(debeConstruir(PROD, "Producción: v0.14 (#12)")).toBe(false); // squash
    expect(debeConstruir(PROD, "Merge pull request #13 from restcasatomascrevillent/feature-x")).toBe(false);
    expect(debeConstruir(PROD, "Merge pull request #14 from restcasatomascrevillent/staging-viejo")).toBe(false);
    expect(debeConstruir(PROD, "")).toBe(false);
  });
  it("la demo y los previews se construyen siempre", () => {
    expect(debeConstruir({ VERCEL_ENV: "preview" }, "cualquier cosa")).toBe(true);
    expect(debeConstruir({}, "")).toBe(true);
  });
});
