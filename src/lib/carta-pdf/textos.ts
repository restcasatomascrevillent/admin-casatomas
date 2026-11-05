/**
 * Textos de la carta impresa en los tres idiomas de la web (es, en, fr).
 *
 * Los nombres de tipo de vino, «Consultar precio» y las unidades son los de la
 * web pública (web-casatomas: src/lib/tipos-vino.ts, src/lib/precios.ts y
 * src/lib/unidades-platos.ts), para que la carta de papel diga lo mismo que la
 * de la pantalla.
 */

export const IDIOMAS_CARTA = ["es", "en", "fr"] as const;
export type IdiomaCarta = (typeof IDIOMAS_CARTA)[number];

export const NOMBRE_IDIOMA: Record<IdiomaCarta, string> = {
  es: "Español",
  en: "English",
  fr: "Français",
};

export interface TextosCarta {
  tituloPlatos: string;
  tituloVinos: string;
  /** Va detrás del título de una categoría que sigue de la página anterior. */
  continuacion: string;
  consultarPrecio: string;
  copa: string;
  ivaIncluido: string;
  notaAlergenos: string;
  tituloAlergenos: string;
  explicacionAlergenos: string;
  /** «Todos nuestros vinos contienen {lista}.» */
  todosLosVinosContienen: (lista: string) => string;
  telefono: string;
  /** Nombre de cada tipo de vino (cabecera de su sección). */
  tiposVino: Record<"tinto" | "blanco" | "espumoso" | "rosado" | "otro", string>;
  unidades: Record<"Unidad" | "Ración", string>;
}

export const TEXTOS: Record<IdiomaCarta, TextosCarta> = {
  es: {
    tituloPlatos: "Carta",
    tituloVinos: "Carta de vinos",
    continuacion: "(continuación)",
    consultarPrecio: "Consultar precio",
    copa: "Copa",
    ivaIncluido: "Precios con IVA incluido.",
    notaAlergenos: "Si tiene alguna alergia o intolerancia alimentaria, consulte a nuestro personal.",
    tituloAlergenos: "Alérgenos",
    explicacionAlergenos: "Los números junto a cada nombre indican los alérgenos que contiene.",
    todosLosVinosContienen: (lista) => `Todos nuestros vinos contienen ${lista}.`,
    telefono: "Tel.",
    tiposVino: {
      tinto: "Tintos",
      blanco: "Blancos",
      espumoso: "Champagnes y espumosos",
      rosado: "Rosados",
      otro: "Otros",
    },
    unidades: { Unidad: "Unidad", Ración: "Ración" },
  },
  en: {
    tituloPlatos: "Menu",
    tituloVinos: "Wine list",
    continuacion: "(continued)",
    consultarPrecio: "Ask for price",
    copa: "Glass",
    ivaIncluido: "Prices include VAT.",
    notaAlergenos: "If you have any food allergy or intolerance, please ask our staff.",
    tituloAlergenos: "Allergens",
    explicacionAlergenos: "The numbers next to each name show the allergens it contains.",
    todosLosVinosContienen: (lista) => `All our wines contain ${lista}.`,
    telefono: "Tel.",
    tiposVino: {
      tinto: "Red wines",
      blanco: "White wines",
      espumoso: "Champagnes and sparkling wines",
      rosado: "Rosé wines",
      otro: "Others",
    },
    unidades: { Unidad: "Unit", Ración: "Portion" },
  },
  fr: {
    tituloPlatos: "Carte",
    tituloVinos: "Carte des vins",
    continuacion: "(suite)",
    consultarPrecio: "Prix sur demande",
    copa: "Verre",
    ivaIncluido: "Prix TVA incluse.",
    notaAlergenos: "En cas d’allergie ou d’intolérance alimentaire, veuillez consulter notre personnel.",
    tituloAlergenos: "Allergènes",
    explicacionAlergenos: "Les numéros à côté de chaque nom indiquent les allergènes qu’il contient.",
    todosLosVinosContienen: (lista) => `Tous nos vins contiennent des ${lista}.`,
    telefono: "Tél.",
    tiposVino: {
      tinto: "Vins rouges",
      blanco: "Vins blancs",
      espumoso: "Champagnes et effervescents",
      rosado: "Vins rosés",
      otro: "Autres",
    },
    unidades: { Unidad: "Unité", Ración: "Portion" },
  },
};

/** «Consultar origen» de las categorías de vino sin denominación confirmada (web). */
export const CONSULTAR_ORIGEN: Record<IdiomaCarta, string> = {
  es: "Consultar origen",
  en: "Ask about origin",
  fr: "Origine sur demande",
};
