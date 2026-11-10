// ESLint SOLO de los ficheros cambiados respecto a una base (por defecto origin/staging).
//
//   node scripts/lint-cambios.mjs [base]      (o variable BASE)
//
// «Trinquete» por fichero: falla si un fichero cambiado tiene MÁS errores que en la base
// (los ficheros nuevos parten de 0). Así se puede tocar un fichero con deuda antigua sin
// arreglarla toda, pero no empeorarla. Los avisos no bloquean.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";

let base = process.argv.slice(2).find((a) => !a.startsWith("--")) || process.env.BASE || "origin/staging";
if (/^0+$/.test(base)) base = "origin/staging";

const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
const lineas = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean);

// Si la base no existe (p. ej. el «antes» de un push forzado), se mira contra origin/staging.
try {
  execFileSync("git", ["rev-parse", "--verify", `${base}^{commit}`], { stdio: "ignore" });
} catch {
  if (base !== "origin/staging") {
    console.log(`No encuentro la base «${base}»; uso origin/staging.`);
    base = "origin/staging";
  }
}
let ficheros;
try {
  ficheros = new Set([
    ...lineas(git("diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`)),
    ...lineas(git("diff", "--name-only", "--diff-filter=ACMR", "HEAD")),
    ...lineas(git("ls-files", "--others", "--exclude-standard")),
  ]);
} catch {
  console.error(`No encuentro la base «${base}» (¿falta git fetch?).`);
  process.exit(1);
}

const eslint = new ESLint();
const candidatos = [];
for (const f of ficheros) {
  if (!/\.(m|c)?[jt]sx?$/.test(f) || !existsSync(f)) continue;
  if (await eslint.isPathIgnored(f)) continue;
  candidatos.push(f);
}
if (!candidatos.length) {
  console.log(`ESLint: ningún fichero de código cambiado respecto a ${base}.`);
  process.exit(0);
}

const errores = (resultados) => resultados.reduce((n, r) => n + r.errorCount, 0);
const ahora = await eslint.lintFiles(candidatos);
let peor = 0;
for (const r of ahora) {
  const rel = path.relative(process.cwd(), r.filePath).replace(/\\/g, "/");
  let antes = 0;
  try {
    const texto = git("show", `${base}:${rel}`);
    antes = errores(await eslint.lintText(texto, { filePath: r.filePath }));
  } catch {
    antes = 0; // fichero nuevo en esta rama
  }
  if (r.errorCount > antes) {
    peor++;
    console.log(`✗ ${rel}: ${r.errorCount} errores (antes ${antes})`);
    for (const m of r.messages.filter((m) => m.severity === 2)) console.log(`    ${m.line}:${m.column}  ${m.message}  ${m.ruleId ?? ""}`);
  } else if (r.errorCount) {
    console.log(`· ${rel}: ${r.errorCount} errores ya existentes (antes ${antes})`);
  }
}
console.log(`ESLint de ${candidatos.length} fichero(s) cambiado(s) respecto a ${base}: ${peor ? `${peor} empeoran` : "ninguno empeora"}.`);
process.exit(peor ? 1 : 0);
