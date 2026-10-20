// Vocabulario canónico de alérgenos
// ---------------------------------------------------------------------------
// PROBLEMA QUE RESUELVE
// El panel ofrecía casillas con IDs en snake_case sin acentos
// (`crustaceos`, `frutos_cascara`, `huevo`, `sesamo`) mientras que en la base
// de datos los valores están guardados como etiquetas en español con acentos
// (`crustáceos`, `frutos de cáscara`, `huevos`, `sésamo`). Resultado: al abrir
// un plato para editarlo, sus alérgenos no coincidían con ninguna casilla, se
// clasificaban como "personalizados" y, si se marcaba la casilla oficial, se
// guardaban LAS DOS formas — duplicados que además se publican en la web.
//
// POR QUÉ EL CANÓNICO ES LA ETIQUETA EN ESPAÑOL Y NO EL snake_case
// Las webs públicas imprimen el valor crudo de la columna: casa-tomas-story
// (`src/components/carta/ProductoCard.tsx`) solo le aplica un `capitalizar`
// que pone la primera letra en mayúscula. Guardar `frutos_cascara` haría que
// la web mostrase literalmente "Frutos_cascara". La forma legible con acentos
// es además la que YA predomina en los datos, así que normalizar hacia ella
// deja la mayoría de filas intactas.
//
// TOLERANCIA
// `normalizarAlergeno` acepta ambas formas y además mayúsculas, acentos,
// guiones bajos, espacios sobrantes y singular/plural. Lo que no reconoce
// (p. ej. `alcohol`, `carne`, `marisco`) NO se toca: se conserva tal cual como
// alérgeno personalizado. En concreto `marisco` se deja a propósito fuera del
// mapa porque en castellano cubre a la vez crustáceos y moluscos: asignarlo a
// uno perdería información y asignarlo a los dos se la inventaría. Es una
// decisión que corresponde al dueño de la carta.
// ---------------------------------------------------------------------------

export interface AlergenoOficial {
  /** Valor canónico: lo que se guarda en BD y lo que muestran las webs. */
  id: string;
  /** Etiqueta para la interfaz del panel. */
  label: string;
}

/** Los 14 alérgenos de declaración obligatoria (Reglamento UE 1169/2011). */
export const ALERGENOS_OFICIALES: AlergenoOficial[] = [
  { id: "gluten", label: "Gluten" },
  { id: "crustáceos", label: "Crustáceos" },
  { id: "huevos", label: "Huevos" },
  { id: "pescado", label: "Pescado" },
  { id: "cacahuetes", label: "Cacahuetes" },
  { id: "frutos de cáscara", label: "Frutos de cáscara" },
  { id: "lácteos", label: "Lácteos" },
  { id: "apio", label: "Apio" },
  { id: "mostaza", label: "Mostaza" },
  { id: "sésamo", label: "Sésamo" },
  { id: "sulfitos", label: "Sulfitos" },
  { id: "altramuces", label: "Altramuces" },
  { id: "moluscos", label: "Moluscos" },
  { id: "soja", label: "Soja" },
];

/**
 * Sinónimos aceptados por cada alérgeno canónico. Se listan sin acentos y en
 * minúsculas porque se comparan ya "plegados" (ver `plegar`), e incluyen a
 * propósito tanto el singular como el plural: el desplegable de `singularizar`
 * es solo una red de seguridad para formas que nadie previó.
 */
const SINONIMOS: Record<string, string[]> = {
  gluten: ["gluten", "cereales con gluten", "cereales que contengan gluten"],
  crustáceos: ["crustaceos", "crustaceo"],
  huevos: ["huevos", "huevo"],
  pescado: ["pescado", "pescados"],
  cacahuetes: ["cacahuetes", "cacahuete", "cacahuates", "cacahuate", "mani"],
  "frutos de cáscara": [
    "frutos de cascara",
    "fruto de cascara",
    "frutos cascara",
    "fruto cascara",
    "frutos secos",
    "fruto seco",
    "nueces",
  ],
  lácteos: ["lacteos", "lacteo", "leche", "lactosa", "productos lacteos"],
  apio: ["apio"],
  mostaza: ["mostaza"],
  sésamo: [
    "sesamo",
    "sesamos",
    "granos de sesamo",
    "semillas de sesamo",
    "ajonjoli",
  ],
  sulfitos: [
    "sulfitos",
    "sulfito",
    "dioxido de azufre",
    "dioxido de azufre y sulfitos",
    "so2",
  ],
  altramuces: ["altramuces", "altramuz"],
  moluscos: ["moluscos", "molusco"],
  soja: ["soja", "sojas", "soya"],
};

/**
 * Reduce un valor a una clave comparable: sin acentos, en minúsculas, con
 * guiones bajos y guiones convertidos en espacios y sin espacios repetidos.
 * `"Frutos_Cáscara "` y `"frutos cascara"` producen la misma clave.
 */
const plegar = (valor: string): string =>
  valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Quita la marca de plural de cada palabra. Red de seguridad: los plurales y
 * singulares habituales ya están enumerados en `SINONIMOS`, esto solo cubre
 * variantes no previstas. Palabras de 3 letras o menos se dejan intactas para
 * no destrozar cosas como "so2" o "mar".
 */
const singularizar = (clave: string): string =>
  clave
    .split(" ")
    .map((palabra) => {
      if (palabra.length <= 3) return palabra;
      if (palabra.endsWith("es")) return palabra.slice(0, -2);
      if (palabra.endsWith("s")) return palabra.slice(0, -1);
      return palabra;
    })
    .join(" ");

/** clave plegada -> id canónico. Se construye una sola vez. */
const INDICE_CANONICO: Map<string, string> = (() => {
  const indice = new Map<string, string>();
  const registrar = (clave: string, canonico: string) => {
    const plegada = plegar(clave);
    if (!plegada) return;
    if (!indice.has(plegada)) indice.set(plegada, canonico);
    const singular = singularizar(plegada);
    if (singular && !indice.has(singular)) indice.set(singular, canonico);
  };

  for (const { id, label } of ALERGENOS_OFICIALES) {
    registrar(id, id);
    registrar(label, id);
    for (const sinonimo of SINONIMOS[id] ?? []) registrar(sinonimo, id);
  }
  return indice;
})();

const ETIQUETAS: Map<string, string> = new Map(
  ALERGENOS_OFICIALES.map(({ id, label }) => [id, label]),
);

/**
 * Devuelve el valor canónico si el texto corresponde a un alérgeno oficial, o
 * `null` si no lo reconoce (alérgeno personalizado del restaurante).
 */
export function normalizarAlergeno(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const plegado = plegar(valor);
  if (!plegado) return null;
  return (
    INDICE_CANONICO.get(plegado) ??
    INDICE_CANONICO.get(singularizar(plegado)) ??
    null
  );
}

/** `true` si el texto corresponde a uno de los 14 alérgenos oficiales. */
export function esAlergenoOficial(valor: unknown): boolean {
  return normalizarAlergeno(valor) !== null;
}

/**
 * Etiqueta para mostrar en el panel. Para un alérgeno oficial devuelve su
 * etiqueta bonita ("Frutos de cáscara") aunque en BD estuviera guardado en
 * cualquiera de sus formas antiguas; para uno personalizado, el texto tal cual.
 */
export function etiquetaAlergeno(valor: string): string {
  const canonico = normalizarAlergeno(valor);
  if (canonico) return ETIQUETAS.get(canonico) ?? canonico;
  return valor;
}

/**
 * Lee la columna `alergenos_oficiales` venga como venga: array de textos,
 * objeto `{ gluten: true, apio: false }`, texto JSON, o texto suelto.
 * No normaliza: devuelve los valores crudos ya limpios de vacíos.
 */
export function parseAlergenos(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const texto = value.trim();
    if (!texto) return [];
    try {
      const parsed = JSON.parse(texto);
      if (Array.isArray(parsed) || (parsed && typeof parsed === "object")) {
        return parseAlergenos(parsed);
      }
    } catch {
      // No era JSON: se trata como un único alérgeno escrito a mano.
    }
    return [texto];
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, activo]) => Boolean(activo))
      .map(([clave]) => clave.trim())
      .filter(Boolean);
  }

  return [];
}

/**
 * Separa lo que hay guardado en dos cubos para poblar el formulario:
 * `oficiales` ya en forma canónica (así las casillas se marcan solas) y
 * `personalizados` con el texto original. Ambos vienen sin duplicados.
 */
export function separarAlergenos(value: unknown): {
  oficiales: string[];
  personalizados: string[];
} {
  const oficiales: string[] = [];
  const personalizados: string[] = [];
  const vistosOficiales = new Set<string>();
  const vistosPersonalizados = new Set<string>();

  for (const bruto of parseAlergenos(value)) {
    const canonico = normalizarAlergeno(bruto);
    if (canonico) {
      if (!vistosOficiales.has(canonico)) {
        vistosOficiales.add(canonico);
        oficiales.push(canonico);
      }
      continue;
    }
    const clave = plegar(bruto);
    if (!vistosPersonalizados.has(clave)) {
      vistosPersonalizados.add(clave);
      personalizados.push(bruto.trim());
    }
  }

  return { oficiales, personalizados };
}

/**
 * Construye la lista definitiva que se escribe en BD. Normaliza todo (también
 * los "personalizados": si alguien teclea "Huevo" a mano, sale como `huevos` y
 * no como una entrada aparte) y elimina duplicados, que era justo el efecto
 * que producía el desajuste de vocabulario.
 */
export function combinarAlergenos(
  oficiales: string[],
  personalizados: string[] = [],
): string[] {
  const resultado: string[] = [];
  const vistos = new Set<string>();

  for (const bruto of [...oficiales, ...personalizados]) {
    if (typeof bruto !== "string") continue;
    const limpio = bruto.trim();
    if (!limpio) continue;
    const valor = normalizarAlergeno(limpio) ?? limpio;
    const clave = plegar(valor);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    resultado.push(valor);
  }

  return resultado;
}

/** Declaración expresa, distinta de dejar la información sin completar. */
export const SIN_ALERGENOS_DECLARADOS = "sin alérgenos declarados";
export const esSinAlergenosDeclarados = (valor: string) =>
  ["sin alergenos declarados", "sin alergenos", "ninguno"].includes(
    plegar(valor),
  );
export function validarDeclaracionAlergenos(valores: string[]): string[] {
  if (!valores.length)
    throw new Error(
      "Selecciona los alérgenos o confirma que no hay alérgenos declarados",
    );
  const sin = valores.some(esSinAlergenosDeclarados);
  const presentes = valores.filter((v) => !esSinAlergenosDeclarados(v));
  if (sin && presentes.length)
    throw new Error(
      "No se puede indicar sin alérgenos y seleccionar alérgenos a la vez",
    );
  return sin ? [SIN_ALERGENOS_DECLARADOS] : valores;
}
