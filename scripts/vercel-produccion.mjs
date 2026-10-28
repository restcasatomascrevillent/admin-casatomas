// Ignored Build Step de Vercel (vercel.json → "ignoreCommand"). Vercel interpreta la salida así:
//   0 → NO construir (cancela el despliegue)      1 → construir
//
// Producción solo se publica cuando el último commit de main es la ACEPTACIÓN de un PR
// desde staging, es decir, el merge commit que crea GitHub al pulsar «Merge pull request»
// ("Merge pull request #N from <org>/staging"). Un push directo a main, un squash o un
// rebase no llegan a producción. La demo y los previews se construyen siempre.
// Ver docs/PROCESO-DE-CAMBIOS.md.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PR_DESDE_STAGING = /^Merge pull request #\d+ from \S+\/staging(\s|$)/;

/** true si este despliegue debe construirse. */
export function debeConstruir(env, mensaje) {
  if (env.VERCEL_ENV !== "production") return true;
  return PR_DESDE_STAGING.test((mensaje ?? "").trim());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let mensaje = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "";
  if (!mensaje) {
    try { mensaje = execFileSync("git", ["log", "-1", "--format=%B"], { encoding: "utf8" }); } catch { /* sin git: decide el mensaje vacío */ }
  }
  if (debeConstruir(process.env, mensaje)) {
    if (process.env.VERCEL_ENV === "production") console.log("Producción: PR aceptado desde staging, se publica.");
    process.exit(1);
  }
  console.log("Producción NO se publica: el último commit de main no es un PR aceptado desde staging. Ver docs/PROCESO-DE-CAMBIOS.md.");
  process.exit(0);
}
