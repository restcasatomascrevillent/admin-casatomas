/**
 * Tipos de vino y denominaciones a partir de la categoría de la carta
 * («VINOS TINTOS — RIBERA DEL DUERO»), con el mismo criterio que la carta de
 * la web (web-casatomas/src/lib/tipos-vino.ts y FiltrosTipoVino.tsx). Lo usa el
 * filtro de píldoras de Gestor Web › Carta › Vinos (04/11/2026, dueño: «en vez
 * del desplegable para filtrar vinos, que esté la misma opción que hay en
 * carta»): una fila por tipo y, al elegir tipo, otra por denominación.
 */

export const TIPOS_VINO = ["tinto", "blanco", "espumoso", "rosado", "otro"] as const;
export type TipoVino = (typeof TIPOS_VINO)[number];

/** Igual que la web: lo decide el texto de la categoría (sin acentos ni mayúsculas). */
export function tipoVino(categoria?: string | null): TipoVino {
  const texto = (categoria ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (texto.includes("TINTO")) return "tinto";
  if (texto.includes("BLANCO")) return "blanco";
  if (texto.includes("ROSADO") || texto.includes("ROSE")) return "rosado";
  if (texto.includes("CHAMP") || texto.includes("CAVA") || texto.includes("ESPUMOS")) return "espumoso";
  return "otro";
}

/** Texto de la píldora (corto, como en la web). */
export const ETIQUETA_TIPO_VINO: Record<TipoVino, string> = {
  tinto: "Tintos",
  blanco: "Blancos",
  espumoso: "Espumosos",
  rosado: "Rosados",
  otro: "Otros",
};

/** Nombre largo (título y nombre accesible), como en la web. */
export const NOMBRE_TIPO_VINO: Record<TipoVino, string> = {
  tinto: "Tintos",
  blanco: "Blancos",
  espumoso: "Champagnes y espumosos",
  rosado: "Rosados",
  otro: "Otros",
};

/**
 * Categorías con el origen sin confirmar («VINOS TINTOS — ORIGEN PENDIENTE»).
 * La web las enseña como «Consultar origen» y el mapa no sabe dónde ponerlas.
 */
export function esCategoriaOrigenPendiente(categoria?: string | null): boolean {
  return /pendiente|por confirmar/i.test(categoria ?? "");
}

/** Texto de las categorías sin origen claro en el panel. */
export const ETIQUETA_ORIGEN_POR_CONFIRMAR = "Origen por confirmar";

const NOMBRES_DENOMINACION: Record<string, string> = {
  "RIBERA DEL DUERO": "Ribera del Duero",
  "IGP CASTILLA Y LEÓN": "IGP Castilla y León",
  "IGP TRES RIBERAS": "IGP Tres Riberas",
  "SIN D.O.": "Sin D.O.",
  "ALBARIÑO (Rías Baixas)": "Albariño · Rías Baixas",
  "NAVARRA / CHABLIS / RIOJA": "Navarra · Chablis · Rioja",
  "RIBEIRO / CASTILLA Y LEÓN": "Ribeiro · Castilla y León",
  "OTRAS DENOMINACIONES": "Otras D.O.",
};

/**
 * La denominación de una categoría, sin el tipo delante y legible:
 * «VINOS TINTOS — RIBERA DEL DUERO» → «Ribera del Duero». Las de origen sin
 * confirmar → «Origen por confirmar» (en la web, «Consultar origen»).
 */
export function categoriaCorta(categoria: string): string {
  if (esCategoriaOrigenPendiente(categoria)) return ETIQUETA_ORIGEN_POR_CONFIRMAR;
  const corta = categoria.replace(/^VINOS?\s+(?:TINTOS?|BLANCOS?|ROSADOS?|ESPUMOSOS?)\s*[—–-]\s*/i, "");
  if (NOMBRES_DENOMINACION[corta]) return NOMBRES_DENOMINACION[corta];
  return corta === corta.toUpperCase()
    ? corta.toLocaleLowerCase("es").replace(/^\p{L}/u, (letra) => letra.toLocaleUpperCase("es"))
    : corta;
}
