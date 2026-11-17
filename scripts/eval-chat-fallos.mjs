/* eslint-env node */
// Banco de pruebas del copiloto de Facturas con las preguntas REALES que fallaron
// (evaluación del 16/11/2026: 123 preguntas de producción, 58 % bien).
//   supabase/functions/chat-facturas/__tests__/eval/banco-fallos.json
//
// Dos niveles:
//   · rpc (por defecto, GRATIS y de solo lectura): llama a la herramienta que el
//     modelo debería usar con sus argumentos (la misma traducción que chat-facturas:
//     prepararLlamada) y comprueba que el resultado trae la respuesta correcta.
//     Mide lo que tarda cada consulta. Sirve para demo y para producción (solo SELECT).
//   · ia (--ia, gasta OpenAI: una pregunta ≈ 0,01 $): lanza la pregunta entera por la
//     acción «evaluar» de ia-modelos-openai (el MISMO bucle que el copiloto) y comprueba
//     la respuesta redactada. Solo donde esa función esté desplegada con este código.
//
// Uso (desde una carpeta enlazada con `supabase link`; mira supabase/.temp/project-ref):
//   node scripts/eval-chat-fallos.mjs                         # rpc, entorno según el proyecto enlazado
//   node scripts/eval-chat-fallos.mjs --solo f01,f03 --ver    # enseña el resultado de cada consulta
//   node scripts/eval-chat-fallos.mjs --ia --solo f01,f02 --modelo gpt-6.1-terra
//   node scripts/eval-chat-fallos.mjs --dir ../carpeta-enlazada-a-prod --npx-prefix ../repo-con-node_modules
//   node scripts/eval-chat-fallos.mjs --salida informe.json
//   node scripts/eval-chat-fallos.mjs --simular a.sql,b.sql   # crea antes esas migraciones en una transacción
//        (begin; a.sql; b.sql; banco; rollback): probar en producción funciones que aún no tiene, sin cambiar nada.
//
// Código de salida: 0 todo bien · 1 algún caso falla · 2 no se pudo ejecutar.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RUTA_BANCO = path.join(RAIZ, "supabase/functions/chat-facturas/__tests__/eval/banco-fallos.json");
const PROYECTOS = { sfonaclosuafvlhutkon: "demo", haqmmdfdzzatdnrrcgez: "prod" };

// ─── Lógica pura (con tests) ────────────────────────────────────────────────

/** Literal SQL de un valor de parámetro de RPC (texto, número, booleano, null, array u objeto → jsonb). */
export function literalSql(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
}

/** `select public.<rpc>(p_a => …, p_b => …)` de una llamada de prepararLlamada (solo las de tipo rpc). */
export function sqlDeLlamada(ll) {
  if (ll.tipo !== "rpc") throw new Error(`La herramienta va por búsqueda semántica (${ll.rpc}): no se puede probar sin OpenAI.`);
  if (!/^[a-z_]+$/.test(ll.rpc)) throw new Error(`RPC no válida: ${ll.rpc}`);
  const args = Object.entries(ll.params).map(([k, v]) => {
    if (!/^[a-z_]+$/.test(k)) throw new Error(`Parámetro no válido: ${k}`);
    return `${k} => ${literalSql(v)}`;
  });
  return `public.${ll.rpc}(${args.join(", ")})`;
}

/** Listas de comprobación de un nivel (rpc o ia) para un entorno: las comunes más las del entorno. */
export function comprobaciones(nivel, entorno) {
  const n = nivel ?? {};
  const e = n[entorno] ?? {};
  return {
    debe: [...(n.debe ?? []), ...(e.debe ?? [])],
    no_debe: [...(n.no_debe ?? []), ...(e.no_debe ?? [])],
  };
}

/** Problemas de un texto frente a sus comprobaciones (expresiones regulares, sin distinguir mayúsculas). */
export function problemas(texto, { debe, no_debe }) {
  const p = [];
  for (const r of debe) if (!new RegExp(r, "i").test(texto)) p.push(`falta /${r}/`);
  for (const r of no_debe) if (new RegExp(r, "i").test(texto)) p.push(`sobra /${r}/`);
  return p;
}

export function mediana(ns) {
  const o = ns.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (o.length === 0) return null;
  return o.length % 2 ? o[(o.length - 1) / 2] : Math.round((o[o.length / 2 - 1] + o[o.length / 2]) / 2);
}

/** Problemas de forma del banco (ids únicos, herramienta y comprobaciones en cada caso). */
export function problemasDelBanco(banco, nombresHerramientas) {
  const p = [];
  const ids = new Set();
  for (const c of banco.casos ?? []) {
    if (!c.id || ids.has(c.id)) p.push(`id repetido o vacío: ${c.id}`);
    ids.add(c.id);
    if (!c.mensaje || !c.fallo_original || !c.correcto) p.push(`${c.id}: faltan mensaje, fallo_original o correcto`);
    if (!c.herramienta?.nombre || !nombresHerramientas.has(c.herramienta.nombre)) p.push(`${c.id}: herramienta desconocida`);
    for (const nivel of [c.rpc, c.ia]) {
      for (const lista of [nivel?.debe, nivel?.no_debe, nivel?.demo?.debe, nivel?.prod?.debe, nivel?.demo?.no_debe, nivel?.prod?.no_debe]) {
        for (const r of lista ?? []) { try { new RegExp(r, "i"); } catch { p.push(`${c.id}: expresión no válida ${r}`); } }
      }
    }
    if (comprobaciones(c.rpc, "prod").debe.length === 0) p.push(`${c.id}: sin comprobación rpc para producción`);
  }
  return p;
}

// ─── Ejecución ──────────────────────────────────────────────────────────────

function args(argv) {
  const o = { ia: false, ver: false, solo: null, dir: RAIZ, npxPrefix: null, modelo: "gpt-6.1-terra", salida: null, entorno: null, simular: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ia") o.ia = true;
    else if (a === "--ver") o.ver = true;
    else if (a === "--solo") o.solo = new Set(argv[++i].split(","));
    else if (a === "--dir") o.dir = path.resolve(argv[++i]);
    else if (a === "--npx-prefix") o.npxPrefix = path.resolve(argv[++i]);
    else if (a === "--modelo") o.modelo = argv[++i];
    else if (a === "--salida") o.salida = argv[++i];
    else if (a === "--entorno") o.entorno = argv[++i];
    else if (a === "--simular") o.simular = argv[++i].split(",").map((f) => path.resolve(f));
    else throw new Error(`Opción desconocida: ${a}`);
  }
  return o;
}

/** Ejecuta un fichero SQL con la CLI de Supabase en la carpeta enlazada y devuelve las filas. */
function consultar(sql, o) {
  const dir = mkdtempSync(path.join(tmpdir(), "eval-chat-"));
  const fichero = path.join(dir, "consulta.sql");
  writeFileSync(fichero, sql);
  const cmd = ["npx", ...(o.npxPrefix ? ["--prefix", o.npxPrefix] : []), "supabase", "db", "query", "--linked", "--yes", "-f", fichero];
  const salida = execFileSync(cmd[0], cmd.slice(1), { cwd: o.dir, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const i = salida.indexOf("{");
  if (i < 0) throw new Error(`Respuesta inesperada de la CLI: ${salida.slice(0, 300)}`);
  const json = JSON.parse(salida.slice(i));
  if (!Array.isArray(json.rows)) throw new Error(`Error de la base de datos: ${salida.slice(i, i + 500)}`);
  return json.rows;
}

/** El banco dentro de una transacción que crea antes las migraciones dadas y se deshace al final. */
export function sqlSimulado(banco, migraciones) {
  if (!migraciones.length) return banco;
  return ["begin;", ...migraciones, banco, "rollback;"].join(String.fromCharCode(10));
}

const SERVICIO = "(select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true))";

async function main() {
  const o = args(process.argv.slice(2));
  const ref = readFileSync(path.join(o.dir, "supabase/.temp/project-ref"), "utf8").trim();
  const entorno = o.entorno ?? PROYECTOS[ref];
  if (!entorno) throw new Error(`Proyecto enlazado desconocido (${ref}): indica --entorno demo|prod.`);
  if (o.ia && o.simular.length) throw new Error("--simular solo vale para el nivel rpc.");
  if (o.ia && entorno === "prod") throw new Error("El nivel --ia no se lanza contra producción (escribe en la cola de pg_net y gasta OpenAI).");

  const h = await import(pathToFileURL(path.join(RAIZ, "supabase/functions/chat-facturas/herramientas.ts")).href);
  const banco = JSON.parse(readFileSync(RUTA_BANCO, "utf8"));
  const forma = problemasDelBanco(banco, new Set(h.TOOLS.map((t) => t.function.name)));
  if (forma.length) throw new Error(`Banco mal formado:\n${forma.join("\n")}`);
  const casos = banco.casos.filter((c) => (!o.solo || o.solo.has(c.id)) && (!c.solo_en || c.solo_en === entorno));
  console.log(`Banco de fallos del copiloto · ${entorno} (${ref}) · ${casos.length} casos · nivel ${o.ia ? "ia" : "rpc"}\n`);

  const resultados = [];
  if (!o.ia) {
    // Una sola consulta: cada caso es una fila (id, ms, resultado). Solo SELECT.
    const filas = casos.map((c) => {
      const ll = h.prepararLlamada(c.herramienta.nombre, c.herramienta.argumentos, c.mensaje, c.herramienta.asociacion ?? null);
      return `select ${literalSql(c.id)} as id, clock_timestamp() as a, ${sqlDeLlamada(ll)}::text as r, clock_timestamp() as b`;
    });
    const consulta = `with cfg as materialized (select ${SERVICIO} as x), t as (\n${filas.map((f) => `select * from (${f} from cfg) q`).join("\nunion all\n")}\n)\nselect id, round(extract(epoch from (b - a)) * 1000) as ms, r from t;`;
    const sql = sqlSimulado(consulta, o.simular.map((f) => readFileSync(f, "utf8")));
    const porId = new Map(consultar(sql, o).map((f) => [f.id, f]));
    for (const c of casos) {
      const f = porId.get(c.id);
      const p = f ? problemas(String(f.r ?? ""), comprobaciones(c.rpc, entorno)) : ["sin resultado"];
      if (f && c.rpc?.max_ms && Number(f.ms) > c.rpc.max_ms) p.push(`tarda ${f.ms} ms (máximo ${c.rpc.max_ms})`);
      resultados.push({ id: c.id, mensaje: c.mensaje, ok: p.length === 0, ms: f ? Number(f.ms) : null, problemas: p, ...(o.ver ? { resultado: f?.r } : {}) });
    }
  } else {
    // Una petición por pregunta a la acción «evaluar» (pg_net + secreto de Vault; no sale de la BD).
    const url = `https://${ref}.supabase.co/functions/v1/ia-modelos-openai`;
    const envios = casos.map((c) => `select ${literalSql(c.id)} as id, net.http_post(url := ${literalSql(url)}, timeout_milliseconds := 140000,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ocr_trabajos_secret')),
      body := ${literalSql({ accion: "evaluar", modelo: o.modelo, preguntas: [{ id: c.id, mensaje: c.mensaje, historial: c.historial ?? [] }] })}) as pid`);
    const pedidos = [];
    // De una en una: en paralelo las consultas se frenan entre sí y los tiempos no valen.
    for (const [i, envio] of envios.entries()) {
      const [{ pid }] = consultar(envio + ";", o);
      let fila = null;
      for (let intento = 0; intento < 60 && !fila; intento++) {
        await new Promise((r) => setTimeout(r, 3000));
        fila = consultar(`select status_code, content::text as content, error_msg from net._http_response where id = ${Number(pid)};`, o)[0] ?? null;
      }
      pedidos.push({ caso: casos[i], fila });
    }
    for (const { caso: c, fila } of pedidos) {
      let r = null;
      try { r = JSON.parse(fila?.content ?? "null")?.resultados?.[0] ?? null; } catch { /* respuesta ilegible */ }
      const texto = r?.respuesta ?? "";
      const p = r ? problemas(texto, comprobaciones(c.ia, entorno)) : [`sin respuesta (${fila?.status_code ?? "sin estado"} ${fila?.error_msg ?? ""})`];
      if (r?.error) p.push(`error: ${r.error}`);
      resultados.push({
        id: c.id, mensaje: c.mensaje, ok: p.length === 0, ms: r?.latencia_ms ?? null, problemas: p,
        llamadas_chat: r?.llamadas_chat ?? null, llamadas_ms: r?.llamadas_ms ?? null, coste_usd: r?.coste_usd ?? null,
        herramientas: (r?.herramientas ?? []).map((x) => `${x.nombre}:${x.resultado}:${x.duracion_ms}ms`),
        respuesta: texto,
      });
    }
  }

  for (const r of resultados) {
    console.log(`${r.ok ? "BIEN " : "FALLA"} ${r.id}  ${String(r.ms ?? "—").padStart(6)} ms  ${r.mensaje}`);
    for (const p of r.problemas) console.log(`        · ${p}`);
    if (o.ia) console.log(`        ${r.herramientas?.join(", ") || "sin herramientas"} · ${r.llamadas_chat ?? "?"} llamadas al modelo\n        ${String(r.respuesta).replace(/\s+/g, " ").slice(0, 400)}`);
    if (o.ver && r.resultado) console.log(`        ${String(r.resultado).slice(0, 1500)}`);
  }
  const bien = resultados.filter((r) => r.ok).length;
  const tiempos = resultados.map((r) => r.ms);
  console.log(`\nAciertos: ${bien} de ${resultados.length} (${resultados.length ? Math.round((bien / resultados.length) * 100) : 0} %) · mediana ${mediana(tiempos) ?? "—"} ms · máximo ${Math.max(0, ...tiempos.filter(Number.isFinite))} ms`);
  if (o.salida) writeFileSync(o.salida, JSON.stringify({ entorno, proyecto: ref, nivel: o.ia ? "ia" : "rpc", fecha: new Date().toISOString(), resultados }, null, 2));
  process.exit(bien === resultados.length ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(2); });
}
