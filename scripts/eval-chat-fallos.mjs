/* eslint-env node */
// Bancos de pruebas del copiloto de Facturas con preguntas REALES de producción:
//   · banco-fallos.json  (25 casos: lo que falló en la evaluación del 16/11/2026, 123 preguntas, 58 % bien)
//   · bateria.json       (212 casos: TODAS las preguntas reales, más casos por tema y de trampa) → --bateria
//   en supabase/functions/chat-facturas/__tests__/eval/
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
// Comprobaciones de un caso (nivel rpc):
//   · rpc.debe / rpc.no_debe: expresiones regulares sobre el texto del resultado (las del banco de fallos);
//   · esperado: [{ruta, valor, tol, tol_pct, tipo, op, sql}]: ruta dentro del resultado (a.b[0].c[campo=valor].d),
//     valor esperado y tolerancia. El valor se calculó con SQL propio (el campo `sql`) contra producción;
//     no se guarda la respuesta en texto. Con --en-vivo se vuelve a calcular con ese SQL en cada pasada
//     (no hay deriva por facturas nuevas) y se avisa de los valores que han cambiado.
//
// Uso (desde una carpeta enlazada con `supabase link`; mira supabase/.temp/project-ref):
//   node scripts/eval-chat-fallos.mjs                         # banco de fallos, rpc, entorno según el proyecto enlazado
//   node scripts/eval-chat-fallos.mjs --bateria               # la batería ampliada
//   node scripts/eval-chat-fallos.mjs --bateria --categoria margenes,iva --en-vivo
//   node scripts/eval-chat-fallos.mjs --bateria --historico ../facturas-conocimiento/evals --solo-regresiones
//   node scripts/eval-chat-fallos.mjs --solo f01,f03 --ver    # enseña el resultado de cada consulta
//   node scripts/eval-chat-fallos.mjs --ia --solo f01,f02 --modelo gpt-6.1-terra
//   node scripts/eval-chat-fallos.mjs --dir ../carpeta-enlazada-a-prod --npx-prefix ../repo-con-node_modules
//   node scripts/eval-chat-fallos.mjs --salida informe.json
//   node scripts/eval-chat-fallos.mjs --simular a.sql,b.sql   # crea antes esas migraciones en una transacción
//        (begin; a.sql; b.sql; banco; rollback): probar en producción funciones que aún no tiene, sin cambiar nada.
//
// Histórico (--historico <carpeta>): guarda <fecha>-<entorno>-<nivel>.json con el resultado de cada caso y lo
// compara con la pasada anterior de la carpeta (mejoras y regresiones). --solo-regresiones hace que el código
// de salida sea 1 solo si algo que antes iba bien ahora falla (para un trabajo programado).
//
// Código de salida: 0 todo bien · 1 algún caso falla · 2 no se pudo ejecutar.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RUTA_BANCO = path.join(RAIZ, "supabase/functions/chat-facturas/__tests__/eval/banco-fallos.json");
export const RUTA_BATERIA = path.join(RAIZ, "supabase/functions/chat-facturas/__tests__/eval/bateria.json");
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

// ─── Comprobaciones de valor (batería) ──────────────────────────────────────

/** Trozos de una ruta: «a.b[0].c[campo=valor].d» → ["a","b",0,"c",{campo,valor},"d"]. Los puntos dentro de [] no separan. */
export function trozosRuta(ruta) {
  const t = [];
  let i = 0;
  while (i < ruta.length) {
    if (ruta[i] === ".") { i++; continue; }
    if (ruta[i] === "[") {
      const fin = ruta.indexOf("]", i);
      if (fin < 0) throw new Error(`Ruta mal formada: ${ruta}`);
      const dentro = ruta.slice(i + 1, fin);
      const eq = dentro.indexOf("=");
      t.push(eq >= 0 ? { campo: dentro.slice(0, eq), valor: dentro.slice(eq + 1) } : Number(dentro));
      i = fin + 1;
    } else {
      let j = i;
      while (j < ruta.length && ruta[j] !== "." && ruta[j] !== "[") j++;
      t.push(ruta.slice(i, j));
      i = j;
    }
  }
  return t;
}

const minus = (x) => String(x ?? "").trim().toLowerCase();

/** Valor de una ruta dentro del resultado (undefined si no existe). */
export function leerRuta(obj, ruta) {
  let v = obj;
  for (const t of trozosRuta(ruta)) {
    if (v === null || v === undefined) return undefined;
    if (typeof t === "string") v = v[t];
    else if (typeof t === "number") v = Array.isArray(v) ? v[t] : undefined;
    else v = Array.isArray(v) ? v.find((x) => minus(x?.[t.campo]) === minus(t.valor)) : undefined;
  }
  return v;
}

/** null si el valor observado cumple lo esperado; si no, el motivo. e = {ruta, valor, tol, tol_pct, tipo, op}. */
export function compararEsperado(e, observado, esperado = e.valor) {
  const tipo = e.tipo ?? (typeof esperado === "number" ? "num" : typeof esperado === "boolean" ? "bool" : esperado === null ? "nulo" : "txt");
  if (tipo === "nulo") return observado === null || observado === undefined ? null : `${e.ruta}: debía faltar y sale ${JSON.stringify(observado)}`;
  if (observado === undefined) return `${e.ruta}: no está en el resultado (esperado ${JSON.stringify(esperado)})`;
  if (tipo === "bool") return observado === esperado ? null : `${e.ruta}: esperado ${esperado}, sale ${JSON.stringify(observado)}`;
  if (tipo === "txt") return minus(observado) === minus(esperado) ? null : `${e.ruta}: esperado «${esperado}», sale «${observado}»`;
  const n = Number(observado);
  if (observado === null || !Number.isFinite(n)) return `${e.ruta}: esperado ${esperado}, sale ${JSON.stringify(observado)}`;
  const tol = Math.max(e.tol ?? 0.01, Math.abs(esperado) * ((e.tol_pct ?? 0) / 100));
  const op = e.op ?? "=";
  if (op === "<=") return n <= esperado + tol ? null : `${e.ruta}: esperado como mucho ${esperado}, sale ${n}`;
  if (op === ">=") return n >= esperado - tol ? null : `${e.ruta}: esperado al menos ${esperado}, sale ${n}`;
  return Math.abs(n - esperado) <= tol ? null : `${e.ruta}: esperado ${esperado} (±${tol}), sale ${n}`;
}

/** Evalúa un caso con el resultado de la RPC (texto JSON). valores = valores esperados en vivo (por posición) o null. */
export function evaluarResultado(caso, texto, entorno, valores = null) {
  const p = problemas(texto, comprobaciones(caso.rpc, entorno));
  let json = null;
  try { json = JSON.parse(texto); } catch { /* resultado no JSON */ }
  const observado = {};
  (caso.esperado ?? []).forEach((e, i) => {
    const v = json === null ? undefined : leerRuta(json, e.ruta);
    observado[e.ruta + (e.op ? ` ${e.op}` : "")] = v === undefined ? null : v;
    const m = compararEsperado(e, v, valores ? valores[i] : e.valor);
    if (m) p.push(m);
  });
  return { problemas: p, observado };
}

/** Resumen por categoría de los casos evaluados: { categoria: {n, bien, pct} } */
export function resumenPorCategoria(resultados) {
  const r = {};
  for (const x of resultados) {
    const k = x.categoria ?? "sin_categoria";
    r[k] ??= { n: 0, bien: 0, pct: 0 };
    r[k].n++;
    if (x.ok) r[k].bien++;
  }
  for (const k of Object.keys(r)) r[k].pct = Math.round((r[k].bien / r[k].n) * 100);
  return r;
}

/** Compara dos pasadas (listas de {id, ok}): regresiones, mejoras, nuevos y desaparecidos. */
export function compararPasadas(anterior, actual) {
  const a = new Map(anterior.map((x) => [x.id, x.ok]));
  const b = new Map(actual.map((x) => [x.id, x.ok]));
  const r = { regresiones: [], mejoras: [], nuevos: [], desaparecidos: [] };
  for (const [id, ok] of b) {
    if (!a.has(id)) r.nuevos.push(id);
    else if (a.get(id) && !ok) r.regresiones.push(id);
    else if (!a.get(id) && ok) r.mejoras.push(id);
  }
  for (const id of a.keys()) if (!b.has(id)) r.desaparecidos.push(id);
  return r;
}

/** Problemas de forma de la batería: ids únicos, categoría, herramienta (o rpc directa) y valor en cada comprobación. */
export function problemasDeBateria(bateria, nombresHerramientas) {
  const p = [];
  const ids = new Set();
  for (const c of bateria.casos ?? []) {
    if (!c.id || ids.has(c.id)) p.push(`id repetido o vacío: ${c.id}`);
    ids.add(c.id);
    if (!c.mensaje || !c.categoria || !c.origen) p.push(`${c.id}: faltan mensaje, categoría u origen`);
    if (c.evaluable === false) { if (!c.motivo_no_evaluable) p.push(`${c.id}: no evaluable sin motivo`); continue; }
    if (c.rpc_directo) { if (!/^[a-z_]+_agente$/.test(c.rpc_directo.rpc ?? "")) p.push(`${c.id}: rpc directa no válida`); }
    else if (!c.herramienta?.nombre || !nombresHerramientas.has(c.herramienta.nombre)) p.push(`${c.id}: herramienta desconocida`);
    const regex = [...(c.rpc?.debe ?? []), ...(c.rpc?.no_debe ?? [])];
    if ((c.esperado ?? []).length === 0 && regex.length === 0) p.push(`${c.id}: sin ninguna comprobación`);
    for (const r of regex) { try { new RegExp(r, "i"); } catch { p.push(`${c.id}: expresión no válida ${r}`); } }
    for (const e of c.esperado ?? []) {
      if (!e.ruta) p.push(`${c.id}: comprobación sin ruta`);
      else { try { trozosRuta(e.ruta); } catch { p.push(`${c.id}: ruta mal formada ${e.ruta}`); } }
      if (e.valor === undefined) p.push(`${c.id}: ${e.ruta} sin valor esperado`);
      if (e.sql && (/;/.test(e.sql) || !/^\s*select\b/i.test(e.sql) || /\b(insert|update|delete|drop|alter|create|grant|truncate)\b/i.test(e.sql))) p.push(`${c.id}: el SQL de verificación no es de solo lectura`);
    }
  }
  return p;
}

/** `public.<rpc>(…)` de un caso (herramienta normal o RPC directa). */
export function sqlDeCaso(h, c) {
  if (c.rpc_directo) {
    const args = Object.entries(c.rpc_directo.params).map(([k, v]) => {
      if (!/^[a-z_]+$/.test(k)) throw new Error(`Parámetro no válido: ${k}`);
      return `${k} => ${literalSql(v)}`;
    });
    return `public.${c.rpc_directo.rpc}(${args.join(", ")})`;
  }
  return sqlDeLlamada(h.prepararLlamada(c.herramienta.nombre, c.herramienta.argumentos, c.mensaje, c.herramienta.asociacion ?? null));
}
export function rpcDeCaso(h, c) {
  return c.rpc_directo ? c.rpc_directo.rpc : h.prepararLlamada(c.herramienta.nombre, c.herramienta.argumentos, c.mensaje, c.herramienta.asociacion ?? null).rpc;
}

/** La última pasada guardada de la carpeta para ese entorno y nivel (o null). Los ficheros se llaman AAAA-MM-DD[THHMM]-entorno-nivel.json. */
export function ultimaPasada(dir, entorno, nivel, excluir = null) {
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).filter((n) => n.endsWith(`-${entorno}-${nivel}.json`) && n !== excluir).sort();
  return f.length ? path.join(dir, f[f.length - 1]) : null;
}

// ─── Ejecución ──────────────────────────────────────────────────────────────

function args(argv) {
  const o = {
    ia: false, ver: false, solo: null, categorias: null, dir: RAIZ, npxPrefix: null, modelo: "gpt-6.1-terra", salida: null, entorno: null,
    simular: [], bateria: false, enVivo: false, historico: null, soloRegresiones: false, banco: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ia") o.ia = true;
    else if (a === "--ver") o.ver = true;
    else if (a === "--bateria") o.bateria = true;
    else if (a === "--en-vivo") o.enVivo = true;
    else if (a === "--solo-regresiones") o.soloRegresiones = true;
    else if (a === "--solo") o.solo = new Set(argv[++i].split(","));
    else if (a === "--categoria") o.categorias = new Set(argv[++i].split(","));
    else if (a === "--historico") o.historico = path.resolve(argv[++i]);
    else if (a === "--banco") o.banco = path.resolve(argv[++i]);
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
  const salida = execFileSync(cmd[0], cmd.slice(1), { cwd: o.dir, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
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
const TROZO = 12; // casos por consulta: una consulta enorme se corta por tiempo o por tamaño

/** Lanza los casos por trozos; si un trozo falla, de uno en uno (una función que falta no tumba a los demás). */
function lanzarRpc(casos, h, o, entorno) {
  const resultados = new Map();
  const lanzar = (lista) => {
    const filas = lista.map((c) => `select ${literalSql(c.id)} as id, clock_timestamp() as a, ${sqlDeCaso(h, c)}::text as r, clock_timestamp() as b`);
    const consulta = `with cfg as materialized (select ${SERVICIO} as x), t as (\n${filas.map((f) => `select * from (${f} from cfg) q`).join("\nunion all\n")}\n)\nselect id, round(extract(epoch from (b - a)) * 1000) as ms, r from t;`;
    return consultar(sqlSimulado(consulta, o.simular.map((f) => readFileSync(f, "utf8"))), o);
  };
  for (let i = 0; i < casos.length; i += TROZO) {
    const trozo = casos.slice(i, i + TROZO);
    try {
      for (const f of lanzar(trozo)) resultados.set(f.id, { ms: Number(f.ms), r: f.r });
    } catch {
      for (const c of trozo) {
        try { for (const f of lanzar([c])) resultados.set(f.id, { ms: Number(f.ms), r: f.r }); } catch (e) {
          const m = String(e.stderr ?? e.stdout ?? e.message ?? e);
          resultados.set(c.id, { error: /does not exist|no existe|42883/i.test(m) ? `falta la función ${rpcDeCaso(h, c)} en este entorno` : `error de la base de datos: ${m.replace(/\s+/g, " ").slice(0, 200)}` });
        }
      }
    }
  }
  return resultados;
}

/** Valores esperados recalculados con el SQL de cada comprobación: Map(id → [valor|undefined, …]). */
function valoresEnVivo(casos, o) {
  const partes = [];
  casos.forEach((c, i) => (c.esperado ?? []).forEach((e, j) => { if (e.sql) partes.push({ i, j, sql: e.sql }); }));
  const sal = new Map();
  for (let k = 0; k < partes.length; k += 40) {
    const lote = partes.slice(k, k + 40);
    const consulta = lote.map((p) => `select ${p.i} as i, ${p.j} as j, to_jsonb((${p.sql})) as v`).join("\nunion all\n") + ";";
    for (const f of consultar(consulta, o)) {
      const c = casos[f.i];
      const e = c.esperado[f.j];
      const arr = sal.get(c.id) ?? [];
      arr[f.j] = e.tipo === "num" || typeof e.valor === "number" ? (f.v === null ? null : Number(f.v)) : f.v;
      sal.set(c.id, arr);
    }
  }
  return sal;
}

async function main() {
  const o = args(process.argv.slice(2));
  const ref = readFileSync(path.join(o.dir, "supabase/.temp/project-ref"), "utf8").trim();
  const entorno = o.entorno ?? PROYECTOS[ref];
  if (!entorno) throw new Error(`Proyecto enlazado desconocido (${ref}): indica --entorno demo|prod.`);
  if (o.ia && o.simular.length) throw new Error("--simular solo vale para el nivel rpc.");
  if (o.ia && entorno === "prod") throw new Error("El nivel --ia no se lanza contra producción (escribe en la cola de pg_net y gasta OpenAI).");

  const h = await import(pathToFileURL(path.join(RAIZ, "supabase/functions/chat-facturas/herramientas.ts")).href);
  const rutaBanco = o.banco ?? (o.bateria ? RUTA_BATERIA : RUTA_BANCO);
  const banco = JSON.parse(readFileSync(rutaBanco, "utf8"));
  const nombres = new Set(h.TOOLS.map((t) => t.function.name));
  const forma = o.bateria || o.banco ? problemasDeBateria(banco, nombres) : problemasDelBanco(banco, nombres);
  if (forma.length) throw new Error(`Banco mal formado:\n${forma.join("\n")}`);
  const todos = banco.casos.filter((c) => (!o.solo || o.solo.has(c.id)) && (!o.categorias || o.categorias.has(c.categoria)) && (!c.solo_en || c.solo_en === entorno));
  const noEvaluables = todos.filter((c) => c.evaluable === false);
  const casos = todos.filter((c) => c.evaluable !== false && (!o.ia || c.ia));
  const nivel = o.ia ? "ia" : "rpc";
  console.log(`${o.bateria || o.banco ? "Batería" : "Banco de fallos"} del copiloto · ${entorno} (${ref}) · ${casos.length} casos${noEvaluables.length ? ` (+${noEvaluables.length} sin juicio posible)` : ""} · nivel ${nivel}\n`);

  const resultados = [];
  const derivas = [];
  if (!o.ia) {
    const vivo = o.enVivo ? valoresEnVivo(casos, o) : null;
    const lanzados = lanzarRpc(casos, h, o, entorno);
    for (const c of casos) {
      const f = lanzados.get(c.id);
      let p;
      let observado;
      if (!f) p = ["sin resultado"];
      else if (f.error) p = [f.error];
      else {
        const ev = evaluarResultado(c, String(f.r ?? ""), entorno, vivo?.get(c.id) ?? null);
        p = ev.problemas;
        observado = ev.observado;
        if (c.rpc?.max_ms && Number(f.ms) > c.rpc.max_ms) p.push(`tarda ${f.ms} ms (máximo ${c.rpc.max_ms})`);
      }
      if (vivo?.has(c.id)) (c.esperado ?? []).forEach((e, j) => { const v = vivo.get(c.id)[j]; if (e.sql && v !== undefined && e.valor !== v && !(typeof v === "number" && Math.abs(v - e.valor) < 0.005)) derivas.push(`${c.id} ${e.ruta}: guardado ${e.valor}, ahora ${v}`); });
      resultados.push({ id: c.id, categoria: c.categoria ?? "fallos_reales", mensaje: c.mensaje, ok: p.length === 0, ms: f && !f.error ? Number(f.ms) : null, problemas: p, ...(observado ? { observado } : {}), ...(o.ver && f ? { resultado: f.r } : {}) });
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
        id: c.id, categoria: c.categoria ?? "fallos_reales", mensaje: c.mensaje, ok: p.length === 0, ms: r?.latencia_ms ?? null, problemas: p,
        llamadas_chat: r?.llamadas_chat ?? null, llamadas_ms: r?.llamadas_ms ?? null, coste_usd: r?.coste_usd ?? null,
        herramientas: (r?.herramientas ?? []).map((x) => `${x.nombre}:${x.resultado}:${x.duracion_ms}ms`),
        respuesta: texto,
      });
    }
  }

  for (const r of resultados) {
    console.log(`${r.ok ? "BIEN " : "FALLA"} ${r.id}  ${String(r.ms ?? "—").padStart(6)} ms  ${r.mensaje.slice(0, 90)}`);
    for (const p of r.problemas) console.log(`        · ${p}`);
    if (o.ia) console.log(`        ${r.herramientas?.join(", ") || "sin herramientas"} · ${r.llamadas_chat ?? "?"} llamadas al modelo\n        ${String(r.respuesta).replace(/\s+/g, " ").slice(0, 400)}`);
    if (o.ver && r.resultado) console.log(`        ${String(r.resultado).slice(0, 1500)}`);
  }
  const bien = resultados.filter((r) => r.ok).length;
  const tiempos = resultados.map((r) => r.ms);
  const porCategoria = resumenPorCategoria(resultados);
  if (resultados.some((r) => r.categoria !== "fallos_reales")) {
    console.log("\nPor categoría:");
    for (const [k, v] of Object.entries(porCategoria).sort()) console.log(`  ${k.padEnd(32)} ${String(v.bien).padStart(3)} de ${String(v.n).padStart(3)}  ${String(v.pct).padStart(3)} %`);
  }
  if (derivas.length) { console.log(`\nValores esperados que han cambiado desde que se guardaron (${derivas.length}; las facturas crecen):`); for (const d of derivas) console.log(`  ${d}`); }
  console.log(`\nAciertos: ${bien} de ${resultados.length} (${resultados.length ? Math.round((bien / resultados.length) * 100) : 0} %) · mediana ${mediana(tiempos) ?? "—"} ms · máximo ${Math.max(0, ...tiempos.filter(Number.isFinite))} ms`);

  const informe = { entorno, proyecto: ref, nivel, banco: path.basename(rutaBanco), en_vivo: o.enVivo, fecha: new Date().toISOString(), aciertos: bien, total: resultados.length, por_categoria: porCategoria, resultados };
  if (o.salida) writeFileSync(o.salida, JSON.stringify({ entorno, proyecto: ref, nivel, fecha: informe.fecha, resultados }, null, 2));

  // Histórico: un JSON por fecha y comparación con la pasada anterior.
  let hayRegresion = false;
  if (o.historico && !o.ia) {
    mkdirSync(o.historico, { recursive: true });
    const sello = informe.fecha.slice(0, 10);
    let nombre = `${sello}-${entorno}-${nivel}.json`;
    if (existsSync(path.join(o.historico, nombre))) nombre = `${sello}T${informe.fecha.slice(11, 16).replace(":", "")}-${entorno}-${nivel}.json`;
    const previa = ultimaPasada(o.historico, entorno, nivel, nombre);
    writeFileSync(path.join(o.historico, nombre), JSON.stringify(informe, null, 2));
    console.log(`\nHistórico: ${path.join(o.historico, nombre)}`);
    if (previa) {
      const ant = JSON.parse(readFileSync(previa, "utf8"));
      const cmp = compararPasadas(ant.resultados, resultados);
      console.log(`Frente a la pasada anterior (${path.basename(previa)}: ${ant.aciertos} de ${ant.total}):`);
      console.log(`  mejoras (${cmp.mejoras.length}): ${cmp.mejoras.join(", ") || "—"}`);
      console.log(`  regresiones (${cmp.regresiones.length}): ${cmp.regresiones.join(", ") || "—"}`);
      if (cmp.nuevos.length) console.log(`  casos nuevos (${cmp.nuevos.length}): ${cmp.nuevos.join(", ")}`);
      if (cmp.desaparecidos.length) console.log(`  casos que ya no están (${cmp.desaparecidos.length}): ${cmp.desaparecidos.join(", ")}`);
      for (const [k, v] of Object.entries(porCategoria)) { const a = ant.por_categoria?.[k]; if (a && a.pct !== v.pct) console.log(`  ${k}: ${a.pct} % → ${v.pct} %`); }
      hayRegresion = cmp.regresiones.length > 0;
    } else console.log("Sin pasada anterior con la que comparar.");
  }
  process.exit(o.soloRegresiones ? (hayRegresion ? 1 : 0) : bien === resultados.length ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(2); });
}
