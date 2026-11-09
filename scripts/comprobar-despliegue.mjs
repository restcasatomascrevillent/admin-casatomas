// Comprueba que un despliegue (la candidata en preview o producción) es exactamente el esperado:
// la página principal responde y /version.json lleva la versión y el commit que tocan.
//
//   node scripts/comprobar-despliegue.mjs <url> [--version X.Y.Z] [--commit <sha>] [--json fichero]
//
// Reintenta durante 3 minutos (el CDN puede tardar en servir el despliegue nuevo). Con el secreto
// VERCEL_AUTOMATION_BYPASS_SECRET en el entorno, pasa la protección de Vercel si está activada.
// Lo usan .github/workflows/release-candidata.yml y release.yml (docs/PROCESO-DE-CAMBIOS.md).
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Compara lo publicado con lo esperado. Devuelve la lista de diferencias (vacía si cuadra). */
export function diferencias(datos, { version, commit } = {}) {
  const errores = [];
  if (!datos || typeof datos !== "object") return ["/version.json no es un JSON válido"];
  if (version && datos.version !== version) errores.push(`versión ${datos.version ?? "?"} (se esperaba ${version})`);
  if (commit) {
    const publicado = String(datos.commit ?? "").toLowerCase();
    const esperado = commit.toLowerCase();
    if (publicado.length < 7 || !(esperado.startsWith(publicado) || publicado.startsWith(esperado))) errores.push(`commit ${publicado || "?"} (se esperaba ${esperado.slice(0, 7)})`);
  }
  return errores;
}

async function pedir(url) {
  const cabeceras = { "cache-control": "no-cache" };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) cabeceras["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return fetch(url, { headers: cabeceras, redirect: "follow" });
}

export async function comprobar(url, esperado, { intentos = 18, esperaMs = 10_000 } = {}) {
  const base = url.replace(/\/+$/, "");
  let ultimo = { ok: false, url: base, detalle: "sin respuesta" };
  for (let i = 0; i < intentos; i++) {
    try {
      const portada = await pedir(`${base}/`);
      const resp = await pedir(`${base}/version.json?t=${Date.now()}`);
      const datos = resp.ok ? await resp.json().catch(() => null) : null;
      const errores = [...(portada.ok ? [] : [`la portada responde ${portada.status}`]), ...(resp.ok ? diferencias(datos, esperado) : [`/version.json responde ${resp.status}`])];
      ultimo = errores.length
        ? { ok: false, url: base, detalle: errores.join("; "), publicado: datos }
        : { ok: true, url: base, detalle: `v${datos.version} · commit ${datos.commit} · entorno ${datos.entorno ?? "?"}`, publicado: datos };
      if (ultimo.ok) return ultimo;
    } catch (e) {
      ultimo = { ok: false, url: base, detalle: e instanceof Error ? e.message : String(e) };
    }
    if (i < intentos - 1) await new Promise((r) => setTimeout(r, esperaMs));
  }
  return ultimo;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valor = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const url = args.find((a) => /^https?:\/\//.test(a));
  if (!url) {
    console.error("Uso: node scripts/comprobar-despliegue.mjs <url> [--version X.Y.Z] [--commit sha] [--json fichero]");
    process.exit(2);
  }
  const res = await comprobar(url, { version: valor("--version"), commit: valor("--commit") }, { intentos: Number(valor("--intentos") ?? 18) });
  console.log(`${res.ok ? "OK" : "FALLA"} ${res.url}: ${res.detalle}`);
  if (valor("--json")) writeFileSync(valor("--json"), JSON.stringify(res, null, 2));
  process.exitCode = res.ok ? 0 : 1;
}
