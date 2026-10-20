// ============================================================================
//  busqueda-carta.ts — búsqueda tolerante de platos/vinos para las tools de
//  chat-web (TS puro, sin Deno: se prueba con vitest).
//
//  POR QUÉ (eval carta-precio-multiturno-es, 2026-09-26): en la carta los
//  arroces se llaman "Con mero", "De rape"... dentro de la categoría
//  "Arroces melosos". En el turno 2 ("¿cuánto cuesta el primero?") el modelo
//  solo tiene el TEXTO del turno anterior (no el resultado de la tool) y
//  llama a consultar_carta con busqueda "arroz con mero": el filtro antiguo
//  hacía `nombre.includes("arroz con mero")` y devolvía 0 platos → "no
//  encuentro ese arroz". Además "arroz" no casaba con la categoría "Arroces"
//  (plural en -ces) ni viceversa.
//
//  Ahora la búsqueda es por PALABRAS, sin acentos, sin palabras vacías y con
//  un plegado de plurales simétrico, sobre nombre + categoría + descripción
//  (+ ingredientes), en el idioma del widget y en español.
// ============================================================================

export type IdiomaBusqueda = "es" | "en" | "fr";

/** Minúsculas, sin acentos (NFD) y sin espacios sobrantes. */
export function plegarTexto(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Palabras vacías es/en/fr (ya plegadas). No aportan nada a "arroz con mero".
const VACIAS = new Set([
  // es
  "de", "del", "la", "las", "el", "los", "lo", "un", "una", "unos", "unas", "con", "sin", "y", "e", "o", "a",
  "al", "en", "por", "para", "que", "ese", "esa", "este", "esta", "plato", "platos",
  // en
  "the", "of", "with", "and", "or", "an", "in", "on", "for", "dish", "dishes",
  // fr
  "le", "les", "du", "des", "au", "aux", "et", "avec", "un", "une", "plat", "plats",
]);

/**
 * Raíz aproximada, aplicada IGUAL a lo buscado y a lo guardado (por eso basta
 * con que sea consistente, no lingüísticamente perfecta):
 *   arroces→arroz, arroz→arroz, postres/postre→postr, calamares/calamar→calamar,
 *   melosos/meloso→meloso, dishes/dish→dish.
 */
export function raiz(palabra: string): string {
  let w = plegarTexto(palabra);
  if (w.length <= 3) return w;
  if (w.endsWith("ces")) w = `${w.slice(0, -3)}z`;
  else if (w.endsWith("s")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** Palabras significativas (raíces) de un texto libre. */
export function terminos(texto: unknown): string[] {
  return plegarTexto(texto)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !VACIAS.has(w))
    .map(raiz)
    .filter((w) => w.length >= 2);
}

function campo(row: Record<string, unknown>, nombre: string, idiom: IdiomaBusqueda): unknown[] {
  const vals: unknown[] = [row[nombre]];
  if (idiom !== "es") vals.push(row[`${nombre}_${idiom}`]);
  return vals;
}

function terminosDe(row: Record<string, unknown>, nombres: string[], idiom: IdiomaBusqueda): Set<string> {
  const out = new Set<string>();
  for (const n of nombres) for (const v of campo(row, n, idiom)) for (const t of terminos(v)) out.add(t);
  return out;
}

// Un término buscado casa con una palabra guardada si son iguales o si la
// guardada empieza por él (≥ 4 letras: "lang" → "langosta", pero "de" no).
function casaTermino(q: string, guardados: Set<string>): boolean {
  if (guardados.has(q)) return true;
  if (q.length < 4) return false;
  for (const g of guardados) if (g.startsWith(q)) return true;
  return false;
}

/**
 * ¿La categoría de la fila coincide con lo pedido? Tolerante a acentos y
 * plurales: "arroz" / "arroces" / "Arroces melosos" coinciden entre sí.
 */
export function coincideCategoria(row: Record<string, unknown>, idiom: IdiomaBusqueda, q: unknown): boolean {
  const pedidos = terminos(q);
  if (!pedidos.length) return true;
  const guardados = terminosDe(row, ["categoria"], idiom);
  return pedidos.every((t) => casaTermino(t, guardados));
}

export interface ResultadoBusqueda<T> {
  filas: T[];
  /** "completa": todas las palabras; "parcial": solo algunas (ninguna fila las tenía todas). */
  coincidencia: "completa" | "parcial" | "ninguna";
}

/**
 * Busca en nombre + categoría + descripción + ingredientes. Primero exige
 * TODAS las palabras; si ninguna fila las tiene todas, devuelve las que
 * tienen alguna, marcadas como coincidencia "parcial" (el llamador avisa al
 * modelo para que no las presente como el plato pedido). Orden: más palabras
 * casadas y, a igualdad, las que casan en el NOMBRE primero.
 */
export function buscarFilas<T extends Record<string, unknown>>(
  rows: T[],
  idiom: IdiomaBusqueda,
  busqueda: unknown,
  campos: { principal: string[]; secundarios: string[] } = {
    principal: ["nombre"],
    secundarios: ["categoria", "descripcion", "ingredientes"],
  },
): ResultadoBusqueda<T> {
  const pedidos = [...new Set(terminos(busqueda))];
  if (!pedidos.length) return { filas: rows, coincidencia: "completa" };

  const puntuadas = rows.map((row, i) => {
    const enNombre = terminosDe(row, campos.principal, idiom);
    const enResto = terminosDe(row, campos.secundarios, idiom);
    let casados = 0;
    let enNombreN = 0;
    for (const t of pedidos) {
      if (casaTermino(t, enNombre)) {
        casados++;
        enNombreN++;
      } else if (casaTermino(t, enResto)) casados++;
    }
    return { row, i, casados, enNombreN };
  });

  const ordenar = (a: typeof puntuadas[number], b: typeof puntuadas[number]) =>
    b.casados - a.casados || b.enNombreN - a.enNombreN || a.i - b.i;

  const completas = puntuadas.filter((p) => p.casados === pedidos.length).sort(ordenar);
  if (completas.length) return { filas: completas.map((p) => p.row), coincidencia: "completa" };

  const parciales = puntuadas.filter((p) => p.casados > 0).sort(ordenar);
  if (parciales.length) return { filas: parciales.map((p) => p.row), coincidencia: "parcial" };
  return { filas: [], coincidencia: "ninguna" };
}
