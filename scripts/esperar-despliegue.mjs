// Espera a que Vercel termine de desplegar un commit y escribe la URL donde se ve.
//
//   node scripts/esperar-despliegue.mjs --sha <sha> --entorno Preview --rama release/X.Y.Z [--minutos 20] [--json fichero]
//   node scripts/esperar-despliegue.mjs --sha <sha> --entorno Production --url https://<proyecto>.vercel.app
//
// No depende de una sola señal. En cada vuelta mira tres cosas:
//   1. El propio sitio: si la URL (la de la rama en las previews; la de --url en producción) ya
//      sirve /version.json con ese commit, está desplegado. No necesita GitHub ni tokens de Vercel.
//   2. Los «deployments» de GitHub del commit, si Vercel los crea. Es un ajuste del proyecto de
//      Vercel (Settings → Git → «deployment_status Events») que en web y panel está APAGADO, así
//      que no hay ninguno: mirando solo esto, la candidata de cada release esperaba 20 minutos y
//      quedaba en rojo con la preview ya publicada.
//   3. El estado «Vercel» del commit (el check «Vercel» al pie del PR): si el build falla, se
//      sabe enseguida en vez de agotar el plazo.
// Necesita GITHUB_REPOSITORY y, para 2 y 3, GITHUB_TOKEN (o GH_TOKEN) con permisos deployments:read
// y statuses:read. Si GitHub no contesta o falta un permiso, avisa y sigue con las otras señales.
// Sale con 1 si el despliegue falla o no llega a tiempo; con --json deja el motivo en ese fichero.
// Lo usan .github/workflows/release-candidata.yml y release.yml (docs/PROCESO-DE-CAMBIOS.md).
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { comprobar } from "./comprobar-despliegue.mjs";
import { urlRamaVercel } from "./release.mjs";

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

/**
 * De los estados del commit (el último de cada contexto: GET /commits/<sha>/status), lo que dice
 * Vercel: { estado: "listo" } | { estado: "fallido", detalle } | { estado: "esperando" }.
 * El contexto es «Vercel», o «Vercel – <proyecto>» si el repo tiene varios proyectos de Vercel.
 * No trae la URL del despliegue (su enlace va al panel de Vercel): la URL sale de la rama.
 */
export function estadoVercel(estados, proyecto) {
  const deVercel = (estados ?? []).filter((e) => /^vercel(\s+[–-]\s+.+)?$/i.test(String(e.context ?? "").trim()));
  const elegido = deVercel.find((e) => proyecto && String(e.context).toLowerCase().endsWith(proyecto.toLowerCase())) ?? deVercel[0];
  if (!elegido) return { estado: "esperando" };
  if (elegido.state === "success") return { estado: "listo" };
  if (["failure", "error"].includes(elegido.state)) {
    return { estado: "fallido", detalle: `Vercel: ${elegido.state}${elegido.description ? `: ${elegido.description}` : ""}${elegido.target_url ? ` (${elegido.target_url})` : ""}` };
  }
  return { estado: "esperando" };
}

/**
 * Junta las señales de una vuelta. `sirve`: la URL prevista ya responde con el commit esperado,
 * que es lo que de verdad se quiere saber y por eso manda sobre lo demás.
 */
export function resolverEspera({ sirve, url, github, vercel }) {
  if (sirve) return { estado: "listo", url };
  const fallido = [github, vercel].find((s) => s.estado === "fallido");
  if (fallido) return { estado: "fallido", detalle: fallido.detalle };
  if (github.estado === "listo") return { estado: "listo", url: github.url ?? url ?? null };
  if (vercel.estado === "listo") return { estado: "listo", url: url ?? null };
  return { estado: "esperando" };
}

async function api(ruta) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const cabeceras = { accept: "application/vnd.github+json" };
  if (token) cabeceras.authorization = `Bearer ${token}`;
  const r = await fetch(`https://api.github.com${ruta}`, { headers: cabeceras });
  if (!r.ok) throw new Error(`GitHub ${r.status} en ${ruta}`);
  return r.json();
}

export async function esperar({ repo, sha, entorno = "Preview", rama, url, minutos = 20, pausaMs = 20_000, avisar = (texto) => console.error(texto) }) {
  const proyecto = String(repo ?? "").split("/")[1];
  const destino = (url ?? (entorno.toLowerCase() === "preview" && rama && proyecto ? urlRamaVercel(proyecto, rama) : null))?.replace(/\/+$/, "") ?? null;
  const limite = Date.now() + minutos * 60_000;
  const avisados = new Set();
  // Una señal que falla (sin permiso, GitHub caído) no tumba la espera: se avisa una vez y se sigue.
  const senal = async (nombre, leer) => {
    try {
      return await leer();
    } catch (e) {
      if (!avisados.has(nombre)) avisar(`Aviso: no se puede leer ${nombre} (${e instanceof Error ? e.message : e}); se sigue con las otras señales.`);
      avisados.add(nombre);
      return { estado: "esperando" };
    }
  };
  let ultimoResumen = "";
  for (;;) {
    const [sirve, github, vercel] = await Promise.all([
      destino ? comprobar(destino, { commit: sha }, { intentos: 1 }).then((r) => r.ok) : false,
      senal("los deployments de GitHub", async () => {
        const despliegues = await api(`/repos/${repo}/deployments?sha=${sha}&per_page=20`);
        for (const d of despliegues) d.estados = await api(`/repos/${repo}/deployments/${d.id}/statuses?per_page=5`);
        return estadoDespliegue(despliegues, entorno);
      }),
      senal("el estado «Vercel» del commit", async () => estadoVercel((await api(`/repos/${repo}/commits/${sha}/status?per_page=100`)).statuses, proyecto)),
    ]);
    const res = resolverEspera({ sirve, url: destino, github, vercel });
    if (res.estado !== "esperando") return res;
    const resumen = `Esperando a Vercel (${entorno}): ${destino ?? "sin URL prevista"} aún no sirve ${String(sha).slice(0, 7)} · deployments de GitHub: ${github.estado} · estado «Vercel»: ${vercel.estado}`;
    if (resumen !== ultimoResumen) avisar(resumen);
    ultimoResumen = resumen;
    if (Date.now() + pausaMs >= limite) break;
    await new Promise((r) => setTimeout(r, pausaMs));
  }
  return { estado: "fallido", url: destino, detalle: `Vercel no terminó el despliegue de ${entorno} en ${minutos} minutos${destino ? ` (${destino} no sirve el commit ${String(sha).slice(0, 7)})` : ""}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valor = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const entorno = valor("--entorno") ?? "Preview";
  if (!valor("--sha") || !process.env.GITHUB_REPOSITORY) {
    console.error("Uso: GITHUB_REPOSITORY=<org>/<repo> node scripts/esperar-despliegue.mjs --sha <sha> [--entorno Preview|Production] [--rama release/X.Y.Z | --url https://…] [--minutos 20] [--json fichero]");
    process.exit(2);
  }
  const res = await esperar({ repo: process.env.GITHUB_REPOSITORY, sha: valor("--sha"), entorno, rama: valor("--rama"), url: valor("--url"), minutos: Number(valor("--minutos") ?? 20) });
  if (res.estado === "listo") {
    console.log(res.url ?? "");
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `url=${res.url ?? ""}\n`);
  } else {
    console.error(`Despliegue ${entorno} de ${valor("--sha")}: ${res.detalle}`);
    // Solo si falla: el motivo, para el informe del PR. Si va bien, el resultado lo escribe comprobar-despliegue.mjs.
    if (valor("--json")) writeFileSync(valor("--json"), JSON.stringify({ ok: false, ...(res.url ? { url: res.url } : {}), detalle: res.detalle }, null, 2));
    process.exitCode = 1;
  }
}
