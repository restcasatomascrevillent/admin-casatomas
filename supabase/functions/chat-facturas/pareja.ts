// ============================================================================
//  chat-facturas · ¿es el mismo producto? Reglas fijas (auditoría 16/11/2026)
// ----------------------------------------------------------------------------
//  TS puro (sin Deno): corre bajo vitest.
//
//  La auditoría de la tarifa real (2.669 artículos) encontró que la IA de
//  confirmación (gpt-4.1-mini) daba por «mismo producto y formato» parejas
//  como «Hendrick's Lunar» = «Hendrick's», «Beefeater 0,0 %» = «Beefeater»,
//  «Mini 5 cl» = «70 cl», «Mateus Rosé» = «Laurent-Perrier Rosé», una cerveza
//  = «Envase retornable caja cerveza» o una lata de bonito = «Bonito del norte
//  6-8 kg». Estas reglas NO dependen del modelo y se aplican siempre:
//    - otro_producto: sin alcohol / sin gluten / zero frente a la normal,
//      colores (tinto, blanco, rosado, rojo), etiquetas (negra, roja, azul…),
//      edades (5, 12, 15 años), crianza/reserva/gran reserva, sabores
//      (limón, mango, café, hierbas…) o envases/palets/descuentos;
//    - formato_distinto: otro tamaño de envase (5 cl, 70 cl, 1 l, magnum) u
//      otra añada (2012 frente a 2018);
//    - dudosa: la tarifa trae una palabra que identifica el producto (marca,
//      edición, variedad) que no sale en ninguna factura de ese producto. No se
//      descarta, pero tampoco se compara como seguro: sale en «Revisar».
// ============================================================================
import { contenidoCanonico } from "./presupuesto.ts";

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Texto en minúsculas, sin acentos y con las abreviaturas de tarifa desplegadas. */
export function normalizarParaComparar(s: string): string {
  let t = ` ${sinAcentos(String(s ?? "")).toLowerCase()} `;
  t = t
    .replace(/\be\s*\/\s*n\b/g, " black ")
    .replace(/\be\s*\/\s*r(oja)?\b/g, " red ")
    .replace(/\be\s*\/\s*azuli?\b/g, " blue ")
    .replace(/\be\s*\/\s*verde\b/g, " green ")
    .replace(/\b(blue|black|red|green|gold)\s+label\b/g, " $1 ")
    .replace(/\betiqueta\s+(negra)\b/g, " black ")
    .replace(/\betiqueta\s+(roja)\b/g, " red ")
    .replace(/\betiqueta\s+(azul)\b/g, " blue ")
    .replace(/\betiqueta\s+(verde)\b/g, " green ")
    .replace(/\bs\s*\/\s*a\b|\bsin\s+alcohol\b|\b0[,.]0\s*%?|(?<![\d,.])0\s*%/g, " sinalcohol ")
    .replace(/\bc\s*\/\s*a\b/g, " ")
    .replace(/\bs\s*\/\s*glut(en)?\b|\bsin\s+gluten\b|\bgluten\s+free\b/g, " singluten ")
    .replace(/\bsugar\s+free\b|\bsin\s+azucar\b/g, " zero ")
    .replace(/\bg\s*\.\s*rva\b|\bgran\s+reserva\b|\bg\s*\.\s*reserva\b/g, " granreserva ")
    .replace(/\brva\b|\brvas\b/g, " reserva ")
    .replace(/\bcza\b/g, " crianza ")
    .replace(/\bbco\b/g, " blanco ")
    .replace(/\b(rose|rosato|rosado|rosada|rosa)\b/g, " rosado ")
    .replace(/\bblanc\b|\bbianco\b/g, " blanco ")
    .replace(/\ba\s*\/\s*o\b|\baceite\s+de\s+oliva\b/g, " oliva ")
    .replace(/\ba\s*\/\s*v\b|\baceite\s+vegetal\b/g, " vegetal ")
    .replace(/\ba\s*\/\s*girasol\b/g, " girasol ")
    .replace(/\b(ro|ol|rr)\s*-?\s*(\d{2,4})\b/g, " lata$1$2 ")
    .replace(/\bnum\s*\.\s*(\d)|\bn\s*[º°o]\s*\.?\s*(\d)/g, " $1$2 ")
    .replace(/\bextra\s*viejo\b|\bextraviejo\b/g, " extraviejo ")
    .replace(/\bcapitan\b/g, " captain ")
    // Grados («40º», «14,5%»), cajas de reparto («C6», «P3+1», «caja 24») y rangos («6-8 kg», «18/24»): no identifican el producto.
    .replace(/\d+(?:[.,]\d+)?\s*(?:º|°|%|grados)/g, " ")
    .replace(/(?:^|\s)[cp]\s*\d{1,3}(?:\s*\+\s*\d{1,2})?(?=\s|$|\))/g, " ")
    .replace(/\b(?:caja|cajas|pack|bandeja|estuche)\s+(?:de\s+)?\d+\b/g, " ")
    .replace(/\b\d+\s*[-/]\s*\d+\b/g, " ")
    .replace(/[^a-z0-9ñ.,/%]+/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

// ─── Grupos de marcas de variante ───────────────────────────────────────────
/** Si uno lo dice y el otro no, es otro producto. */
const PRESENCIA: Record<string, string> = {
  sinalcohol: "sin alcohol", singluten: "sin gluten", zero: "zero", rosado: "rosado", xo: "XO", xr: "XR", double: "Double",
  black: "etiqueta negra (Black)", red: "etiqueta roja (Red)", blue: "etiqueta azul (Blue)", green: "etiqueta verde (Green)", gold: "Gold",
};
const COLORES = new Set(["tinto", "blanco", "rosado", "rojo"]);
/** Aceite o caldo de una conserva. */
const GOBIERNO = new Set(["oliva", "vegetal", "girasol", "escabeche", "natural"]);
const ETIQUETAS = new Set(["black", "red", "blue", "green", "gold"]);
const CRIANZAS = new Set(["joven", "roble", "crianza", "reserva", "granreserva", "reposado", "anejo", "silver", "plata", "extraviejo"]);
const SABORES = new Set([
  "limon", "lima", "naranja", "mango", "fresa", "melocoton", "manzana", "pomelo", "citron", "citrus", "peach", "pears",
  "raspberri", "raspberry", "vanilia", "vainilla", "berri", "berry", "watermelon", "sandia", "apple", "honey", "fire",
  "blackberry", "pink", "spiced", "coco", "pina", "mandarin", "mandarina", "cafe", "hierbas", "crema", "miel", "menta",
  "cacao", "tabasco", "grapefruit", "mojito", "passionfruit", "chocolate", "avellana", "pistacho", "melon", "cereza",
  "mora", "frambuesa", "cola", "ginger", "picosa", "neptunia", "lunar", "orbium", "amazonia", "cabaret",
]);
const ENVASES = new Set(["envase", "envases", "palet", "descuento", "deposito", "fianza"]);

/** Palabras que no identifican un producto (tipo, relleno, logística de la tarifa). */
const GENERICAS = new Set([
  // tipos de producto
  "vino", "vinos", "tinto", "blanco", "rosado", "cava", "champan", "champagne", "cha", "gin", "ginebra", "ron", "whisky",
  "whiskey", "vodka", "tequila", "mezcal", "licor", "brandy", "anis", "orujo", "vermouth", "vermut", "cerveza", "agua",
  "refresco", "tonica", "zumo", "aceite", "atun", "bonito", "conserva", "espumoso", "aguardiente", "single", "malt",
  "dry", "london", "premium", "premiun", "seco", "dulce", "brut", "nature", "extra", "claro", "oliva", "virgen", "girasol",
  "natural", "escabeche", "gas", "con", "sin", "energy", "drink", "bitter", "jamaicano", "gaseosa", "sidra", "cider",
  "barrica", "meses", "years", "old", "year", "anos", "ano",
  // logística y presentación
  "ref", "nref", "rosca", "nacional", "cris", "cristal", "pet", "hucha", "estuche", "vaso", "impor", "stick", "iglu",
  "reto", "bandeja", "etiquetar", "madera", "caja", "lata", "botella", "botellin", "pack", "horeca", "vidrio", "bolsa",
  "petaca", "mini", "magnum", "edicion", "label", "black", "red", "blue", "green", "gold", "sinalcohol", "singluten",
  "zero", "gratis", "nuevo", "nueva", "litro", "litros", "unidad", "unidades", "sabor", "tarro", "brik", "envase",
  "anonima", "medalla", "oro", "cwsa", "mejor", "mundo", "del", "the", "and",
  "original", "japanese", "cuvee", "crianza", "roble", "selecto", "superior",
  "los", "las", "con", "para", "por", "sabor",
]);

/** Contenido de UN envase según el nombre (sin multiplicar paquetes): 70 cl, 1 l, magnum, 3/8. */
export function envaseDelNombre(nombre: string): { cantidad: number | null; unidad: "kg" | "l" | "ud" | null } {
  const s = sinAcentos(String(nombre ?? "")).toLowerCase();
  const m = s.match(/(?<![\d/.,])(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|grs?|g|gramos|l|lt|lts|litros?|cl|ml)(?![a-z])/i);
  if (m) {
    let txt = m[1];
    const u = m[2].toLowerCase();
    // «2,100GR» o «1,015ML» son miles, no decimales.
    if (/^(g|grs?|gramos|ml)$/.test(u) && /^\d{1,2}[.,]\d{3}$/.test(txt)) txt = txt.replace(/[.,]/, "");
    const n = Number(txt.replace(",", "."));
    const uni = /^k/.test(u) ? "kg" : /^g/.test(u) ? "g" : /^(l|lt|lts|litro|litros)$/.test(u) ? "l" : u === "cl" ? "cl" : "ml";
    return contenidoCanonico(n, uni);
  }
  const f = s.match(/(?:^|[\s(])([1-3])\/([2-8])(?:\s*l\b)?(?=[\s)]|$)/);
  if (f && Number(f[1]) < Number(f[2])) return { cantidad: Math.round((Number(f[1]) / Number(f[2])) * 1000) / 1000, unidad: "l" };
  if (/\bmagnum\b/.test(s)) return { cantidad: 1.5, unidad: "l" };
  return { cantidad: null, unidad: null };
}

/** Edades («12A», «15 años», «12YO»). */
function edades(t: string): Set<number> {
  const out = new Set<number>();
  for (const m of t.matchAll(/(?:^|\s)(\d{1,2})\s*(?:a|anos|ano|yo|y\.o\.)(?=\s|$)/g)) out.add(Number(m[1]));
  return out;
}

/** Añadas (1950-2049). */
function anadas(t: string): Set<number> {
  const out = new Set<number>();
  for (const m of t.matchAll(/(?:^|\s)(19[5-9]\d|20[0-4]\d)(?=\s|$)/g)) out.add(Number(m[1]));
  return out;
}

function palabras(t: string): string[] {
  return t.split(/[^a-z0-9ñ]+/).filter((w) => (w.length >= 3 || w === "xo" || w === "xr") && !/\d/.test(w));
}

/** Números de modelo («1866», «904», «Nº 3», el 12 de Larios 12): ni tamaños, ni grados, ni edades, ni meses, ni añadas. */
function numerosDeModelo(t: string): Set<number> {
  const out = new Set<number>();
  for (const m of t.matchAll(/(?:^|\s)(\d{1,4})(?=\s|$)/g)) {
    const n = Number(m[1]);
    const resto = t.slice((m.index ?? 0) + m[0].length);
    if (/^\s*(meses|mes|anos|ano|a|yo|kg|g|gr|grs|l|cl|ml|lt|litros?|uds?|u|unid|unidades|rollos|sobres|bot|botellas|latas|piezas|m|cm|mm)(\s|$)/.test(resto)) continue;
    if (n >= 1950 && n <= 2049) continue;
    out.add(n);
  }
  return out;
}

/** Códigos de lata de conserva (RO-900, OL120, RR125). */
const latas = (t: string) => new Set(t.match(/lata(ro|ol|rr)\d{2,4}/g) ?? []);

/** Distancia de edición ≤ 1 (artic/arctic). */
function casiIgual(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++dif > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}

const conjunto = (t: string, grupo: Set<string>) => new Set(palabras(t).filter((w) => grupo.has(w)));
const disjuntos = (a: Set<unknown>, b: Set<unknown>) => a.size > 0 && b.size > 0 && ![...a].some((x) => b.has(x));
const lista = (s: Set<unknown>) => [...s].join(", ");

/** ¿La palabra sale (o casi: plural, «gaudas»/«gauda», «premiun»/«premium») en el conjunto? */
function aparece(w: string, en: Set<string>): boolean {
  if (en.has(w)) return true;
  // Abreviaturas de tarifa: «manz» = manzanilla, «tempranil» = tempranillo.
  if (w.length >= 4) for (const x of en) if (x.length >= 4 && (x.startsWith(w) || w.startsWith(x))) return true;
  if (w.length < 5) return false;
  for (const x of en) {
    if (x.length >= 5 && ((x.startsWith(w.slice(0, 5)) && Math.abs(x.length - w.length) <= 2) || casiIgual(w, x))) return true;
  }
  return false;
}

/** Envase de referencia del producto del catálogo: el del nombre o, si no lo dice, el tamaño más repetido en las facturas. */
export function envaseDeReferencia(catalogo: string, compras: string[] = []): { cantidad: number | null; unidad: "kg" | "l" | "ud" | null } {
  const fc = envaseDelNombre(catalogo);
  if (fc.cantidad !== null) return fc;
  const cuenta = new Map<string, { n: number; v: ReturnType<typeof envaseDelNombre> }>();
  for (const n of compras) {
    const v = envaseDelNombre(n);
    if (v.cantidad === null) continue;
    const k = `${v.cantidad}${v.unidad}`;
    cuenta.set(k, { n: (cuenta.get(k)?.n ?? 0) + 1, v });
  }
  return [...cuenta.values()].sort((a, b) => b.n - a.n)[0]?.v ?? fc;
}

/** ¿La tarifa y el catálogo dicen el tamaño del envase y es el mismo? (entonces «C6 frente a C12» o «1 L frente a 70 cl» mal leídos no pesan). */
export function tamanoVerificado(tarifa: string, catalogo: string, compras: string[] = []): boolean {
  const ft = envaseDelNombre(tarifa);
  const fc = envaseDeReferencia(catalogo, compras);
  return ft.cantidad !== null && fc.cantidad !== null && ft.unidad === fc.unidad && Math.abs(ft.cantidad - fc.cantidad) / fc.cantidad <= 0.04;
}

/** El catálogo ni sus facturas dicen el tamaño del envase («Ginebra Tanqueray Ten»): no se puede verificar, solo sugerir. */
export function tamanoDesconocido(catalogo: string, compras: string[] = []): boolean {
  return envaseDeReferencia(catalogo, compras).cantidad === null;
}

export interface Conflicto {
  tipo: "otro_producto" | "formato_distinto" | "dudosa";
  motivo: string;
}

const formatoLegible = (c: { cantidad: number | null; unidad: string | null }) => {
  if (c.cantidad === null || !c.unidad) return "?";
  if (c.unidad === "l") return c.cantidad < 1 ? `${Math.round(c.cantidad * 1000) / 10} cl` : `${String(c.cantidad).replace(".", ",")} l`;
  if (c.unidad === "kg") return c.cantidad < 1 ? `${Math.round(c.cantidad * 1000)} g` : `${String(c.cantidad).replace(".", ",")} kg`;
  return `${c.cantidad} ud`;
};

/**
 * ¿La línea de la tarifa y el producto del catálogo son el mismo producto y el
 * mismo formato? `compras` son los nombres con que ese producto sale en las
 * facturas. Devuelve el primer conflicto (el más grave primero) o null.
 */
export function conflictoDePareja(tarifa: string, catalogo: string, compras: string[] = []): Conflicto | null {
  const t = normalizarParaComparar(tarifa);
  const c = normalizarParaComparar(catalogo);
  const todas = [c, ...compras.map(normalizarParaComparar)];
  const u = todas.join(" | ");
  const pt = new Set(palabras(t));
  const pc = new Set(palabras(c));
  const pu = new Set(palabras(u));

  // 1. Presencia: sin alcohol, sin gluten, zero, rosado, XO, Double.
  for (const [k, dicho] of Object.entries(PRESENCIA)) {
    if (pt.has(k) && !pu.has(k)) return { tipo: "otro_producto", motivo: `la tarifa es ${dicho} y lo que compras no` };
    if (pc.has(k) && !pt.has(k)) return { tipo: "otro_producto", motivo: `lo que compras es ${dicho} y la tarifa no` };
  }
  // 2. Envases, palets y descuentos solo casan entre sí.
  const envT = [...pt].some((w) => ENVASES.has(w));
  const envC = [...pc].some((w) => ENVASES.has(w));
  if (envT !== envC) return { tipo: "otro_producto", motivo: envC ? "lo que compras es el envase o un descuento, no el producto" : "la tarifa es un envase o un palet" };
  // 3. Color, etiqueta, crianza y edad: si los dos lo dicen, tiene que coincidir.
  const grupos: Array<[Set<string>, string]> = [[COLORES, "color"], [ETIQUETAS, "etiqueta"], [CRIANZAS, "crianza"], [GOBIERNO, "conserva en"]];
  for (const [g, nombre] of grupos) {
    const a = conjunto(t, g);
    const b = conjunto(u, g);
    if (disjuntos(a, b)) return { tipo: "otro_producto", motivo: `${nombre} distinto: ${lista(a)} frente a ${lista(b)}` };
  }
  const et = edades(t);
  const eu = new Set(todas.flatMap((x) => [...edades(x)]));
  if (disjuntos(et, eu)) return { tipo: "otro_producto", motivo: `edad distinta: ${lista(et)} años frente a ${lista(eu)}` };
  // Números de modelo: los del catálogo tienen que estar en la tarifa y al revés.
  const nt = numerosDeModelo(t);
  const nc = numerosDeModelo(c);
  const nu = new Set(todas.flatMap((x) => [...numerosDeModelo(x)]));
  const sinN = [...nc].filter((n) => !nt.has(n));
  const sobraN = [...nt].filter((n) => !nu.has(n));
  if (sinN.length > 0 || sobraN.length > 0) {
    return { tipo: "otro_producto", motivo: sinN.length ? `lo que compras es «${sinN.join(", ")}» y la tarifa no` : `la tarifa es «${sobraN.join(", ")}» y lo que compras no` };
  }
  // 4. Sabores: el de la tarifa tiene que salir en las compras, y el del catálogo en la tarifa.
  const st = conjunto(t, SABORES);
  const su = conjunto(u, SABORES);
  const sc = conjunto(c, SABORES);
  const faltaT = [...st].filter((w) => !su.has(w));
  if (faltaT.length > 0) return { tipo: "otro_producto", motivo: `la tarifa es ${faltaT.join(", ")} y lo que compras no` };
  const faltaC = [...sc].filter((w) => !st.has(w));
  if (faltaC.length > 0) return { tipo: "otro_producto", motivo: `lo que compras es ${faltaC.join(", ")} y la tarifa no` };
  // 5. Formato: tamaño del envase y añada.
  const ft = envaseDelNombre(tarifa);
  let fc = envaseDelNombre(catalogo);
  if (fc.cantidad === null) {
    // El catálogo no lo dice: el tamaño más repetido en las facturas.
    const cuenta = new Map<string, { n: number; v: ReturnType<typeof envaseDelNombre> }>();
    for (const n of compras) {
      const v = envaseDelNombre(n);
      if (v.cantidad === null) continue;
      const k = `${v.cantidad}${v.unidad}`;
      cuenta.set(k, { n: (cuenta.get(k)?.n ?? 0) + 1, v });
    }
    const mejor = [...cuenta.values()].sort((a, b) => b.n - a.n)[0];
    if (mejor) fc = mejor.v;
  }
  if (ft.cantidad !== null && fc.cantidad !== null &&
      (ft.unidad !== fc.unidad || Math.abs(ft.cantidad - fc.cantidad) / fc.cantidad > 0.04)) {
    return { tipo: "formato_distinto", motivo: `${formatoLegible(ft)} frente a ${formatoLegible(fc)}` };
  }
  // Latas de conserva: el código (RO-900, OL120) o el peso tienen que casar.
  const lt = latas(t);
  const lc = latas(c);
  const codigo = (x: Set<string>) => [...x].join(", ").replace(/lata/g, "").toUpperCase();
  if (lc.size > 0 && (disjuntos(lt, lc) || (lt.size === 0 && ft.cantidad !== null))) {
    return { tipo: "formato_distinto", motivo: `lata ${codigo(lt) || formatoLegible(ft)} frente a ${codigo(lc)}` };
  }
  if (lt.size > 0 && lc.size === 0 && fc.cantidad !== null) {
    return { tipo: "formato_distinto", motivo: `lata ${codigo(lt)} frente a ${formatoLegible(fc)}` };
  }
  // Mini o petaca contra un producto sin tamaño conocido: no es el mismo envase.
  if (/\b(mini|petaca)\b/.test(t) && !/\b(mini|petaca)\b/.test(u) && fc.cantidad === null) {
    return { tipo: "formato_distinto", motivo: `${/\bmini\b/.test(t) ? "mini" : "petaca"} de ${formatoLegible(ft)} frente a la botella que compras` };
  }
  const at = anadas(t);
  const ac = anadas(c);
  if (disjuntos(at, ac)) return { tipo: "formato_distinto", motivo: `añada ${lista(at)} frente a ${lista(ac)}` };
  // 6. Palabras que identifican el producto (marca, edición, variedad) y no salen en ninguna compra.
  if (pc.has("blanco") !== pt.has("blanco") && (pc.has("blanco") || !pu.has("blanco"))) {
    return { tipo: "dudosa", motivo: pc.has("blanco") ? "lo que compras es blanco y la tarifa no lo dice" : "la tarifa es blanco y lo que compras no lo dice" };
  }
  const extra = palabras(t).filter((w) => !GENERICAS.has(w) && !SABORES.has(w) && !aparece(w, pu));
  if (extra.length > 0) {
    return { tipo: "dudosa", motivo: `la tarifa dice «${extra.slice(0, 3).join(" ")}» y tus facturas de «${catalogo}» no` };
  }
  const extraC = palabras(c).filter((w) => !GENERICAS.has(w) && !SABORES.has(w) && !aparece(w, pt));
  if (extraC.length > 0) {
    return { tipo: "dudosa", motivo: `lo que compras es «${catalogo}» y la tarifa no dice «${extraC.slice(0, 3).join(" ")}»` };
  }
  return null;
}
