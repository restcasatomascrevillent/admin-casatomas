// Releases con una selección explícita de cambios (docs/PROCESO-DE-CAMBIOS.md).
//
//   node scripts/release.mjs pendientes                    qué hay en staging sin publicar
//   node scripts/release.mjs preparar '#12' a1b2c3d …      crea release/X.Y.Z desde main con SOLO eso
//        [--objetivo "texto"] [--tipo minor|patch|major] [--version X.Y.Z] [--simular]
//   node scripts/release.mjs comprobar                     reglas de una rama release/X.Y.Z (lo usa el CI)
//   node scripts/release.mjs informe                       descripción del PR de la release (diferencia real)
//   node scripts/release.mjs notas X.Y.Z                   texto del CHANGELOG para la GitHub Release
//
// Opciones comunes: --base (origin/main), --desde (origin/staging), --head (HEAD).
//
// Qué hace «preparar», en una copia temporal (git worktree) que no toca tu carpeta:
//   1. Busca cada PR o commit seleccionado en staging. Un PR fusionado con merge commit se aplica
//      entero (cherry-pick -m 1); uno fusionado con squash es un commit normal.
//   2. Descarta lo que ya está en main (por ascendencia, por la marca «cherry picked from commit»
//      o por tener el mismo parche) y lo dice.
//   3. Busca DEPENDENCIAS: con `git blame`, qué commits escribieron las líneas que el cambio
//      modifica o borra. Si alguno no está en main ni en la selección, BLOQUEA y lo nombra.
//   4. Aplica los cambios en orden. Un CONFLICTO también bloquea, con los ficheros afectados.
//   5. Sube la versión (1.x.y), añade la entrada del CHANGELOG y crea la rama release/X.Y.Z.
// Nunca añade cambios que no se hayan pedido: si falta algo, se para y lo explica.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FICHERO_VERSION = "versionado.json";
export const FICHERO_CHANGELOG = "CHANGELOG.md";
const FICHEROS_DE_RELEASE = new Set([FICHERO_VERSION, FICHERO_CHANGELOG]);
const EQUIPO_VERCEL = "casa-tomas";
const RE_RAMA_RELEASE = /^release\/(\d+\.\d+\.\d+)$/;
const RE_TRAILER = /\(cherry picked from commit ([0-9a-f]{40})\)/g;
const TIENE_TRAILER = /\(cherry picked from commit [0-9a-f]{40}\)/;
const RE_PR_MERGE = /^Merge pull request #(\d+) from (\S+)/;
const RE_MERGE_RAMA = /^Merge branch '([^']+)'(?: into (\S+?))?(?: \(#(\d+)\))?\s*$/;
const RE_SQUASH = /\s\(#(\d+)\)\s*$/;
const RE_COMMIT_RELEASE = /^release: v\d+\.\d+\.\d+/;
const COMO_FUNCIONA =
  "Versión publicada (X.Y.Z). Solo la cambia scripts/release.mjs al preparar una release; main tiene la de producción y la etiqueta vX.Y.Z se crea al aceptar el PR. Ver docs/PROCESO-DE-CAMBIOS.md.";

export class ErrorRelease extends Error {}

// ─────────────────────────────── git ───────────────────────────────

/** Ejecuta git en `cwd`. `git.r()` devuelve {status, stdout, stderr} sin lanzar. */
export function crearGit(cwd = RAIZ, entornoExtra = {}) {
  const r = (args, { input, env } = {}) =>
    spawnSync("git", ["-c", "core.quotePath=false", ...args], {
      cwd,
      input,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      env: { ...process.env, ...entornoExtra, ...env },
    });
  const git = (args, opciones) => {
    const res = r(args, opciones);
    if (res.status !== 0) throw new ErrorRelease(`git ${args.join(" ")}\n${(res.stderr || res.stdout).trim()}`);
    return res.stdout.replace(/\n$/, "");
  };
  git.r = r;
  git.cwd = cwd;
  return git;
}

const lineas = (texto) => (texto ? texto.split("\n").filter(Boolean) : []);
const corto = (sha) => (sha ? sha.slice(0, 7) : "");

function infoCommit(git, ref) {
  const [sha, padres, autor, fecha, asunto, cuerpo] = git(["show", "-s", "--format=%H%x00%P%x00%an <%ae>%x00%aI%x00%s%x00%b", ref]).split("\0");
  return { sha, padres: padres.split(" ").filter(Boolean), autor, fecha, asunto, cuerpo: (cuerpo ?? "").trim() };
}

function esAncestro(git, a, b, cache) {
  const clave = `${a} ${b}`;
  if (cache?.has(clave)) return cache.get(clave);
  const res = git.r(["merge-base", "--is-ancestor", a, b]).status === 0;
  cache?.set(clave, res);
  return res;
}

function resolver(git, ref) {
  const res = git.r(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return res.status === 0 ? res.stdout.trim() : null;
}

function patchId(git, diff) {
  if (!diff.trim()) return null;
  const out = git(["patch-id", "--stable"], { input: diff });
  return out.split(" ")[0] || null;
}

/** Repositorio "dueño/nombre" (para enlaces a GitHub). */
export function slugRepo(git) {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = git.r(["remote", "get-url", "origin"]).stdout.trim();
  const m = /[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : "dueno/repo";
}

// ───────────────────────────── versiones ─────────────────────────────

const RE_SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
export const parsearVersion = (v) => {
  const m = RE_SEMVER.exec(String(v ?? "").trim());
  return m ? m.slice(1).map(Number) : null;
};
export function compararVersiones(a, b) {
  const [x, y] = [parsearVersion(a), parsearVersion(b)];
  if (!x || !y) throw new ErrorRelease(`versión no válida: ${x ? b : a}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * Siguiente versión de una release. En 0.x la siguiente es SIEMPRE 1.0.0 (paso a 1.x), salvo
 * `version` explícita. Después: `tipo` si se da; si no, minor si hay alguna funcionalidad
 * nueva (feat) y patch en el resto. Major solo a petición (`tipo: "major"`).
 */
export function siguienteVersion(actual, { clases = [], tipo, version } = {}) {
  if (version) {
    if (!parsearVersion(version)) throw new ErrorRelease(`--version ${version} no es X.Y.Z`);
    if (parsearVersion(actual) && compararVersiones(version, actual) <= 0) throw new ErrorRelease(`--version ${version} tiene que ser mayor que la de producción (${actual})`);
    return version;
  }
  const p = parsearVersion(actual);
  if (!p || p[0] === 0) return "1.0.0";
  const t = tipo ?? (clases.includes("feat") ? "minor" : "patch");
  if (t === "major") return `${p[0] + 1}.0.0`;
  if (t === "minor") return `${p[0]}.${p[1] + 1}.0`;
  if (t === "patch") return `${p[0]}.${p[1]}.${p[2] + 1}`;
  throw new ErrorRelease(`--tipo ${t}: usa major, minor o patch`);
}

/**
 * Versión de `versionado.json` en `ref`. Entiende el formato antiguo («mayor» + número de
 * commits, hasta la 0.x) para poder dar el paso a 1.0.0 desde él.
 */
export function versionEn(git, ref) {
  const res = git.r(["show", `${ref}:${FICHERO_VERSION}`]);
  if (res.status !== 0) return { version: null, formato: "ninguno" };
  let datos;
  try { datos = JSON.parse(res.stdout); } catch { return { version: null, formato: "roto" }; }
  if (parsearVersion(datos.version)) return { version: datos.version, formato: "semver" };
  if (Number.isInteger(datos.mayor)) {
    const desde = git.r(["log", "-1", "--format=%H", ref, "--", FICHERO_VERSION]).stdout.trim();
    const n = desde ? git.r(["rev-list", "--count", "--no-merges", `${desde}..${ref}`]).stdout.trim() : "?";
    return { version: `${datos.mayor}.${n}`, formato: "antiguo" };
  }
  return { version: null, formato: "roto" };
}

// ─────────────────────── títulos y tipos de cambio ───────────────────────

const RE_CONVENCIONAL = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;
/** "feat" (se añade), "cambio" (cambia un comportamiento) u "otro" (docs, tests, CI…); null si no se sabe. */
export function claseDeTitulo(titulo) {
  const m = RE_CONVENCIONAL.exec(titulo ?? "");
  if (!m) return null;
  const t = m[1].toLowerCase();
  if (t === "feat") return "feat";
  if (["fix", "perf", "refactor", "style", "revert"].includes(t)) return "cambio";
  return "otro";
}
/** "feat(reservas): hoja de mesa" → "Reservas: hoja de mesa". */
export function tituloLegible(titulo) {
  const sinPr = String(titulo ?? "").replace(RE_SQUASH, "").trim();
  const m = RE_CONVENCIONAL.exec(sinPr);
  if (!m) return sinPr;
  const texto = m[4].trim();
  return m[2] ? `${m[2].charAt(0).toUpperCase()}${m[2].slice(1)}: ${texto}` : texto.charAt(0).toUpperCase() + texto.slice(1);
}
function claseDeUnidad(u) {
  const propia = claseDeTitulo(u.titulo);
  if (propia) return propia;
  const deCommits = (u.asuntos ?? []).map(claseDeTitulo);
  if (deCommits.includes("feat")) return "feat";
  if (deCommits.includes("cambio")) return "cambio";
  if (deCommits.length && deCommits.every((c) => c === "otro")) return "otro";
  return "cambio";
}

/** Primer párrafo útil y líneas «Antes:»/«Ahora:» del mensaje. */
function resumenDeMensaje(cuerpo) {
  const ls = (cuerpo ?? "").split("\n").map((l) => l.trim());
  // «Antes: …» / «Ahora: …» pueden seguir en las líneas siguientes hasta una vacía o la otra marca.
  const valor = (re) => {
    const i = ls.findIndex((l) => re.test(l));
    if (i === -1) return null;
    const partes = [ls[i].replace(re, "")];
    for (const l of ls.slice(i + 1)) { if (!l || /^(antes|ahora):/i.test(l) || /^[-*] /.test(l)) break; partes.push(l); }
    return partes.join(" ").replace(/\s+/g, " ").trim() || null;
  };
  const antes = valor(/^antes:\s*/i);
  const ahora = valor(/^ahora:\s*/i);
  const parrafo = [];
  for (const l of ls) {
    if (/^(co-authored-by|claude-session|signed-off-by):/i.test(l) || TIENE_TRAILER.test(l)) continue;
    if (!l) { if (parrafo.length) break; continue; }
    parrafo.push(l.replace(/^[-*]\s+/, ""));
  }
  let texto = parrafo.join(" ").replace(/\s+/g, " ").trim();
  if (texto.length > 220) texto = `${texto.slice(0, 217).replace(/\s+\S*$/, "")}…`;
  return { antes, ahora, texto: texto || null };
}

// ─────────────────────── cambios pendientes y publicados ───────────────────────

/**
 * Índice de lo que ya está publicado en `base`: SHA originales citados por la marca
 * «cherry picked from commit X» en todo su historial, y parches de los commits que están en
 * `base` pero no en `desde` (copias sin marca).
 */
function indicePublicados(git, base, desde) {
  const originales = new Set();
  for (const m of git(["log", "--format=%B", base]).matchAll(RE_TRAILER)) originales.add(m[1]);
  let parches = null;
  const parchesBase = () => {
    if (parches) return parches;
    parches = new Set();
    const salida = git(["log", "-p", "--no-merges", "--format=commit %H", `${desde}..${base}`]);
    if (salida.trim()) for (const l of lineas(git(["patch-id", "--stable"], { input: salida + "\n" }))) parches.add(l.split(" ")[0]);
    return parches;
  };
  return { originales, parchesBase };
}

function diffUnidad(git, u) {
  return u.mainline ? git(["diff", "--binary", `${u.sha}^1`, u.sha]) : git(["show", "--binary", "--format=", u.sha]);
}

function estaPublicada(git, u, indice) {
  if (indice.originales.has(u.sha)) return "marca";
  if (u.commits.length && u.commits.every((c) => indice.originales.has(c))) return "marca";
  const pid = patchId(git, diffUnidad(git, u));
  if (pid && indice.parchesBase().has(pid)) return "parche";
  return null;
}

/**
 * Agrupa los commits de `base..desde` en cambios seleccionables: PR fusionados con merge
 * commit (o «Merge branch 'x' into staging»), y commits sueltos (un squash «… (#12)» lleva su
 * número de PR). Los merges de integración (staging dentro de una rama) no son cambios.
 */
export function cambiosEntre(git, base, desde) {
  const nombreDesde = desde.replace(/^origin\//, "");
  const shas = lineas(git(["rev-list", "--topo-order", "--reverse", `${base}..${desde}`]));
  const unidades = [];
  const integracion = [];
  for (const [posicion, sha] of shas.entries()) {
    const c = infoCommit(git, sha);
    if (c.padres.length > 1) {
      const pr = RE_PR_MERGE.exec(c.asunto);
      const rama = RE_MERGE_RAMA.exec(c.asunto);
      const ramaPr = pr?.[2].replace(/^[^/]+\//, "");
      const esCambio = (pr && !/^(main|staging|release\/.*)$/.test(ramaPr)) || (rama && (!rama[2] || rama[2] === nombreDesde) && !/^(origin\/)?(main|staging)$/.test(rama[1]));
      if (!esCambio) { integracion.push(c); continue; }
      const commits = lineas(git(["rev-list", "--no-merges", "--reverse", `${c.padres[0]}..${c.padres[1]}`]));
      const asuntos = commits.map((s) => infoCommit(git, s).asunto);
      const numero = pr ? pr[1] : rama[3];
      unidades.push({
        id: numero ? `#${numero}` : corto(sha),
        tipo: pr ? "pr" : "rama",
        pr: numero ? Number(numero) : null,
        rama: pr ? ramaPr : rama[1],
        sha,
        mainline: 1,
        titulo: (pr ? c.cuerpo.split("\n")[0] : "") || (asuntos.length === 1 ? asuntos[0] : pr ? ramaPr : `Rama ${rama[1]}`),
        cuerpo: pr ? c.cuerpo.split("\n").slice(1).join("\n") : "",
        autor: commits.length ? infoCommit(git, commits.at(-1)).autor : c.autor,
        fecha: c.fecha,
        commits,
        asuntos,
        posicion,
      });
    } else {
      const pr = RE_SQUASH.exec(c.asunto);
      unidades.push({ id: corto(sha), tipo: "commit", pr: pr ? Number(pr[1]) : null, sha, mainline: null, titulo: c.asunto, cuerpo: c.cuerpo, autor: c.autor, fecha: c.fecha, commits: [sha], asuntos: [c.asunto], posicion });
    }
  }
  // Los commits que ya van dentro de un PR no se listan aparte (siguen pudiéndose elegir por SHA).
  const enGrupos = new Map();
  for (const u of unidades) if (u.mainline) for (const s of u.commits) if (!enGrupos.has(s)) enGrupos.set(s, u);
  const visibles = unidades.filter((u) => u.mainline || !enGrupos.has(u.sha));
  return { unidades: visibles, todas: unidades, enGrupos, integracion };
}

/** Cambios de `desde` que no están en `base`, separados en pendientes y ya publicados. */
export function pendientes(git, { base, desde }) {
  const indice = indicePublicados(git, base, desde);
  const { unidades, enGrupos, integracion } = cambiosEntre(git, base, desde);
  const resultado = { pendientes: [], publicados: [], integracion, enGrupos, indice };
  for (const u of unidades) {
    const como = estaPublicada(git, u, indice);
    (como ? resultado.publicados : resultado.pendientes).push(como ? { ...u, publicadoPor: como } : u);
  }
  return resultado;
}

// ─────────────────────────────── selección ───────────────────────────────

/** Traduce "#12", "12" con #, o SHAs a cambios concretos de `desde`. */
export function resolverSeleccion(git, seleccion, { base, desde, estado = pendientes(git, { base, desde }) }) {
  const errores = [];
  const avisos = [];
  const elegidas = new Map();
  const todas = [...estado.pendientes, ...estado.publicados];
  for (const bruto of seleccion) {
    const item = String(bruto).trim();
    if (!item) continue;
    const numPr = /^#(\d+)$/.exec(item)?.[1];
    if (numPr) {
      const u = todas.find((x) => x.pr === Number(numPr));
      if (!u) {
        const enBase = git.r(["log", "-1", "--format=%h", "-E", `--grep=^Merge pull request #${numPr} from|\\(#${numPr}\\)$`, base]).stdout.trim();
        errores.push(enBase ? `PR #${numPr}: ya está en ${base} (${enBase}).` : `PR #${numPr}: no está en ${desde}. Fusiónalo antes en staging (con merge commit o squash) o elige sus commits.`);
        continue;
      }
      if (u.publicadoPor) { avisos.push(`${u.id} ya está publicado en ${base}: se omite.`); continue; }
      elegidas.set(u.sha, u);
      continue;
    }
    if (!/^[0-9a-f]{4,40}$/i.test(item)) { errores.push(`«${item}»: usa #número de PR o un SHA de commit.`); continue; }
    const sha = resolver(git, item);
    if (!sha) { errores.push(`${item}: no existe ese commit (¿falta git fetch?).`); continue; }
    if (esAncestro(git, sha, base)) { avisos.push(`${corto(sha)} ya está en ${base}: se omite.`); continue; }
    if (!esAncestro(git, sha, desde)) { errores.push(`${corto(sha)}: no está en ${desde}. Solo se publica lo que ha pasado por ${desde} (para una urgencia, usa --desde con la rama del arreglo).`); continue; }
    const u = todas.find((x) => x.sha === sha);
    if (u) {
      if (u.publicadoPor) { avisos.push(`${u.id} ya está publicado en ${base}: se omite.`); continue; }
      elegidas.set(sha, u);
      continue;
    }
    const c = infoCommit(git, sha);
    if (c.padres.length > 1) { errores.push(`${corto(sha)} es un merge de integración («${c.asunto}»): elige el PR o los commits del cambio.`); continue; }
    const grupo = estado.enGrupos.get(sha);
    if (grupo) avisos.push(`${corto(sha)} es parte de ${grupo.id}: se publica solo ese commit, no el PR entero.`);
    const individual = { id: corto(sha), tipo: "commit", pr: null, sha, mainline: null, titulo: c.asunto, cuerpo: c.cuerpo, autor: c.autor, fecha: c.fecha, commits: [sha], asuntos: [c.asunto], posicion: grupo?.posicion ?? Number.MAX_SAFE_INTEGER };
    if (estaPublicada(git, individual, estado.indice)) { avisos.push(`${corto(sha)} ya está publicado en ${base}: se omite.`); continue; }
    elegidas.set(sha, individual);
  }
  // Un commit suelto que ya va dentro de un PR elegido sobra.
  const enElegidos = new Set([...elegidas.values()].filter((u) => u.mainline).flatMap((u) => u.commits));
  const unidades = [...elegidas.values()].filter((u) => u.mainline || !enElegidos.has(u.sha));
  // Orden de staging: así cada cambio se aplica después de lo que tenga debajo.
  const orden = new Map(lineas(git(["rev-list", "--topo-order", "--reverse", `${base}..${desde}`])).map((s, i) => [s, i]));
  unidades.sort((a, b) => (orden.get(a.sha) ?? a.posicion) - (orden.get(b.sha) ?? b.posicion));
  return { unidades, errores, avisos };
}

// ─────────────────────────────── dependencias ───────────────────────────────

/** Rangos de líneas ANTIGUAS que modifica o borra un diff -U0, por fichero. */
export function rangosModificados(diff) {
  const res = [];
  let actual = null;
  for (const l of diff.split("\n")) {
    if (l.startsWith("diff --git ")) { actual = { viejo: null, binario: false, rangos: [] }; res.push(actual); continue; }
    if (!actual) continue;
    if (l.startsWith("--- ")) actual.viejo = l === "--- /dev/null" ? null : l.slice(4).replace(/^a\//, "").replace(/\t$/, "");
    else if (l.startsWith("Binary files ")) actual.binario = true;
    else {
      const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(l);
      if (m) {
        const n = m[2] === undefined ? 1 : Number(m[2]);
        if (n > 0) actual.rangos.push([Number(m[1]), n]);
      }
    }
  }
  return res.filter((f) => f.viejo && f.rangos.length);
}

const RE_DEFINE_SQL = /create\s+(?:or\s+replace\s+)?(?:table|view|materialized\s+view|function|type|sequence)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([A-Za-z_]\w+)/gi;
const RE_DEFINE_JS = /export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const RE_LITERAL = /["'`=]([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?=["'`&]|$)/g;
const esDoc = (f) => /\.(md|txt|csv)$/i.test(f);

/** Líneas añadidas por un cambio, por fichero (diff -U0 contra su padre). */
function lineasAnadidas(git, u) {
  const padre = u.mainline ? `${u.sha}^1` : `${u.sha}^`;
  const res = [];
  let fichero = null;
  for (const l of git(["diff", "-U0", "--no-color", "-M", padre, u.sha]).split("\n")) {
    if (l.startsWith("+++ ")) fichero = l === "+++ /dev/null" ? null : l.slice(4).replace(/^b\//, "");
    else if (fichero && l.startsWith("+")) res.push({ fichero, texto: l.slice(1) });
  }
  return res;
}

/**
 * Nombres que un cambio CREA y que no existen en `base`: tablas y funciones de SQL y exports de
 * código, y literales snake_case del código de servidor (acciones de Edge Functions, RPC,
 * tablas). Sirve para ver si otro cambio los usa aunque no toque sus líneas (p. ej. el panel
 * llama a una acción nueva). Un literal en el panel o en un script es un USO, no una creación.
 */
const esServidor = (f) => /^(supabase\/(functions|migrations)\/|api\/)/.test(f);
function nombresNuevos(git, u, base, cacheBase) {
  const nombres = new Set();
  for (const { fichero, texto } of lineasAnadidas(git, u)) {
    if (esDoc(fichero) || esTest(fichero)) continue;
    const re = [/\.sql$/i.test(fichero) ? RE_DEFINE_SQL : RE_DEFINE_JS, ...(esServidor(fichero) ? [RE_LITERAL] : [])];
    for (const r of re) for (const m of texto.matchAll(r)) if (m[1].length >= 6) nombres.add(m[1]);
  }
  const porMirar = [...nombres].filter((n) => !cacheBase.has(n));
  if (porMirar.length) {
    const existen = new Set(lineas(git.r(["grep", "-o", "-h", "-w", "-F", ...porMirar.flatMap((n) => ["-e", n]), base, "--", "."]).stdout).map((l) => l.replace(/^[^:]*:/, "")));
    for (const n of porMirar) cacheBase.set(n, existen.has(n));
  }
  return new Set([...nombres].filter((n) => !cacheBase.get(n)));
}

/**
 * Para cada cambio elegido, lo que necesita y no está en `base`, ni publicado, ni elegido:
 *  - «lineas»: commits que escribieron las líneas que modifica o borra (git blame);
 *  - «usa»: cambios pendientes que crean un nombre (tabla, función, acción, export) que el
 *    elegido usa. Así se ve que el panel necesita la migración o la Edge Function de otro PR.
 * `noDepende`: SHAs que quien prepara la release declara innecesarios (quedan anotados).
 */
export function dependenciasQueFaltan(git, unidades, { base, estado, noDepende = [] }) {
  const elegidos = new Set(unidades.flatMap((u) => [u.sha, ...u.commits]));
  const descartados = new Set(noDepende);
  const cache = new Map();
  const ok = new Map();
  const unidadDe = (sha) => estado.pendientes.find((u) => u.sha === sha || u.commits.includes(sha));
  const descartado = (sha) => descartados.has(sha) || [...descartados].some((d) => unidadDe(sha)?.sha === d);
  const cacheBase = new Map();
  const noElegidas = estado.pendientes.filter((p) => !elegidos.has(p.sha) && !p.commits.some((c) => elegidos.has(c)) && !descartado(p.sha));
  const creadosPorElegidos = new Set(unidades.flatMap((u) => [...nombresNuevos(git, u, base, cacheBase)]));
  // Cada nombre se atribuye a quien lo creó primero (estado.pendientes va en orden de staging).
  const yaVistos = new Set(creadosPorElegidos);
  const creaciones = [];
  for (const p of noElegidas) {
    const nombres = new Set([...nombresNuevos(git, p, base, cacheBase)].filter((n) => !yaVistos.has(n)));
    for (const n of nombres) yaVistos.add(n);
    if (nombres.size) creaciones.push({ unidad: p, nombres });
  }
  const faltan = [];
  for (const u of unidades) {
    const padre = u.mainline ? `${u.sha}^1` : `${u.sha}^`;
    const diff = git(["diff", "-U0", "--no-color", "-M", padre, u.sha]);
    const necesita = new Map();
    for (const f of rangosModificados(diff)) {
      for (const [inicio, n] of f.rangos) {
        const blame = git.r(["blame", "--porcelain", "-L", `${inicio},+${n}`, padre, "--", f.viejo]);
        if (blame.status !== 0) continue;
        for (const l of blame.stdout.split("\n")) {
          const m = /^([0-9a-f]{40}) \d+ \d+/.exec(l);
          if (!m) continue;
          const x = m[1];
          if (!ok.has(x)) {
            const bien = elegidos.has(x) || descartado(x) || esAncestro(git, x, base, cache) || estado.indice.originales.has(x) ||
              (() => { const pid = patchId(git, git(["show", "--format=", x])); return !!pid && estado.indice.parchesBase().has(pid); })();
            ok.set(x, bien);
          }
          if (ok.get(x)) continue;
          if (!necesita.has(x)) necesita.set(x, { motivo: "lineas", ficheros: new Set(), nombres: new Set() });
          necesita.get(x).ficheros.add(f.viejo);
        }
      }
    }
    if (creaciones.length) {
      const usados = lineasAnadidas(git, u).filter((l) => !esDoc(l.fichero));
      for (const { unidad: p, nombres } of creaciones) {
        // Solo puede depender de lo que ya existía cuando se escribió (sus antepasados).
        if (!esAncestro(git, p.sha, u.mainline ? `${u.sha}^1` : u.sha, cache)) continue;
        for (const nombre of nombres) {
          if (creadosPorElegidos.has(nombre)) continue;
          const re = new RegExp(`(^|[^A-Za-z0-9_$])${nombre.replace(/\$/g, "\\$")}([^A-Za-z0-9_$]|$)`);
          const donde = usados.filter((l) => re.test(l.texto)).map((l) => l.fichero);
          if (!donde.length) continue;
          const clave = p.sha;
          if (!necesita.has(clave)) necesita.set(clave, { motivo: "usa", ficheros: new Set(), nombres: new Set() });
          const e = necesita.get(clave);
          if (e.motivo === "lineas") e.motivo = "lineas+usa";
          e.nombres.add(nombre);
          for (const d of donde) e.ficheros.add(d);
        }
      }
    }
    if (necesita.size) {
      faltan.push({
        unidad: u,
        necesita: [...necesita].map(([sha, d]) => {
          const c = infoCommit(git, sha);
          const de = unidadDe(sha);
          return { sha, asunto: de?.mainline && de.sha === sha ? de.titulo : c.asunto, esMerge: c.padres.length > 1 && !(de?.mainline && de.sha === sha), cambio: de ? de.id : corto(sha), motivo: d.motivo, nombres: [...d.nombres], ficheros: [...d.ficheros] };
        }),
      });
    }
  }
  return faltan;
}

// ─────────────────────────────── changelog ───────────────────────────────

const enlaceCambio = (repo, u) =>
  u.pr ? `[#${u.pr}](https://github.com/${repo}/pull/${u.pr})` : `[${corto(u.sha)}](https://github.com/${repo}/commit/${u.sha})`;

const CABECERA_CHANGELOG = (repo) =>
  `# Changelog\n\nPublicaciones en producción de ${repo.split("/")[1] ?? repo}. Cada entrada la escribe \`scripts/release.mjs\` al preparar la release y recoge solo los cambios incluidos en ella. La numeración 1.x empieza en 1.0.0; las versiones 0.N anteriores están en las Releases de GitHub.\n`;

export function entradaChangelog({ version, fecha, objetivo, unidades, repo, anterior }) {
  const grupos = { feat: [], cambio: [], otro: [] };
  for (const u of unidades) grupos[claseDeUnidad(u)].push(`- ${tituloLegible(u.titulo)} (${enlaceCambio(repo, u)})`);
  const partes = [`## [${version}] - ${fecha}`, ""];
  if (objetivo) partes.push(`Objetivo: ${objetivo}`, "");
  if (anterior && parsearVersion(version)?.[0] === 1 && !parsearVersion(anterior)) partes.push(`Primera versión de la serie 1.x. Producción estaba en v${anterior}.`, "");
  if (grupos.feat.length) partes.push("### Añadido", ...grupos.feat, "");
  if (grupos.cambio.length) partes.push("### Cambiado", ...grupos.cambio, "");
  if (grupos.otro.length) partes.push("### Otros", ...grupos.otro, "");
  if (!unidades.length) partes.push("Sin cambios de código: solo la versión.", "");
  return partes.join("\n");
}

export function insertarEnChangelog(texto, entrada, repo) {
  const base = texto && texto.trim() ? texto : CABECERA_CHANGELOG(repo);
  const i = base.search(/^## \[/m);
  return i === -1 ? `${base.replace(/\s*$/, "")}\n\n${entrada.trim()}\n` : `${base.slice(0, i)}${entrada.trim()}\n\n${base.slice(i)}`;
}

export function seccionChangelog(texto, version) {
  const ini = texto.indexOf(`## [${version}]`);
  if (ini === -1) return null;
  const resto = texto.slice(ini + 1);
  const fin = resto.search(/^## \[/m);
  return (fin === -1 ? texto.slice(ini) : texto.slice(ini, ini + 1 + fin)).trim();
}

// ─────────────────────────────── preparar ───────────────────────────────

/**
 * Prepara la rama release/X.Y.Z desde `base` con SOLO los cambios elegidos. Devuelve un
 * informe; si `bloqueada`, no crea nada y explica por qué en `errores`.
 */
export function prepararRelease(git, seleccion, opciones = {}) {
  const { base = "origin/main", desde = "origin/staging", objetivo = null, tipo, version, simular = false, fecha = new Date().toISOString().slice(0, 10), identidad = {} } = opciones;
  const noDepende = (opciones.noDepende ?? []).map((r) => resolver(git, r)).filter(Boolean);
  const repo = opciones.repo ?? slugRepo(git);
  for (const ref of [base, desde]) if (!resolver(git, ref)) throw new ErrorRelease(`No existe ${ref}. ¿Has hecho git fetch origin?`);
  const estado = pendientes(git, { base, desde });
  const { unidades, errores, avisos } = resolverSeleccion(git, seleccion, { base, desde, estado });
  const resultado = { base, desde, baseSha: resolver(git, base), unidades, errores: [...errores], avisos, dependencias: [], conflicto: null, aplicadas: [], vacias: [], version: null, rama: null, bloqueada: true };
  if (!seleccion.length) resultado.errores.push("No has elegido ningún cambio. Mira la lista con: node scripts/release.mjs pendientes");
  else if (!unidades.length && !errores.length) resultado.errores.push("Todo lo elegido ya está en producción: no hay nada que publicar.");
  if (resultado.errores.length) return resultado;

  resultado.noDepende = noDepende;
  resultado.dependencias = dependenciasQueFaltan(git, unidades, { base, estado, noDepende });
  if (resultado.dependencias.length) {
    resultado.errores.push("Hay cambios elegidos que necesitan otros que no están en producción ni en la selección (ver dependencias).");
    return resultado;
  }

  const anterior = versionEn(git, base).version;
  const clases = unidades.map(claseDeUnidad);
  let nueva;
  try { nueva = siguienteVersion(anterior, { clases, tipo, version }); } catch (e) { resultado.errores.push(e.message); return resultado; }
  resultado.version = nueva;
  resultado.anterior = anterior;
  resultado.rama = `release/${nueva}`;
  if (!simular && resolver(git, `refs/heads/${resultado.rama}`)) { resultado.errores.push(`Ya existe la rama ${resultado.rama}. Bórrala (git branch -D ${resultado.rama}) o elige otra versión con --version.`); return resultado; }
  if (resolver(git, `refs/tags/v${nueva}`)) { resultado.errores.push(`La etiqueta v${nueva} ya existe: elige otra versión con --version.`); return resultado; }

  const carpeta = mkdtempSync(path.join(tmpdir(), "release-"));
  const entornoIdentidad = {
    ...(identidad.nombre ? { GIT_AUTHOR_NAME: identidad.nombre, GIT_COMMITTER_NAME: identidad.nombre } : {}),
    ...(identidad.email ? { GIT_AUTHOR_EMAIL: identidad.email, GIT_COMMITTER_EMAIL: identidad.email } : {}),
  };
  git(["worktree", "add", "--quiet", "--detach", carpeta, resultado.baseSha]);
  try {
    const w = crearGit(carpeta);
    for (const u of unidades) {
      const args = ["cherry-pick", "--no-commit", ...(u.mainline ? ["-m", String(u.mainline)] : []), u.sha];
      const res = w.r(args);
      if (res.status !== 0) {
        const ficheros = lineas(w.r(["diff", "--name-only", "--diff-filter=U"]).stdout);
        if (ficheros.length || /conflict/i.test(res.stdout + res.stderr)) {
          resultado.conflicto = { unidad: u, ficheros, causantes: causantesDeConflicto(git, u, ficheros, { base, estado }) };
          resultado.errores.push(`${u.id} no se puede aplicar sobre ${base} sin conflictos.`);
          return resultado;
        }
        if (!/empty|vac/i.test(res.stdout + res.stderr)) throw new ErrorRelease(`No se pudo aplicar ${u.id}: ${(res.stderr || res.stdout).trim()}`);
      }
      if (w.r(["diff", "--cached", "--quiet"]).status === 0) {
        resultado.vacias.push(u);
        w.r(["reset", "--hard", "-q"]);
        continue;
      }
      const original = infoCommit(git, u.mainline ? u.commits.at(-1) ?? u.sha : u.sha);
      const mensaje = u.mainline
        ? `${u.titulo}${u.pr ? ` (#${u.pr})` : ""}\n\n${u.commits.map((s, i) => `- ${corto(s)} ${u.asuntos[i]}`).join("\n")}\n\n(cherry picked from commit ${u.sha})`
        : `${u.titulo}${u.cuerpo ? `\n\n${u.cuerpo}` : ""}\n\n(cherry picked from commit ${u.sha})`;
      w(["commit", "--quiet", "--no-verify", "-F", "-", `--author=${original.autor}`, `--date=${original.fecha}`], { input: mensaje, env: entornoIdentidad.GIT_COMMITTER_NAME ? { GIT_COMMITTER_NAME: entornoIdentidad.GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL: entornoIdentidad.GIT_COMMITTER_EMAIL } : {} });
      resultado.aplicadas.push({ ...u, nuevo: w(["rev-parse", "HEAD"]) });
    }
    if (!resultado.aplicadas.length) {
      resultado.errores.push("Al aplicarlos, ninguno de los cambios elegidos aporta nada nuevo: ya estaban en producción.");
      return resultado;
    }
    // Versión y CHANGELOG, en un commit propio.
    writeFileSync(path.join(carpeta, FICHERO_VERSION), `${JSON.stringify({ version: nueva, _como_funciona: COMO_FUNCIONA }, null, 2)}\n`);
    let changelog = "";
    try { changelog = readFileSync(path.join(carpeta, FICHERO_CHANGELOG), "utf8"); } catch { /* primera release */ }
    const entrada = entradaChangelog({ version: nueva, fecha, objetivo, unidades: resultado.aplicadas, repo, anterior });
    writeFileSync(path.join(carpeta, FICHERO_CHANGELOG), insertarEnChangelog(changelog, entrada, repo));
    w(["add", FICHERO_VERSION, FICHERO_CHANGELOG]);
    const cuerpo = resultado.aplicadas.map((u) => `- ${u.id} ${u.titulo}`).join("\n");
    const descartes = noDepende.length ? `\n\nDependencias descartadas a mano (--no-depende): ${noDepende.map(corto).join(", ")}` : "";
    w(["commit", "--quiet", "--no-verify", "-F", "-"], { input: `release: v${nueva}\n\n${objetivo ? `${objetivo}\n\n` : ""}${cuerpo}${descartes}\n`, env: entornoIdentidad });
    resultado.sha = w(["rev-parse", "HEAD"]);
    resultado.entrada = entrada;
    if (!simular) git(["branch", resultado.rama, resultado.sha]);
    resultado.bloqueada = false;
    return resultado;
  } finally {
    git.r(["worktree", "remove", "--force", carpeta]);
    rmSync(carpeta, { recursive: true, force: true });
    git.r(["worktree", "prune"]);
  }
}

/** Ante un conflicto: quién escribió las líneas de alrededor de cada trozo y no está en `base`. */
function causantesDeConflicto(git, u, ficheros, { base, estado }) {
  const padre = u.mainline ? `${u.sha}^1` : `${u.sha}^`;
  const cache = new Map();
  const res = new Map();
  for (const f of ficheros) {
    const diff = git.r(["diff", "-U3", "--no-color", padre, u.sha, "--", f]).stdout;
    const existe = git.r(["cat-file", "-e", `${padre}:${f}`]).status === 0;
    if (!existe) continue;
    for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? /gm)) {
      const n = m[2] === undefined ? 1 : Number(m[2]);
      if (!n) continue;
      const blame = git.r(["blame", "--porcelain", "-L", `${m[1]},+${n}`, padre, "--", f]).stdout;
      for (const x of new Set([...blame.matchAll(/^([0-9a-f]{40}) \d+ \d+/gm)].map((y) => y[1]))) {
        if (x === u.sha || u.commits.includes(x) || esAncestro(git, x, base, cache) || estado.indice.originales.has(x)) continue;
        if (!res.has(x)) res.set(x, { sha: x, asunto: infoCommit(git, x).asunto, ficheros: new Set() });
        res.get(x).ficheros.add(f);
      }
    }
  }
  return [...res.values()].map((c) => {
    const de = estado.pendientes.find((p) => p.sha === c.sha || p.commits.includes(c.sha));
    return { ...c, ficheros: [...c.ficheros], cambio: de ? de.id : corto(c.sha) };
  });
}

// ─────────────────────────────── comprobar ───────────────────────────────

/** Reglas que tiene que cumplir una rama release/X.Y.Z para poder fusionarse en main. */
export function comprobarRelease(git, { base = "origin/main", head = "HEAD", rama }) {
  const errores = [];
  const avisos = [];
  const version = RE_RAMA_RELEASE.exec(rama ?? "")?.[1];
  if (!version) {
    errores.push(`Producción solo admite PR desde ramas release/X.Y.Z (esta es «${rama ?? "?"}»). Prepara una con: node scripts/release.mjs preparar …`);
    return { errores, avisos, version: null };
  }
  const enHead = versionEn(git, head);
  const enBase = versionEn(git, base);
  if (enHead.version !== version) errores.push(`${FICHERO_VERSION} dice ${enHead.version ?? "nada"} y la rama es ${rama}.`);
  if (enBase.formato === "semver" && parsearVersion(version) && compararVersiones(version, enBase.version) <= 0) errores.push(`v${version} no es mayor que la de producción (v${enBase.version}).`);
  if (!esAncestro(git, base, head)) errores.push(`${rama} no parte del último ${base}: vuelve a prepararla (main ha cambiado desde entonces).`);
  const changelog = git.r(["show", `${head}:${FICHERO_CHANGELOG}`]);
  if (changelog.status !== 0 || !seccionChangelog(changelog.stdout, version)) errores.push(`${FICHERO_CHANGELOG} no tiene la entrada [${version}].`);
  if (git.r(["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/v${version}`]).status === 0 || resolver(git, `refs/tags/v${version}`)) errores.push(`La etiqueta v${version} ya existe: esta versión ya se publicó.`);
  const commits = lineas(git(["rev-list", "--no-merges", "--reverse", `${base}..${head}`])).map((s) => infoCommit(git, s));
  const directos = commits.filter((c) => !RE_COMMIT_RELEASE.test(c.asunto) && !TIENE_TRAILER.test(c.cuerpo));
  for (const c of directos) avisos.push(`${corto(c.sha)} «${c.asunto}» se hizo directamente en la release (no viene de staging); sale en el informe como tal.`);
  if (!commits.some((c) => RE_COMMIT_RELEASE.test(c.asunto))) errores.push(`Falta el commit «release: v${version}» con la versión y el CHANGELOG.`);
  return { errores, avisos, version };
}

// ─────────────────────────────── informe ───────────────────────────────

/** Cambios que hay de verdad en base..head, con su origen (PR o commit de staging). */
export function cambiosDeLaRelease(git, { base, head }) {
  const res = [];
  for (const sha of lineas(git(["rev-list", "--no-merges", "--reverse", `${base}..${head}`]))) {
    const c = infoCommit(git, sha);
    if (RE_COMMIT_RELEASE.test(c.asunto)) continue;
    const origen = [...c.cuerpo.matchAll(RE_TRAILER)].map((m) => m[1]).at(-1) ?? null;
    let pr = RE_SQUASH.exec(c.asunto)?.[1] ?? null;
    let tipo = origen ? "commit" : "directo";
    let cuerpoOriginal = null;
    if (origen && resolver(git, origen)) {
      const o = infoCommit(git, origen);
      if (o.padres.length > 1) {
        tipo = RE_PR_MERGE.test(o.asunto) ? "pr" : "rama";
        pr = (RE_PR_MERGE.exec(o.asunto)?.[1] ?? RE_MERGE_RAMA.exec(o.asunto)?.[3]) || pr;
        // Para el resumen: los mensajes de los commits del PR (el primero con «Antes/Ahora» manda).
        const cuerpos = lineas(git(["rev-list", "--no-merges", "--reverse", `${o.padres[0]}..${o.padres[1]}`])).map((x) => infoCommit(git, x).cuerpo);
        cuerpoOriginal = cuerpos.find((b) => /^antes:/im.test(b)) ?? cuerpos[0] ?? null;
      } else if (!pr) pr = RE_SQUASH.exec(o.asunto)?.[1] ?? null;
    }
    const cuerpoSinLista = cuerpoOriginal ?? c.cuerpo.replace(RE_TRAILER, "").split("\n").filter((l) => !/^- [0-9a-f]{7} /.test(l)).join("\n");
    const asuntos = tipo === "pr" || tipo === "rama" ? c.cuerpo.split("\n").filter((l) => /^- [0-9a-f]{7} /.test(l)).map((l) => l.slice(10)) : [c.asunto];
    const stats = lineas(git(["show", "--numstat", "--format=", "-M", sha])).map((l) => l.split("\t"));
    res.push({
      sha: origen ?? sha,
      nuevo: sha,
      tipo,
      pr: pr ? Number(pr) : null,
      titulo: c.asunto.replace(RE_SQUASH, "").trim(),
      cuerpo: cuerpoSinLista,
      asuntos,
      autor: c.autor,
      ficheros: stats.map((s) => s[2]),
      mas: stats.reduce((t, s) => t + (Number(s[0]) || 0), 0),
      menos: stats.reduce((t, s) => t + (Number(s[1]) || 0), 0),
    });
  }
  return res;
}

const RE_VISUAL = /^(src\/.*\.(tsx|css)|tailwind\.config\.[jt]s|index\.html|public\/.*\.(png|jpe?g|webp|avif|svg|woff2?))$/;
const esTest = (f) => /(__tests__|\.test\.|\.spec\.|^e2e\/|^tests\/)/.test(f);

function impactoOperativo(git, { base, head, numstat }) {
  const items = [];
  const nombres = numstat.map((s) => s.fichero);
  const nuevas = lineas(git(["diff", "--name-only", "--diff-filter=A", `${base}...${head}`, "--", "supabase/migrations"]));
  if (nuevas.length) items.push(`**Migraciones de Supabase** (aplicar en producción después de aceptar, primero comprobadas en la demo): ${nuevas.map((f) => `\`${path.basename(f)}\``).join(", ")}.`);
  const funciones = new Set();
  let compartido = false;
  for (const f of nombres) {
    const m = /^supabase\/functions\/([^/]+)\//.exec(f);
    if (!m || esTest(f)) continue;
    if (m[1] === "_shared") compartido = true; else funciones.add(m[1]);
  }
  if (funciones.size || compartido) {
    const lista = [...funciones].map((f) => `\`${f}\``).join(", ");
    items.push(`**Funciones de Supabase** (Vercel no las despliega; desplegar en producción después de aceptar): ${lista || "ninguna directamente"}${compartido ? `${lista ? "; además" : ""} cambia \`_shared/\`: redesplegar las funciones que lo usan` : ""}.`);
  }
  if (nombres.includes("vercel.json")) items.push("**Vercel**: cambia `vercel.json` (cabeceras, rutas o despliegues).");
  if (nombres.includes("package.json")) {
    const leer = (ref) => { try { return JSON.parse(git(["show", `${ref}:package.json`])); } catch { return {}; } };
    const [a, b] = [leer(base), leer(head)];
    const deps = (p) => ({ ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) });
    const [da, db] = [deps(a), deps(b)];
    const cambios = [
      ...Object.keys(db).filter((k) => !(k in da)).map((k) => `añade ${k}`),
      ...Object.keys(da).filter((k) => !(k in db)).map((k) => `quita ${k}`),
      ...Object.keys(db).filter((k) => k in da && da[k] !== db[k]).map((k) => `${k} ${da[k]} → ${db[k]}`),
    ];
    if (cambios.length) items.push(`**Dependencias**: ${cambios.join(", ")}.`);
  }
  // Solo el código que corre en la app o en el servidor: los scripts y workflows tienen sus propias variables.
  const diff = git(["diff", "-U0", "--no-color", `${base}...${head}`, "--", ".", ":(exclude)**/__tests__/**", ":(exclude)**/*.test.*", ":(exclude)e2e/**", ":(exclude)tests/**", ":(exclude)scripts/**", ":(exclude).github/**", ":(exclude)docs/**"]);
  const vars = new Set();
  for (const l of diff.split("\n")) {
    if (!l.startsWith("+") || l.startsWith("+++")) continue;
    for (const m of l.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]+)|Deno\.env\.get\(\s*["'`]([A-Z][A-Z0-9_]+)["'`]|process\.env\.([A-Z][A-Z0-9_]+)/g)) vars.add(m[1] ?? m[2] ?? m[3]);
  }
  const ignorar = new Set(["VERCEL", "VERCEL_ENV", "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_COMMIT_REF", "VERCEL_GIT_COMMIT_MESSAGE", "CI", "NODE_ENV", "DEV", "PROD", "MODE", "BASE_URL", "SSR", "GITHUB_REPOSITORY", "GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY"]);
  const nuevasVars = [...vars].filter((v) => !ignorar.has(v) && git.r(["grep", "-q", "-w", v, base, "--", "."]).status !== 0);
  if (nuevasVars.length) items.push(`**Variables nuevas** (crearlas en Vercel o en los secretos de Supabase de producción antes de aceptar): ${nuevasVars.map((v) => `\`${v}\``).join(", ")}.`);
  return items;
}

function resumenPorZonas(numstat) {
  const zonas = new Map();
  for (const s of numstat) {
    const partes = s.fichero.split("/");
    const zona = partes.length > 2 ? partes.slice(0, partes[0] === "src" || partes[0] === "supabase" ? 3 : 2).join("/").replace(/\/[^/]*\.[^/]*$/, "") : partes.length === 2 ? partes[0] : "(raíz)";
    const z = zonas.get(zona) ?? { ficheros: 0, mas: 0, menos: 0 };
    z.ficheros++; z.mas += s.mas; z.menos += s.menos;
    zonas.set(zona, z);
  }
  return [...zonas].sort((a, b) => b[1].mas + b[1].menos - (a[1].mas + a[1].menos));
}

/** URL estable que Vercel da a la última versión de una rama (`<proyecto>-git-<rama>-<equipo>`). */
export function urlRamaVercel(proyecto, rama) {
  const slug = rama.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `https://${proyecto}-git-${slug}-${EQUIPO_VERCEL}.vercel.app`;
}

const MARCA_INICIO = "<!-- informe-release:inicio (lo regenera scripts/release.mjs; lo que escribas fuera de estas marcas se conserva) -->";
const MARCA_FIN = "<!-- informe-release:fin -->";

/** Sustituye el informe dentro de un cuerpo de PR existente, conservando lo escrito fuera. */
export function sustituirInforme(cuerpoActual, informe) {
  const a = (cuerpoActual ?? "").indexOf("<!-- informe-release:inicio");
  const b = (cuerpoActual ?? "").indexOf(MARCA_FIN);
  if (a === -1 || b === -1) return informe;
  return `${cuerpoActual.slice(0, a)}${informe}${cuerpoActual.slice(b + MARCA_FIN.length)}`;
}

/**
 * Descripción del PR de la release, a partir de la diferencia REAL `base...head` (no de lo que
 * se pidió): cambios, pendientes de staging, impacto, capturas y reversión.
 * `resultados` (opcional) son los de las comprobaciones de la candidata (workflow).
 */
export function generarInforme(git, opciones = {}) {
  const { base = "origin/main", head = "HEAD", desde = "origin/staging", resultados = null, validacionLocal = null } = opciones;
  const repo = opciones.repo ?? slugRepo(git);
  const proyecto = repo.split("/")[1];
  const rama = opciones.rama ?? (git.r(["rev-parse", "--abbrev-ref", head]).stdout.trim().replace(/^origin\//, "") || head);
  const headSha = resolver(git, head);
  const baseSha = resolver(git, base);
  const version = versionEn(git, head).version;
  const anterior = versionEn(git, base).version;
  const changelog = git.r(["show", `${head}:${FICHERO_CHANGELOG}`]).stdout;
  const seccion = (version && seccionChangelog(changelog, version)) || "";
  const objetivo = /^Objetivo:\s*(.+)$/m.exec(seccion)?.[1]?.trim() ?? null;
  const cambios = cambiosDeLaRelease(git, { base, head });
  const numstat = lineas(git(["diff", "--numstat", "-M", `${base}...${head}`]))
    .map((l) => l.split("\t"))
    .map(([mas, menos, fichero]) => ({ fichero: fichero.includes("=>") ? fichero.replace(/\{([^}]*) => ([^}]*)\}/, "$2").replace(/^.* => /, "") : fichero, mas: Number(mas) || 0, menos: Number(menos) || 0 }));
  const deCodigo = numstat.filter((s) => !FICHEROS_DE_RELEASE.has(s.fichero));
  const explicados = new Set([...FICHEROS_DE_RELEASE, ...cambios.flatMap((c) => c.ficheros)]);
  const sinExplicar = deCodigo.filter((s) => !explicados.has(s.fichero)).map((s) => s.fichero);
  const releaseTocaOtros = lineas(git(["log", "--format=", "--name-only", "--grep=^release: v", `${base}..${head}`])).filter((f) => !FICHEROS_DE_RELEASE.has(f));

  const enlace = (c) => (c.pr ? `[#${c.pr}](https://github.com/${repo}/pull/${c.pr})` : `[${corto(c.sha)}](https://github.com/${repo}/commit/${c.sha})`);
  const clase = (c) => claseDeUnidad(c);
  const lineaCambio = (c) => {
    const r = resumenDeMensaje(c.cuerpo);
    if (r.antes && r.ahora) return `- **${tituloLegible(c.titulo)}** (${enlace(c)}): antes ${r.antes.replace(/\.$/, "")} → ahora ${r.ahora}`;
    return `- **${tituloLegible(c.titulo)}** (${enlace(c)})${r.texto ? `: ${r.texto}` : ""}`;
  };

  const s = [];
  s.push(MARCA_INICIO);
  s.push(`## v${version ?? "?"} · ${proyecto}`, "");
  s.push(`**Producción ahora:** v${anterior ?? "?"} (\`${corto(baseSha)}\`) · **al aprobar:** v${version ?? "?"} (\`${corto(headSha)}\`) · rama \`${rama}\``, "");
  s.push(`**Objetivo:** ${objetivo ?? cambios.map((c) => tituloLegible(c.titulo)).join("; ") ?? "—"}`, "");

  const cambia = cambios.filter((c) => clase(c) === "cambio");
  const anade = cambios.filter((c) => clase(c) === "feat");
  const otros = cambios.filter((c) => clase(c) === "otro");
  s.push("### Qué cambia", ...(cambia.length ? cambia.map(lineaCambio) : ["Ningún comportamiento existente cambia."]), "");
  s.push("### Qué se añade", ...(anade.length ? anade.map(lineaCambio) : ["Nada nuevo para el usuario."]), "");
  if (otros.length) s.push("**Sin efecto para el usuario:** " + otros.map((c) => `${tituloLegible(c.titulo)} (${enlace(c)})`).join(" · "), "");

  s.push("### Cambios incluidos", "", "| Cambio | Tipo | Ficheros | Líneas |", "| --- | --- | --- | --- |");
  for (const c of cambios) {
    const tipo = c.tipo === "pr" ? `PR${c.asuntos.length > 1 ? `, ${c.asuntos.length} commits` : ""}` : c.tipo === "directo" ? "**hecho en la release**" : c.tipo === "rama" ? "rama" : "commit";
    s.push(`| ${enlace(c)} ${tituloLegible(c.titulo).replace(/\|/g, "/")} | ${tipo} | ${c.ficheros.length} | +${c.mas} −${c.menos} |`);
  }
  const tot = deCodigo.reduce((t, x) => ({ mas: t.mas + x.mas, menos: t.menos + x.menos }), { mas: 0, menos: 0 });
  s.push("", `Diferencia real con \`main\`: ${deCodigo.length} ficheros, +${tot.mas} −${tot.menos} (sin contar ${FICHERO_VERSION} y ${FICHERO_CHANGELOG}).`);
  const zonas = resumenPorZonas(deCodigo).slice(0, 6);
  if (zonas.length) s.push(`Zonas: ${zonas.map(([z, d]) => `\`${z}\` (${d.ficheros})`).join(", ")}${resumenPorZonas(deCodigo).length > 6 ? "…" : "."}`);
  if (sinExplicar.length || releaseTocaOtros.length) s.push("", `> ⚠️ Hay cambios en la diferencia que no corresponden a ningún cambio de la lista: ${[...new Set([...sinExplicar, ...releaseTocaOtros])].map((f) => `\`${f}\``).join(", ")}. Revísalos antes de aprobar.`);
  else s.push("", "La diferencia coincide con la lista: no hay cambios fuera de ella.");
  s.push("");

  s.push("### Qué queda pendiente");
  let quedan = [];
  if (resolver(git, desde)) quedan = pendientes(git, { base: head, desde }).pendientes;
  if (!quedan.length) s.push(`Nada: \`${desde.replace(/^origin\//, "")}\` no tiene más cambios sin publicar.`);
  else {
    s.push(`Siguen en \`${desde.replace(/^origin\//, "")}\` (la demo) y **no** se publican con esta versión:`);
    for (const p of quedan.slice(0, 12)) s.push(`- ${tituloLegible(p.titulo)} (${enlace(p)})`);
    if (quedan.length > 12) s.push(`- y ${quedan.length - 12} más (\`node scripts/release.mjs pendientes\`).`);
  }
  s.push("");

  s.push("### Validación");
  const res = resultados ?? {};
  const marca = (r) => (r == null ? "⏳ pendiente" : r.ok ? "✅" : "❌");
  s.push(`- Tests, build y e2e de esta combinación exacta: checks **CI** al pie del PR.`);
  s.push(`- Reglas de la release (versión, CHANGELOG, parte del último main): check **Validar release a producción**.`);
  const urlCand = res.preview?.url ?? urlRamaVercel(proyecto, rama);
  s.push(`- Candidata desplegada en preview: ${marca(res.preview)} ${urlCand}${res.preview?.detalle ? ` · ${res.preview.detalle}` : res.preview ? "" : " (URL prevista de la rama; la comprueba el workflow «Release · candidata»)"}`);
  if (res.humo) s.push(`- Prueba rápida contra la candidata: ${marca(res.humo)} ${res.humo.detalle ?? ""}`.trimEnd());
  if (validacionLocal) for (const l of lineas(validacionLocal)) s.push(`- ${l.replace(/^[-*]\s*/, "")}`);
  s.push("");

  const impacto = impactoOperativo(git, { base, head, numstat: deCodigo });
  if (impacto.length) s.push("### Impacto operativo", ...impacto.map((i) => `- ${i}`), "");

  const visuales = deCodigo.map((x) => x.fichero).filter((f) => RE_VISUAL.test(f) && !esTest(f));
  if (visuales.length) {
    s.push("### Capturas");
    const cap = res.capturas;
    if (cap?.items?.length) {
      s.push(`Antes (\`main\`, v${anterior}) y después (candidata v${version}), con datos de prueba:`, "", "| Pantalla | Antes | Después |", "| --- | --- | --- |");
      for (const it of cap.items) s.push(`| ${it.nombre} | ![antes](${it.antes}) | ![después](${it.despues}) |`);
      if (cap.enlace) s.push("", `Todas las capturas: ${cap.enlace}`);
    } else if (cap && !cap.ok) s.push(`No se han podido generar: ${cap.motivo ?? "error en el workflow"}. Revisa la candidata en ${urlCand}.`);
    else s.push(`Hay cambios visuales (${visuales.length} ${visuales.length === 1 ? "fichero" : "ficheros"} de interfaz). Las capturas antes/después las añade el workflow «Release · candidata»; si no aparecen, compáralas en ${urlCand} frente a producción.`);
    s.push("");
  }

  s.push("### Reversión");
  s.push(`- Inmediata: Vercel → proyecto ${proyecto} → Deployments → despliegue de producción de v${anterior ?? "anterior"} (commit \`${corto(baseSha)}\`) → **Instant Rollback**.`);
  const rollbacks = lineas(git(["diff", "--name-only", "--diff-filter=A", `${base}...${head}`, "--", "supabase/rollbacks", "supabase/migrations/*ROLLBACK*"]));
  if (rollbacks.length) s.push(`- Base de datos: vuelta atrás preparada en ${rollbacks.map((f) => `\`${f}\``).join(", ")} (aplicarla a mano, primero en la demo).`);
  s.push(`- Limitaciones: Vercel no deshace ${impacto.some((i) => i.includes("Migraciones")) ? "**las migraciones de Supabase**, " : ""}${impacto.some((i) => i.includes("Funciones")) ? "**las funciones de Supabase desplegadas**, " : ""}los datos guardados ni las variables; y \`main\` sigue en v${version} hasta que una release nueva (p. ej. v${version ? siguienteVersion(version, { tipo: "patch" }) : "?"} con \`git revert\`) lo corrija.`);
  s.push("");
  s.push(`<sub>Generado por \`scripts/release.mjs informe\` de la diferencia real \`${base.replace(/^origin\//, "")}...${rama}\` (\`${corto(headSha)}\`).</sub>`);
  s.push(MARCA_FIN);
  return { texto: s.join("\n"), version, anterior, cambios, quedan, sinExplicar, impacto, visuales, rama };
}

// ─────────────────────────────── CLI ───────────────────────────────

function argumentos(argv) {
  const opciones = {};
  const sueltos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      const clave = k.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      if (v !== undefined) opciones[clave] = v;
      else if (["simular", "json"].includes(clave)) opciones[clave] = true;
      else opciones[clave] = argv[++i];
    } else sueltos.push(a);
  }
  return { opciones, sueltos };
}

function salidaGitHub(clave, valor) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${clave}=${valor}\n`);
}

function mostrarPreparacion(r) {
  const out = [];
  out.push(`Base: ${r.base} (${corto(r.baseSha)}) · cambios desde: ${r.desde}`);
  if (r.unidades.length) {
    out.push("", "Selección:");
    for (const u of r.unidades) out.push(`  ${u.id.padEnd(8)} ${u.titulo}${u.mainline ? `  [${u.tipo === "pr" ? "PR" : "rama"}, ${u.commits.length} commits]` : ""}`);
  }
  for (const a of r.avisos) out.push(`AVISO: ${a}`);
  if (r.dependencias.length) {
    out.push("", "DEPENDENCIAS QUE FALTAN (no se añaden solas):");
    for (const d of r.dependencias) {
      out.push(`  ${d.unidad.id} «${d.unidad.titulo}» necesita:`);
      for (const n of d.necesita) {
        const porque = n.motivo === "usa" ? `usa ${n.nombres.map((x) => `«${x}»`).join(", ")}, que crea ese cambio` : n.motivo === "lineas+usa" ? `modifica sus líneas y usa ${n.nombres.map((x) => `«${x}»`).join(", ")}` : "modifica líneas que escribió ese cambio";
        out.push(`    - ${n.cambio}${n.cambio !== corto(n.sha) ? ` (${corto(n.sha)})` : ""} «${n.asunto}»${n.esMerge ? " [merge de integración]" : ""}: ${porque} (${n.ficheros.slice(0, 4).join(", ")}${n.ficheros.length > 4 ? "…" : ""})`);
      }
    }
    out.push("  Qué hacer: añade esos cambios a la selección, deja fuera el que los necesita o rehazlo sobre main.");
    out.push("  Si estás seguro de que no hace falta (p. ej. solo comparte un nombre), repite con --no-depende <sha>: queda anotado en la release.");
  }
  if (r.conflicto) {
    out.push("", `CONFLICTO al aplicar ${r.conflicto.unidad.id} «${r.conflicto.unidad.titulo}» en: ${r.conflicto.ficheros.join(", ") || "(sin detalle)"}`);
    for (const c of r.conflicto.causantes) out.push(`  probable dependencia: ${corto(c.sha)} «${c.asunto}»${c.cambio !== corto(c.sha) ? ` (parte de ${c.cambio})` : ""} en ${c.ficheros.join(", ")}`);
  }
  for (const v of r.vacias) out.push(`AVISO: ${v.id} no aporta nada al aplicarlo (ya estaba en producción): se omite.`);
  if (r.bloqueada) {
    out.push("", "BLOQUEADA: no se ha creado ninguna rama.");
    for (const e of r.errores) out.push(`  - ${e}`);
  } else {
    out.push("", `Versión: v${r.anterior ?? "?"} → v${r.version}`, `${r.simular ? "Simulación correcta (no se ha creado la rama)" : `Creada la rama ${r.rama}`} (${corto(r.sha)}) con ${r.aplicadas.length} cambio(s).`);
    if (!r.simular) {
      out.push("", "Siguiente paso:", `  git push -u origin ${r.rama}`, `  node scripts/release.mjs informe --head ${r.rama} > informe.md   (descripción del PR)`, `  abrir el PR ${r.rama} → main con esa descripción`);
    }
  }
  return out.join("\n");
}

async function main() {
  const [orden, ...resto] = process.argv.slice(2);
  const { opciones: o, sueltos } = argumentos(resto);
  const git = crearGit(process.cwd());
  const base = o.base ?? "origin/main";
  const desde = o.desde ?? "origin/staging";
  if (orden === "pendientes") {
    const r = pendientes(git, { base, desde });
    if (o.json) { console.log(JSON.stringify(r.pendientes.map(({ id, tipo, pr, sha, titulo, commits }) => ({ id, tipo, pr, sha, titulo, commits })), null, 2)); return; }
    console.log(`En ${desde} y no en ${base}: ${r.pendientes.length} cambio(s) sin publicar.`);
    for (const u of r.pendientes) console.log(`  ${u.id.padEnd(8)} ${u.titulo}${u.mainline ? `  [${u.tipo === "pr" ? "PR" : "rama"}, ${u.commits.length} commits]` : ""}`);
    if (r.publicados.length) console.log(`Ya publicados como copia en ${base} (no se listan): ${r.publicados.map((u) => u.id).join(", ")}`);
    console.log(`\nPara publicar solo algunos: node scripts/release.mjs preparar <#PR|sha> … --objetivo "para qué"`);
    return;
  }
  if (orden === "preparar") {
    const r = prepararRelease(git, sueltos, {
      base, desde, objetivo: o.objetivo, tipo: o.tipo === "auto" ? undefined : o.tipo, version: o.version || undefined, simular: !!o.simular,
      noDepende: String(o.noDepende ?? "").split(/[\s,]+/).filter(Boolean),
      identidad: { nombre: process.env.RELEASE_GIT_NAME, email: process.env.RELEASE_GIT_EMAIL },
    });
    r.simular = !!o.simular;
    if (o.json) console.log(JSON.stringify({ bloqueada: r.bloqueada, version: r.version, rama: r.rama, sha: r.sha, errores: r.errores, avisos: r.avisos }, null, 2));
    else console.log(mostrarPreparacion(r));
    if (!r.bloqueada) { salidaGitHub("rama", r.rama); salidaGitHub("version", r.version); }
    process.exitCode = r.bloqueada ? 1 : 0;
    return;
  }
  if (orden === "comprobar") {
    const rama = o.rama ?? process.env.GITHUB_HEAD_REF ?? git.r(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
    const r = comprobarRelease(git, { base, head: o.head ?? "HEAD", rama });
    for (const a of r.avisos) console.log(`AVISO: ${a}`);
    for (const e of r.errores) console.log(`ERROR: ${e}`);
    if (!r.errores.length) console.log(`Release v${r.version} correcta.`);
    process.exitCode = r.errores.length ? 1 : 0;
    return;
  }
  if (orden === "informe") {
    const resultados = o.resultados ? JSON.parse(readFileSync(o.resultados, "utf8")) : null;
    const validacionLocal = o.validacion ? readFileSync(o.validacion, "utf8") : null;
    const r = generarInforme(git, { base, desde, head: o.head ?? "HEAD", rama: o.rama, resultados, validacionLocal });
    const texto = o.cuerpoActual ? sustituirInforme(readFileSync(o.cuerpoActual, "utf8"), r.texto) : r.texto;
    if (o.salida) writeFileSync(o.salida, `${texto}\n`); else console.log(texto);
    salidaGitHub("version", r.version ?? "");
    salidaGitHub("visual", r.visuales.length ? "si" : "no");
    return;
  }
  if (orden === "notas") {
    const version = sueltos[0] ?? versionEn(git, o.head ?? "HEAD").version;
    const texto = git.r(["show", `${o.head ?? "HEAD"}:${FICHERO_CHANGELOG}`]).stdout;
    const seccion = seccionChangelog(texto, version);
    if (!seccion) throw new ErrorRelease(`${FICHERO_CHANGELOG} no tiene la entrada [${version}].`);
    console.log(seccion.replace(/^## .*\n+/, ""));
    return;
  }
  console.log("Uso: node scripts/release.mjs <pendientes|preparar|comprobar|informe|notas> … (ver la cabecera del script y docs/PROCESO-DE-CAMBIOS.md)");
  process.exitCode = orden ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof ErrorRelease ? `ERROR: ${e.message}` : e);
    process.exitCode = 1;
  });
}
