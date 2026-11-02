// Borra los despliegues de Vercel (equipo casa-tomas) creados ANTES de una
// fecha (00:00 hora de Madrid) en admin-casatomas, web-casatomas y
// touza-casatomas, para liberar almacenamiento. Nunca toca el despliegue que
// está ahora en producción. Lo que se borra ya no sirve para «Instant Rollback».
//
//   VERCEL_TOKEN=xxx node scripts/vercel/borrar-despliegues.mjs --antes 2026-10-31            → solo lista
//   VERCEL_TOKEN=xxx node scripts/vercel/borrar-despliegues.mjs --antes 2026-10-31 --borrar   → borra
//
// En una sesión en la nube, el token puede ir como secreto de red de
// api.vercel.com (el proxy añade la cabecera): entonces VERCEL_TOKEN puede
// faltar y se manda la petición sin Authorization.
//
// Node 18 o superior. Vercel guarda los borrados 30 días por si hay que recuperarlos.
const TOKEN = process.env.VERCEL_TOKEN;
const BORRAR = process.argv.includes("--borrar");
const iAntes = process.argv.indexOf("--antes");
const ANTES = iAntes > 0 ? process.argv[iAntes + 1] : undefined;
if (!ANTES || !/^\d{4}-\d{2}-\d{2}$/.test(ANTES)) {
  console.error("Indica la fecha: --antes AAAA-MM-DD (se borra lo creado antes de ese día, hora de Madrid)");
  process.exit(2);
}
const EQUIPO = "team_18KKVg7ueSX0PL4Ycy1QakZj"; // casa-tomas
// Medianoche de Madrid (CET/CEST) del día indicado.
const CORTE = (() => {
  for (const desfase of ["+01:00", "+02:00"]) {
    const t = Date.parse(`${ANTES}T00:00:00${desfase}`);
    const h = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(t);
    if (h === "00") return t;
  }
  throw new Error("Fecha no válida");
})();
const PROYECTOS = {
  "admin-casatomas": "prj_wsr5PHHJsKaJalPrC7gyrlGeALfY",
  "web-casatomas": "prj_0sGVG2CWWPpZWwy1zrr0nCPftcYQ",
  "touza-casatomas": "prj_rV4u5MRropGlLxSVPCCJV8kbwkgv",
};
const api = async (ruta, metodo = "GET") => {
  for (let intento = 0; ; intento++) {
    const res = await fetch(`https://api.vercel.com${ruta}${ruta.includes("?") ? "&" : "?"}teamId=${EQUIPO}`, {
      method: metodo,
      headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
    });
    if (res.status === 429 && intento < 5) {
      await new Promise((r) => setTimeout(r, 2000 * (intento + 1)));
      continue;
    }
    const cuerpo = await res.json().catch(() => ({}));
    if (res.status === 403 && cuerpo?.error?.missingToken) throw new Error("Falta el token de Vercel (VERCEL_TOKEN o secreto de red de api.vercel.com)");
    if (!res.ok) throw new Error(`${metodo} ${ruta}: ${res.status} ${JSON.stringify(cuerpo).slice(0, 200)}`);
    return cuerpo;
  }
};

let total = 0;
for (const [nombre, id] of Object.entries(PROYECTOS)) {
  const proyecto = await api(`/v9/projects/${id}`);
  const enProduccion = proyecto.targets?.production?.id;
  if (!enProduccion) throw new Error(`${nombre}: no se sabe cuál es el despliegue de producción; no se borra nada`);
  const lista = [];
  const vistos = new Set();
  let hasta = CORTE;
  for (;;) {
    const pagina = await api(`/v6/deployments?projectId=${id}&until=${hasta}&limit=100`);
    for (const d of pagina.deployments ?? []) {
      if (d.created >= CORTE) continue;
      if (d.uid === enProduccion) continue; // el que sirve producción ahora: nunca
      if (["BUILDING", "QUEUED", "INITIALIZING"].includes(d.state)) continue;
      if (vistos.has(d.uid)) continue;
      vistos.add(d.uid);
      lista.push(d);
    }
    if (!pagina.pagination?.next) break;
    hasta = pagina.pagination.next;
  }
  console.log(`\n${nombre}: ${lista.length} despliegues anteriores al ${ANTES} (producción actual ${enProduccion}, se conserva)`);
  for (const d of lista) {
    const linea = `  ${new Date(d.created).toISOString().slice(0, 16)}  ${d.target ?? "preview"}  ${d.meta?.githubCommitRef ?? "-"}  ${d.url}`;
    if (!BORRAR) {
      console.log(linea);
      continue;
    }
    await api(`/v13/deployments/${d.uid}`, "DELETE");
    console.log(`${linea}  → BORRADO`);
  }
  total += lista.length;
}
console.log(BORRAR ? `\nBorrados ${total}.` : `\nModo prueba: no se ha borrado nada (${total} en total). Repite con --borrar.`);
