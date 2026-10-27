// Versión automática «M.N» (ver docs/PROCESO-DE-CAMBIOS.md):
//   M = "mayor" de versionado.json (0 hasta la primera salida a producción).
//   N = commits desde el último que cambió versionado.json, SIN contar merges:
//       cada commit suma 1, y aceptar el PR staging → main (un merge) no suma,
//       así producción queda con la misma versión que tenía la demo.
//
// Uso:  node scripts/version.mjs            → JSON con versión, commit, rama y entorno
//       node scripts/version.mjs --ref origin/main --solo-version   → "0.12"
//
// Necesita el historial de git. Si el clon es superficial (Vercel, CI) intenta
// completarlo; si no puede, la versión sale como "M.?" y avisa, en vez de
// inventar un número.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FICHERO = "versionado.json";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}
function intentar(fn) {
  try { return fn(); } catch { return null; }
}

/** "produccion" | "demo" | "preview" | "local", a partir de las variables de Vercel. */
export function detectarEntorno(env = process.env, rama = env.VERCEL_GIT_COMMIT_REF) {
  if (!env.VERCEL) return "local";
  if (env.VERCEL_ENV === "production") return "produccion";
  return rama === "staging" ? "demo" : "preview";
}

/**
 * @param {{ ref?: string, cwd?: string, env?: NodeJS.ProcessEnv, completarHistorial?: boolean }} opciones
 */
export function calcularVersion({ ref = "HEAD", cwd = RAIZ, env = process.env, completarHistorial = true } = {}) {
  let aviso = null;
  const textoConfig = intentar(() => (ref === "HEAD" ? readFileSync(path.join(cwd, FICHERO), "utf8") : git(["show", `${ref}:${FICHERO}`], cwd)));
  const mayor = textoConfig === null ? null : Number(JSON.parse(textoConfig).mayor);
  if (mayor === null || !Number.isInteger(mayor) || mayor < 0) {
    return { version: "sin versionar", mayor: null, numero: null, commit: null, rama: null, entorno: detectarEntorno(env), aviso: `falta ${FICHERO}` };
  }

  const superficial = () => intentar(() => git(["rev-parse", "--is-shallow-repository"], cwd));
  if (superficial() === "true" && completarHistorial) intentar(() => git(["fetch", "--unshallow", "--quiet"], cwd));
  let numero = null;
  const estado = superficial();
  if (estado === "false") {
    const base = intentar(() => git(["log", "-1", "--format=%H", ref, "--", FICHERO], cwd));
    const cuenta = base ? intentar(() => git(["rev-list", "--count", "--no-merges", `${base}..${ref}`], cwd)) : null;
    numero = cuenta === null ? null : Number(cuenta);
    if (!base) aviso = `${FICHERO} todavía no está en ningún commit`;
  } else {
    // Contar en un clon incompleto daría un número falso: mejor "M.?" y el motivo.
    aviso = estado === "true" ? "historial de git incompleto" : "sin historial de git";
  }

  const commit = (ref === "HEAD" && env.VERCEL_GIT_COMMIT_SHA) || intentar(() => git(["rev-parse", ref], cwd));
  const rama = (ref === "HEAD" && env.VERCEL_GIT_COMMIT_REF) || intentar(() => git(["rev-parse", "--abbrev-ref", ref], cwd));
  return {
    version: `${mayor}.${numero ?? "?"}`,
    mayor,
    numero,
    commit: commit ? commit.slice(0, 7) : null,
    rama,
    entorno: detectarEntorno(env, rama ?? undefined),
    aviso,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ref = args.includes("--ref") ? args[args.indexOf("--ref") + 1] : "HEAD";
  const datos = calcularVersion({ ref });
  console.log(args.includes("--solo-version") ? datos.version : JSON.stringify(datos, null, 2));
}
