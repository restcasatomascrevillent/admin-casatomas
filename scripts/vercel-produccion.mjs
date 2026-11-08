// Ignored Build Step de Vercel (vercel.json → "ignoreCommand"). Vercel interpreta la salida así:
//   0 → NO construir (cancela el despliegue)      1 → construir
//
// Producción solo se publica cuando el último commit de main es la ACEPTACIÓN de un PR desde
// una rama release/X.Y.Z (el merge commit que crea GitHub al pulsar «Merge pull request»:
// "Merge pull request #N from <org>/release/X.Y.Z") y versionado.json dice esa misma versión.
// Un push directo a main, un squash, un rebase o un PR desde staging no llegan a producción.
// La demo (staging) y las previews (release/*) se construyen siempre.
// Ver docs/PROCESO-DE-CAMBIOS.md.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let mensaje = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "";
  if (!mensaje) {
    try { mensaje = execFileSync("git", ["log", "-1", "--format=%B"], { encoding: "utf8" }); } catch { /* sin git: decide el mensaje vacío */ }
  }
  let versionFichero = null;
  try { versionFichero = JSON.parse(readFileSync("versionado.json", "utf8")).version ?? null; } catch { /* sin fichero: no se publica */ }
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
