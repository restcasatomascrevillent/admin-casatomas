// Espera a que Vercel termine de desplegar un commit y escribe la URL del despliegue.
//
//   node scripts/esperar-despliegue.mjs --sha <sha> --entorno Preview|Production [--minutos 20]
//
// Usa los «deployments» de GitHub que crea la integración de Vercel para cada despliegue (el
// mismo dato que muestra el PR). Necesita GITHUB_TOKEN (o GH_TOKEN) con permiso deployments:read
// y GITHUB_REPOSITORY. Sale con 1 si el despliegue falla o no llega a tiempo.
// Lo usan .github/workflows/release-candidata.yml y release.yml (docs/PROCESO-DE-CAMBIOS.md).
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * De los deployments de un commit y sus estados, el resultado para `entorno`:
 * { estado: "listo", url } | { estado: "fallido", detalle } | { estado: "esperando" }.
 * Vercel nombra los entornos «Preview», «Production» o «Preview – <proyecto>».
 */
export function estadoDespliegue(despliegues, entorno) {
  const delEntorno = despliegues
    .filter((d) => String(d.environment ?? "").toLowerCase().startsWith(entorno.toLowerCase()))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (!delEntorno.length) return { estado: "esperando" };
  const ultimo = delEntorno[0];
  const estado = (ultimo.estados ?? [])[0]; // GitHub los da del más nuevo al más viejo
  if (!estado) return { estado: "esperando" };
  if (estado.state === "success") return { estado: "listo", url: estado.environment_url || estado.target_url || null };
  if (["failure", "error", "inactive"].includes(estado.state)) return { estado: "fallido", detalle: `${estado.state}${estado.description ? `: ${estado.description}` : ""}` };
  return { estado: "esperando" };
}

async function api(ruta) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const r = await fetch(`https://api.github.com${ruta}`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(`GitHub ${r.status} en ${ruta}`);
  return r.json();
}

export async function esperar({ repo, sha, entorno, minutos = 20 }) {
  const limite = Date.now() + minutos * 60_000;
  let ultimo = { estado: "esperando" };
  while (Date.now() < limite) {
    const despliegues = await api(`/repos/${repo}/deployments?sha=${sha}&per_page=20`);
    for (const d of despliegues) d.estados = await api(`/repos/${repo}/deployments/${d.id}/statuses?per_page=5`);
    ultimo = estadoDespliegue(despliegues, entorno);
    if (ultimo.estado !== "esperando") return ultimo;
    await new Promise((r) => setTimeout(r, 20_000));
  }
  return { estado: "fallido", detalle: `Vercel no terminó el despliegue de ${entorno} en ${minutos} minutos` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valor = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const res = await esperar({ repo: process.env.GITHUB_REPOSITORY, sha: valor("--sha"), entorno: valor("--entorno") ?? "Preview", minutos: Number(valor("--minutos") ?? 20) });
  if (res.estado === "listo") {
    console.log(res.url ?? "");
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `url=${res.url ?? ""}\n`);
  } else {
    console.error(`Despliegue ${valor("--entorno") ?? "Preview"} de ${valor("--sha")}: ${res.detalle}`);
    process.exitCode = 1;
  }
}
