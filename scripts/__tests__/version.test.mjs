// Reglas de la versión (scripts/version.mjs) sobre un repo de git temporal.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { calcularVersion, detectarEntorno, esRamaDePublicacion } from "../version.mjs";

const IDENTIDAD = { GIT_AUTHOR_NAME: "Prueba", GIT_AUTHOR_EMAIL: "prueba@example.com", GIT_COMMITTER_NAME: "Prueba", GIT_COMMITTER_EMAIL: "prueba@example.com" };
const carpetas = [];
afterEach(() => { for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true }); });

function repo() {
  const cwd = mkdtempSync(path.join(tmpdir(), "version-"));
  carpetas.push(cwd);
  const git = (...args) => execFileSync("git", args, { cwd, env: { ...process.env, ...IDENTIDAD }, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  let n = 0;
  const commit = (fichero = `f${++n}.txt`, contenido = String(n)) => { writeFileSync(path.join(cwd, fichero), contenido); git("add", fichero); git("commit", "-q", "-m", `cambio ${fichero}`); };
  const fijar = (version) => commit("versionado.json", JSON.stringify({ version }));
  const datos = (ref = "HEAD", env = {}) => calcularVersion({ cwd, ref, env });
  return { cwd, git, commit, fijar, datos };
}

describe("versión publicada X.Y.Z", () => {
  it("main y release/X.Y.Z llevan la versión exacta; no sube con cada commit", () => {
    const r = repo();
    r.fijar("1.2.0");
    r.commit(); r.commit();
    expect(r.datos().version).toBe("1.2.0");
    r.git("checkout", "-q", "-b", "release/1.3.0");
    r.fijar("1.3.0");
    expect(r.datos()).toMatchObject({ version: "1.3.0", publicada: "1.3.0", desarrollo: false, rama: "release/1.3.0" });
  });

  it("la demo y las ramas de trabajo muestran lo publicado + el commit", () => {
    const r = repo();
    r.fijar("1.2.0");
    r.git("checkout", "-q", "-b", "staging");
    r.commit();
    const sha = r.git("rev-parse", "--short=7", "HEAD");
    expect(r.datos()).toMatchObject({ version: `1.2.0+${sha}`, publicada: "1.2.0", desarrollo: true, rama: "staging" });
  });

  it("en Vercel manda la rama del despliegue y producción siempre es exacta", () => {
    const r = repo();
    r.fijar("2.0.1");
    const demo = r.datos("HEAD", { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "staging", VERCEL_GIT_COMMIT_SHA: "abcdef1234567890" });
    expect(demo).toMatchObject({ version: "2.0.1+abcdef1", entorno: "demo", commit: "abcdef1" });
    const candidata = r.datos("HEAD", { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "release/2.1.0" });
    expect(candidata).toMatchObject({ version: "2.0.1", entorno: "preview", desarrollo: false });
    const prod = r.datos("HEAD", { VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" });
    expect(prod).toMatchObject({ version: "2.0.1", entorno: "produccion", desarrollo: false });
  });

  it("lee otra referencia sin cambiar de rama", () => {
    const r = repo();
    r.fijar("1.0.0");
    r.git("checkout", "-q", "-b", "staging");
    r.fijar("1.1.0");
    expect(r.datos("main").version).toBe("1.0.0");
  });

  it("sin versionado.json válido lo dice en vez de inventar (formato antiguo incluido)", () => {
    const r = repo();
    r.commit("versionado.json", JSON.stringify({ mayor: 0 }));
    expect(r.datos()).toMatchObject({ version: "sin versionar", publicada: null });
    expect(r.datos().aviso).toMatch(/versionado\.json/);
  });
});

describe("entorno", () => {
  it("producción, demo (staging), preview y local según Vercel", () => {
    expect(detectarEntorno({ VERCEL: "1", VERCEL_ENV: "production" }, "main")).toBe("produccion");
    expect(detectarEntorno({ VERCEL: "1", VERCEL_ENV: "preview" }, "staging")).toBe("demo");
    expect(detectarEntorno({ VERCEL: "1", VERCEL_ENV: "preview" }, "otra")).toBe("preview");
    expect(detectarEntorno({}, "staging")).toBe("local");
  });
  it("ramas de publicación", () => {
    expect(esRamaDePublicacion("main")).toBe(true);
    expect(esRamaDePublicacion("release/1.4.2")).toBe(true);
    expect(esRamaDePublicacion("release/1.4")).toBe(false);
    expect(esRamaDePublicacion("staging")).toBe(false);
    expect(esRamaDePublicacion(null)).toBe(false);
  });
});
