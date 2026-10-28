// Reglas de la versión automática (scripts/version.mjs) sobre un repo de git temporal.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { calcularVersion, detectarEntorno } from "../version.mjs";

const IDENTIDAD = { GIT_AUTHOR_NAME: "Prueba", GIT_AUTHOR_EMAIL: "prueba@example.com", GIT_COMMITTER_NAME: "Prueba", GIT_COMMITTER_EMAIL: "prueba@example.com" };
const carpetas = [];
afterEach(() => { for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true }); });

function repo() {
  const cwd = mkdtempSync(path.join(tmpdir(), "version-"));
  carpetas.push(cwd);
  const git = (...args) => execFileSync("git", args, { cwd, env: { ...process.env, ...IDENTIDAD }, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "staging");
  let n = 0;
  const commit = (fichero = `f${++n}.txt`, contenido = String(n)) => { writeFileSync(path.join(cwd, fichero), contenido); git("add", fichero); git("commit", "-q", "-m", `cambio ${fichero}`); };
  const mayor = (m) => commit("versionado.json", JSON.stringify({ mayor: m }));
  const version = (ref = "HEAD") => calcularVersion({ cwd, ref, env: {} }).version;
  return { cwd, git, commit, mayor, version };
}

describe("versión automática M.N", () => {
  it("el commit que fija el mayor es la .0 y cada commit suma 1", () => {
    const r = repo();
    r.commit(); r.mayor(0);
    expect(r.version()).toBe("0.0");
    r.commit(); r.commit();
    expect(r.version()).toBe("0.2");
  });

  it("aceptar el PR (un merge) no suma: producción queda igual que la demo", () => {
    const r = repo();
    r.mayor(0); r.commit();
    r.git("branch", "main");
    r.commit(); r.commit();
    expect([r.version("main"), r.version("staging")]).toEqual(["0.1", "0.3"]); // la demo va por delante
    r.git("checkout", "-q", "main");
    r.git("merge", "-q", "--no-ff", "-m", "Merge pull request #1 from org/staging", "staging");
    expect(r.version("main")).toBe("0.3");
    expect(r.version("staging")).toBe("0.3");
  });

  it("cambiar el mayor reinicia la cuenta", () => {
    const r = repo();
    r.mayor(0); r.commit(); r.commit();
    r.mayor(1);
    expect(r.version()).toBe("1.0");
    r.commit();
    expect(r.version()).toBe("1.1");
  });

  it("sin versionado.json en la rama, lo dice en vez de inventar", () => {
    const r = repo();
    r.commit(); r.git("branch", "main"); r.mayor(0);
    expect(r.version("main")).toBe("sin versionar");
  });

  it("en un clon superficial completa el historial, y si no puede da M.? con aviso", () => {
    const r = repo();
    r.mayor(0); r.commit(); r.commit(); r.commit();
    const destino = mkdtempSync(path.join(tmpdir(), "version-clon-"));
    carpetas.push(destino);
    execFileSync("git", ["clone", "-q", "--depth", "1", "--branch", "staging", `file://${r.cwd}`, destino]);
    expect(calcularVersion({ cwd: destino, env: {} }).version).toBe("0.3");

    const sinRemoto = mkdtempSync(path.join(tmpdir(), "version-clon-"));
    carpetas.push(sinRemoto);
    execFileSync("git", ["clone", "-q", "--depth", "1", "--branch", "staging", `file://${r.cwd}`, sinRemoto]);
    execFileSync("git", ["remote", "remove", "origin"], { cwd: sinRemoto });
    const datos = calcularVersion({ cwd: sinRemoto, env: {} });
    expect(datos.version).toBe("0.?");
    expect(datos.aviso).toBe("historial de git incompleto");
  });
});

describe("entorno", () => {
  it("producción, demo (staging), preview y local según Vercel", () => {
    expect(detectarEntorno({ VERCEL: "1", VERCEL_ENV: "production" }, "main")).toBe("produccion");
    expect(detectarEntorno({ VERCEL: "1", VERCEL_ENV: "preview" }, "staging")).toBe("demo");
    expect(detectarEntorno({ VERCEL: "1", VERCEL_ENV: "preview" }, "otra")).toBe("preview");
    expect(detectarEntorno({}, "staging")).toBe("local");
  });
});
