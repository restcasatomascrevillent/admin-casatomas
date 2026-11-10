import { describe, expect, it } from "vitest";
import { debeConstruir, saltarDemo, soloDocsOTests, versionAceptada } from "../vercel-produccion.mjs";

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

describe("la demo no se construye si solo cambian docs o tests", () => {
  const DEMO = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "staging" };
  it("salta staging con solo docs, Markdown o tests", () => {
    expect(soloDocsOTests(["docs/PROCESO-DE-CAMBIOS.md", "CLAUDE.md", "src/__tests__/a.test.ts", "e2e/x.spec.ts", ".github/workflows/ci.yml", ""])).toBe(true);
    expect(saltarDemo(DEMO, ["README.md", "src/hooks/__tests__/useX.test.ts"])).toBe(true);
  });
  it("construye si cambia código, config o la lista está vacía", () => {
    expect(soloDocsOTests(["docs/a.md", "src/App.tsx"])).toBe(false);
    expect(soloDocsOTests(["vercel.json"])).toBe(false);
    expect(soloDocsOTests(["public/robots.txt"])).toBe(false);
    expect(soloDocsOTests(["scripts/release.mjs"])).toBe(false);
    expect(soloDocsOTests([])).toBe(false);
    expect(soloDocsOTests(null)).toBe(false);
  });
  it("nunca salta producción ni las previews de release/*", () => {
    expect(saltarDemo({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" }, ["docs/a.md"])).toBe(false);
    expect(saltarDemo({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "release/1.2.0" }, ["CHANGELOG.md"])).toBe(false);
  });
});
