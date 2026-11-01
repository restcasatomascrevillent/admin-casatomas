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

/**
 * Las tres secciones de siempre, en el orden en que se sirven. Son también las
 * fijas del menú de una novedad (`menu-novedad.ts`), que añade las suyas aparte
 * con las secciones de nombre libre.
 */
export const SECCIONES_MENU = ["primero", "segundo", "postre"] as const;
export type SeccionMenu = (typeof SECCIONES_MENU)[number];

/**
 * El menú del día lleva además un ENTRANTE opcional delante del primero
 * (petición del dueño, 01/11/2026: «faltaría opción de entrante»). Es un tiempo
 * fijo y no una sección de nombre libre como las de las novedades: el menú del
 * día se rellena cada día desde el móvil y un tiempo que ya está ahí, vacío
 * hasta que se le pone algo, es un toque menos que «añadir sección, ponerle
 * nombre, elegir dónde va». Vacío no sale en la web: eso es «desactivarlo».
 */
export const SECCIONES_MENU_DIA = ["entrante", ...SECCIONES_MENU] as const;
export type SeccionMenuDia = (typeof SECCIONES_MENU_DIA)[number];

/** Las cuatro secciones del menú del día, ya normalizadas. */
export type SeccionesMenuDia = Record<SeccionMenuDia, ItemMenu[]>;

/**
 * Lo que aceptan las funciones de este fichero: el entrante es opcional para
 * que quien solo conoce primero/segundo/postre (el menú de una novedad, los
 * tests de antes) siga funcionando igual.
 */
export type EntradaSeccionesMenu = Record<SeccionMenu, ItemMenu[]> & Partial<Record<"entrante", ItemMenu[]>>;

/** Rótulo de cada sección en el editor del panel. */
export const ETIQUETA_SECCION: Record<SeccionMenuDia, string> = {
  entrante: "Entrante",
  primero: "Primero",
  segundo: "Segundo",
  postre: "Postre",
};

/**
 * Qué entra en el postre del menú del día y, por tanto, cómo se titula la
 * sección en la web (petición del dueño, 01/11/2026: «en nuestro menú entran
 * las 2 cosas, que se pueda configurar»). Va en `menu.postreCafe`.
 *
 * - `postre`: lo de siempre; la web pone «Postre» (o «Postres» con varios).
 *   Es lo que vale para los menús guardados antes de existir la opción, así
 *   que ninguno cambia en la web hasta que el dueño lo cambie.
 * - `postre_o_cafe`: «Postre o café».
 * - `postre_y_cafe`: «Postre y café».
 */
export const OPCIONES_POSTRE_CAFE = ["postre", "postre_o_cafe", "postre_y_cafe"] as const;
export type PostreCafe = (typeof OPCIONES_POSTRE_CAFE)[number];

export const ETIQUETA_POSTRE_CAFE: Record<PostreCafe, string> = {
  postre: "Postre",
  postre_o_cafe: "Postre o café",
  postre_y_cafe: "Postre y café",
};

/**
 * La de un menú NUEVO cuando ningún menú guardado la tiene elegida: el dueño
 * dijo que en su menú entran las dos cosas. Después, cada menú nuevo arranca
 * con la del último que la tenga (ver `EditorMenuTapasWeb`).
 */
export const POSTRE_CAFE_POR_DEFECTO: PostreCafe = "postre_y_cafe";

export const esPostreCafe = (valor: unknown): valor is PostreCafe =>
  typeof valor === "string" && (OPCIONES_POSTRE_CAFE as readonly string[]).includes(valor);

/**
 * Título de cada sección TAL Y COMO LO PINTA LA WEB en castellano (la vista
 * previa del panel lo imita; `CartaDelDia` de casa-tomas-story es la fuente):
 * sin entrante, el primero sale como «Entrantes» y el segundo como
 * «Principales», que es lo que se ve hoy; con entrante, «Entrantes»,
 * «Primeros» y «Segundos». El postre, según `postreCafe`.
 */
export function rotuloEnLaWeb(
  seccion: SeccionMenuDia,
  secciones: EntradaSeccionesMenu,
  postreCafe: PostreCafe | null,
): string {
  const conEntrante = (secciones.entrante ?? []).length > 0;
  switch (seccion) {
    case "entrante":
      return "Entrantes";
    case "primero":
      return conEntrante ? "Primeros" : "Entrantes";
    case "segundo":
      return conEntrante ? "Segundos" : "Principales";
    case "postre":
      if (postreCafe === "postre_o_cafe" || postreCafe === "postre_y_cafe") return ETIQUETA_POSTRE_CAFE[postreCafe];
      return secciones.postre.length > 1 ? "Postres" : "Postre";
  }
}

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
  secciones: SeccionesMenuDia;
  /**
   * Qué entra en el postre. `null` = el menú se guardó antes de existir la
   * opción: se edita y se pinta como `postre`, pero no cuenta como elegida a
   * la hora de proponer la de un menú nuevo.
   */
  postreCafe: PostreCafe | null;
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

export const seccionesMenuDiaVacias = (): SeccionesMenuDia => ({
  entrante: [],
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

/**
 * Lee un item del jsonb. Devuelve `null` si no tiene ni nombre. Exportado para
 * el menú de las novedades (`src/lib/menu-novedad.ts`), que usa el mismo item.
 */
export function parseItemMenu(valor: unknown): ItemMenu | null {
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

  const secciones = seccionesMenuDiaVacias();
  const crudas = payload.secciones;
  // Sin la clave (menús de antes de la opción) o con un valor raro: null.
  const postreCafe = esPostreCafe(payload.postreCafe) ? payload.postreCafe : null;

  if (crudas && typeof crudas === "object" && !Array.isArray(crudas)) {
    const mapa = crudas as Record<string, unknown>;
    let hayAlguno = false;
    for (const seccion of SECCIONES_MENU_DIA) {
      const lista = mapa[seccion];
      if (!Array.isArray(lista)) continue;
      const items = lista.map(parseItemMenu).filter((item): item is ItemMenu => item !== null);
      secciones[seccion] = items;
      if (items.length > 0) hayAlguno = true;
    }
    if (hayAlguno) return { version: 2, secciones, postreCafe };
  }

  // Camino heredado. OJO: aquí sí se parte por "\n". La web lo hacía mal
  // (`normalizeMenuItems` devolvía el texto entero como un único elemento), así
  // que dos platos en dos líneas se pintaban como un solo bloque.
  for (const seccion of SECCIONES_MENU_DIA) {
    const bruto = payload[seccion] ?? payload[`${seccion}s`];
    const lineas = Array.isArray(bruto)
      ? bruto.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : lineasDeTexto(texto(bruto));
    secciones[seccion] = lineas.map((linea) => itemLibre(linea));
  }

  return { version: 1, secciones, postreCafe };
}

/** Nombres de una sección unidos por salto de línea (el espejo heredado). */
export const textoDeSeccion = (items: ItemMenu[]): string =>
  items.map((item) => item.nombre).filter(Boolean).join("\n");

/** Las cuatro secciones, con el entrante vacío si no venía. */
export const completarSecciones = (secciones: EntradaSeccionesMenu): SeccionesMenuDia => ({
  entrante: secciones.entrante ?? [],
  primero: secciones.primero,
  segundo: secciones.segundo,
  postre: secciones.postre,
});

/** ¿Hay algo que guardar? */
export const menuTieneContenido = (secciones: EntradaSeccionesMenu): boolean => {
  const completas = completarSecciones(secciones);
  return SECCIONES_MENU_DIA.some((seccion) => completas[seccion].length > 0);
};

/**
 * Construye el jsonb que se escribe en BD.
 *
 * Escribe SIEMPRE el espejo v1 (`primero`/`segundo`/`postre` con los nombres
 * unidos por "\n") además de `secciones`. Es lo que permite desplegar el panel
 * y la web por separado sin romper nada, y lo que protege a cualquier otro
 * consumidor que solo conozca el formato viejo. El entrante va igual
 * (`entrante` y `secciones.entrante`): quien no lo conozca lo ignora.
 *
 * `postreCafe` solo se escribe si se pasa; sin él la web pinta «Postre», lo
 * mismo que con `postre`.
 */
export function serializarMenuDia(
  secciones: EntradaSeccionesMenu,
  postreCafe?: PostreCafe,
): Record<string, unknown> {
  const completas = completarSecciones(secciones);
  return {
    v: 2,
    entrante: textoDeSeccion(completas.entrante),
    primero: textoDeSeccion(completas.primero),
    segundo: textoDeSeccion(completas.segundo),
    postre: textoDeSeccion(completas.postre),
    ...(postreCafe ? { postreCafe } : {}),
    secciones: {
      entrante: completas.entrante,
      primero: completas.primero,
      segundo: completas.segundo,
      postre: completas.postre,
    },
  };
}

/**
 * Aplica las variantes de idioma a un menú: cambia nombre y descripción de cada
 * item y deja intacto todo lo demás (foto, alérgenos, ids). Los items sin
 * variante se quedan en español, que es mejor que dejarlos en blanco.
 */
export function menuEnIdioma(
  secciones: EntradaSeccionesMenu,
  variantes: Map<string, VarianteIdioma>,
): SeccionesMenuDia {
  const completas = completarSecciones(secciones);
  const resultado = seccionesMenuDiaVacias();
  for (const seccion of SECCIONES_MENU_DIA) {
    resultado[seccion] = completas[seccion].map((item) => {
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
