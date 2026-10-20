// ============================================================================
//  Normalizador de alérgenos para chat-web (TS puro, sin imports de Deno).
// ----------------------------------------------------------------------------
//  Copia adaptada del vocabulario de `src/lib/alergenos.ts` del panel (las Edge
//  Functions no pueden importar de src/). Si se cambia el vocabulario allí,
//  revisar también este archivo.
//
//  PROBLEMA QUE RESUELVE (seguridad alimentaria): el filtro excluir_alergenos
//  comparaba cadenas EXACTAS. En la carta hay valores como `frutos_cascara`,
//  `crustaceos` o `frutos de cáscara`, y el modelo pide "frutos secos", "nuts",
//  "marisco", "fruits à coque", "gluten-free"... Nada coincidía y el bot podía
//  recomendar como apto un plato con el alérgeno.
//
//  DIFERENCIA DELIBERADA con src/lib/alergenos.ts: allí `marisco` NO se mapea
//  (decisión de almacenamiento: no inventar información al guardar). Aquí el
//  uso es EXCLUIR, y en esa dirección lo seguro es ampliar: "marisco" /
//  "seafood" / "fruits de mer" = crustáceos + moluscos, y "frutos secos" /
//  "nuts" / "fruits secs" = frutos de cáscara + cacahuetes. Excluir de más solo
//  cuesta una sugerencia; excluir de menos puede costar una reacción alérgica.
// ============================================================================

/** Claves canónicas de los 14 alérgenos UE (Reglamento 1169/2011). */
export const ALERGENOS_UE = [
  "gluten",
  "crustaceos",
  "huevos",
  "pescado",
  "cacahuetes",
  "frutos_cascara",
  "lacteos",
  "apio",
  "mostaza",
  "sesamo",
  "sulfitos",
  "altramuces",
  "moluscos",
  "soja",
] as const;

export type AlergenoUE = typeof ALERGENOS_UE[number];

/** Etiqueta legible (español) para mostrar al modelo. */
export const ETIQUETA_ALERGENO: Record<AlergenoUE, string> = {
  gluten: "gluten",
  crustaceos: "crustáceos",
  huevos: "huevos",
  pescado: "pescado",
  cacahuetes: "cacahuetes",
  frutos_cascara: "frutos de cáscara",
  lacteos: "lácteos",
  apio: "apio",
  mostaza: "mostaza",
  sesamo: "sésamo",
  sulfitos: "sulfitos",
  altramuces: "altramuces",
  moluscos: "moluscos",
  soja: "soja",
};

// Palabras que rodean al alérgeno en una petición ("sin gluten", "gluten-free",
// "allergic to nuts", "sans lactose"...). Se quitan antes de buscar.
const RUIDO = new Set([
  "sin", "libre", "libres", "de", "del", "la", "el", "los", "las", "alergia", "alergico", "alergica",
  "intolerancia", "intolerante", "apto", "apta", "para", "con", "y",
  "free", "without", "no", "allergy", "allergic", "to", "intolerance", "intolerant", "the", "and",
  "sans", "allergie", "allergique", "au", "aux", "a", "du", "des", "le", "les", "et", "intolerant",
]);

/**
 * Sinónimos es/en/fr (ya plegados: sin acentos, minúsculas, espacios simples).
 * Una entrada puede apuntar a VARIOS canónicos (términos paraguas).
 */
const SINONIMOS: Record<string, AlergenoUE[]> = {};
function reg(canonicos: AlergenoUE[], ...terminos: string[]) {
  for (const t of terminos) {
    // Se registra el término plegado y también sin palabras de ruido
    // ("fruits de mer" -> "fruits mer"), que es como queda una petición
    // tipo "allergie aux fruits de mer" tras limpiarla.
    const k = plegar(t);
    for (const clave of new Set([k, sinRuido(k)])) {
      if (!clave) continue;
      const previos = SINONIMOS[clave] ?? [];
      SINONIMOS[clave] = Array.from(new Set([...previos, ...canonicos]));
    }
  }
}

/**
 * Reduce un texto a una clave comparable: sin acentos, minúsculas, `_`/`-`
 * como espacios, sin espacios repetidos. "Frutos_Cáscara " == "frutos cascara".
 */
export function plegar(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[_\-/]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Vocabulario ────────────────────────────────────────────────────────────
reg(["gluten"],
  "gluten", "cereales con gluten", "cereales que contengan gluten", "trigo", "harina", "celiaco", "celiaca",
  "celiacos", "celiaquia", "wheat", "celiac", "coeliac", "ble", "farine", "celiaque", "cereales contenant du gluten");
reg(["crustaceos"],
  "crustaceos", "crustaceo", "crustaceans", "crustacean", "shellfish crustaceans", "crustaces", "crustace",
  "gambas", "gamba", "langostinos", "cigalas", "bogavante", "cangrejo", "shrimp", "prawns", "lobster", "crab",
  "crevettes", "homard", "crabe");
reg(["huevos"], "huevos", "huevo", "egg", "eggs", "oeuf", "oeufs");
reg(["pescado"], "pescado", "pescados", "fish", "poisson", "poissons");
reg(["cacahuetes"],
  "cacahuetes", "cacahuete", "cacahuates", "cacahuate", "mani", "peanut", "peanuts", "arachide", "arachides",
  "cacahouete", "cacahouetes");
reg(["frutos_cascara"],
  "frutos de cascara", "fruto de cascara", "frutos cascara", "fruto cascara", "nueces", "almendras", "avellanas",
  "pistachos", "anacardos", "tree nuts", "tree nut", "almonds", "hazelnuts", "walnuts", "cashews", "pistachios",
  "fruits a coque", "fruit a coque", "noix", "amandes", "noisettes");
// Términos paraguas coloquiales: incluyen también los cacahuetes (ver cabecera).
reg(["frutos_cascara", "cacahuetes"], "frutos secos", "fruto seco", "nuts", "nut", "fruits secs", "fruit sec");
reg(["lacteos"],
  "lacteos", "lacteo", "leche", "lactosa", "productos lacteos", "queso", "nata", "mantequilla", "milk", "dairy",
  "lactose", "cheese", "butter", "cream", "lait", "laitiers", "produits laitiers", "fromage", "beurre", "creme");
reg(["apio"], "apio", "celery", "celeri");
reg(["mostaza"], "mostaza", "mustard", "moutarde");
reg(["sesamo"],
  "sesamo", "sesamos", "granos de sesamo", "semillas de sesamo", "ajonjoli", "sesame", "sesame seeds",
  "graines de sesame");
reg(["sulfitos"],
  "sulfitos", "sulfito", "dioxido de azufre", "dioxido de azufre y sulfitos", "so2", "sulphites", "sulfites",
  "sulphite", "sulfite", "sulphur dioxide", "sulfur dioxide", "anhydride sulfureux");
reg(["altramuces"], "altramuces", "altramuz", "lupin", "lupins", "lupine");
reg(["moluscos"],
  "moluscos", "molusco", "molluscs", "mollusks", "mollusc", "mollusk", "mollusques", "mollusque", "mejillones",
  "almejas", "calamar", "calamares", "sepia", "pulpo", "berberechos", "ostras", "navajas", "mussels", "clams",
  "squid", "octopus", "oysters", "moules", "palourdes", "calmar", "poulpe", "huitres");
reg(["soja"], "soja", "sojas", "soya", "soy", "soybean", "soybeans");
// Paraguas: marisco = crustáceos + moluscos.
reg(["crustaceos", "moluscos"],
  "marisco", "mariscos", "seafood", "shellfish", "fruits de mer", "fruit de mer");

function sinRuido(clavePlegada: string): string {
  return clavePlegada.split(" ").filter((p) => p && !RUIDO.has(p)).join(" ");
}

function singularizar(clave: string): string {
  return clave
    .split(" ")
    .map((p) => (p.length <= 3 ? p : p.endsWith("es") ? p.slice(0, -2) : p.endsWith("s") ? p.slice(0, -1) : p))
    .join(" ");
}

function buscar(clave: string): AlergenoUE[] | null {
  if (!clave) return null;
  if (SINONIMOS[clave]) return SINONIMOS[clave];
  const s = singularizar(clave);
  for (const [k, v] of Object.entries(SINONIMOS)) {
    if (singularizar(k) === s) return v;
  }
  return null;
}

/**
 * Normaliza UN término (guardado en BD o pedido por el modelo) a sus claves
 * UE canónicas. Devuelve [] si no lo reconoce (alérgeno "personalizado").
 */
export function normalizarAlergeno(valor: unknown): AlergenoUE[] {
  if (typeof valor !== "string") return [];
  const plegado = plegar(valor);
  if (!plegado) return [];
  const directo = buscar(plegado);
  if (directo) return [...directo];
  // Quitar palabras de ruido: "gluten free" -> "gluten", "sin lactosa" -> "lactosa".
  const limpio = sinRuido(plegado);
  const tras = buscar(limpio);
  if (tras) return [...tras];
  // Última red: alguna palabra suelta o bigrama reconocible ("alergia marisco grave").
  const palabras = limpio.split(" ").filter(Boolean);
  const encontrados = new Set<AlergenoUE>();
  for (let i = 0; i < palabras.length; i++) {
    for (const cand of [palabras.slice(i, i + 3).join(" "), palabras.slice(i, i + 2).join(" "), palabras[i]]) {
      const r = buscar(cand);
      if (r) {
        r.forEach((a) => encontrados.add(a));
        break;
      }
    }
  }
  return Array.from(encontrados);
}

/**
 * Lee `alergenos_oficiales` / `alergenos_inferidos` venga como venga: array de
 * textos, objeto `{ gluten: true }`, texto JSON o texto suelto (separado por
 * comas o punto y coma). Devuelve los valores crudos limpios de vacíos.
 */
export function parseAlergenos(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const texto = value.trim();
    if (!texto) return [];
    try {
      const parsed = JSON.parse(texto);
      if (Array.isArray(parsed) || (parsed && typeof parsed === "object")) return parseAlergenos(parsed);
    } catch {
      // no era JSON
    }
    return texto.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, activo]) => Boolean(activo))
      .map(([k]) => k.trim())
      .filter(Boolean);
  }
  return [];
}

export interface InfoAlergenos {
  /** false = la fila no trae NINGÚN dato de alérgenos: nunca presentarla como apta. */
  conocido: boolean;
  /** Claves UE canónicas presentes. */
  ue: AlergenoUE[];
  /** Valores que no son de los 14 UE (texto original), p.ej. "alcohol". */
  otros: string[];
}

/** Alérgenos de una fila de Platos/Vinos: oficiales si hay; si no, inferidos. */
export function alergenosDeFila(row: Record<string, unknown>): InfoAlergenos {
  const oficiales = parseAlergenos(row?.alergenos_oficiales);
  const crudos = oficiales.length ? oficiales : parseAlergenos(row?.alergenos_inferidos);
  const ue = new Set<AlergenoUE>();
  const otros: string[] = [];
  for (const c of crudos) {
    const n = normalizarAlergeno(c);
    if (n.length) n.forEach((a) => ue.add(a));
    else if (!otros.some((o) => plegar(o) === plegar(c))) otros.push(c);
  }
  return { conocido: crudos.length > 0, ue: ALERGENOS_UE.filter((a) => ue.has(a)), otros };
}

export interface PeticionExclusion {
  ue: Set<AlergenoUE>;
  /** Términos pedidos que no son de los 14 UE: se comparan en texto plegado. */
  otros: string[];
  /** Términos pedidos no reconocidos (para avisar al modelo). */
  noReconocidos: string[];
}

export function prepararExclusion(pedidos: unknown): PeticionExclusion {
  const lista = Array.isArray(pedidos) ? pedidos : typeof pedidos === "string" ? [pedidos] : [];
  const ue = new Set<AlergenoUE>();
  const otros: string[] = [];
  const noReconocidos: string[] = [];
  for (const p of lista) {
    if (typeof p !== "string" || !p.trim()) continue;
    const n = normalizarAlergeno(p);
    if (n.length) n.forEach((a) => ue.add(a));
    else {
      const limpio = sinRuido(plegar(p));
      if (limpio) otros.push(limpio);
      noReconocidos.push(p.trim());
    }
  }
  return { ue, otros, noReconocidos };
}

/** true si la fila CONTIENE alguno de los alérgenos pedidos (según sus datos). */
export function contieneAlguno(info: InfoAlergenos, excl: PeticionExclusion): boolean {
  if (info.ue.some((a) => excl.ue.has(a))) return true;
  if (!excl.otros.length) return false;
  return info.otros.some((o) => {
    const po = plegar(o);
    return excl.otros.some((x) => po.includes(x) || x.includes(po));
  });
}

export const SIN_INFO_ALERGENOS = "sin información de alérgenos";

/** Representación para el modelo: etiquetas legibles o el aviso de sin datos. */
export function alergenosParaModelo(info: InfoAlergenos): string[] | string {
  if (!info.conocido) return SIN_INFO_ALERGENOS;
  return [...info.ue.map((a) => ETIQUETA_ALERGENO[a]), ...info.otros];
}
