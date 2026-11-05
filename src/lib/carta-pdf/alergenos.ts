/**
 * Alérgenos en la carta impresa: un número por alérgeno junto al nombre del
 * plato o del vino y la leyenda en la última página, como en las cartas de
 * papel. Los 14 de declaración obligatoria llevan el número del anexo II del
 * Reglamento UE 1169/2011 (1 Gluten … 14 Moluscos), el orden habitual de los
 * pictogramas; lo que no es uno de ellos pero el restaurante marca (marisco,
 * carne, alcohol…) sigue numerado a partir del 15, para no perder el dato.
 *
 * Las etiquetas en en/fr son las de la web pública (web-casatomas,
 * src/lib/alergenos.ts), para que la carta de papel diga lo mismo.
 */
import { esSinAlergenosDeclarados, normalizarAlergeno, parseAlergenos } from "@/lib/alergenos";
import type { IdiomaCarta } from "./textos";

type Etiquetas = Record<IdiomaCarta, string>;

/** Valor canónico del panel (`src/lib/alergenos.ts`) → número UE y nombre. */
const OFICIALES: { id: string; etiquetas: Etiquetas }[] = [
  { id: "gluten", etiquetas: { es: "Gluten", en: "Gluten", fr: "Gluten" } },
  { id: "crustáceos", etiquetas: { es: "Crustáceos", en: "Crustaceans", fr: "Crustacés" } },
  { id: "huevos", etiquetas: { es: "Huevos", en: "Egg", fr: "Œuf" } },
  { id: "pescado", etiquetas: { es: "Pescado", en: "Fish", fr: "Poisson" } },
  { id: "cacahuetes", etiquetas: { es: "Cacahuetes", en: "Peanuts", fr: "Arachides" } },
  { id: "soja", etiquetas: { es: "Soja", en: "Soy", fr: "Soja" } },
  { id: "lácteos", etiquetas: { es: "Lácteos", en: "Dairy", fr: "Produits laitiers" } },
  { id: "frutos de cáscara", etiquetas: { es: "Frutos de cáscara", en: "Tree nuts", fr: "Fruits à coque" } },
  { id: "apio", etiquetas: { es: "Apio", en: "Celery", fr: "Céleri" } },
  { id: "mostaza", etiquetas: { es: "Mostaza", en: "Mustard", fr: "Moutarde" } },
  { id: "sésamo", etiquetas: { es: "Sésamo", en: "Sesame", fr: "Sésame" } },
  { id: "sulfitos", etiquetas: { es: "Sulfitos", en: "Sulphites", fr: "Sulfites" } },
  { id: "altramuces", etiquetas: { es: "Altramuces", en: "Lupin", fr: "Lupin" } },
  { id: "moluscos", etiquetas: { es: "Moluscos", en: "Molluscs", fr: "Mollusques" } },
];

/** Marcas del restaurante que no son de los 14 (en la BD hay «marisco», «carne» y «alcohol»). */
const EXTRAS: Record<string, Etiquetas> = {
  marisco: { es: "Marisco", en: "Shellfish", fr: "Fruits de mer" },
  carne: { es: "Carne", en: "Meat", fr: "Viande" },
  alcohol: { es: "Alcohol", en: "Alcohol", fr: "Alcool" },
};
const ORDEN_EXTRAS = Object.keys(EXTRAS);

const plegar = (valor: string) =>
  valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

const capitalizar = (valor: string) => {
  const limpio = valor.trim();
  return limpio ? limpio.charAt(0).toLocaleUpperCase("es") + limpio.slice(1).toLocaleLowerCase("es") : "";
};

/**
 * Clave estable de un alérgeno tal y como llega de la BD: el id canónico de
 * los 14, la clave de un extra conocido o el texto plegado si no se reconoce.
 * `null` para la declaración «sin alérgenos declarados» y los vacíos.
 */
export function claveAlergenoCarta(valor: string): string | null {
  const limpio = valor.trim();
  if (!limpio || esSinAlergenosDeclarados(limpio)) return null;
  const oficial = normalizarAlergeno(limpio);
  if (oficial) return oficial;
  const plegado = plegar(limpio);
  const extra = ORDEN_EXTRAS.find((clave) => plegar(clave) === plegado || plegar(clave) + "s" === plegado);
  return extra ?? plegado;
}

/** Claves de los alérgenos declarados e inferidos de una fila, sin repetir. */
export function clavesAlergenosFila(fila: { alergenos_oficiales?: unknown; alergenos_inferidos?: unknown }): string[] {
  const claves = [...parseAlergenos(fila.alergenos_oficiales), ...parseAlergenos(fila.alergenos_inferidos)]
    .map(claveAlergenoCarta)
    .filter((clave): clave is string => Boolean(clave));
  return [...new Set(claves)];
}

export interface EntradaLeyenda {
  numero: number;
  clave: string;
  etiqueta: string;
  /** Uno de los 14 de declaración obligatoria. */
  oficial: boolean;
}

/**
 * Numeración de una carta: los 14 oficiales siempre con su número UE (la
 * leyenda los lista todos) y los extras que aparecen, del 15 en adelante
 * (primero los conocidos en su orden, luego el resto por orden alfabético).
 */
export function numeracionAlergenos(clavesUsadas: Iterable<string>, idioma: IdiomaCarta): EntradaLeyenda[] {
  const usadas = new Set(clavesUsadas);
  const entradas: EntradaLeyenda[] = OFICIALES.map(({ id, etiquetas }, indice) => ({
    numero: indice + 1,
    clave: id,
    etiqueta: etiquetas[idioma],
    oficial: true,
  }));
  const oficiales = new Set(OFICIALES.map(({ id }) => id));
  const extras = [...usadas].filter((clave) => !oficiales.has(clave));
  extras.sort((a, b) => {
    const ia = ORDEN_EXTRAS.indexOf(a);
    const ib = ORDEN_EXTRAS.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    return a.localeCompare(b, "es");
  });
  extras.forEach((clave, indice) =>
    entradas.push({
      numero: OFICIALES.length + indice + 1,
      clave,
      etiqueta: EXTRAS[clave]?.[idioma] ?? capitalizar(clave),
      oficial: false,
    }),
  );
  return entradas;
}

/** Nombre de un alérgeno en minúsculas para una frase («sulfitos», «sulphites»). */
export function nombreEnFrase(entrada: EntradaLeyenda, idioma: IdiomaCarta): string {
  return entrada.etiqueta.toLocaleLowerCase(idioma);
}
