import { describe, expect, it } from "vitest";
import { carpetasFuncionesDeLaApp, debeConstruir, saltarDemo, soloDocsOTests, versionAceptada } from "../vercel-produccion.mjs";

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

describe("la demo tampoco se construye si solo cambia Supabase que el panel no lleva dentro", () => {
  const DEMO = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "staging" };
  const APP = new Set(["_shared", "emails-reserva"]);

  it("migraciones, rollbacks, pruebas SQL, config.toml y pruebas PGlite no cambian el panel", () => {
    expect(soloDocsOTests(["supabase/migrations/20261209100000_x.sql", "supabase/rollbacks/20261209100000_x_ROLLBACK.sql", "supabase/tests/a_test.sql", "supabase/config.toml", "scripts/test-servicios-cierre.mjs"])).toBe(true);
    expect(saltarDemo(DEMO, ["supabase/migrations/a.sql", "docs/a.md"])).toBe(true);
  });

  it("una Edge Function que la app no importa no construye; una que sí importa, sí", () => {
    expect(saltarDemo(DEMO, ["supabase/functions/servicios-uso/servicios.ts", "supabase/migrations/a.sql"], APP)).toBe(true);
    expect(saltarDemo(DEMO, ["supabase/functions/_shared/cierres.ts"], APP)).toBe(false);
    expect(saltarDemo(DEMO, ["supabase/functions/emails-reserva/plantilla.ts"], APP)).toBe(false);
    // Sin saber qué importa la app (no se pudo leer), cualquier función construye.
    expect(saltarDemo(DEMO, ["supabase/functions/servicios-uso/servicios.ts"])).toBe(false);
    expect(saltarDemo(DEMO, ["supabase/functions/servicios-uso/servicios.ts"], null)).toBe(false);
    // Un fichero suelto en supabase/functions (no es de ninguna función) construye.
    expect(saltarDemo(DEMO, ["supabase/functions/deno.json"], APP)).toBe(false);
  });

  it("sigue construyendo con código del panel, api/, scripts del build o package.json", () => {
    for (const f of ["src/App.tsx", "api/recortar-foto.ts", "scripts/release.mjs", "scripts/vercel-produccion.mjs", "package.json", "vercel.json", "public/x.png"]) {
      expect(saltarDemo(DEMO, ["supabase/migrations/a.sql", f], APP), f).toBe(false);
    }
  });

  it("producción y las candidatas no se saltan nunca por esto", () => {
    expect(saltarDemo({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" }, ["supabase/migrations/a.sql"], APP)).toBe(false);
    expect(saltarDemo({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "release/1.2.0" }, ["supabase/migrations/a.sql"], APP)).toBe(false);
  });

  it("carpetasFuncionesDeLaApp: lee del código lo que la app importa, también de rebote", () => {
    const carpetas = carpetasFuncionesDeLaApp();
    expect(carpetas).toBeInstanceOf(Set);
    // La app importa _shared y emails-reserva (reglas compartidas con las funciones).
    expect(carpetas.has("_shared")).toBe(true);
    expect(carpetas.has("emails-reserva")).toBe(true);
    // servicios-uso solo corre en Supabase: nadie del panel la importa.
    expect(carpetas.has("servicios-uso")).toBe(false);
    // Una carpeta que no existe o no se puede leer: null (y entonces se construye siempre).
    expect(carpetasFuncionesDeLaApp("/no/existe")).toBeNull();
  });
});
