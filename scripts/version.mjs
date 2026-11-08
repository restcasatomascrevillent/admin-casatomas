// Versión de la app (docs/PROCESO-DE-CAMBIOS.md).
//
//   - La versión publicada vive en versionado.json ("version": "1.2.3"). Solo la cambia
//     scripts/release.mjs al preparar una release; al aceptarla se crea la etiqueta v1.2.3.
//     La versión identifica una PUBLICACIÓN: no sube con cada commit.
//   - main (producción) y release/X.Y.Z (candidata) muestran esa versión tal cual.
//   - El resto (staging = demo, ramas de trabajo) muestra "X.Y.Z+<commit>": lo publicado más
//     cambios todavía sin publicar (el panel enseña «v1.2.3» y lo detalla al pasar el ratón).
//
// Uso:  node scripts/version.mjs                                   → JSON con versión, commit, rama y entorno
//       node scripts/version.mjs --ref origin/main --solo-version  → "1.2.3"
//
// No necesita el historial de git: lee versionado.json y el commit (en Vercel, de sus variables).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FICHERO = "versionado.json";
const RE_SEMVER = /^\d+\.\d+\.\d+$/;

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

/** main y release/X.Y.Z llevan la versión exacta: son producción o la candidata a serlo. */
export function esRamaDePublicacion(rama) {
  return rama === "main" || /^release\/\d+\.\d+\.\d+$/.test(rama ?? "");
}

/**
 * @param {{ ref?: string, cwd?: string, env?: NodeJS.ProcessEnv }} opciones
 * @returns {{ version: string, publicada: string | null, desarrollo: boolean, commit: string | null, rama: string | null, entorno: "produccion" | "demo" | "preview" | "local", aviso: string | null }}
 */
export function calcularVersion({ ref = "HEAD", cwd = RAIZ, env = process.env } = {}) {
  const commitLargo = (ref === "HEAD" && env.VERCEL_GIT_COMMIT_SHA) || intentar(() => git(["rev-parse", ref], cwd));
  const commit = commitLargo ? commitLargo.slice(0, 7) : null;
  const ramaGit = intentar(() => git(["rev-parse", "--abbrev-ref", ref], cwd));
  const rama = (ref === "HEAD" && env.VERCEL_GIT_COMMIT_REF) || (ramaGit && ramaGit !== "HEAD" ? ramaGit.replace(/^origin\//, "") : null);
  const entorno = detectarEntorno(env, rama ?? undefined);

  const texto = intentar(() => (ref === "HEAD" ? readFileSync(path.join(cwd, FICHERO), "utf8") : git(["show", `${ref}:${FICHERO}`], cwd)));
  const publicada = intentar(() => JSON.parse(texto).version);
  if (!RE_SEMVER.test(publicada ?? "")) {
    return { version: "sin versionar", publicada: null, desarrollo: true, commit, rama, entorno, aviso: `falta "version": "X.Y.Z" en ${FICHERO}` };
  }
  const desarrollo = !(entorno === "produccion" || esRamaDePublicacion(rama));
  return {
    version: desarrollo ? `${publicada}+${commit ?? "dev"}` : publicada,
    publicada,
    desarrollo,
    commit,
    rama,
    entorno,
    aviso: null,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ref = args.includes("--ref") ? args[args.indexOf("--ref") + 1] : "HEAD";
  const datos = calcularVersion({ ref });
  console.log(args.includes("--solo-version") ? datos.version : JSON.stringify(datos, null, 2));
}
