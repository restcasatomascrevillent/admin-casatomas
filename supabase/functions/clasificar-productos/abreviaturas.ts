// ============================================================================
//  abreviaturas.ts · Diccionario de abreviaturas por proveedor (sin Deno)
// ----------------------------------------------------------------------------
//  La tabla abreviaturas_proveedor (migración 20261209300000) se llena sola al
//  enlazar líneas con productos. Aquí se filtra lo fiable, se compacta para el
//  prompt de la IA y se usa como red de seguridad: si el modelo devuelve un
//  nombre que empieza por la abreviatura («LP La Cuvée»), se expande.
// ============================================================================

export interface AbreviaturaFila {
  proveedor_id: number;
  abreviatura: string;
  expansion: string;
  origen: "aprendida" | "manual" | string;
  veces: number;
  en_nombre: boolean;
}

export type AbreviaturasPorProveedor = Map<number, { abreviatura: string; expansion: string }[]>;

/** Máximo de abreviaturas por proveedor que se mandan a la IA (las más vistas). */
export const MAX_ABREVIATURAS_POR_PROVEEDOR = 40;

const sinTildes = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Solo lo fiable: lo manual, lo aprendido por iniciales del nombre (en_nombre)
 * o lo visto 2 veces o más. Si una abreviatura de un proveedor tiene dos
 * expansiones distintas, gana la más vista solo si le saca el doble; si no, se
 * descarta (es ambigua).
 */
export function abreviaturasActivas(filas: AbreviaturaFila[]): AbreviaturasPorProveedor {
  const fiables = filas.filter((f) =>
    f.abreviatura && f.expansion && (f.origen === "manual" || f.en_nombre || f.veces >= 2));
  const grupos = new Map<string, AbreviaturaFila[]>();
  for (const f of fiables) {
    const k = `${f.proveedor_id}|${f.abreviatura.toLowerCase()}`;
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  const res: AbreviaturasPorProveedor = new Map();
  const elegidas: AbreviaturaFila[] = [];
  for (const g of grupos.values()) {
    g.sort((a, b) => (b.origen === "manual" ? 1 : 0) - (a.origen === "manual" ? 1 : 0) || b.veces - a.veces);
    if (g.length > 1 && g[0].origen !== "manual" && g[0].veces < g[1].veces * 2) continue;
    elegidas.push(g[0]);
  }
  elegidas.sort((a, b) => b.veces - a.veces || a.abreviatura.localeCompare(b.abreviatura));
  for (const f of elegidas) {
    const lista = res.get(f.proveedor_id) ?? [];
    if (lista.length >= MAX_ABREVIATURAS_POR_PROVEEDOR) continue;
    lista.push({ abreviatura: f.abreviatura.toLowerCase(), expansion: f.expansion });
    res.set(f.proveedor_id, lista);
  }
  return res;
}

/** «Gambín: LP=Laurent-Perrier; SC=Sierra Cantabria» — una línea por proveedor, sin adornos. */
export function compactarAbreviaturas(
  abreviaturas: AbreviaturasPorProveedor,
  nombresProveedor: Map<number, string>,
): string {
  const lineas: string[] = [];
  for (const [id, lista] of abreviaturas) {
    const nombre = nombresProveedor.get(id);
    if (!nombre || lista.length === 0) continue;
    lineas.push(`${nombre}: ${lista.map((a) => `${a.abreviatura.toUpperCase()}=${a.expansion}`).join("; ")}`);
  }
  return lineas.join("\n");
}

/**
 * Red de seguridad: «LP La Cuvée 75 cl» → «Laurent-Perrier La Cuvée 75 cl» si LP
 * es una abreviatura conocida de ese proveedor. Solo la primera palabra (con o
 * sin punto) y solo si el nombre no empieza ya por la expansión. Las palabras
 * que la expansión ya contiene no se repiten: «Coca Cola Zero» → «Coca-Cola Zero»
 * (no «Coca-Cola Cola Zero»), «Juve & Camps Reserva» → «Juve&Camps Reserva».
 */
export function expandirAbreviaturaInicial(
  nombre: string,
  lista: { abreviatura: string; expansion: string }[] | undefined,
): string {
  if (!lista?.length) return nombre;
  const m = /^\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+)\.?(?:\s+|$)(.*)$/.exec(nombre);
  if (!m) return nombre;
  const hallada = lista.find((a) => a.abreviatura === sinTildes(m[1]));
  if (!hallada) return nombre;
  const resto = m[2].trim();
  if (sinTildes(resto).startsWith(sinTildes(hallada.expansion))) return resto ? resto : nombre;
  // Palabras de la expansión (Coca-Cola → coca, cola) frente a las del nombre tras la abreviatura.
  const palabras = (t: string) => [...t.matchAll(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+/g)]
    .map((x) => ({ n: sinTildes(x[0]), fin: (x.index ?? 0) + x[0].length }));
  const exp = palabras(hallada.expansion).map((p) => p.n);
  const nom = palabras(nombre);
  let usadas = 1;                                  // la propia abreviatura
  let j = nom[0].n.length >= 3 && exp[0]?.startsWith(nom[0].n) ? 1 : 0;   // «coca» ya es el comienzo de «coca»
  while (j < exp.length && usadas < nom.length && nom[usadas].n === exp[j]) { usadas++; j++; }
  const sobra = nombre.slice(nom[usadas - 1].fin).replace(/^[\s.&,-]+/, "").trim();
  return sobra ? `${hallada.expansion} ${sobra}` : hallada.expansion;
}

/** Espejo de abreviaturas_token_generico (SQL): lo que NO es una marca (envase, familia, calidad, partículas). */
const GENERICOS = new Set((
  "bot bota botella botellas bt btl caja cajas cja cza cb ud uds und unid un pack pk kg kgs gr grs lt lts litro litros cl ml mg mag magnum " +
  "sin cargo ret retornable bandeja cha champagne champan cava vino vinos tinto tto blanco bco rosado licor lc gin ginebra ron whisky whiskey " +
  "vodka tequila brandy cognac anis cerveza refresco infusion agua mezcal rva rv reserva crianza cr gran extra ex brut nature rose mm " +
  "de del la el los las le les du des the and con por varios"
).split(" "));
export const esTokenGenerico = (t: string): boolean => t.length < 2 || /^[0-9]/.test(t) || GENERICOS.has(t);

const PARTICULAS = new Set("de del la el los las y e i the le les du des da do di von van of".split(" "));

/** ¿Encaja la expansión con la abreviatura? Iniciales de las palabras (sin partículas) o comienzo de la primera (3+ letras). */
export function abreviaturaPlausible(token: string, expansion: string): boolean {
  const partes = sinTildes(expansion).split(/[\s-]+/).map((p) => p.replace(/[^a-z]/g, "")).filter((p) => p.length >= 2 && !PARTICULAS.has(p));
  if (partes.length === 0) return false;
  const iniciales = partes.map((p) => p[0]).join("");
  return iniciales === token || (token.length >= 3 && partes[0].length > token.length && partes[0].startsWith(token));
}

export interface PropuestaAbreviatura {
  proveedor_id: number;
  abreviatura: string;
  propuesta: string;
  texto: string;
}

/**
 * Abreviaturas NUEVAS que el modelo ha visto en las líneas: el token tiene que estar en el texto de la
 * línea, no ser genérico ni conocido del proveedor y la expansión tiene que encajar con él. Una por
 * proveedor y abreviatura. La base de datos vuelve a comprobarlo todo (y no avisa dos veces).
 */
export function extraerAbreviaturasNuevas(
  respuesta: unknown,
  textos: { texto: string; proveedor_id?: number | null }[],
  conocidas: AbreviaturasPorProveedor = new Map(),
): PropuestaAbreviatura[] {
  const lista = (respuesta as { asignaciones?: unknown })?.asignaciones;
  if (!Array.isArray(lista)) return [];
  const pedidos = new Map(textos.map((t) => [t.texto, t]));
  const vistas = new Set<string>();
  const res: PropuestaAbreviatura[] = [];
  for (const a of lista as { texto?: unknown; abreviatura?: { token?: unknown; expansion?: unknown } | null }[]) {
    const pedido = typeof a?.texto === "string" ? pedidos.get(a.texto) : undefined;
    const ab = a?.abreviatura;
    if (!pedido || pedido.proveedor_id == null || !ab || typeof ab.token !== "string" || typeof ab.expansion !== "string") continue;
    const token = sinTildes(ab.token).replace(/\./g, "").trim();
    const expansion = ab.expansion.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!/^[a-z]{2,6}$/.test(token) || esTokenGenerico(token) || expansion.length < 3) continue;
    if (!sinTildes(pedido.texto).split(/[^a-z0-9]+/).includes(token)) continue;
    if (!abreviaturaPlausible(token, expansion)) continue;
    if (conocidas.get(pedido.proveedor_id)?.some((k) => k.abreviatura === token)) continue;
    const clave = `${pedido.proveedor_id}|${token}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    res.push({ proveedor_id: pedido.proveedor_id, abreviatura: token, propuesta: expansion, texto: pedido.texto });
  }
  return res;
}
