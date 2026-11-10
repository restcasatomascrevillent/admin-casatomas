// Ejecuta SOLO los tests afectados por lo cambiado respecto a una base (por defecto
// origin/staging), para no pasar la suite completa en cada subida a staging.
//
//   npm run test:cambios                 # base origin/staging (+ lo no commiteado)
//   npm run test:cambios -- origin/main  # otra base (rama, tag o SHA)
//   npm run test:cambios -- --listar     # solo dice qué ejecutaría
//
// También vale la variable BASE (la usa CI). Reglas:
//   - Ficheros de código cambiados → `vitest related --run` (tests que los importan, directa o
//     indirectamente, y los propios tests cambiados).
//   - Cambia algo global (package.json, lockfile, config de vite/vitest/tsconfig, setup de tests,
//     tipos de Supabase, mocks), se borra o renombra código, o no hay base → suite completa.
//   - Panel: cambia supabase/migrations → todas las pruebas PGlite (`test:*:db`, versiones de
//     migración y scripts/verificar-*.mjs); cambia un scripts/test-*.mjs o verificar-*.mjs → ese.
//     Cambia supabase/functions → las pruebas PGlite que leen supabase/functions (si hay).
// La suite completa (`npm test`, todas las PGlite, build) se pasa al preparar una release
// (docs/PROCESO-DE-CAMBIOS.md).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const listar = args.includes("--listar");
const SIN_BASE = /^0+$/;
let base = args.find((a) => !a.startsWith("--")) || process.env.BASE || "origin/staging";
if (SIN_BASE.test(base)) base = "origin/staging"; // push de rama nueva: no hay «antes»

const CODIGO = /\.(m|c)?[jt]sx?$/;
const GLOBALES = [
  /^package(-lock)?\.json$/,
  /^(vite|vitest)\.config\.[mc]?[jt]s$/,
  /^tsconfig[^/]*\.json$/,
  /^src\/test\/setup\.[jt]sx?$/,
  /^src\/__tests__\/setup\.[jt]sx?$/,
  /^src\/__mocks__\//,
  /^src\/integrations\/supabase\/types\.ts$/,
  /^scripts\/(carta|novedades)-ssg\.mjs$/, // los importa vitest.config.ts de la web
  /^scripts\/tests-cambios\.mjs$/,
];

function git(...a) {
  return execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function lineas(texto) {
  return texto.split("\n").map((l) => l.trim()).filter(Boolean);
}
function ejecutar(cmd, cmdArgs, env = {}) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(" ")}`);
  if (listar) return 0;
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  return r.status ?? 1;
}
function suiteCompleta(motivo) {
  console.log(`Suite completa: ${motivo}`);
  return ejecutar("npx", ["vitest", "run"]);
}

/** [{estado, ruta}] de lo cambiado respecto a la base (commits desde la base + lo no commiteado). */
function cambios() {
  const salida = [];
  for (const l of lineas(git("diff", "--name-status", "-M", `${base}...HEAD`))) salida.push(l);
  for (const l of lineas(git("diff", "--name-status", "-M", "HEAD"))) salida.push(l);
  for (const r of lineas(git("ls-files", "--others", "--exclude-standard"))) salida.push(`A\t${r}`);
  const vistos = new Map();
  for (const l of salida) {
    const [estado, ...rutas] = l.split("\t");
    const e = estado[0];
    if (e === "R") vistos.set(rutas[0], "D"), vistos.set(rutas[1], "A");
    else vistos.set(rutas[0], e === "D" ? "D" : (vistos.get(rutas[0]) ?? e));
  }
  return [...vistos].map(([ruta, estado]) => ({ ruta: ruta.replace(/\\/g, "/"), estado }));
}

/** Pruebas PGlite del panel (scripts `test:*:db` de package.json). */
function pruebasDb() {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  return Object.entries(scripts)
    .filter(([nombre]) => /^test:.+:db$/.test(nombre))
    .map(([nombre, cmd]) => ({ nombre, fichero: /node (scripts\/\S+\.mjs)/.exec(cmd)?.[1] }));
}
function verificadores() {
  if (!existsSync("scripts")) return [];
  return readdirSync("scripts").filter((f) => /^verificar-.+\.mjs$/.test(f)).map((f) => `scripts/${f}`);
}

// Si la base no existe (p. ej. el «antes» de un push forzado), se mira contra origin/staging.
try {
  execFileSync("git", ["rev-parse", "--verify", `${base}^{commit}`], { stdio: "ignore" });
} catch {
  if (base !== "origin/staging") {
    console.log(`No encuentro la base «${base}»; uso origin/staging.`);
    base = "origin/staging";
  }
}
let fallos = 0;
let lista;
try {
  git("rev-parse", "--verify", `${base}^{commit}`);
  lista = cambios();
} catch {
  process.exit(suiteCompleta(`no encuentro la base «${base}» (¿falta git fetch?)`) ? 1 : 0);
}

console.log(`Base: ${base} · ${lista.length} fichero(s) cambiado(s)`);
const globales = lista.filter((c) => GLOBALES.some((re) => re.test(c.ruta)));
const codigoBorrado = lista.filter((c) => c.estado === "D" && CODIGO.test(c.ruta) && !c.ruta.startsWith("supabase/"));
const codigo = lista.filter((c) => c.estado !== "D" && CODIGO.test(c.ruta) && existsSync(c.ruta) && !c.ruta.startsWith("supabase/"));

// ---- Vitest ----
if (globales.length) fallos += suiteCompleta(`cambia ${globales.map((c) => c.ruta).join(", ")}`) ? 1 : 0;
else if (codigoBorrado.length) fallos += suiteCompleta(`se borra o renombra ${codigoBorrado.map((c) => c.ruta).join(", ")}`) ? 1 : 0;
else if (codigo.length > 150) fallos += suiteCompleta(`${codigo.length} ficheros de código cambiados`) ? 1 : 0;
else if (codigo.length) fallos += ejecutar("npx", ["vitest", "related", "--run", "--passWithNoTests", ...codigo.map((c) => c.ruta)]) ? 1 : 0;
else console.log("Vitest: ningún fichero de código cambiado, nada que probar.");

// ---- Pruebas PGlite (solo el panel) ----
const db = pruebasDb();
if (db.length) {
  const migraciones = lista.some((c) => c.ruta.startsWith("supabase/migrations/"));
  const funciones = lista.some((c) => c.ruta.startsWith("supabase/functions/"));
  const tocados = new Set(lista.filter((c) => c.estado !== "D").map((c) => c.ruta));
  const elegidas = [];
  for (const p of db) {
    const leeFunciones = funciones && p.fichero && existsSync(p.fichero) && readFileSync(p.fichero, "utf8").includes("supabase/functions");
    if (migraciones || leeFunciones || tocados.has(p.fichero)) elegidas.push(["npm", ["run", p.nombre]]);
  }
  if (migraciones || tocados.has("scripts/comprobar-versiones-migraciones.mjs")) elegidas.push(["npm", ["run", "test:migraciones"]]);
  for (const v of verificadores()) if (migraciones || tocados.has(v)) elegidas.push(["node", [v]]);
  if (elegidas.length) {
    console.log(`\nPruebas PGlite: ${elegidas.length}${migraciones ? " (cambian migraciones: todas)" : ""}`);
    for (const [cmd, a] of elegidas) fallos += ejecutar(cmd, a) ? 1 : 0;
  } else console.log("Pruebas PGlite: no cambian migraciones ni sus scripts, nada que probar.");
}

if (fallos) console.error(`\n${fallos} ejecución(es) con fallos.`);
process.exit(fallos ? 1 : 0);
