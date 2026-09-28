// ---------------------------------------------------------------------------
// Contrato del menú del día (columna `menus_diarios.menu`, jsonb)
//
// QUÉ RESUELVE
// El menú del día se tecleaba a mano en tres cajas de texto libre, aunque la
// tabla `Platos` ya tiene los 128 platos de la carta con sus alérgenos (126),
// sus fotos (57) y sus traducciones. Resultado: se reescribía un plato que ya
// existía, sin alérgenos, sin foto, y se volvía a traducir lo ya traducido.
//
// Ahora cada línea del menú es un ITEM con estructura. Un item puede venir de
// la carta (`origen: "carta"`, se copian sus datos) o escribirse a mano
// (`origen: "libre"`). Los dos admiten alérgenos: el dueño pidió literalmente
// poder "poner alérgenos como cualquier plato" también en los de texto libre.
//
// POR QUÉ SE COPIA Y NO SE ENLAZA
// Un menú publicado es un DOCUMENTO HISTÓRICO: el menú del 12 de marzo no debe
// cambiar porque hoy se edite ese plato en la carta. Además:
//   1. No hay clave ajena de `menus_diarios` a `Platos` (y `Platos.id` es
//      `text`). Enlazar en vivo obligaría a crearla, y entonces borrar un plato
//      destruiría menús pasados (CASCADE) o dejaría ids colgando (RESTRICT).
//   2. El menú se guarda POR IDIOMA (tres filas). Con enlace vivo habría que
//      resolver la traducción en cada pintado; la copia ya lleva el idioma
//      correcto en cada fila.
//   3. La web pública lee `menus_diarios` con UNA consulta y carga el SDK de
//      Supabase en diferido para no lastrar la portada. Un enlace vivo obligaría
//      a un join o a una segunda consulta de la carta entera en la home.
//   4. Precios y recetas cambian. Un menú de marzo con el plato de hoy miente.
// Se conserva `platoId` solo para TRAZABILIDAD: permite ofrecer en el panel un
// "actualizar desde la carta" explícito, que es una decisión de la persona que
// edita, no un efecto colateral. Es el mismo patrón que una línea de factura.
//
// VOCABULARIO DE ALÉRGENOS
// Se guardan SIEMPRE en el canónico español con acentos (`crustáceos`,
// `frutos de cáscara`, ...), el mismo de `src/lib/alergenos.ts` y el mismo que
// ya hay en `Platos.alergenos_oficiales`. También en las filas en/fr: la web
// traduce la ETIQUETA al pintar (su `etiquetaAlergeno(valor, idioma)` entiende
// estas formas). Guardar la etiqueta traducida solo serviría para que las tres
// filas se desincronizasen.
// ---------------------------------------------------------------------------

import { combinarAlergenos, parseAlergenos } from "@/lib/alergenos";

/** Las tres secciones del menú, en el orden en que se sirven. */
export const SECCIONES_MENU = ["primero", "segundo", "postre"] as const;
export type SeccionMenu = (typeof SECCIONES_MENU)[number];

/** Rótulo de cada sección en el panel. "Postre o café" es el de siempre. */
export const ETIQUETA_SECCION: Record<SeccionMenu, string> = {
  primero: "Primero",
  segundo: "Segundo",
  postre: "Postre o café",
};

/** Una línea del menú, tal y como se guarda en BD. */
export interface ItemMenu {
  /** uuid de la línea. El MISMO en las filas es/en/fr: así se emparejan. */
  id: string;
  /** De dónde salió: elegido de la carta o escrito a mano. */
  origen: "carta" | "libre";
  /** `Platos.id` si vino de la carta. Solo trazabilidad, nunca se resuelve en vivo. */
  platoId: string | null;
  /** Ya en el idioma de la fila. */
  nombre: string;
  /** Ya en el idioma de la fila. */
  descripcion: string | null;
  imagenUrl: string | null;
  /** 0..100. Igual que `Platos.imagen_posicion_y`: el `object-position` vertical. */
  imagenPosicionY: number | null;
  /** Declarados por el restaurante. Canónico español. */
  alergenos: string[];
  /** Deducidos de los ingredientes: menos fiables, nunca se presentan igual. */
  alergenosInferidos: string[];
  alergenosNotas: string | null;
}

/** El menú entero, ya normalizado. */
export interface MenuEstructurado {
  /** 1 = los tres textos libres de siempre; 2 = con items estructurados. */
  version: 1 | 2;
  secciones: Record<SeccionMenu, ItemMenu[]>;
}

/** Variante de un item en otro idioma: es lo único que cambia al traducir. */
export interface VarianteIdioma {
  nombre: string;
  descripcion: string | null;
}

const texto = (valor: unknown): string => (typeof valor === "string" ? valor.trim() : "");

const textoONulo = (valor: unknown): string | null => {
  const limpio = texto(valor);
  return limpio || null;
};

const numeroONulo = (valor: unknown): number | null => {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  return valor;
};

/**
 * Identificador de línea. `crypto.randomUUID` no existe en contextos no
 * seguros (http:// que no sea localhost) ni en algunos jsdom, y quedarse sin
 * id rompería el emparejado entre idiomas: por eso hay respaldo.
 */
export const nuevoIdItem = (): string => {
  const cripto = globalThis.crypto;
  if (cripto && typeof cripto.randomUUID === "function") return cripto.randomUUID();
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const seccionesVacias = (): Record<SeccionMenu, ItemMenu[]> => ({
  primero: [],
  segundo: [],
  postre: [],
});

/** Parte un texto de varias líneas en platos. Vacíos fuera. */
export const lineasDeTexto = (valor: string): string[] =>
  valor
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean);

/** Crea un item de texto libre. Admite alérgenos como cualquier otro. */
export function itemLibre(nombre: string, alergenos: string[] = []): ItemMenu {
  return {
    id: nuevoIdItem(),
    origen: "libre",
    platoId: null,
    nombre: nombre.trim(),
    descripcion: null,
    imagenUrl: null,
    imagenPosicionY: null,
    alergenos: combinarAlergenos(alergenos),
    alergenosInferidos: [],
    alergenosNotas: null,
  };
}

/** Lo que hace falta de un plato de la carta para copiarlo al menú. */
export interface PlatoParaMenu {
  id: string;
  nombre: string | null;
  descripcion?: string | null;
  imagen_url?: string | null;
  imagen_posicion_y?: number | null;
  alergenos_oficiales?: unknown;
  alergenos_inferidos?: unknown;
  alergenos_notas?: string | null;
}

/**
 * COPIA un plato de la carta a una línea de menú. A partir de aquí la línea es
 * independiente: si el plato cambia o se borra, el menú publicado no se entera.
 */
export function itemDesdePlato(plato: PlatoParaMenu): ItemMenu {
  return {
    id: nuevoIdItem(),
    origen: "carta",
    platoId: plato.id,
    nombre: texto(plato.nombre),
    descripcion: textoONulo(plato.descripcion),
    imagenUrl: textoONulo(plato.imagen_url),
    imagenPosicionY: numeroONulo(plato.imagen_posicion_y),
    alergenos: combinarAlergenos(parseAlergenos(plato.alergenos_oficiales)),
    alergenosInferidos: combinarAlergenos(parseAlergenos(plato.alergenos_inferidos)),
    alergenosNotas: textoONulo(plato.alergenos_notas),
  };
}

/** Lee un item del jsonb. Devuelve `null` si no tiene ni nombre. */
function parseItem(valor: unknown): ItemMenu | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const obj = valor as Record<string, unknown>;
  const nombre = texto(obj.nombre);
  if (!nombre) return null;

  const platoId = textoONulo(obj.platoId);
  // El origen se deduce del platoId si falta o viene con un valor raro: así una
  // fila escrita a mano en SQL sigue cayendo en el lado correcto.
  const origen: ItemMenu["origen"] =
    obj.origen === "carta" || obj.origen === "libre" ? obj.origen : platoId ? "carta" : "libre";

  return {
    id: texto(obj.id) || nuevoIdItem(),
    origen,
    platoId: origen === "carta" ? platoId : null,
    nombre,
    descripcion: textoONulo(obj.descripcion),
    imagenUrl: textoONulo(obj.imagenUrl),
    imagenPosicionY: numeroONulo(obj.imagenPosicionY),
    alergenos: combinarAlergenos(parseAlergenos(obj.alergenos)),
    alergenosInferidos: combinarAlergenos(parseAlergenos(obj.alergenosInferidos)),
    alergenosNotas: textoONulo(obj.alergenosNotas),
  };
}

/**
 * Lee la columna `menu` venga como venga.
 *
 * - v2: usa `secciones`.
 * - v1 (los menús ya guardados, el último del 12/03/2026): los tres textos
 *   sueltos, partidos por salto de línea. Cada línea pasa a ser un item libre
 *   sin alérgenos, que es exactamente la información que había.
 * - Basura o vacío: menú vacío, nunca revienta.
 */
export function parseMenuDia(valor: unknown): MenuEstructurado {
  let payload: Record<string, unknown> = {};

  if (typeof valor === "string") {
    try {
      const parsed = JSON.parse(valor);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      // No era JSON: se trata como menú vacío.
    }
  } else if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    payload = valor as Record<string, unknown>;
  }

  const secciones = seccionesVacias();
  const crudas = payload.secciones;

  if (crudas && typeof crudas === "object" && !Array.isArray(crudas)) {
    const mapa = crudas as Record<string, unknown>;
    let hayAlguno = false;
    for (const seccion of SECCIONES_MENU) {
      const lista = mapa[seccion];
      if (!Array.isArray(lista)) continue;
      const items = lista.map(parseItem).filter((item): item is ItemMenu => item !== null);
      secciones[seccion] = items;
      if (items.length > 0) hayAlguno = true;
    }
    if (hayAlguno) return { version: 2, secciones };
  }

  // Camino heredado. OJO: aquí sí se parte por "\n". La web lo hacía mal
  // (`normalizeMenuItems` devolvía el texto entero como un único elemento), así
  // que dos platos en dos líneas se pintaban como un solo bloque.
  for (const seccion of SECCIONES_MENU) {
    const bruto = payload[seccion] ?? payload[`${seccion}s`];
    const lineas = Array.isArray(bruto)
      ? bruto.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : lineasDeTexto(texto(bruto));
    secciones[seccion] = lineas.map((linea) => itemLibre(linea));
  }

  return { version: 1, secciones };
}

/** Nombres de una sección unidos por salto de línea (el espejo heredado). */
export const textoDeSeccion = (items: ItemMenu[]): string =>
  items.map((item) => item.nombre).filter(Boolean).join("\n");

/** ¿Hay algo que guardar? */
export const menuTieneContenido = (secciones: Record<SeccionMenu, ItemMenu[]>): boolean =>
  SECCIONES_MENU.some((seccion) => secciones[seccion].length > 0);

/**
 * Construye el jsonb que se escribe en BD.
 *
 * Escribe SIEMPRE el espejo v1 (`primero`/`segundo`/`postre` con los nombres
 * unidos por "\n") además de `secciones`. Es lo que permite desplegar el panel
 * y la web por separado sin romper nada, y lo que protege a cualquier otro
 * consumidor que solo conozca el formato viejo.
 */
export function serializarMenuDia(secciones: Record<SeccionMenu, ItemMenu[]>): Record<string, unknown> {
  return {
    v: 2,
    primero: textoDeSeccion(secciones.primero),
    segundo: textoDeSeccion(secciones.segundo),
    postre: textoDeSeccion(secciones.postre),
    secciones: {
      primero: secciones.primero,
      segundo: secciones.segundo,
      postre: secciones.postre,
    },
  };
}

/**
 * Aplica las variantes de idioma a un menú: cambia nombre y descripción de cada
 * item y deja intacto todo lo demás (foto, alérgenos, ids). Los items sin
 * variante se quedan en español, que es mejor que dejarlos en blanco.
 */
export function menuEnIdioma(
  secciones: Record<SeccionMenu, ItemMenu[]>,
  variantes: Map<string, VarianteIdioma>,
): Record<SeccionMenu, ItemMenu[]> {
  const resultado = seccionesVacias();
  for (const seccion of SECCIONES_MENU) {
    resultado[seccion] = secciones[seccion].map((item) => {
      const variante = variantes.get(item.id);
      if (!variante || !variante.nombre) return item;
      return { ...item, nombre: variante.nombre, descripcion: variante.descripcion };
    });
  }
  return resultado;
}

/**
 * Empareja las líneas traducidas con los items que se mandaron a traducir.
 *
 * Solo se manda a traducir el TEXTO LIBRE: los platos de la carta ya tienen sus
 * `nombre_en` / `nombre_fr`, y volver a traducirlos solo introduciría una
 * segunda versión del mismo plato. Si el traductor devuelve un número de líneas
 * distinto del que se le mandó, se descarta esa sección entera y se queda en
 * español: es preferible a desplazar los nombres y atribuirle a un plato el
 * nombre de otro.
 */
export function emparejarTraduccion(
  itemsEnviados: ItemMenu[],
  textoTraducido: string,
): Map<string, VarianteIdioma> {
  const variantes = new Map<string, VarianteIdioma>();
  if (itemsEnviados.length === 0) return variantes;

  const lineas = lineasDeTexto(textoTraducido);
  if (lineas.length !== itemsEnviados.length) return variantes;

  itemsEnviados.forEach((item, indice) => {
    variantes.set(item.id, { nombre: lineas[indice], descripcion: item.descripcion });
  });
  return variantes;
}

/** ¿La copia guardada sigue coincidiendo con lo que hay hoy en la carta? */
export function difiereDeLaCarta(item: ItemMenu, plato: PlatoParaMenu | undefined): boolean {
  if (item.origen !== "carta" || !item.platoId) return false;
  // Si el plato ya no está en la carta no "difiere": desapareció. Se avisa aparte.
  if (!plato) return false;
  const actual = itemDesdePlato(plato);
  return (
    actual.nombre !== item.nombre ||
    actual.descripcion !== item.descripcion ||
    actual.imagenUrl !== item.imagenUrl ||
    actual.imagenPosicionY !== item.imagenPosicionY ||
    actual.alergenos.join("|") !== item.alergenos.join("|") ||
    actual.alergenosInferidos.join("|") !== item.alergenosInferidos.join("|") ||
    actual.alergenosNotas !== item.alergenosNotas
  );
}
