// Convierte los 👎 REVISADOS del copiloto de Facturas (tabla chat_feedback,
// migración 20261123200000) en casos de la batería de evaluación:
//   supabase/functions/chat-facturas/__tests__/eval/preguntas.json
// con el mismo formato que los existentes (id, mensaje, historial, esperado,
// herramientas_esperadas, sql). La cifra de referencia NO se puede sacar del
// 👎: el caso entra con esperado.valor = null y la nota «PENDIENTE»; hay que
// calcularla con SQL en la demo y rellenar `valor`, `unidad`, `tolerancia_pct`,
// `herramientas_esperadas` y `sql` antes de usarlo para puntuar.
//
// Uso:
//   node scripts/chat-feedback-a-eval.mjs --simular          # enseña lo que añadiría, no escribe
//   node scripts/chat-feedback-a-eval.mjs                    # añade los casos nuevos
//   node scripts/chat-feedback-a-eval.mjs --desde-json f.json [--simular]
//
// Origen de los datos:
//   · Por defecto, la API REST de Supabase con SUPABASE_URL y
//     SUPABASE_SERVICE_ROLE_KEY (la demo: sfonaclosuafvlhutkon). Solo lee.
//   · --desde-json: un fichero con las filas (array), p. ej. sacado con
//       npx supabase db query --linked --output json "select * from chat_feedback where valoracion = -1 and revisado"
//
// No repite casos: el id es «fb<id de chat_feedback>» y los que ya estén se saltan.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RUTA_BATERIA = path.join(RAIZ, "supabase/functions/chat-facturas/__tests__/eval/preguntas.json");

// Límites de la acción «evaluar» (ia-modelos-openai/logica.ts, peticionEvaluar).
const MAX_TURNOS_HISTORIAL = 6;
const MAX_CHARS_TURNO = 4000;

const recorta = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Un caso de preguntas.json a partir de una fila de chat_feedback. */
export function casoDeFeedback(fila) {
  const historial = (Array.isArray(fila.historial) ? fila.historial : [])
    .filter((t) => t && (t.rol === "user" || t.rol === "assistant") && typeof t.contenido === "string" && t.contenido.trim())
    .slice(-MAX_TURNOS_HISTORIAL)
    .map((t) => ({ rol: t.rol, contenido: recorta(t.contenido, MAX_CHARS_TURNO) }));
  // Que el historial empiece por una pregunta del usuario.
  while (historial.length > 0 && historial[0].rol !== "user") historial.shift();

  const usadas = (Array.isArray(fila.herramientas) ? fila.herramientas : [])
    .map((h) => (h && typeof h.nombre === "string" ? h.nombre + (h.error ? ` (error: ${recorta(String(h.error), 120)})` : "") : null))
    .filter(Boolean);
  const comentario = (fila.comentario ?? "").trim();
  const fecha = String(fila.created_at ?? "").slice(0, 10);

  return {
    id: `fb${fila.id}`,
    mensaje: fila.pregunta,
    historial,
    esperado: {
      valor: null,
      unidad: null,
      tolerancia_pct: null,
      alternativas: [],
      notas:
        `PENDIENTE de referencia (👎 del ${fecha || "?"}, chat_feedback ${fila.id}, modelo ${fila.modelo ?? "?"}). ` +
        (comentario ? `Qué estaba mal, según el usuario: «${recorta(comentario, 300)}». ` : "Sin comentario del usuario. ") +
        `Herramientas que usó: ${usadas.length > 0 ? usadas.join(", ") : "ninguna"}. ` +
        `Respuesta mala: «${recorta(String(fila.respuesta ?? ""), 400)}»`,
    },
    herramientas_esperadas: [],
    sql: "-- PENDIENTE: consulta de referencia en la demo",
  };
}

/** Casos nuevos (los que aún no están en la batería), en orden de id. */
export function casosNuevos(bateria, filas) {
  const existentes = new Set(bateria.preguntas.map((p) => p.id));
  return filas
    .filter((f) => f && f.valoracion === -1 && f.revisado === true && typeof f.pregunta === "string" && f.pregunta.trim())
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(casoDeFeedback)
    .filter((c) => !existentes.has(c.id));
}

/**
 * Añade los casos al final de `preguntas` SIN reformatear lo que ya hay (el
 * fichero está escrito a mano, con `esperado` en una línea).
 */
export function anadirAlTexto(texto, casos) {
  const cierre = /\n([ \t]*)\]\s*\}\s*$/.exec(texto);
  if (!cierre) throw new Error("preguntas.json no acaba en «] }»: añade los casos a mano.");
  const sangria = cierre[1] + "  ";
  const bloques = casos.map((c) => JSON.stringify(c, null, 2).split("\n").map((l) => sangria + l).join("\n"));
  const antes = texto.slice(0, cierre.index).replace(/\s*$/, "");
  const vacio = antes.endsWith("[");
  const resultado = `${antes}${vacio ? "" : ","}\n${bloques.join(",\n")}${texto.slice(cierre.index)}`;
  JSON.parse(resultado); // nunca dejar el fichero roto
  return resultado;
}

async function leerFilas(desdeJson) {
  if (desdeJson) {
    const crudo = JSON.parse(await readFile(path.resolve(desdeJson), "utf8"));
    // Admite el array tal cual o la salida de `supabase db query --output json` ({ rows: [...] }).
    return Array.isArray(crudo) ? crudo : Array.isArray(crudo?.rows) ? crudo.rows : [];
  }
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) {
    throw new Error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o usa --desde-json <fichero>).");
  }
  const res = await fetch(
    `${url.replace(/\/$/, "")}/rest/v1/chat_feedback?valoracion=eq.-1&revisado=eq.true&select=id,pregunta,respuesta,historial,herramientas,modelo,valoracion,comentario,revisado,created_at&order=id.asc`,
    { headers: { apikey: clave, Authorization: `Bearer ${clave}` } },
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function main(argv) {
  const simular = argv.includes("--simular");
  const i = argv.indexOf("--desde-json");
  const desdeJson = i >= 0 ? argv[i + 1] : null;
  if (i >= 0 && !desdeJson) throw new Error("--desde-json necesita un fichero");

  const bateria = JSON.parse(await readFile(RUTA_BATERIA, "utf8"));
  const filas = await leerFilas(desdeJson);
  const nuevos = casosNuevos(bateria, filas);

  console.log(`👎 revisados leídos: ${filas.length}. Casos nuevos: ${nuevos.length}.`);
  for (const c of nuevos) console.log(`  ${c.id}: ${recorta(c.mensaje, 90)}${c.historial.length ? ` (con ${c.historial.length} turnos previos)` : ""}`);
  if (nuevos.length === 0) return;

  if (simular) {
    console.log("\n--simular: no se escribe nada. Así quedaría el primero:\n");
    console.log(JSON.stringify(nuevos[0], null, 2));
    return;
  }
  await writeFile(RUTA_BATERIA, anadirAlTexto(await readFile(RUTA_BATERIA, "utf8"), nuevos), "utf8");
  console.log(`\nAñadidos a ${path.relative(RAIZ, RUTA_BATERIA)}. Rellena la referencia (valor, unidad, tolerancia_pct, herramientas_esperadas, sql) antes de evaluar.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
