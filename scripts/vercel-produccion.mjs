// Ignored Build Step de Vercel (vercel.json → "ignoreCommand"). Vercel interpreta la salida así:
//   0 → NO construir (cancela el despliegue)      1 → construir
//
// Producción solo se publica cuando el último commit de main es la ACEPTACIÓN de un PR desde
// una rama release/X.Y.Z (el merge commit que crea GitHub al pulsar «Merge pull request»:
// "Merge pull request #N from <org>/release/X.Y.Z") y versionado.json dice esa misma versión.
// Un push directo a main, un squash, un rebase o un PR desde staging no llegan a producción.
// Las previews (release/*) se construyen siempre. La demo (staging) también, SALVO si todo lo que
// cambia desde el último despliegue de staging (VERCEL_GIT_PREVIOUS_SHA) son docs, Markdown, tests o
// cosas de Supabase que el panel no lleva dentro (migraciones, rollbacks, Edge Functions que la app
// no importa): así no gastamos compilaciones de Vercel en commits que no cambian el panel. Ante cualquier duda
// (sin SHA anterior, git sin historia suficiente, lista vacía) se construye.
// Ver docs/PROCESO-DE-CAMBIOS.md.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PR_DESDE_RELEASE = /^Merge pull request #\d+ from \S+\/release\/(\d+\.\d+\.\d+)(\s|$)/;

/** Versión de la release que se acepta en este commit, o null si no es la aceptación de una. */
export function versionAceptada(mensaje) {
  return PR_DESDE_RELEASE.exec((mensaje ?? "").trim())?.[1] ?? null;
}

/** true si este despliegue debe construirse. `versionFichero`: la de versionado.json. */
export function debeConstruir(env, mensaje, versionFichero) {
  if (env.VERCEL_ENV !== "production") return true;
  const version = versionAceptada(mensaje);
  return version !== null && version === versionFichero;
}

// Rutas que no cambian lo que se despliega. Ojo: nada de vercel.json, public/, api/ ni scripts/
// (salvo las pruebas PGlite, scripts/test-*.mjs, que no entran en el build). Lo de Supabase lo
// despliega Supabase, no Vercel: migraciones, rollbacks, pruebas SQL y config.toml nunca cambian
// el panel (17/11/2026: cada compilación del panel cuesta ~5 céntimos de dólar en el plan Pro).
const SIN_DESPLIEGUE = [
  /^docs\//,
  /\.md$/i,
  /(^|\/)__tests__\//,
  /\.(test|spec)\.[mc]?[jt]sx?$/,
  /^e2e\//,
  /^\.github\//,
  /^supabase\/(migrations|rollbacks|tests)\//,
  /^supabase\/config\.toml$/,
  /^scripts\/test-[^/]+\.mjs$/,
];

const FUNCION = /^supabase\/functions\/([^/]+)\//;

/**
 * true si TODOS los ficheros son docs/Markdown/tests o cosas de Supabase que el panel no lleva
 * dentro (y hay al menos uno). `carpetasApp`: carpetas de supabase/functions que la app importa
 * (ver carpetasFuncionesDeLaApp); un cambio en una Edge Function que la app NO importa tampoco
 * cambia el panel. Sin esa lista (null), cualquier cambio en supabase/functions construye.
 */
export function soloDocsOTests(ficheros, carpetasApp = null) {
  const lista = (ficheros ?? []).map((f) => f.trim()).filter(Boolean);
  return lista.length > 0 && lista.every((f) => {
    if (SIN_DESPLIEGUE.some((re) => re.test(f))) return true;
    const carpeta = FUNCION.exec(f)?.[1];
    return !!carpeta && carpetasApp instanceof Set && !carpetasApp.has(carpeta);
  });
}

/** true si es la demo (staging) y lo cambiado desde su último despliegue no afecta a la web. */
export function saltarDemo(env, ficheros, carpetasApp = null) {
  return env.VERCEL_ENV !== "production" && env.VERCEL_GIT_COMMIT_REF === "staging" && soloDocsOTests(ficheros, carpetasApp);
}

const CODIGO = /\.(m|c)?[jt]sx?$/;

/** Ficheros de código bajo `dir` (recursivo, sin node_modules). */
function codigoDe(dir) {
  const salida = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) salida.push(...codigoDe(ruta));
    else if (CODIGO.test(e.name)) salida.push(ruta);
  }
  return salida;
}

/**
 * Carpetas de supabase/functions que acaban dentro del panel: las que importa src/ o api/
 * (p. ej. `_shared`, `emails-reserva`) y las que importan esas a su vez. Se calcula leyendo
 * el código, sin lista a mano. null si no se puede leer algo: entonces se construye siempre.
 */
export function carpetasFuncionesDeLaApp(raiz = process.cwd()) {
  try {
    const funciones = path.join(raiz, "supabase", "functions");
    const existentes = new Set(readdirSync(funciones, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
    const usadas = new Set();
    for (const dir of ["src", "api"]) {
      for (const f of codigoDe(path.join(raiz, dir))) {
        for (const m of readFileSync(f, "utf8").matchAll(/supabase\/functions\/([A-Za-z0-9_.-]+)\//g)) usadas.add(m[1]);
      }
    }
    const pendientes = [...usadas];
    while (pendientes.length) {
      const carpeta = pendientes.pop();
      if (!existentes.has(carpeta)) continue;
      for (const f of codigoDe(path.join(funciones, carpeta))) {
        for (const m of readFileSync(f, "utf8").matchAll(/["'`](?:\.\.\/)+([A-Za-z0-9_.-]+)\//g)) {
          if (existentes.has(m[1]) && !usadas.has(m[1])) {
            usadas.add(m[1]);
            pendientes.push(m[1]);
          }
        }
      }
    }
    return usadas;
  } catch {
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let mensaje = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "";
  if (!mensaje) {
    try { mensaje = execFileSync("git", ["log", "-1", "--format=%B"], { encoding: "utf8" }); } catch { /* sin git: decide el mensaje vacío */ }
  }
  let versionFichero = null;
  try { versionFichero = JSON.parse(readFileSync("versionado.json", "utf8")).version ?? null; } catch { /* sin fichero: no se publica */ }
  const anterior = process.env.VERCEL_GIT_PREVIOUS_SHA;
  if (process.env.VERCEL_ENV !== "production" && process.env.VERCEL_GIT_COMMIT_REF === "staging" && anterior) {
    let ficheros = null;
    try { ficheros = execFileSync("git", ["diff", "--name-only", anterior, "HEAD"], { encoding: "utf8" }).split(/\r?\n/); } catch { /* sin historia: se construye */ }
    if (ficheros && saltarDemo(process.env, ficheros, carpetasFuncionesDeLaApp())) {
      console.log("Demo NO se construye: desde el último despliegue de staging solo cambian docs, tests o cosas de Supabase que el panel no lleva dentro.");
      process.exit(0);
    }
  }
  if (debeConstruir(process.env, mensaje, versionFichero)) {
    if (process.env.VERCEL_ENV === "production") console.log(`Producción: release v${versionFichero} aceptada, se publica.`);
    process.exit(1);
  }
  const version = versionAceptada(mensaje);
  console.log(
    version
      ? `Producción NO se publica: el PR acepta release/${version} pero versionado.json dice ${versionFichero ?? "nada"}. Ver docs/PROCESO-DE-CAMBIOS.md.`
      : "Producción NO se publica: el último commit de main no es la aceptación de un PR desde release/X.Y.Z. Ver docs/PROCESO-DE-CAMBIOS.md.",
  );
  process.exit(0);
}
