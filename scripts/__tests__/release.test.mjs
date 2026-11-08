// Reglas de las releases con selección (scripts/release.mjs) sobre repos de git temporales:
// lo elegido entra, lo demás se queda fuera, y las dependencias y conflictos bloquean.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  comprobarRelease,
  crearGit,
  generarInforme,
  pendientes,
  prepararRelease,
  siguienteVersion,
  sustituirInforme,
  tituloLegible,
} from "../release.mjs";

const IDENTIDAD = { GIT_AUTHOR_NAME: "Prueba", GIT_AUTHOR_EMAIL: "prueba@example.com", GIT_COMMITTER_NAME: "Prueba", GIT_COMMITTER_EMAIL: "prueba@example.com" };
const OPC = { base: "main", desde: "staging", repo: "org/app", fecha: "2026-11-09", identidad: { nombre: "Prueba", email: "prueba@example.com" } };
const carpetas = [];
afterEach(() => { for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true }); });

function repo({ version = "1.0.0" } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "release-test-"));
  carpetas.push(cwd);
  const sh = (...args) => execFileSync("git", args, { cwd, env: { ...process.env, ...IDENTIDAD }, encoding: "utf8" }).trim();
  sh("init", "-q", "-b", "main");
  sh("config", "user.name", "Prueba");
  sh("config", "user.email", "prueba@example.com");
  const escribir = (ficheros) => {
    for (const [f, c] of Object.entries(ficheros)) {
      mkdirSync(path.dirname(path.join(cwd, f)), { recursive: true });
      writeFileSync(path.join(cwd, f), c);
      sh("add", f);
    }
  };
  const commit = (mensaje, ficheros) => { escribir(ficheros); sh("commit", "-q", "-m", mensaje); return sh("rev-parse", "HEAD"); };
  commit("inicio", {
    "versionado.json": typeof version === "string" ? JSON.stringify({ version }) : JSON.stringify(version),
    "src/carta.ts": "linea 1\nlinea 2\nlinea 3\n",
    "src/comun.ts": "a\nb\nc\n",
  });
  sh("branch", "staging");
  const git = crearGit(cwd, IDENTIDAD);
  return { cwd, sh, commit, git, en: (rama) => sh("checkout", "-q", rama) };
}

describe("versiones de las releases", () => {
  it("desde 0.x la siguiente es 1.0.0; después feat → minor, el resto → patch", () => {
    expect(siguienteVersion("0.403", { clases: ["cambio"] })).toBe("1.0.0");
    expect(siguienteVersion("0.9.0", { clases: ["feat"] })).toBe("1.0.0");
    expect(siguienteVersion(null)).toBe("1.0.0");
    expect(siguienteVersion("1.0.0", { clases: ["feat", "cambio"] })).toBe("1.1.0");
    expect(siguienteVersion("1.1.0", { clases: ["cambio", "otro"] })).toBe("1.1.1");
    expect(siguienteVersion("1.1.1", { tipo: "major" })).toBe("2.0.0");
    expect(siguienteVersion("1.1.1", { version: "1.3.0" })).toBe("1.3.0");
    expect(() => siguienteVersion("1.1.1", { version: "1.1.0" })).toThrow(/mayor/);
  });
  it("títulos legibles para el CHANGELOG", () => {
    expect(tituloLegible("feat(reservas): hoja de mesa (#12)")).toBe("Reservas: hoja de mesa");
    expect(tituloLegible("fix: el precio de la copa")).toBe("El precio de la copa");
    expect(tituloLegible("Ficha del plato: vídeo")).toBe("Ficha del plato: vídeo");
  });
});

describe("preparar una release con una selección", () => {
  it("con el cambio A elegido deja fuera el cambio B pendiente", () => {
    const r = repo();
    r.en("staging");
    const a = r.commit("feat(menu): menú del día", { "src/menu.ts": "export const menu = 1;\n" });
    const b = r.commit("fix(carta): precio", { "src/carta.ts": "linea 1\nlinea 2 corregida\nlinea 3\n" });
    r.en("main");

    const res = prepararRelease(r.git, [a.slice(0, 7)], { ...OPC, objetivo: "Publicar el menú" });
    expect(res.errores).toEqual([]);
    expect(res).toMatchObject({ bloqueada: false, version: "1.1.0", rama: "release/1.1.0" });

    expect(r.sh("show", "release/1.1.0:src/menu.ts")).toBe("export const menu = 1;");
    expect(r.sh("show", "release/1.1.0:src/carta.ts")).toBe("linea 1\nlinea 2\nlinea 3"); // B no está
    expect(JSON.parse(r.sh("show", "release/1.1.0:versionado.json")).version).toBe("1.1.0");
    const changelog = r.sh("show", "release/1.1.0:CHANGELOG.md");
    expect(changelog).toContain("## [1.1.0] - 2026-11-09");
    expect(changelog).toContain("Objetivo: Publicar el menú");
    expect(changelog).toContain("Menu: menú del día");
    expect(changelog).not.toContain("precio");
    expect(r.sh("log", "-1", "--format=%B", "release/1.1.0~1")).toContain(`(cherry picked from commit ${a})`);

    // B sigue pendiente frente a la release, A ya no.
    const quedan = pendientes(r.git, { base: "release/1.1.0", desde: "staging" });
    expect(quedan.pendientes.map((u) => u.sha)).toEqual([b]);
    expect(quedan.publicados.map((u) => u.sha)).toEqual([a]);
  });

  it("en modo simular no crea la rama", () => {
    const r = repo();
    r.en("staging");
    const a = r.commit("feat: algo", { "src/algo.ts": "1\n" });
    r.en("main");
    const res = prepararRelease(r.git, [a], { ...OPC, simular: true });
    expect(res.bloqueada).toBe(false);
    expect(r.git.r(["rev-parse", "--verify", "--quiet", "release/1.1.0"]).status).not.toBe(0);
  });

  it("bloquea si el elegido modifica líneas de un cambio no elegido, y lo nombra", () => {
    const r = repo();
    r.en("staging");
    const c1 = r.commit("feat(precios): tabla de precios", { "src/precios.ts": "uno\ndos\ntres\n" });
    const c2 = r.commit("fix(precios): dos bien escrito", { "src/precios.ts": "uno\nDOS\ntres\n" });
    r.en("main");
    const res = prepararRelease(r.git, [c2], OPC);
    expect(res.bloqueada).toBe(true);
    expect(res.dependencias).toHaveLength(1);
    expect(res.dependencias[0].necesita[0]).toMatchObject({ sha: c1, motivo: "lineas" });
    expect(r.git.r(["rev-parse", "--verify", "--quiet", "release/1.1.0"]).status).not.toBe(0);
    // Con los dos elegidos se puede.
    expect(prepararRelease(r.git, [c1, c2], OPC).bloqueada).toBe(false);
  });

  it("bloquea si el elegido USA una tabla o acción que crea otro cambio no elegido", () => {
    const r = repo();
    r.en("staging");
    const migracion = r.commit("feat(bd): tabla de extras", { "supabase/migrations/001_extras.sql": "create table if not exists public.reservas_extra (id int);\n" });
    const panel = r.commit("feat(panel): lista de extras", { "src/extras.ts": 'export const leer = () => supabase.from("reservas_extra").select();\n' });
    r.en("main");
    const res = prepararRelease(r.git, [panel], OPC);
    expect(res.bloqueada).toBe(true);
    expect(res.dependencias[0].necesita[0]).toMatchObject({ sha: migracion, motivo: "usa", nombres: ["reservas_extra"] });
    // Quien prepara la release puede descartarla a mano: queda anotado en el commit de la release.
    const forzada = prepararRelease(r.git, [panel], { ...OPC, noDepende: [migracion] });
    expect(forzada.bloqueada).toBe(false);
    expect(r.sh("log", "-1", "--format=%B", "release/1.1.0")).toContain(`--no-depende): ${migracion.slice(0, 7)}`);
  });

  it("bloquea ante un conflicto con lo que ya hay en main y dice el fichero", () => {
    const r = repo();
    r.en("staging");
    const e = r.commit("fix(comun): b en mayúscula", { "src/comun.ts": "a\nB\nc\n" });
    r.en("main");
    r.commit("fix(comun): arreglo urgente", { "src/comun.ts": "a\nbe\nc\n" });
    const res = prepararRelease(r.git, [e], OPC);
    expect(res.bloqueada).toBe(true);
    expect(res.conflicto?.ficheros).toEqual(["src/comun.ts"]);
    expect(r.sh("worktree", "list").split("\n")).toHaveLength(1); // la copia temporal se ha borrado
  });

  it("lo ya publicado no se vuelve a meter y lo dice", () => {
    const r = repo();
    r.en("staging");
    const a = r.commit("feat: A", { "src/a.ts": "a\n" });
    r.en("main");
    prepararRelease(r.git, [a], OPC);
    r.sh("merge", "-q", "--no-ff", "release/1.1.0", "-m", "Merge pull request #5 from org/release/1.1.0");
    const res = prepararRelease(r.git, [a], OPC);
    expect(res.bloqueada).toBe(true);
    expect(res.avisos.join(" ")).toMatch(/ya está publicado/);
    expect(res.errores.join(" ")).toMatch(/ya está en producción/);
  });

  it("un PR fusionado con merge commit se elige por número y entra entero como un commit", () => {
    const r = repo();
    r.sh("checkout", "-q", "-b", "feature/x", "staging");
    r.commit("feat(x): parte 1", { "src/x1.ts": "1\n" });
    r.commit("feat(x): parte 2", { "src/x2.ts": "2\n" });
    r.en("staging");
    r.sh("merge", "-q", "--no-ff", "feature/x", "-m", "Merge pull request #7 from org/feature/x\n\nfeat(x): pantalla nueva");
    r.commit("fix: otra cosa (#8)", { "src/otra.ts": "o\n" });
    r.en("main");

    const lista = pendientes(r.git, { base: "main", desde: "staging" }).pendientes;
    expect(lista.map((u) => [u.id, u.commits.length])).toEqual([["#7", 2], [lista[1].id, 1]]);
    expect(lista[1].pr).toBe(8); // squash: el número sale del título

    const res = prepararRelease(r.git, ["#7"], OPC);
    expect(res.bloqueada).toBe(false);
    expect(r.sh("log", "--format=%s", "main..release/1.1.0")).toBe("release: v1.1.0\nfeat(x): pantalla nueva (#7)");
    expect(r.sh("ls-tree", "--name-only", "release/1.1.0", "src/").split("\n")).toEqual(expect.arrayContaining(["src/x1.ts", "src/x2.ts"]));
    expect(r.git.r(["cat-file", "-e", "release/1.1.0:src/otra.ts"]).status).not.toBe(0);

    const squash = prepararRelease(r.git, ["#8"], { ...OPC, version: "1.2.0" });
    expect(squash.bloqueada).toBe(false);
  });

  it("un merge local «Merge branch 'x' into staging (#12)» también se elige por número", () => {
    const r = repo();
    r.sh("checkout", "-q", "-b", "fix/z", "staging");
    r.commit("fix(z): arreglo", { "src/z.ts": "z\n" });
    r.en("staging");
    r.sh("merge", "-q", "--no-ff", "fix/z", "-m", "Merge branch 'fix/z' into staging (#12)");
    r.en("main");
    const lista = pendientes(r.git, { base: "main", desde: "staging" }).pendientes;
    expect(lista.map((u) => [u.id, u.tipo])).toEqual([["#12", "rama"]]);
    expect(prepararRelease(r.git, ["#12"], OPC)).toMatchObject({ bloqueada: false, version: "1.0.1" });
  });

  it("rechaza un merge de integración y un PR que no está en staging", () => {
    const r = repo();
    r.sh("checkout", "-q", "-b", "feat/y", "staging");
    r.commit("feat(y): algo", { "src/y.ts": "y\n" });
    r.en("staging");
    r.commit("fix: en staging", { "src/s.ts": "s\n" });
    r.en("feat/y");
    r.sh("merge", "-q", "--no-ff", "staging", "-m", "Merge remote-tracking branch 'origin/staging' into feat/y");
    const integracion = r.sh("rev-parse", "HEAD");
    r.en("staging");
    r.sh("merge", "-q", "--ff-only", "feat/y");
    r.en("main");
    const res = prepararRelease(r.git, [integracion, "#99"], OPC);
    expect(res.bloqueada).toBe(true);
    expect(res.errores.join("\n")).toMatch(/merge de integración/);
    expect(res.errores.join("\n")).toMatch(/PR #99: no está en staging/);
    // Y los cambios de verdad sí se listan.
    expect(pendientes(r.git, { base: "main", desde: "staging" }).pendientes.map((u) => u.titulo)).toEqual(["feat(y): algo", "fix: en staging"]);
  });

  it("desde el formato antiguo (0.N) da el paso a 1.0.0 y lo anota", () => {
    const r = repo({ version: { mayor: 0 } });
    r.commit("fix: uno", { "src/u.ts": "u\n" });
    r.sh("branch", "-f", "staging");
    r.en("staging");
    const a = r.commit("feat: A", { "src/a.ts": "a\n" });
    r.en("main");
    const res = prepararRelease(r.git, [a], OPC);
    expect(res).toMatchObject({ bloqueada: false, anterior: "0.1", version: "1.0.0" });
    expect(r.sh("show", "release/1.0.0:CHANGELOG.md")).toContain("Primera versión de la serie 1.x. Producción estaba en v0.1.");
  });
});

describe("comprobar e informe", () => {
  function conRelease() {
    const r = repo();
    r.en("staging");
    const a = r.commit("feat(reservas): mesas al final\n\nAntes: se usaban en cualquier orden.\nAhora: las mesas 10-12 van las últimas.", {
      "src/Reservas.tsx": "export const R = () => null;\n",
      "supabase/migrations/002_mesas.sql": "alter table reservas add column al_final boolean;\n",
    });
    const b = r.commit("fix(carta): precio", { "src/carta.ts": "linea 1\nlinea 2 corregida\nlinea 3\n" });
    r.en("main");
    prepararRelease(r.git, [a], OPC);
    return { r, a, b };
  }

  it("la rama release cumple las reglas; otra rama o una versión que no cuadra, no", () => {
    const { r } = conRelease();
    expect(comprobarRelease(r.git, { base: "main", head: "release/1.1.0", rama: "release/1.1.0" }).errores).toEqual([]);
    expect(comprobarRelease(r.git, { base: "main", head: "staging", rama: "staging" }).errores[0]).toMatch(/release\/X\.Y\.Z/);
    expect(comprobarRelease(r.git, { base: "main", head: "release/1.1.0", rama: "release/1.2.0" }).errores.join(" ")).toMatch(/versionado\.json dice 1\.1\.0/);
    // Si main avanza, la release tiene que rehacerse.
    r.commit("fix: hotfix en main", { "src/otro.ts": "x\n" });
    expect(comprobarRelease(r.git, { base: "main", head: "release/1.1.0", rama: "release/1.1.0" }).errores.join(" ")).toMatch(/no parte del último/);
  });

  it("el informe sale de la diferencia real: incluido, pendiente, impacto, capturas y reversión", () => {
    const { r, b } = conRelease();
    const { texto, sinExplicar, quedan } = generarInforme(r.git, { base: "main", head: "release/1.1.0", desde: "staging", repo: "org/app" });
    expect(texto).toContain("## v1.1.0 · app");
    expect(texto).toContain("**Producción ahora:** v1.0.0");
    expect(texto).toMatch(/### Qué se añade\n- \*\*Reservas: mesas al final\*\* \(\[[0-9a-f]{7}\]\(https:\/\/github\.com\/org\/app\/commit\/[0-9a-f]{40}\)\): antes se usaban en cualquier orden → ahora las mesas 10-12 van las últimas\./);
    expect(texto).toContain("La diferencia coincide con la lista");
    expect(sinExplicar).toEqual([]);
    expect(quedan.map((u) => u.sha)).toEqual([b]);
    expect(texto).toMatch(/### Qué queda pendiente\n.*\n- Carta: precio/);
    expect(texto).toContain("### Impacto operativo\n- **Migraciones de Supabase**");
    expect(texto).toContain("`002_mesas.sql`");
    expect(texto).toContain("### Capturas");
    expect(texto).toContain("### Reversión");
    expect(texto).toContain("**las migraciones de Supabase**");
  });

  it("avisa si la diferencia trae algo que no está en la lista", () => {
    const { r } = conRelease();
    r.en("release/1.1.0");
    r.commit("chore: retoque a mano", { "src/carta.ts": "cambiado a mano\n" });
    r.sh("commit", "-q", "--amend", "-m", "release: v1.1.0 (retocada)"); // se cuela en el commit de la release
    r.en("main");
    const { texto } = generarInforme(r.git, { base: "main", head: "release/1.1.0", desde: "staging", repo: "org/app" });
    expect(texto).toMatch(/⚠️ Hay cambios en la diferencia que no corresponden a ningún cambio de la lista: `src\/carta\.ts`/);
  });

  it("sin cambios visuales ni de Supabase no salen esas secciones", () => {
    const r = repo();
    r.en("staging");
    const a = r.commit("docs: guía", { "docs/guia.md": "hola\n" });
    r.en("main");
    prepararRelease(r.git, [a], OPC);
    const { texto } = generarInforme(r.git, { base: "main", head: "release/1.0.1", desde: "staging", repo: "org/app" });
    expect(texto).not.toContain("### Capturas");
    expect(texto).not.toContain("### Impacto operativo");
    expect(texto).toContain("Nada: `staging` no tiene más cambios sin publicar.");
  });

  it("al regenerar conserva lo escrito fuera de las marcas", () => {
    const viejo = "Nota del dueño\n<!-- informe-release:inicio (x) -->\nviejo\n<!-- informe-release:fin -->\nFirma";
    expect(sustituirInforme(viejo, "<!-- informe-release:inicio (x) -->\nnuevo\n<!-- informe-release:fin -->")).toBe(
      "Nota del dueño\n<!-- informe-release:inicio (x) -->\nnuevo\n<!-- informe-release:fin -->\nFirma",
    );
  });
});
