/**
 * Validadores de lo que propone la IA de textos de Instagram (Edge Function
 * instagram-ia), en el SERVIDOR, después del modelo y antes de devolver nada.
 * Lógica pura, sin red ni Deno: se prueba con vitest.
 *
 * Cada variante sale de aquí corregida o descartada:
 *   · se CORRIGE (y se avisa): emoji (se quitan), hashtags (se normalizan,
 *     sin repetidos, como mucho 12), texto alternativo de más de 1000
 *     caracteres (se recorta), CTA fuera de la lista cerrada (se quita);
 *   · se DESCARTA: límites de Instagram (2200 caracteres, 30 hashtags, 20
 *     menciones, contando caption + hashtags), precios que no son el de la
 *     base de datos, platos que no están en la carta, «sin gluten» y demás
 *     afirmaciones de alérgenos que no respaldan alergenos_oficiales o
 *     sin_gluten_disponible, «reservar» en TOUZA, datos personales (correos,
 *     teléfonos, DNI/NIE, IBAN, menciones a cuentas que no son de la marca),
 *     y en los rótulos, los límites de la plantilla (titular ≤ 6 palabras).
 *
 * Diseño: instagram-studio/propuesta/PROPUESTA.md, apartado 3.5.
 */
import { normalizarAlergeno, parseAlergenos, plegar, type AlergenoUE, ETIQUETA_ALERGENO } from "../../chat-web/alergenos.ts";
import { validarCaption } from "./validacion.ts";

export type MarcaIA = "casa-tomas" | "touza";

/** Plato de la carta tal como lo lee la función (tabla "Platos"). */
export interface PlatoContexto {
  id: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  precio_eur: number | null;
  unidad: string | null;
  alergenos_oficiales: unknown;
  sin_gluten_disponible: boolean;
  /**
   * Dietas CONFIRMADAS por el restaurante (Platos.etiquetas_dieteticas,
   * migración 20261104151000_platos_vegetarianos): 'vegetariano' y/o
   * 'vegano'. Sin la columna o null = sin confirmar.
   */
  etiquetas_dieteticas?: unknown;
}

/** Dietas confirmadas de un plato: «vegano» implica también «vegetariano». */
export function dietasConfirmadas(plato: Pick<PlatoContexto, "etiquetas_dieteticas"> | null): Set<"vegetariano" | "vegano"> {
  const s = new Set<"vegetariano" | "vegano">();
  const v = plato?.etiquetas_dieteticas;
  if (!Array.isArray(v)) return s;
  for (const x of v) {
    const k = typeof x === "string" ? x.trim().toLowerCase() : "";
    if (k === "vegano") {
      s.add("vegano");
      s.add("vegetariano");
    } else if (k === "vegetariano") s.add("vegetariano");
  }
  return s;
}

export interface ContextoValidacion {
  marca: MarcaIA;
  /** Plato de la pieza (foto «carta:<id>»), si lo hay. */
  plato: PlatoContexto | null;
  /** Nombres de los platos activos de la marca: lo que se puede citar. */
  nombresCarta: string[];
  /** Lista CERRADA de CTA de la guía de la marca. */
  ctas: string[];
  /** Cuentas de Instagram de la casa que sí se pueden mencionar (sin @). */
  cuentasPropias?: string[];
}

export const MAX_HASHTAGS_VARIANTE = 12;
export const MAX_ALT_TEXT = 1000;
export const MAX_PALABRAS_TITULAR = 6;
export const CUENTAS_PROPIAS = ["casatomascrevillent", "touzabar"];

// ── Emoji ────────────────────────────────────────────────────────────────────

// Pictogramas, banderas (indicadores regionales), selector de variación, ZWJ,
// tono de piel y el «keycap». © ® ™ también son Extended_Pictographic: fuera.
// (Alternativa y no clase de caracteres: eslint no-misleading-character-class.)
const RE_EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u{FE0F}|\u{FE0E}|\u{200D}|\u{20E3}/gu;

export function tieneEmoji(texto: string): boolean {
  RE_EMOJI.lastIndex = 0;
  return RE_EMOJI.test(texto);
}

/** Quita los emoji y los espacios que dejan. */
export function quitarEmoji(texto: string): string {
  return texto
    .replace(RE_EMOJI, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

// ── Precios ─────────────────────────────────────────────────────────────────

/** «22,5 €» (formato de la marca para impresión y redes). */
export function formatearPrecio(n: number): string {
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "").replace(".", ",");
  return `${s} €`;
}

const RE_PRECIO = /(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:€|eur(?:os?)?\b)|€\s*(\d{1,5}(?:[.,]\d{1,2})?)/giu;

/** Precios con aspecto de precio («22,5 €», «22.50 euros», «€22») del texto. */
export function preciosDelTexto(texto: string): number[] {
  const out: number[] = [];
  for (const m of texto.matchAll(RE_PRECIO)) {
    const n = Number((m[1] ?? m[2]).replace(",", "."));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Errores de precio: cualquier precio que no sea el precio_eur del plato de la pieza. */
export function erroresPrecio(texto: string, plato: PlatoContexto | null): string[] {
  const precios = preciosDelTexto(texto);
  const bueno = plato?.precio_eur ?? null;
  const malos = precios.filter((p) => bueno === null || Math.abs(p - bueno) > 0.005);
  if (malos.length) {
    return [`Precio que no viene de la carta (${malos.map(formatearPrecio).join(", ")}): los precios solo los pone el servidor.`];
  }
  if (!precios.length && /€|\beuros?\b/iu.test(texto)) return ["Habla de euros sin un precio de la carta."];
  return [];
}

// ── Alérgenos y dietas ──────────────────────────────────────────────────────

/** Alérgenos UE de alergenos_oficiales (null si no hay dato oficial). Solo los oficiales: nunca los inferidos. */
export function alergenosOficiales(plato: PlatoContexto | null): Set<AlergenoUE> | null {
  if (!plato) return null;
  const crudos = parseAlergenos(plato.alergenos_oficiales);
  if (!crudos.length) return null;
  const s = new Set<AlergenoUE>();
  for (const c of crudos) normalizarAlergeno(c).forEach((a) => s.add(a));
  return s;
}

/** Alérgenos oficiales legibles para el modelo (null = la carta no tiene el dato oficial). */
export function parseAlergenosOficiales(valor: unknown): string[] | null {
  const crudos = parseAlergenos(valor);
  if (!crudos.length) return null;
  const out = new Set<string>();
  for (const c of crudos) {
    const n = normalizarAlergeno(c);
    if (n.length) n.forEach((a) => out.add(ETIQUETA_ALERGENO[a]));
    else out.add(c);
  }
  return [...out];
}

// Palabras que introducen una afirmación de «no lleva»; y cabezas de términos
// de varias palabras («frutos secos», «productos lácteos», «cereales con gluten»).
const RE_NEGACION = /\b(?:sin|libres? de|exentos? de|apt[oa]s? para|free of|ideal para|perfect[oa]s? para)\s+((?:\p{L}+\s*){1,4})/gu;
const CABEZAS = new Set(["frutos", "fruto", "productos", "cereales", "granos", "semillas", "dioxido"]);
const ARTICULOS = new Set(["el", "la", "los", "las", "de", "del", "personas", "gente", "quienes", "intolerantes", "alergicos", "alergicas"]);
const RE_TODOS = /\b(?:sin|libres? de|apt[oa]s? para)\s+(?:(?:ningun|ningunos?)\s+)?(?:alergenos?|alergicos?|alergias?)\b/u;
const RE_CELIACOS = /\bceliac[oa]s?\b|\bceliaquia\b|\bgluten free\b|\bsin tacc\b/u;
const RE_LIBRE_DE = /\b(\p{L}+(?: \p{L}+)?) free\b/gu;
const RE_CONTIENE = /\b(?:contiene|contienen|lleva alergenos?|alergenos?)\s*:?\s+((?:\p{L}+\s*){1,4})/gu;
const RE_DIETA = /\b(?:vegan[oa]s?|vegetarian[oa]s?|plant based|keto|sin azucar(?:es)? anadid[oa]s?|bajo en calorias|light)\b/u;
const HASHTAGS_DIETA = /^(?:singluten|glutenfree|celiac[oa]s?|aptoceliacos|sinlactosa|lactosefree|sinalergenos|vegan[oa]?s?|vegetarian[oa]?s?|plantbased|realfood)$/u;

function alergenoTras(palabras: string[]): AlergenoUE[] {
  const limpias = palabras.filter((p) => p && !ARTICULOS.has(p));
  if (!limpias.length) return [];
  const [a, b, c] = limpias;
  const uno = normalizarAlergeno(a);
  if (uno.length) return uno;
  if (CABEZAS.has(a)) {
    for (const cand of [[a, b, c], [a, b]]) {
      const r = normalizarAlergeno(cand.filter(Boolean).join(" "));
      if (r.length) return r;
    }
  }
  return [];
}

/**
 * Afirmaciones de alérgenos o dietas que el texto hace y la base de datos no
 * respalda. Reglas (seguridad alimentaria, de más estricta a menos):
 *   · «sin gluten», «apto para celíacos», «gluten free»: solo si el plato de
 *     la pieza tiene sin_gluten_disponible o alergenos_oficiales (con dato)
 *     no incluye gluten;
 *   · «sin <alérgeno>»: solo si alergenos_oficiales (con dato) no lo incluye;
 *   · «contiene <alérgeno>»: solo si alergenos_oficiales lo incluye;
 *   · «vegetariano» (y #vegetariano): solo si el plato de la pieza tiene
 *     'vegetariano' o 'vegano' en etiquetas_dieteticas (confirmado por el
 *     restaurante en la carta, 20261104151000); «vegano», «plant based»:
 *     solo con 'vegano';
 *   · «sin alérgenos», «apto para alérgicos», «keto», «light»…: nunca (la
 *     carta no tiene ese dato).
 * Sin plato en el contexto, cualquier afirmación así es un error.
 */
export function erroresAlergenos(texto: string, plato: PlatoContexto | null, hashtags: string[] = []): string[] {
  const errores: string[] = [];
  const t = plegar(texto);
  const oficiales = alergenosOficiales(plato);
  const sinGlutenOk = !!plato && (plato.sin_gluten_disponible === true || (!!oficiales && !oficiales.has("gluten")));
  const nombre = plato?.nombre ? `«${plato.nombre}»` : "ningún plato";

  const negar = (alergenos: AlergenoUE[], frase: string) => {
    for (const a of alergenos) {
      const ok = a === "gluten" ? sinGlutenOk : !!oficiales && !oficiales.has(a);
      if (!ok) errores.push(`Dice «${frase}», pero los alérgenos oficiales de ${nombre} no lo respaldan (${ETIQUETA_ALERGENO[a]}).`);
    }
  };

  if (RE_TODOS.test(t)) errores.push("Dice que no tiene alérgenos o que es apto para alérgicos: no se puede afirmar.");
  for (const m of t.matchAll(RE_NEGACION)) {
    const palabras = m[1].trim().split(/\s+/);
    if (/^alergen|^alergic|^alergia/.test(palabras.find((p) => !ARTICULOS.has(p)) ?? "")) continue; // ya contado en RE_TODOS
    const al = alergenoTras(palabras);
    if (al.length) negar(al, m[0].trim());
  }
  if (RE_CELIACOS.test(t) && !sinGlutenOk) {
    errores.push(`Habla de celíacos o «gluten free», pero ${nombre} no consta como sin gluten.`);
  }
  for (const m of t.matchAll(RE_LIBRE_DE)) {
    const al = normalizarAlergeno(m[1]);
    if (al.length && !(al.length === 1 && al[0] === "gluten")) negar(al, m[0]);
  }
  for (const m of t.matchAll(RE_CONTIENE)) {
    const al = alergenoTras(m[1].trim().split(/\s+/));
    for (const a of al) {
      if (!oficiales?.has(a)) errores.push(`Dice que contiene ${ETIQUETA_ALERGENO[a]}, pero no está en los alérgenos oficiales de ${nombre}.`);
    }
  }
  const dietas = dietasConfirmadas(plato);
  // «vegetariano/a» y «vegano/a» solo con el dato confirmado en la carta; el resto, nunca.
  const dietaOk = (palabra: string): boolean =>
    /^vegetarian/.test(palabra) ? dietas.has("vegetariano") : /^vegan|^plant ?based/.test(palabra) ? dietas.has("vegano") : false;
  for (const m of t.matchAll(new RegExp(RE_DIETA.source, "gu"))) {
    if (dietaOk(m[0])) continue;
    errores.push(
      /^vegetarian|^vegan|^plant/.test(m[0])
        ? `Dice «${m[0]}», pero ${nombre} no consta como ${/^vegetarian/.test(m[0]) ? "vegetariano" : "vegano"} en la carta.`
        : `Dice «${m[0]}»: la carta no tiene ese dato y no se puede afirmar.`,
    );
    break;
  }
  for (const h of hashtags) {
    const k = plegar(h).replace(/\s+/g, "").replace(/^#/, "");
    if (!HASHTAGS_DIETA.test(k)) continue;
    const esGluten = /gluten|celiac/.test(k);
    if (esGluten && sinGlutenOk) continue;
    if (/^vegetarian/.test(k) && dietas.has("vegetariano")) continue;
    if (/^(?:vegan|plantbased)/.test(k) && dietas.has("vegano")) continue;
    errores.push(`El hashtag ${h} afirma algo de alérgenos o dieta que la carta no respalda.`);
  }
  return [...new Set(errores)];
}

// ── TOUZA no admite reservas ────────────────────────────────────────────────

/** «reservar», «reserva», «reservado»… en un texto; en hashtags también pegado («#ReservaYa»). */
export function mencionaReservar(texto: string, hashtags: string[] = []): boolean {
  return /\breserv/u.test(plegar(texto)) || hashtags.some((h) => plegar(h).includes("reserv"));
}

/** «Touza» → «TOUZA» (regla de marca), salvo el pueblo «A Touza». */
export function touzaEnMayusculas(texto: string): string {
  return texto.replace(/(?<![Aa] )\b[Tt]ouza\b/gu, "TOUZA");
}

// ── Datos personales ────────────────────────────────────────────────────────

const RE_EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+\.[\p{L}\p{N}.-]+/u;
const RE_TELEFONO = /(?:\+|00)\s*\d{2,3}[\s.-]*\d(?:[\s.-]*\d){6,11}|\b[6789](?:[\s.-]*\d){8}\b/u;
const RE_DNI = /\b[XYZ]?\d{7,8}[\s-]?[A-HJ-NP-TV-Z]\b/iu;
const RE_IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){4,7}\b/u;
const RE_MENCION = /(?:^|[^\p{L}\p{N}_.@])@([A-Za-z0-9._]{1,30})/gu;

export function erroresDatosPersonales(texto: string, cuentasPropias: string[] = CUENTAS_PROPIAS): string[] {
  const errores: string[] = [];
  if (RE_EMAIL.test(texto)) errores.push("Lleva un correo electrónico.");
  else {
    const ajenas = [...texto.matchAll(RE_MENCION)].map((m) => m[1].toLowerCase()).filter((c) => !cuentasPropias.includes(c));
    if (ajenas.length) errores.push(`Menciona cuentas que no son de la casa (${ajenas.map((c) => `@${c}`).join(", ")}).`);
  }
  if (RE_TELEFONO.test(texto)) errores.push("Lleva un número de teléfono.");
  if (RE_DNI.test(texto)) errores.push("Lleva algo con forma de DNI o NIE.");
  if (RE_IBAN.test(texto)) errores.push("Lleva algo con forma de cuenta bancaria.");
  return errores;
}

/** Quita correos, teléfonos, DNI/NIE e IBAN de un texto libre (las indicaciones del usuario) antes de enviarlo o guardarlo. */
export function anonimizar(texto: string): string {
  const g = (re: RegExp) => new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  return texto
    .replace(g(RE_EMAIL), "[correo]")
    .replace(g(RE_IBAN), "[cuenta]")
    .replace(g(RE_TELEFONO), "[teléfono]")
    .replace(g(RE_DNI), "[documento]");
}

// ── Platos que no existen ───────────────────────────────────────────────────

// Platos y productos concretos: si el texto nombra uno, tiene que estar en
// algún nombre de la carta de la marca. Lo genérico («marisco», «producto»,
// «pescado», «vino», «cóctel») no cuenta.
const PLATOS_CONOCIDOS = [
  "pulpo", "chuleton", "chuleta", "entrecot", "solomillo", "cachopo", "lacon", "cocido", "caldo gallego", "empanada",
  "croqueta", "zamburina", "vieira", "navaja", "percebe", "centolla", "necora", "bogavante", "langosta", "cigala",
  "gamba", "langostino", "carabinero", "ostra", "almeja", "mejillon", "berberecho", "merluza", "rodaballo", "lubina",
  "dorada", "bacalao", "rape", "lenguado", "salmon", "atun", "tartar", "carpaccio", "risotto", "arroz", "paella",
  "fideua", "alcachofa", "pimientos de padron", "tarta de santiago", "filloa", "flan", "torrija", "cecina", "jamon",
  "salazon", "mojama", "hueva", "lamprea", "calamar", "chipiron", "sepia", "callos", "tortilla", "helado", "coulant",
  "brownie", "tiramisu", "mousse",
] as const;

const plural = (s: string) => `${s}(?:s|es)?`;
const RE_CONOCIDOS = PLATOS_CONOCIDOS.map((p) => ({ plato: p, re: new RegExp(`\\b${p.split(" ").map(plural).join(" ")}\\b`, "u") }));

function singular(palabras: string): string {
  return palabras
    .split(" ")
    .map((p) => (p.length > 4 && p.endsWith("es") && !p.endsWith("ses") ? p.slice(0, -2) : p.length > 3 && p.endsWith("s") ? p.slice(0, -1) : p))
    .join(" ");
}

/** true si el nombre citado corresponde a un plato de la carta (comparación plegada y tolerante). */
export function platoEnCarta(citado: string, nombresCarta: string[]): boolean {
  const c = singular(plegar(citado));
  if (c.length < 3) return false;
  return nombresCarta.some((n) => {
    const k = singular(plegar(n));
    return k === c || (c.length >= 5 && k.includes(c)) || (k.length >= 5 && c.includes(k));
  });
}

export function erroresPlatos(texto: string, platosCitados: string[], ctx: Pick<ContextoValidacion, "nombresCarta">): string[] {
  const errores: string[] = [];
  for (const p of platosCitados) {
    if (p.trim() && !platoEnCarta(p, ctx.nombresCarta)) errores.push(`Cita «${p}», que no está en la carta.`);
  }
  const carta = ctx.nombresCarta.map((n) => plegar(n)).join(" | ");
  const t = plegar(texto);
  for (const { plato, re } of RE_CONOCIDOS) {
    const m = re.exec(t);
    if (m && !re.test(carta)) errores.push(`Habla de «${m[0]}», que no está en la carta.`);
  }
  return errores;
}

// ── Hashtags ────────────────────────────────────────────────────────────────

/** «#Casa Tomás» → «#CasaTomás»; sin emoji ni signos; sin repetidos (sin distinguir mayúsculas ni acentos). */
export function normalizarHashtags(lista: unknown[]): string[] {
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const h of lista) {
    if (typeof h !== "string") continue;
    const limpio = quitarEmoji(h).replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!limpio || limpio.length > 60 || /^\d+$/.test(limpio)) continue;
    const k = plegar(limpio).replace(/\s+/g, "");
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(`#${limpio}`);
  }
  return out;
}

function recortarPalabras(texto: string, max: number): string {
  const chars = [...texto];
  if (chars.length <= max) return texto;
  const corte = chars.slice(0, max).join("");
  const espacio = corte.lastIndexOf(" ");
  return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).replace(/[\s,;:.-]+$/, "")}.`;
}

// ── Variantes de texto (sugerir_texto) ─────────────────────────────────────

export interface VarianteTexto {
  caption: string;
  hashtags: string[];
  altText: string;
  gancho: string;
  platosCitados: string[];
}

export interface Revision<T> {
  ok: boolean;
  /** La variante ya corregida (si ok). */
  valor: T;
  /** Motivos de descarte. */
  errores: string[];
  /** Lo que se corrigió solo (se enseña como aviso). */
  correcciones: string[];
}

const texto = (v: unknown, max = 4000): string => (typeof v === "string" ? v.slice(0, max) : "");
const listaTextos = (v: unknown, max = 40): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : [];

/** Comprueba y corrige una variante de texto. Nunca lanza. */
export function revisarVarianteTexto(bruta: unknown, ctx: ContextoValidacion): Revision<VarianteTexto> {
  const o = (bruta && typeof bruta === "object" ? bruta : {}) as Record<string, unknown>;
  const correcciones: string[] = [];
  const errores: string[] = [];

  const crudos = {
    caption: texto(o.caption).trim(),
    gancho: texto(o.gancho, 500).trim(),
    altText: texto(o.alt_text ?? o.altText, 3000).trim(),
  };
  const hashtagsCrudos = listaTextos(o.hashtags);
  const algunEmoji = [crudos.caption, crudos.gancho, crudos.altText, ...hashtagsCrudos].some(tieneEmoji);
  const marcaTouza = (t: string) => (ctx.marca === "touza" ? touzaEnMayusculas(t) : t);
  let caption = marcaTouza(quitarEmoji(crudos.caption));
  const gancho = marcaTouza(quitarEmoji(crudos.gancho));
  let altText = marcaTouza(quitarEmoji(crudos.altText));
  if (algunEmoji) correcciones.push("Se han quitado los emoji (la marca no los usa).");

  let hashtags = normalizarHashtags(hashtagsCrudos);
  if (hashtags.length !== hashtagsCrudos.length) correcciones.push("Se han limpiado hashtags repetidos o mal escritos.");
  if (hashtags.length > MAX_HASHTAGS_VARIANTE) {
    hashtags = hashtags.slice(0, MAX_HASHTAGS_VARIANTE);
    correcciones.push(`Se han dejado ${MAX_HASHTAGS_VARIANTE} hashtags (los recomendados son de 5 a 12).`);
  }
  if ([...altText].length > MAX_ALT_TEXT) {
    altText = recortarPalabras(altText, MAX_ALT_TEXT);
    correcciones.push(`El texto alternativo se ha recortado a ${MAX_ALT_TEXT} caracteres.`);
  }
  caption = caption.replace(/\n{3,}/g, "\n\n");
  const platosCitados = listaTextos(o.platos_citados ?? o.platosCitados, 20).map((p) => p.trim()).filter(Boolean);

  if (!caption) errores.push("Sin texto.");
  if (!altText) errores.push("Sin texto alternativo.");
  const completo = hashtags.length ? `${caption}\n\n${hashtags.join(" ")}` : caption;
  errores.push(...validarCaption(completo).errores);

  const todo = [caption, gancho, altText].join("\n");
  errores.push(...erroresPrecio(`${todo}\n${hashtags.join(" ")}`, ctx.plato));
  errores.push(...erroresAlergenos(todo, ctx.plato, hashtags));
  if (ctx.marca === "touza" && mencionaReservar(todo, hashtags)) errores.push("TOUZA no admite reservas: no puede decir «reservar».");
  errores.push(...erroresDatosPersonales(todo, ctx.cuentasPropias));
  errores.push(...erroresPlatos(todo, platosCitados, ctx));

  return {
    ok: errores.length === 0,
    valor: { caption, hashtags, altText, gancho, platosCitados },
    errores: [...new Set(errores)],
    correcciones,
  };
}

// ── Rótulos (sugerir_rotulos) ──────────────────────────────────────────────

export type CampoRotulo = "antetitulo" | "titular" | "cita" | "cta" | "pie";
export const CAMPOS_ROTULO: readonly CampoRotulo[] = ["antetitulo", "titular", "cita", "cta", "pie"];
export type Rotulos = Partial<Record<CampoRotulo, string>>;

export interface PlantillaRotulos {
  id: string;
  marca: MarcaIA;
  /** Campos de texto que usa la plantilla (de CAMPOS_ROTULO). */
  campos: readonly CampoRotulo[];
  limites: Partial<Record<CampoRotulo, number>>;
  /** true si el titular puede ir vacío cuando hay cita. */
  titularOpcional?: boolean;
}

export function contarPalabras(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

/** Comprueba y corrige una propuesta de rótulos para una plantilla. Nunca lanza. */
export function revisarRotulos(bruta: unknown, plantilla: PlantillaRotulos, ctx: ContextoValidacion): Revision<Rotulos> {
  const o = (bruta && typeof bruta === "object" ? bruta : {}) as Record<string, unknown>;
  const correcciones: string[] = [];
  const errores: string[] = [];
  const valor: Rotulos = {};
  let emoji = false;
  for (const campo of plantilla.campos) {
    const crudo = texto(o[campo], 500).trim();
    if (tieneEmoji(crudo)) emoji = true;
    const sinEmoji = quitarEmoji(crudo).replace(/\s+/g, " ");
    const limpio = ctx.marca === "touza" ? touzaEnMayusculas(sinEmoji) : sinEmoji;
    if (limpio) valor[campo] = limpio;
  }
  if (emoji) correcciones.push("Se han quitado los emoji (la marca no los usa).");

  if (valor.cta) {
    const k = plegar(valor.cta);
    const buena = ctx.ctas.find((c) => plegar(c) === k);
    if (buena) valor.cta = buena;
    else {
      correcciones.push(`Se ha quitado la llamada a la acción «${valor.cta}»: no está en la lista de la marca.`);
      delete valor.cta;
    }
  }
  if (!valor.titular && !(plantilla.titularOpcional && valor.cita)) errores.push("Sin titular.");
  if (valor.titular && contarPalabras(valor.titular) > MAX_PALABRAS_TITULAR) {
    errores.push(`El titular tiene ${contarPalabras(valor.titular)} palabras; el máximo es ${MAX_PALABRAS_TITULAR}.`);
  }
  for (const campo of plantilla.campos) {
    const max = plantilla.limites[campo];
    const v = valor[campo];
    if (v && max && [...v].length > max) errores.push(`«${campo}» tiene ${[...v].length} caracteres; el máximo de la plantilla es ${max}.`);
  }

  const todo = Object.values(valor).join("\n");
  errores.push(...erroresPrecio(todo, ctx.plato));
  errores.push(...erroresAlergenos(todo, ctx.plato));
  if (ctx.marca === "touza" && mencionaReservar(todo)) errores.push("TOUZA no admite reservas: no puede decir «reservar».");
  errores.push(...erroresDatosPersonales(todo, ctx.cuentasPropias));
  errores.push(...erroresPlatos(todo, [], ctx));
  return { ok: errores.length === 0, valor, errores: [...new Set(errores)], correcciones };
}
