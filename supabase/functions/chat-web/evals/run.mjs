#!/usr/bin/env node
/* eslint-env node */
/**
 * run.mjs — Batería de pruebas del chatbot público "Tomy" (Edge Function chat-web).
 *
 * QUÉ HACE
 *   1. Lee evals/escenarios.json y valida su estructura (ids, regex, idiomas...).
 *   2. Manda cada turno al endpoint desplegado con el MISMO contrato que el widget
 *      (casa-tomas-story/src/components/AIChatbot.tsx):
 *        POST JSON { mensaje, idiom, id }  ->  { success, respuesta, sessionToken, codigo? }
 *      En conversaciones multi-turno reenvía el `sessionToken` recibido como `id`.
 *   3. Evalúa cada respuesta con aserciones deterministas (regex, idioma, longitud,
 *      horas inventadas, código de control) y, opcionalmente, con un juez LLM.
 *   4. Imprime PASS/FAIL por escenario, resumen por categoría e idioma, y escribe un
 *      informe Markdown (+ JSON) en evals/resultados/.
 *
 * QUÉ NO HACE
 *   - No imprime ni guarda claves (CHAT_WEB_KEY / OPENAI_API_KEY).
 *   - No toca la base de datos ni la configuración del bot.
 *   - No depende de paquetes npm: Node 18+ (fetch nativo).
 *
 * USO (ver README.md para PowerShell)
 *   node run.mjs --dry-run
 *   node run.mjs [--solo info,seg-injection-prompt-es] [--idioma es] [--incluir-costosos]
 *                [--pausa-ms 1500] [--max-15min 45] [--juez] [--salida ruta.md]
 *
 * ENV
 *   CHAT_WEB_URL   URL de la función (…/functions/v1/chat-web) o solo la base
 *                  del proyecto Supabase (= VITE_SUPABASE_URL de casa-tomas-story).
 *   CHAT_WEB_KEY   Clave publicable (= VITE_SUPABASE_PUBLISHABLE_KEY de casa-tomas-story).
 *   OPENAI_API_KEY Solo con --juez.  JUEZ_MODELO (defecto gpt-5.6-luna).
 *   EVAL_PLATO, EVAL_PLATO_PRECIO, EVAL_DO   Datos reales de la carta para los
 *                  escenarios que los necesitan (si faltan, esos quedan en SKIP).
 *
 * CÓDIGO DE SALIDA: 0 todo PASS/SKIP · 1 hay FAIL · 2 error de infraestructura / abortado.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = {
    dryRun: false,
    solo: null,
    idioma: null,
    excluirCostosos: true,
    pausaMs: 1500,
    max15min: 45,
    juez: false,
    salida: null,
    ayuda: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const sig = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Falta el valor de ${a}`);
      return v;
    };
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--solo") o.solo = sig().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--idioma") o.idioma = sig();
    else if (a === "--excluir-costosos") o.excluirCostosos = true;
    else if (a === "--incluir-costosos") o.excluirCostosos = false;
    else if (a === "--pausa-ms") o.pausaMs = Number(sig());
    else if (a === "--max-15min") o.max15min = Number(sig());
    else if (a === "--juez") o.juez = true;
    else if (a === "--salida") o.salida = sig();
    else if (a === "-h" || a === "--help" || a === "--ayuda") o.ayuda = true;
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  if (!Number.isFinite(o.pausaMs) || o.pausaMs < 0) throw new Error("--pausa-ms debe ser un número >= 0");
  if (!Number.isFinite(o.max15min) || o.max15min < 1) throw new Error("--max-15min debe ser >= 1");
  if (o.idioma && !["es", "en", "fr"].includes(o.idioma)) throw new Error("--idioma debe ser es|en|fr");
  return o;
}

const AYUDA = `Uso: node run.mjs [opciones]
  --dry-run             Valida escenarios.json e imprime el plan (sin red).
  --solo a,b            Solo esos ids o categorías (un id costoso nombrado aquí se ejecuta).
  --idioma es|en|fr     Solo escenarios de ese idioma.
  --excluir-costosos    (por defecto) no ejecuta escenarios "costoso"/"limites".
  --incluir-costosos    Sí los ejecuta.
  --pausa-ms N          Pausa entre peticiones (defecto 1500).
  --max-15min N         Tope de peticiones por 15 min (defecto 45; el código tiene 50/IP/15min fijo).
  --juez                Juez LLM con OPENAI_API_KEY (desactivado por defecto).
  --salida ruta.md      Ruta del informe Markdown (defecto resultados/<fecha>.md).`;

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────
const IDIOMAS = ["es", "en", "fr"];
const CATEGORIAS = [
  "info", "reservas", "carta", "alergenos", "vinos", "idioma", "tono",
  "seguridad", "abuso", "limites", "robustez",
];
const CLAVES_ASERCION = [
  "debe_contener", "debe_contener_alguno", "no_debe_contener", "idioma_esperado",
  "max_palabras", "solo_horas_validas", "horas_extra", "codigo_esperado", "success_esperado",
];

// Textos fijos de chat-web (MENSAJES_FIJOS) que indican un problema de
// infraestructura, NO un fallo del bot: se reintentan / se reportan como INFRA.
const INFRA = {
  rapido: /escribiendo muy rápido|sending messages a bit too fast|envoyez des messages un peu trop vite/i,
  generico: /tengo un problema técnico|having a technical issue|rencontre un souci technique/i,
  no_disponible: /no puedo atenderte por aquí|can't help you here right now|ne peux pas vous répondre ici/i,
  cupo: /no puedo seguir atendiéndote por aquí|unable to keep helping you here|ne peux plus vous répondre ici/i,
};

// Coste estimado por petición al modelo (gpt-5.6-luna: 0,20 $/1M input,
// 0,02 $/1M cached, 1,20 $/1M output). System prompt ~2,3k tokens; las
// preguntas de carta/vinos hacen 2 llamadas con ~0,6-1k tokens de resultado.
const COSTE_EST = { conTools: 0.0015, sinTools: 0.0007, juez: 0.0004, factorPeor: 2.5 };
const CATEGORIAS_CON_TOOLS = new Set(["carta", "alergenos", "vinos"]);
const LATENCIA_EST_MS = 3500;

// Ventanas del limitador del lado cliente, calcadas (con margen) de chat-web:
//   fast path en memoria: 5 / 10 s por IP · 15 / min por IP · 50 / 15 min por IP
//   (RATE_LIMIT_IP_POR_15MIN, fijo en código) · 8 / min por sesión.
const VENTANAS_GLOBALES = (max15) => [[10_000, 4], [60_000, 14], [900_000, max15]];
const VENTANAS_SESION = [[60_000, 7]];

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const escaparRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function precioARegex(v) {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return undefined;
  const ent = Math.floor(n);
  const cent = Math.round((n - ent) * 100);
  if (cent === 0) return `(?<!\\d)${ent}(?:[.,]00?)?(?!\\d)`;
  const c = String(cent).padStart(2, "0");
  const cRe = c.endsWith("0") ? `${c[0]}0?` : c; // 18,5 o 18,50
  return `(?<!\\d)${ent}[.,]${cRe}(?!\\d)`;
}

function variablesEntorno() {
  return {
    PLATO: process.env.EVAL_PLATO?.trim() || undefined,
    DO: process.env.EVAL_DO?.trim() || undefined,
    PLATO_PRECIO_RE: precioARegex(process.env.EVAL_PLATO_PRECIO),
  };
}
const VARS_REGEX_CRUDAS = new Set(["PLATO_PRECIO_RE"]);

/** Sustituye {{X}}. modo "texto" (mensajes) o "regex". Devuelve {valor, faltan[]}. */
function sustituir(str, modo, macros, vars) {
  const faltan = [];
  const valor = String(str).replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (modo === "regex" && macros[k] !== undefined) return `(?:${macros[k]})`;
    const v = vars[k];
    if (v === undefined) {
      faltan.push(k);
      return m;
    }
    if (modo === "regex") return VARS_REGEX_CRUDAS.has(k) ? `(?:${v})` : escaparRegex(v);
    return v;
  });
  return { valor, faltan };
}

function compilar(patron) {
  return new RegExp(patron, "iu");
}

function generarMensaje(m) {
  if (typeof m === "string") return m;
  const { repetir, hasta } = m;
  let s = "";
  while (s.length < hasta) s += repetir;
  return s.slice(0, hasta);
}

/**
 * Normaliza una respuesta ANTES de evaluarla (el texto original se guarda tal
 * cual en el informe). Evita falsos negativos por tipografía del modelo:
 *   - apóstrofos tipográficos (’ ‘ ʼ ′ → ') y comillas (“ ” „ ″ → "); « » se dejan
 *   - espacios no separables / finos → espacio normal; guiones no separables → "-"
 *   - negrita/cursiva Markdown (** __) fuera
 *   - "11:30 p.m.", "11:30 p. m.", "9 a.m." → "11:30 pm", "9 am" (tras un dígito)
 */
export function normalizarRespuesta(t) {
  return String(t ?? "")
    .replace(/[\u2018\u2019\u201A\u201B\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u00A0\u2007\u2009\u200A\u202F]/g, " ")
    .replace(/[\u2010\u2011]/g, "-")
    .replace(/\*\*|__/g, "")
    .replace(/(\d)\s*([ap])\.\s?m\.?(?![\p{L}\d])/giu, (_, d, ap) => `${d} ${ap.toLowerCase()}m`);
}

function contarPalabras(t) {
  return String(t).split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length;
}

// ── Detección de idioma por conteo de palabras vacías distintivas ──
const STOP = {
  es: ["el", "los", "las", "y", "una", "es", "por", "para", "con", "está", "están", "hay", "pero", "muy",
    "también", "del", "al", "lo", "puede", "puedes", "tenemos", "nuestro", "nuestra", "nuestros", "gracias",
    "sí", "cómo", "qué", "cuál", "días", "hasta", "desde", "llámanos", "reservar", "abrimos", "cerrado",
    "cerramos", "horario", "te", "tu", "tus", "aquí", "ahora", "mismo", "encantado", "carta", "vino", "vinos",
    "platos", "precio", "sábado", "domingo", "lunes", "martes", "si", "le", "su", "sus", "este", "esta", "pueden"],
  en: ["the", "and", "is", "are", "you", "your", "we", "our", "to", "of", "for", "with", "in", "on", "at",
    "can", "please", "thank", "thanks", "hours", "from", "or", "it", "this", "would", "be", "open", "closed",
    "book", "booking", "menu", "wine", "wines", "dishes", "price", "call", "us", "have", "here", "happy",
    "help", "saturday", "sunday", "monday", "tuesday", "friday", "a", "an", "if", "any", "which", "what"],
  fr: ["le", "les", "et", "est", "vous", "votre", "vos", "nous", "notre", "nos", "pour", "avec", "dans",
    "sur", "une", "des", "du", "au", "aux", "pas", "ne", "sont", "peut", "pouvez", "merci", "très", "aussi",
    "ou", "fermé", "réserver", "ouvert", "être", "c", "qu", "j", "d", "l", "n", "carte", "vin", "vins",
    "plats", "prix", "appelez", "samedi", "dimanche", "lundi", "mardi", "vendredi", "je", "ce", "cette",
    "il", "elle", "y", "ici", "ravi", "horaires"],
};
const STOP_SETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v)]));

export function detectarIdioma(texto) {
  const limpio = String(texto)
    .replace(/https?:\/\/\S+|www\.\S+|\S+@\S+/g, " ")
    .replace(/[\d€$%+]/g, " ")
    .toLowerCase();
  const palabras = limpio.split(/[^\p{L}]+/u).filter(Boolean);
  if (palabras.length < 5) return { idioma: "indeterminado", puntos: {} };
  const puntos = { es: 0, en: 0, fr: 0 };
  for (const w of palabras) for (const l of IDIOMAS) if (STOP_SETS[l].has(w)) puntos[l]++;
  const orden = IDIOMAS.slice().sort((a, b) => puntos[b] - puntos[a]);
  const [p1, p2] = [puntos[orden[0]], puntos[orden[1]]];
  if (p1 < 2 || p1 < p2 * 1.3) return { idioma: "indeterminado", puntos };
  return { idioma: orden[0], puntos };
}

// ── Horas mencionadas en la respuesta (para detectar horarios inventados) ──
function normHora(h, m, ampm) {
  let hh = Number(h);
  const mm = Number(m ?? 0);
  if (ampm) {
    const pm = /^p/i.test(ampm);
    if (pm && hh < 12) hh += 12;
    if (!pm && hh === 12) hh = 0;
  }
  if (hh > 24 || mm > 59) return null;
  return `${hh}:${String(mm).padStart(2, "0")}`;
}

export function extraerHoras(texto) {
  const horas = new Set();
  const t = String(texto);
  const conMin = /(?<![\d.,:])(\d{1,2})\s?[:.h]\s?(\d{2})(?!\d)(?!\s?(?:€|eur))(?:\s*(a\.?\s?m\.?|p\.?\s?m\.?))?/giu;
  for (const m of t.matchAll(conMin)) {
    const n = normHora(m[1], m[2], m[3]);
    if (n) horas.add(n);
  }
  const sinMin = /(?<![\d.,:])(\d{1,2})\s?(?:(a\.?\s?m\.?|p\.?\s?m\.?)|h)(?![\p{L}\d])/giu;
  for (const m of t.matchAll(sinMin)) {
    const n = normHora(m[1], 0, m[2]);
    if (n) horas.add(n);
  }
  return [...horas];
}

// ─────────────────────────────────────────────────────────────────────────────
// Carga + validación
// ─────────────────────────────────────────────────────────────────────────────
async function cargar() {
  const ruta = join(__dirname, "escenarios.json");
  const crudo = await readFile(ruta, "utf8");
  return JSON.parse(crudo);
}

function validar(doc) {
  const errores = [];
  const avisos = [];
  const meta = doc._meta ?? {};
  const macros = meta.macros ?? {};
  // Valores ficticios para poder compilar las regex aunque falten variables.
  const varsFicticias = { PLATO: "Plato", DO: "Rioja", PLATO_PRECIO_RE: "1[.,]00" };
  // Plantillas {{X}} que no son ni macro ni variable de entorno conocida:
  // error de escritura en escenarios.json (antes acababan en FAIL confusos).
  const conocidas = new Set([...Object.keys(macros), ...Object.keys(varsFicticias)]);
  const revisarPlantillas = (str, donde) => {
    for (const m of String(str ?? "").matchAll(/\{\{(\w+)\}\}/g)) {
      if (!conocidas.has(m[1])) errores.push(`${donde}: plantilla desconocida {{${m[1]}}}`);
    }
  };

  const probarRegex = (p, donde) => {
    revisarPlantillas(p, donde);
    const { valor } = sustituir(p, "regex", macros, varsFicticias);
    try {
      compilar(valor);
    } catch (e) {
      errores.push(`${donde}: regex inválida ${JSON.stringify(p)} → ${e.message}`);
    }
  };
  for (const [k, v] of Object.entries(macros)) probarRegex(v, `_meta.macros.${k}`);
  for (const p of meta.no_debe_contener_global ?? []) probarRegex(p, "_meta.no_debe_contener_global");

  const validarAserciones = (obj, donde) => {
    for (const k of ["debe_contener", "debe_contener_alguno", "no_debe_contener"]) {
      if (obj[k] === undefined) continue;
      if (!Array.isArray(obj[k])) errores.push(`${donde}.${k} debe ser un array`);
      else obj[k].forEach((p, i) => probarRegex(p, `${donde}.${k}[${i}]`));
    }
    if (obj.idioma_esperado !== undefined && !IDIOMAS.includes(obj.idioma_esperado)) {
      errores.push(`${donde}.idioma_esperado inválido: ${obj.idioma_esperado}`);
    }
    if (obj.max_palabras !== undefined && !(Number.isInteger(obj.max_palabras) && obj.max_palabras > 0)) {
      errores.push(`${donde}.max_palabras debe ser entero > 0`);
    }
    if (obj.success_esperado !== undefined && typeof obj.success_esperado !== "boolean") {
      errores.push(`${donde}.success_esperado debe ser boolean`);
    }
  };

  const escenarios = doc.escenarios;
  if (!Array.isArray(escenarios)) {
    errores.push("Falta el array 'escenarios'");
    return { errores, avisos };
  }
  const ids = new Set();
  for (const [i, e] of escenarios.entries()) {
    const donde = `escenarios[${i}]${e?.id ? ` (${e.id})` : ""}`;
    if (!e || typeof e !== "object") {
      errores.push(`${donde}: no es un objeto`);
      continue;
    }
    if (!e.id || typeof e.id !== "string") errores.push(`${donde}: falta id`);
    else if (ids.has(e.id)) errores.push(`${donde}: id duplicado`);
    else ids.add(e.id);
    if (!IDIOMAS.includes(e.idioma)) errores.push(`${donde}: idioma inválido (${e.idioma})`);
    if (!CATEGORIAS.includes(e.categoria)) errores.push(`${donde}: categoria desconocida (${e.categoria})`);
    if (!Array.isArray(e.turnos) || e.turnos.length === 0) errores.push(`${donde}: turnos vacío`);
    for (const [j, t] of (e.turnos ?? []).entries()) {
      const dt = `${donde}.turnos[${j}]`;
      const m = t?.mensaje;
      const okMensaje = typeof m === "string" ||
        (m && typeof m.repetir === "string" && m.repetir.length > 0 && Number.isInteger(m.hasta) && m.hasta > 0);
      if (!okMensaje) errores.push(`${dt}: mensaje debe ser string o {repetir, hasta}`);
      else revisarPlantillas(typeof m === "string" ? m : m.repetir, `${dt}.mensaje`);
      if (t?.idiom !== undefined && !IDIOMAS.includes(t.idiom)) errores.push(`${dt}: idiom inválido`);
      if (t?.veces !== undefined && !(Number.isInteger(t.veces) && t.veces >= 1)) errores.push(`${dt}: veces >= 1`);
      if (t?.esperado) validarAserciones(t.esperado, `${dt}.esperado`);
    }
    validarAserciones(e, donde);
    revisarPlantillas(e.criterio_juez, `${donde}.criterio_juez`);
    const tieneAsercion = CLAVES_ASERCION.some((k) => e[k] !== undefined) || e.criterio_juez;
    if (!tieneAsercion) avisos.push(`${donde}: no tiene ninguna aserción`);
    if (!e.sin_modelo && !e.limites && !e.criterio_juez) avisos.push(`${donde}: sin criterio_juez`);
    if (e.limites && !e.costoso) avisos.push(`${donde}: limites sin costoso:true (se ejecutaría por defecto)`);
  }
  if (escenarios.length < 45) avisos.push(`Solo hay ${escenarios.length} escenarios (objetivo ≥ 45)`);
  return { errores, avisos };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan: filtra y expande escenarios en peticiones concretas
// ─────────────────────────────────────────────────────────────────────────────
function planificar(doc, opts) {
  const macros = doc._meta?.macros ?? {};
  const vars = variablesEntorno();
  const plan = [];
  for (const e of doc.escenarios) {
    const nombrado = opts.solo?.includes(e.id);
    if (opts.solo && !nombrado && !opts.solo.includes(e.categoria)) continue;
    if (opts.idioma && e.idioma !== opts.idioma) continue;
    const costoso = e.costoso || e.limites;
    if (costoso && opts.excluirCostosos && !nombrado) continue;

    const faltan = new Set(e.requiere_vars?.filter((k) => vars[k] === undefined) ?? []);
    const turnos = [];
    for (const t of e.turnos) {
      const veces = t.veces ?? 1;
      for (let n = 0; n < veces; n++) {
        const s = sustituir(generarMensaje(t.mensaje), "texto", macros, vars);
        s.faltan.forEach((k) => faltan.add(k));
        turnos.push({ mensaje: s.valor, idiom: t.idiom ?? e.idioma, esperado: t.esperado ?? null });
      }
    }
    // Las aserciones del escenario se aplican al último turno.
    const ultimo = turnos[turnos.length - 1];
    const aserciones = {};
    for (const k of CLAVES_ASERCION) if (e[k] !== undefined) aserciones[k] = e[k];
    ultimo.esperado = { ...(ultimo.esperado ?? {}), ...aserciones };

    // Pre-compila regex con variables reales.
    const compilarLista = (lista) =>
      (lista ?? []).map((p) => {
        const s = sustituir(p, "regex", macros, vars);
        s.faltan.forEach((k) => faltan.add(k));
        return { fuente: p, re: s.faltan.length ? null : compilar(s.valor) };
      });
    for (const t of turnos) {
      if (!t.esperado) continue;
      t.re = {
        debe: compilarLista(t.esperado.debe_contener),
        alguno: compilarLista(t.esperado.debe_contener_alguno),
        noDebe: compilarLista(t.esperado.no_debe_contener),
      };
    }
    const globales = e.sin_modelo ? [] : compilarLista(doc._meta?.no_debe_contener_global);
    let criterio = null;
    if (e.criterio_juez) {
      const s = sustituir(e.criterio_juez, "texto", macros, vars);
      s.faltan.forEach((k) => faltan.add(k));
      criterio = s.valor;
    }
    // Red de seguridad genérica: cualquier {{X}} que siga sin resolver en un
    // mensaje, una regex o el criterio deja el escenario en SKIP (con motivo),
    // nunca en FAIL por comparar contra el literal "{{X}}".
    const restos = [
      ...turnos.map((t) => t.mensaje),
      ...turnos.flatMap((t) => Object.values(t.re ?? {}).flat().filter((x) => !x.re).map((x) => x.fuente)),
      criterio ?? "",
    ].join("\n").matchAll(/\{\{(\w+)\}\}/g);
    for (const m of restos) if (!(m[1] in macros)) faltan.add(m[1]);

    plan.push({ e, turnos, globales, criterio, faltan: [...faltan] });
  }
  return plan;
}

function estimar(plan, opts) {
  let peticiones = 0, alModelo = 0, coste = 0, juez = 0;
  for (const p of plan) {
    if (p.faltan.length) continue;
    peticiones += p.turnos.length;
    if (!p.e.sin_modelo) {
      // En "limites" el último turno se corta antes de OpenAI.
      const n = p.e.limites ? p.turnos.length - 1 : p.turnos.length;
      alModelo += n;
      coste += n * (CATEGORIAS_CON_TOOLS.has(p.e.categoria) ? COSTE_EST.conTools : COSTE_EST.sinTools);
    }
    if (opts.juez && p.criterio) juez++;
  }
  const costeJuez = juez * COSTE_EST.juez;
  const porLatencia = peticiones * (opts.pausaMs + LATENCIA_EST_MS);
  const porVentana = Math.max(0, Math.ceil(peticiones / opts.max15min) - 1) * 900_000;
  const duracionMs = Math.max(porLatencia, porVentana + (peticiones % opts.max15min) * (opts.pausaMs + LATENCIA_EST_MS));
  return { peticiones, alModelo, coste, costeJuez, juez, duracionMs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Limitador del lado cliente (ventanas deslizantes)
// ─────────────────────────────────────────────────────────────────────────────
class Limitador {
  constructor(ventanas) {
    this.ventanas = ventanas;
    this.marcas = [];
  }
  esperaNecesaria(ahora) {
    let espera = 0;
    for (const [ms, max] of this.ventanas) {
      const dentro = this.marcas.filter((t) => ahora - t < ms);
      if (dentro.length >= max) espera = Math.max(espera, dentro[dentro.length - max] + ms - ahora + 250);
    }
    return espera;
  }
  registrar(t) {
    this.marcas.push(t);
    const maxMs = Math.max(...this.ventanas.map(([ms]) => ms));
    this.marcas = this.marcas.filter((x) => t - x < maxMs);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Red
// ─────────────────────────────────────────────────────────────────────────────
function resolverUrl(u) {
  const limpia = u.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(limpia)) throw new Error("CHAT_WEB_URL debe empezar por https://");
  return /\/functions\/v1\//.test(limpia) ? limpia : `${limpia}/functions/v1/chat-web`;
}

async function enviar(url, key, cuerpo) {
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(60_000),
  });
  const texto = await res.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch { /* cuerpo no JSON */ }
  return { status: res.status, json, texto, ms: Date.now() - t0 };
}

class Abortar extends Error {}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluación determinista de una respuesta
// ─────────────────────────────────────────────────────────────────────────────
function evaluarTurno(turno, r, globales, horasValidas) {
  const fallos = [];
  const notas = [];
  const esp = turno.esperado ?? {};
  const body = r.json ?? {};
  // Se evalúa sobre el texto NORMALIZADO; el informe guarda el original.
  const texto = normalizarRespuesta(typeof body.respuesta === "string" ? body.respuesta : "");

  const successEsperado = esp.success_esperado ?? (esp.codigo_esperado ? false : true);
  if (body.success !== successEsperado) fallos.push(`success=${body.success}, se esperaba ${successEsperado}`);

  if (esp.codigo_esperado) {
    if (body.codigo !== esp.codigo_esperado) fallos.push(`codigo=${body.codigo ?? "(ninguno)"}, se esperaba ${esp.codigo_esperado}`);
  } else if (body.codigo) {
    fallos.push(`codigo inesperado: ${body.codigo}`);
  }
  if (!texto.trim()) fallos.push("respuesta vacía");

  for (const { fuente, re } of turno.re?.debe ?? []) if (re && !re.test(texto)) fallos.push(`no contiene /${fuente}/`);
  const alguno = (turno.re?.alguno ?? []).filter((x) => x.re);
  if (alguno.length && !alguno.some(({ re }) => re.test(texto))) {
    fallos.push(`no contiene ninguna de: ${alguno.map((x) => `/${x.fuente}/`).join(" | ")}`);
  }
  for (const { fuente, re } of [...(turno.re?.noDebe ?? []), ...globales]) {
    const m = re && texto.match(re);
    if (m) fallos.push(`contiene prohibido /${fuente}/ → "${m[0]}"`);
  }

  if (esp.idioma_esperado) {
    const d = detectarIdioma(texto);
    if (d.idioma === "indeterminado") notas.push(`idioma no concluyente (${JSON.stringify(d.puntos)})`);
    else if (d.idioma !== esp.idioma_esperado) {
      fallos.push(`idioma detectado ${d.idioma}, se esperaba ${esp.idioma_esperado} (${JSON.stringify(d.puntos)})`);
    }
  }
  if (esp.max_palabras) {
    const n = contarPalabras(texto);
    if (n > esp.max_palabras) fallos.push(`${n} palabras > máximo ${esp.max_palabras}`);
  }
  if (esp.solo_horas_validas) {
    const validas = new Set([...horasValidas, ...(esp.horas_extra ?? [])].map((h) => normHora(...h.split(":"))));
    const raras = extraerHoras(texto).filter((h) => !validas.has(h));
    if (raras.length) fallos.push(`horas no reales en la respuesta: ${raras.join(", ")}`);
  }
  return { fallos, notas };
}

// ─────────────────────────────────────────────────────────────────────────────
// Juez LLM (opcional)
// ─────────────────────────────────────────────────────────────────────────────
async function juzgar(p, transcripcion, hechos) {
  const modelo = process.env.JUEZ_MODELO || "gpt-5.6-luna";
  const sistema = `Eres un evaluador estricto de un chatbot de atención al cliente de un restaurante.
Recibes: los HECHOS verificados del restaurante, un CRITERIO de evaluación y la TRANSCRIPCIÓN.
Decide si la ÚLTIMA respuesta del bot (en contexto de la conversación) cumple el criterio.
Cualquier dato del restaurante que contradiga los HECHOS es un fallo. Los platos/vinos concretos no puedes
verificarlos: no penalices nombres de platos salvo que sean claramente genéricos o inventados según el contexto.
Contesta SOLO con JSON: {"veredicto":"PASS"|"FAIL","motivo":"<una frase en español>"}`;
  const usuario = `HECHOS:\n${Object.entries(hechos).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

CRITERIO:\n${p.criterio}

TRANSCRIPCIÓN:\n${transcripcion.map((t) => `[${t.rol}] ${t.texto}`).join("\n")}`;
  const cuerpo = {
    model: modelo,
    messages: [{ role: "system", content: sistema }, { role: "user", content: usuario }],
    response_format: { type: "json_object" },
    max_completion_tokens: 200,
  };
  if (/^gpt-5/.test(modelo)) cuerpo.reasoning_effort = "none";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`juez HTTP ${res.status}`);
  const json = await res.json();
  const out = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
  if (out.veredicto !== "PASS" && out.veredicto !== "FAIL") throw new Error("juez: veredicto ilegible");
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ejecución de un escenario
// ─────────────────────────────────────────────────────────────────────────────
async function ejecutarEscenario(p, ctx) {
  const { url, key, opts, limGlobal, horasValidas } = ctx;
  const limSesion = new Limitador(VENTANAS_SESION);
  const transcripcion = [];
  const turnosRes = [];
  let token = null;
  let estado = "PASS";
  const motivos = [];

  for (const [i, t] of p.turnos.entries()) {
    let r;
    for (let intento = 0; ; intento++) {
      // Espera: pausa fija + ventanas del limitador (global y de esta sesión).
      await dormir(opts.pausaMs);
      // Los escenarios sin_modelo se cortan antes de OpenAI y de los conteos
      // persistentes: no consumen las ventanas de ritmo.
      for (; !p.e.sin_modelo;) {
        const ahora = Date.now();
        const espera = Math.max(limGlobal.esperaNecesaria(ahora), limSesion.esperaNecesaria(ahora));
        if (espera <= 0) break;
        if (espera > 5000) process.stdout.write(`    … esperando ${Math.ceil(espera / 1000)} s (límites de ritmo)\n`);
        await dormir(espera);
      }
      if (!p.e.sin_modelo) {
        const ahora = Date.now();
        limGlobal.registrar(ahora);
        limSesion.registrar(ahora);
      }

      const cuerpo = { mensaje: t.mensaje, idiom: t.idiom };
      if (token) cuerpo.id = token;
      try {
        r = await enviar(url, key, cuerpo);
      } catch (e) {
        if (intento < 1) continue;
        throw new Abortar(`red: ${e.message}`);
      }
      const b = r.json ?? {};
      if (typeof b.sessionToken === "string") token = b.sessionToken;

      if ([401, 403, 404].includes(r.status)) {
        throw new Abortar(`HTTP ${r.status} de la pasarela (${r.texto.slice(0, 160)}). ` +
          "Revisa CHAT_WEB_URL/CHAT_WEB_KEY, que chat-web esté desplegada y verify_jwt vs. tipo de clave (ver README).");
      }
      if (r.status === 503 || b.codigo === "rate_limit_unavailable") {
        throw new Abortar("503 rate_limit_unavailable: el limitador/cupo no responde (¿migraciones chat_web_* aplicadas?).");
      }
      const esRapido = r.status === 429 || b.codigo === "rate_limited" || INFRA.rapido.test(b.respuesta ?? "");
      if (esRapido && intento < 2) {
        process.stdout.write("    … límite de ritmo del servidor, reintento en 65 s\n");
        await dormir(65_000);
        continue;
      }
      if (INFRA.generico.test(b.respuesta ?? "") && intento < 1) {
        process.stdout.write("    … error técnico (OpenAI/DB), reintento en 5 s\n");
        await dormir(5000);
        continue;
      }
      if (b.codigo === "cupo_agotado" && t.esperado?.codigo_esperado !== "cupo_agotado") {
        throw new Abortar("cupo_agotado: se ha alcanzado max_req_ip_hora / max_req_dia / presupuesto o el bot está " +
          "desactivado. Sube los topes en 'Protección y consumo' (ver README) y vuelve a lanzar.");
      }
      break;
    }

    const b = r.json ?? {};
    const texto = typeof b.respuesta === "string" ? b.respuesta : r.texto;
    transcripcion.push({ rol: "usuario", texto: t.mensaje.length > 300 ? `${t.mensaje.slice(0, 300)}… (${t.mensaje.length} caracteres)` : t.mensaje });
    transcripcion.push({ rol: "bot", texto });

    const infra = Object.entries(INFRA).find(([k, re]) => re.test(texto) && k !== "cupo");
    const ev = evaluarTurno(t, r, p.globales, horasValidas);
    if (infra) {
      estado = "INFRA";
      motivos.push(`turno ${i + 1}: respuesta de infraestructura (${infra[0]})`);
    } else if (ev.fallos.length) {
      if (estado === "PASS") estado = "FAIL";
      motivos.push(...ev.fallos.map((f) => `turno ${i + 1}: ${f}`));
    }
    turnosRes.push({ n: i + 1, idiom: t.idiom, status: r.status, ms: r.ms, codigo: b.codigo ?? null, success: b.success, respuesta: texto, fallos: ev.fallos, notas: ev.notas });
    if (estado === "INFRA") break;
  }

  let juez = null;
  if (opts.juez && p.criterio && estado !== "INFRA") {
    try {
      juez = await juzgar(p, transcripcion, ctx.hechos);
      if (juez.veredicto === "FAIL") {
        if (estado === "PASS") estado = "FAIL";
        motivos.push(`[juez] ${juez.motivo}`);
      }
    } catch (e) {
      juez = { veredicto: "ERROR", motivo: e.message };
    }
  }
  return { estado, motivos, turnos: turnosRes, juez, transcripcion };
}

// ─────────────────────────────────────────────────────────────────────────────
// Informes
// ─────────────────────────────────────────────────────────────────────────────
function resumir(resultados, clave) {
  const tabla = {};
  for (const r of resultados) {
    const k = r.e[clave];
    tabla[k] ??= { PASS: 0, FAIL: 0, INFRA: 0, SKIP: 0, "NO EJECUTADO": 0 };
    tabla[k][r.estado]++;
  }
  return tabla;
}

function tablaMd(titulo, tabla) {
  const filas = Object.entries(tabla).sort(([a], [b]) => a.localeCompare(b));
  let s = `### ${titulo}\n\n| ${titulo} | PASS | FAIL | INFRA | SKIP | No ejec. |\n|---|---:|---:|---:|---:|---:|\n`;
  for (const [k, v] of filas) s += `| ${k} | ${v.PASS} | ${v.FAIL} | ${v.INFRA} | ${v.SKIP} | ${v["NO EJECUTADO"]} |\n`;
  return s + "\n";
}

const citar = (t) => String(t ?? "").split("\n").map((l) => `> ${l}`).join("\n");

function informeMd(resultados, meta) {
  const tot = { PASS: 0, FAIL: 0, INFRA: 0, SKIP: 0, "NO EJECUTADO": 0 };
  resultados.forEach((r) => tot[r.estado]++);
  let s = `# Batería chat-web (Tomy) — ${meta.fecha}\n\n`;
  s += `- Endpoint: \`${meta.host}\`\n- Opciones: \`${meta.args || "(ninguna)"}\`\n- Juez LLM: ${meta.juez ? meta.juezModelo : "no"}\n`;
  s += `- Duración: ${Math.round(meta.duracionMs / 1000)} s\n`;
  if (meta.abortado) s += `- **ABORTADO**: ${meta.abortado}\n`;
  s += `\n**Total: ${tot.PASS} PASS · ${tot.FAIL} FAIL · ${tot.INFRA} INFRA · ${tot.SKIP} SKIP · ${tot["NO EJECUTADO"]} no ejecutados** (de ${resultados.length})\n\n`;
  s += tablaMd("categoria", resumir(resultados, "categoria"));
  s += tablaMd("idioma", resumir(resultados, "idioma"));

  const conProblema = resultados.filter((r) => r.estado === "FAIL" || r.estado === "INFRA");
  if (conProblema.length) {
    s += `## Fallos\n\n`;
    for (const r of conProblema) {
      s += `### ${r.estado} · ${r.e.id} (${r.e.idioma}/${r.e.categoria})\n\n${r.e.descripcion ?? ""}\n\n`;
      if (r.e.nota) s += `_Nota: ${r.e.nota}_\n\n`;
      s += r.motivos.map((m) => `- ${m}`).join("\n") + "\n\n";
      for (const t of r.transcripcion ?? []) s += `**${t.rol}:**\n\n${citar(t.texto)}\n\n`;
    }
  }
  s += `## Detalle\n\n| Estado | Id | Idioma | Categoría | Motivo principal |\n|---|---|---|---|---|\n`;
  for (const r of resultados) {
    const motivo = (r.motivos[0] ?? "").replace(/\|/g, "\\|").slice(0, 160);
    s += `| ${r.estado} | ${r.e.id} | ${r.e.idioma} | ${r.e.categoria} | ${motivo} |\n`;
  }
  s += `\n## Respuestas (PASS)\n\n`;
  for (const r of resultados.filter((x) => x.estado === "PASS")) {
    const ult = r.turnos?.[r.turnos.length - 1];
    s += `**${r.e.id}** — ${r.transcripcion?.[r.transcripcion.length - 2]?.texto ?? ""}\n\n${citar(ult?.respuesta)}\n\n`;
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.ayuda) {
    console.log(AYUDA);
    return 0;
  }
  const doc = await cargar();
  const { errores, avisos } = validar(doc);
  if (errores.length) {
    console.error(`✗ escenarios.json tiene ${errores.length} error(es):`);
    errores.forEach((e) => console.error(`  - ${e}`));
    return 2;
  }
  avisos.forEach((a) => console.warn(`  aviso: ${a}`));

  const plan = planificar(doc, opts);
  const est = estimar(plan, opts);
  const totalEsc = doc.escenarios.length;
  const porCat = {};
  const porIdioma = {};
  for (const p of plan) {
    porCat[p.e.categoria] = (porCat[p.e.categoria] ?? 0) + 1;
    porIdioma[p.e.idioma] = (porIdioma[p.e.idioma] ?? 0) + 1;
  }

  console.log(`\nescenarios.json OK · ${totalEsc} escenarios · seleccionados ${plan.length}` +
    `${opts.excluirCostosos ? " (costosos excluidos)" : ""}`);
  console.log(`  por categoría: ${Object.entries(porCat).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`  por idioma:    ${Object.entries(porIdioma).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`  peticiones: ${est.peticiones} (al modelo: ${est.alModelo}) · coste estimado ≈ $${est.coste.toFixed(3)} ` +
    `(peor caso ≈ $${(est.coste * COSTE_EST.factorPeor).toFixed(3)})` +
    (opts.juez ? ` + juez ${est.juez} llamadas ≈ $${est.costeJuez.toFixed(3)}` : ""));
  console.log(`  duración estimada ≈ ${Math.ceil(est.duracionMs / 60000)} min (pausa ${opts.pausaMs} ms, máx ${opts.max15min}/15 min)`);

  if (opts.dryRun) {
    console.log("\nPLAN (dry-run, sin red):");
    for (const p of plan) {
      const flags = [p.e.costoso && "costoso", p.e.limites && "limites", p.e.sin_modelo && "sin_modelo"].filter(Boolean);
      const skip = p.faltan.length ? `  SKIP (faltan: ${p.faltan.join(", ")})` : "";
      console.log(`  - ${p.e.id.padEnd(32)} ${p.e.idioma}/${p.e.categoria.padEnd(10)} ${String(p.turnos.length).padStart(2)} turno(s)` +
        `${flags.length ? ` [${flags.join(",")}]` : ""}${skip}`);
      const primero = p.turnos[0].mensaje;
      const vista = primero.length > 70 ? `${primero.slice(0, 70).replace(/\n/g, "⏎")}… (${primero.length} car.)` : primero.replace(/\n/g, "⏎");
      console.log(`      “${vista}”`);
    }
    console.log("\nDry-run completo: no se ha hecho ninguna petición.");
    return 0;
  }

  // ── Ejecución real ──
  if (!process.env.CHAT_WEB_URL || !process.env.CHAT_WEB_KEY) {
    console.error("Faltan CHAT_WEB_URL y/o CHAT_WEB_KEY (ver README.md). Usa --dry-run para validar sin red.");
    return 2;
  }
  if (opts.juez && !process.env.OPENAI_API_KEY) {
    console.error("--juez requiere OPENAI_API_KEY.");
    return 2;
  }
  const url = resolverUrl(process.env.CHAT_WEB_URL);
  const key = process.env.CHAT_WEB_KEY.trim();
  const host = new URL(url).host + new URL(url).pathname;
  console.log(`\nEndpoint: ${host} · clave: presente (no se muestra)\n`);

  // Los escenarios de límites van primero: necesitan terminar en < duracion_max_min.
  plan.sort((a, b) => Number(!!b.e.limites) - Number(!!a.e.limites));

  const ctx = {
    url, key, opts,
    limGlobal: new Limitador(VENTANAS_GLOBALES(opts.max15min)),
    horasValidas: doc._meta?.horas_validas ?? [],
    hechos: doc._meta?.hechos ?? {},
  };
  const t0 = Date.now();
  const resultados = [];
  let abortado = null;
  for (const p of plan) {
    if (abortado) {
      resultados.push({ e: p.e, estado: "NO EJECUTADO", motivos: [abortado], turnos: [], transcripcion: [] });
      continue;
    }
    if (p.faltan.length) {
      resultados.push({ e: p.e, estado: "SKIP", motivos: [`faltan variables: ${p.faltan.join(", ")}`], turnos: [], transcripcion: [] });
      console.log(`SKIP   ${p.e.id} (faltan ${p.faltan.join(", ")})`);
      continue;
    }
    process.stdout.write(`…      ${p.e.id} (${p.e.idioma}/${p.e.categoria}, ${p.turnos.length} turno(s))\n`);
    try {
      const r = await ejecutarEscenario(p, ctx);
      resultados.push({ e: p.e, ...r });
      console.log(`${r.estado.padEnd(6)} ${p.e.id}`);
      for (const m of r.motivos) console.log(`         - ${m}`);
      if (r.estado !== "PASS") {
        const ult = r.turnos[r.turnos.length - 1];
        if (ult) console.log(`         respuesta: ${String(ult.respuesta).replace(/\s+/g, " ").slice(0, 220)}`);
      }
    } catch (e) {
      if (!(e instanceof Abortar)) throw e;
      abortado = e.message;
      resultados.push({ e: p.e, estado: "INFRA", motivos: [e.message], turnos: [], transcripcion: [] });
      console.log(`INFRA  ${p.e.id}\n         - ${e.message}\n\nSe aborta el resto de la batería.`);
    }
  }

  // ── Resumen ──
  const tot = { PASS: 0, FAIL: 0, INFRA: 0, SKIP: 0, "NO EJECUTADO": 0 };
  resultados.forEach((r) => tot[r.estado]++);
  const imprimir = (titulo, tabla) => {
    console.log(`\n${titulo}`);
    for (const [k, v] of Object.entries(tabla).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${k.padEnd(11)} PASS ${v.PASS}  FAIL ${v.FAIL}  INFRA ${v.INFRA}  SKIP ${v.SKIP}${v["NO EJECUTADO"] ? `  no ejec. ${v["NO EJECUTADO"]}` : ""}`);
    }
  };
  imprimir("Por categoría:", resumir(resultados, "categoria"));
  imprimir("Por idioma:", resumir(resultados, "idioma"));
  console.log(`\nTOTAL: ${tot.PASS} PASS · ${tot.FAIL} FAIL · ${tot.INFRA} INFRA · ${tot.SKIP} SKIP · ${tot["NO EJECUTADO"]} no ejecutados`);

  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const fecha = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}_${pad(ahora.getHours())}${pad(ahora.getMinutes())}`;
  const rutaMd = opts.salida ? resolve(opts.salida) : join(__dirname, "resultados", `${fecha}.md`);
  await mkdir(dirname(rutaMd), { recursive: true });
  const meta = {
    fecha, host, args: process.argv.slice(2).join(" "), juez: opts.juez,
    juezModelo: process.env.JUEZ_MODELO || "gpt-5.6-luna", duracionMs: Date.now() - t0, abortado,
  };
  await writeFile(rutaMd, informeMd(resultados, meta), "utf8");
  const rutaJson = rutaMd.replace(/\.md$/i, "") + ".json";
  await writeFile(rutaJson, JSON.stringify({
    meta,
    resultados: resultados.map((r) => ({
      id: r.e.id, idioma: r.e.idioma, categoria: r.e.categoria, estado: r.estado,
      motivos: r.motivos, juez: r.juez ?? null, turnos: r.turnos,
    })),
  }, null, 2), "utf8");
  console.log(`\nInforme: ${rutaMd}\nJSON:    ${rutaJson}`);

  if (abortado || tot.INFRA) return 2;
  return tot.FAIL ? 1 : 0;
}

// Solo se ejecuta como script (permite importar las utilidades desde un test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error("Error inesperado:", e?.stack ?? e);
      process.exit(2);
    },
  );
}

export { validar, planificar, evaluarTurno, precioARegex, contarPalabras, sustituir };
