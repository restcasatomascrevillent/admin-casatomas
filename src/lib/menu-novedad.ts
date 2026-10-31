// ---------------------------------------------------------------------------
// Botones de las tarjetas de novedades (columnas `novedades.botones`, `menu` y
// `plato_id`). Historia 4073221d «Botones de acción en las tarjetas de
// novedades»; el contrato está en el plan del CTO (sección 2) y en la migración
// supabase/migrations/20261028170000_novedades_botones_menu.sql.
//
// - `botones`: array de 0 a 2 tipos distintos de `llamar`, `ver_menu` y
//   `ver_plato`. El orden del array es el de la tarjeta. Las etiquetas no se
//   guardan: las pone la web en cada idioma.
// - `menu`: el menú propio de la novedad (p. ej. un menú de Navidad), NULL si
//   no hay «Ver menú». Mismo item que el menú del día (`ItemMenu` de
//   `menu-dia.ts`) más sus `traducciones` dentro, porque la novedad es UNA fila
//   y no tres como `menus_diarios`. Se COPIA de la carta, no se enlaza (ADR-2).
// - `plato_id`: el plato de «Échale un vistazo». «En la carta» = `activado` y
//   `restaurante`, el mismo filtro que la carta de la web. La BBDD no obliga a
//   que haya plato con `ver_plato` (si se borra, la FK lo pone a NULL): lo
//   comprueba el panel al guardar (ADR-4).
//
// Compatibilidad (regla 2.4 del plan): el panel solo manda estas tres claves si
// la novedad tiene botones o los tenía al abrirla. Así una novedad sin botones
// se sigue guardando contra una BBDD a la que aún no ha llegado la migración.
//
// Menú versión 2 (historia 4093221d «Maridajes y catas»; plan del CTO,
// sección 2, reglas E1–E10 y L1–L6): un menú puede llevar una bebida por plato
// (maridaje) o ser una cata (lista ordenada de bebidas). Sin maridaje ni cata
// se sigue escribiendo la v1 de siempre (ADR-6), así que la web y el panel que
// ya están en producción no notan nada con los menús normales.
// ---------------------------------------------------------------------------

import type { Json } from "@/integrations/supabase/types";
import { normalizarAlergeno, parseAlergenos } from "@/lib/alergenos";
import {
  SECCIONES_MENU,
  emparejarTraduccion,
  nuevoIdItem,
  parseItemMenu,
  textoDeSeccion,
  type ItemMenu,
  type SeccionMenu,
  type VarianteIdioma,
} from "@/lib/menu-dia";

// ---------------------------------------------------------------------------
// Botones
// ---------------------------------------------------------------------------

export const TIPOS_BOTON = ["llamar", "ver_menu", "ver_plato"] as const;
export type TipoBoton = (typeof TIPOS_BOTON)[number];

export const MAX_BOTONES = 2;

/** Rótulo de cada botón en el panel (el mismo que en la web en castellano). */
export const ETIQUETA_BOTON: Record<TipoBoton, string> = {
  llamar: "Llamar",
  ver_menu: "Ver menú",
  ver_plato: "Échale un vistazo",
};

/** Rótulos por idioma para la vista previa del móvil. */
export const ETIQUETA_BOTON_IDIOMA: Record<"es" | "en" | "fr", Record<TipoBoton, string>> = {
  es: ETIQUETA_BOTON,
  en: { llamar: "Call", ver_menu: "View menu", ver_plato: "Take a look" },
  fr: { llamar: "Appeler", ver_menu: "Voir le menu", ver_plato: "Jetez un œil" },
};

export const esTipoBoton = (valor: unknown): valor is TipoBoton =>
  typeof valor === "string" && (TIPOS_BOTON as readonly string[]).includes(valor);

/**
 * Lee `novedades.botones` venga como venga: sin la columna (BBDD sin la
 * migración), NULL o basura es «sin botones». Ignora tipos desconocidos y
 * repetidos y se queda con los dos primeros, como la web.
 */
export function parseBotonesNovedad(valor: unknown): TipoBoton[] {
  if (!Array.isArray(valor)) return [];
  const botones: TipoBoton[] = [];
  for (const tipo of valor) {
    if (botones.length === MAX_BOTONES) break;
    if (esTipoBoton(tipo) && !botones.includes(tipo)) botones.push(tipo);
  }
  return botones;
}

/**
 * Los botones que de verdad pintaría la web: «Échale un vistazo» solo con el
 * plato en la carta y «Ver menú» solo si el menú es pintable (`menuPintable`: algún
 * plato o, en una cata, alguna bebida).
 */
export function botonesVisiblesEnWeb(
  botones: readonly TipoBoton[],
  { platoEnCarta, menuConPlatos }: { platoEnCarta: boolean; menuConPlatos: boolean },
): TipoBoton[] {
  return botones
    .filter((tipo) => (tipo === "ver_plato" ? platoEnCarta : tipo === "ver_menu" ? menuConPlatos : true))
    .slice(0, MAX_BOTONES);
}

// ---------------------------------------------------------------------------
// Plato enlazado («Échale un vistazo»)
// ---------------------------------------------------------------------------

export interface PlatoEnlazable {
  activado?: boolean | null;
  restaurante?: boolean | null;
}

/** «En la carta» = activado AND restaurante (como `scripts/carta-ssg.mjs` de la web). */
export const platoEnCarta = (plato: PlatoEnlazable | null | undefined): boolean =>
  !!plato && plato.activado === true && plato.restaurante === true;

/** `desconocido`: la carta aún no se ha cargado (o no se pudo cargar). */
export type EstadoPlatoEnlazado = "sin_plato" | "en_carta" | "fuera_de_carta" | "desconocido";

export function estadoPlatoEnlazado(
  platoId: string | null | undefined,
  platosPorId: ReadonlyMap<string, PlatoEnlazable>,
  cartaCargada: boolean,
): EstadoPlatoEnlazado {
  if (!platoId) return "sin_plato";
  if (!cartaCargada) return "desconocido";
  return platoEnCarta(platosPorId.get(platoId)) ? "en_carta" : "fuera_de_carta";
}

/**
 * Aviso «El plato ya no está en la carta» de una novedad GUARDADA: tiene
 * «Échale un vistazo» y su plato se borró (la FK dejó `plato_id` a NULL), se
 * desactivó o dejó de estar en el restaurante.
 */
export function platoRetiradoDeLaCarta(
  botones: readonly TipoBoton[],
  platoId: string | null | undefined,
  platosPorId: ReadonlyMap<string, PlatoEnlazable>,
  cartaCargada: boolean,
): boolean {
  if (!botones.includes("ver_plato") || !cartaCargada) return false;
  return estadoPlatoEnlazado(platoId, platosPorId, true) !== "en_carta";
}

// ---------------------------------------------------------------------------
// Menú de la novedad
// ---------------------------------------------------------------------------

export type SeccionMenuNovedad = SeccionMenu | "bebidas";
export const SECCIONES_MENU_NOVEDAD: readonly SeccionMenuNovedad[] = [...SECCIONES_MENU, "bebidas"];

export type IdiomaTraducido = "en" | "fr";
const IDIOMAS_TRADUCIDOS: readonly IdiomaTraducido[] = ["en", "fr"];

export type TraduccionesNovedad = Partial<Record<IdiomaTraducido, VarianteIdioma>>;

/** `ItemMenu` v2 del menú del día + su texto en inglés y francés. */
export interface ItemMenuNovedad extends ItemMenu {
  traducciones?: TraduccionesNovedad;
}

export type SeccionesMenuNovedad = Record<SeccionMenuNovedad, ItemMenuNovedad[]>;

/** De dónde sale una bebida del maridaje o de la cata. */
export type OrigenLineaBebida = "vino" | "bebida" | "libre";
const ORIGENES_LINEA: readonly OrigenLineaBebida[] = ["vino", "bebida", "libre"];

/** Una bebida del maridaje de un plato o de la cata. Se copia de la carta, no se enlaza (E5). */
export interface LineaBebidaNovedad {
  /** uuid, estable al editar (con él se empareja la traducción). */
  id: string;
  origen: OrigenLineaBebida;
  /** `Vinos.id` o `Bebidas.id`; null si se escribió a mano. */
  refId: string | null;
  /** En castellano, nunca vacío al guardar (E4). */
  nombre: string;
  /** Corta y escrita en el panel; no se copia la del vino (ADR-10). */
  descripcion: string | null;
  sulfitos: boolean;
  traducciones?: TraduccionesNovedad;
}

export type TipoMenuNovedad = "menu" | "cata";

/**
 * El menú tal y como lo edita el panel (ADR-7). La versión no está aquí: la
 * decide `serializarMenuNovedad` (E1). Mientras se edita se conserva lo del
 * otro tipo (E10); al guardar solo cuenta lo elegido (`limpiarMenuNovedad`).
 */
export interface MenuNovedad {
  tipo: TipoMenuNovedad;
  /** «Comida + bebidas» (true) o «Solo comida» (false). */
  incluye_bebidas: boolean;
  /** Interruptor «Con maridaje» (solo cuenta con tipo Menú). */
  maridaje: boolean;
  secciones: SeccionesMenuNovedad;
  /** Bebida de cada plato de primero, segundo y postre, por id del plato. */
  maridajes: Record<string, LineaBebidaNovedad>;
  /** Lista ordenada de la cata. */
  cata: LineaBebidaNovedad[];
}

export const menuNovedadVacio = (): MenuNovedad => ({
  tipo: "menu",
  incluye_bebidas: false,
  maridaje: false,
  secciones: { primero: [], segundo: [], postre: [], bebidas: [] },
  maridajes: {},
  cata: [],
});

const texto = (valor: unknown): string => (typeof valor === "string" ? valor.trim() : "");

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  !!valor && typeof valor === "object" && !Array.isArray(valor);

function parseTraducciones(valor: unknown): TraduccionesNovedad | undefined {
  if (!esObjeto(valor)) return undefined;
  const traducciones: TraduccionesNovedad = {};
  for (const idioma of IDIOMAS_TRADUCIDOS) {
    const variante = valor[idioma];
    if (!esObjeto(variante)) continue;
    const nombre = texto(variante.nombre);
    if (!nombre) continue;
    traducciones[idioma] = { nombre, descripcion: texto(variante.descripcion) || null };
  }
  return Object.keys(traducciones).length > 0 ? traducciones : undefined;
}

function parseItemNovedad(valor: unknown): ItemMenuNovedad | null {
  const item = parseItemMenu(valor);
  if (!item) return null;
  const traducciones = parseTraducciones((valor as Record<string, unknown>).traducciones);
  return traducciones ? { ...item, traducciones } : item;
}

/**
 * L2: una línea vale si es un objeto con `nombre` de texto no vacío. `sulfitos`
 * es true solo si es exactamente true y un `origen` desconocido es `libre`.
 */
export function parseLineaBebida(valor: unknown): LineaBebidaNovedad | null {
  if (!esObjeto(valor)) return null;
  const nombre = texto(valor.nombre);
  if (!nombre) return null;
  const origen = ORIGENES_LINEA.find((o) => o === valor.origen) ?? "libre";
  const linea: LineaBebidaNovedad = {
    id: texto(valor.id) || nuevoIdItem(),
    origen,
    refId: origen === "libre" ? null : texto(valor.refId) || null,
    nombre,
    descripcion: texto(valor.descripcion) || null,
    sulfitos: valor.sulfitos === true,
  };
  const traducciones = parseTraducciones(valor.traducciones);
  return traducciones ? { ...linea, traducciones } : linea;
}

const esLinea = (linea: LineaBebidaNovedad | null): linea is LineaBebidaNovedad => linea !== null;

/**
 * Lee `novedades.menu` (v1 o v2). Devuelve `null` si no hay menú (columna
 * ausente, NULL o algo que no es un menú). Las secciones que falten se leen
 * como vacías.
 *  - L1: sin `version`, con la 1 o con `tipo` ausente o desconocido es un
 *    Menú. Sin `version` o con la 1 se ignoran `tipo`, `maridaje` y `cata`
 *    aunque vengan (como la web). Maridaje solo con `maridaje === true` y cata
 *    solo con `tipo === "cata"`. Una versión mayor se lee igual, en lo que se
 *    pueda.
 *  - L6: una v1 se reabre como Menú sin maridaje; una v2 restaura el tipo, los
 *    maridajes, la cata, los sulfitos y las traducciones.
 */
export function parseMenuNovedad(valor: unknown): MenuNovedad | null {
  let crudo: unknown = valor;
  if (typeof valor === "string") {
    try {
      crudo = JSON.parse(valor);
    } catch {
      return null;
    }
  }
  if (!esObjeto(crudo)) return null;
  const mapa = crudo.secciones;
  if (!esObjeto(mapa)) return null;

  const menu = menuNovedadVacio();
  const v2 = typeof crudo.version === "number" && crudo.version >= 2;
  menu.tipo = v2 && crudo.tipo === "cata" ? "cata" : "menu";
  menu.incluye_bebidas = crudo.incluye_bebidas === true;
  menu.maridaje = v2 && menu.tipo === "menu" && crudo.maridaje === true;
  for (const seccion of SECCIONES_MENU_NOVEDAD) {
    const lista = mapa[seccion];
    if (!Array.isArray(lista)) continue;
    for (const valorItem of lista) {
      const item = parseItemNovedad(valorItem);
      if (!item) continue;
      menu.secciones[seccion].push(item);
      if (menu.maridaje && seccion !== "bebidas") {
        const linea = parseLineaBebida((valorItem as Record<string, unknown>).maridaje);
        if (linea) menu.maridajes[item.id] = linea;
      }
    }
  }
  if (menu.tipo === "cata" && Array.isArray(mapa.cata)) {
    menu.cata = mapa.cata.map((linea) => parseLineaBebida(linea)).filter(esLinea);
  }
  return menu;
}

/** Líneas con nombre vacío fuera (se añade «A mano» y puede quedarse en blanco). */
const limpiarLineas = (items: ItemMenuNovedad[]): ItemMenuNovedad[] =>
  items.map((item) => ({ ...item, nombre: item.nombre.trim() })).filter((item) => item.nombre !== "");

/** E4 y E7: sin nombre se descarta; la descripción vacía es null. */
function limpiarLinea(linea: LineaBebidaNovedad | null | undefined): LineaBebidaNovedad | null {
  if (!linea) return null;
  const nombre = linea.nombre.trim();
  if (!nombre) return null;
  return {
    ...linea,
    nombre,
    refId: linea.origen === "libre" ? null : linea.refId,
    descripcion: texto(linea.descripcion) || null,
    sulfitos: linea.sulfitos === true,
  };
}

/**
 * El menú tal y como se guarda: sin líneas vacías, sin bebidas con «Solo
 * comida», sin los maridajes de platos que ya no están (ADR-7) y sin nada del
 * tipo que no se ha elegido (E10). Una cata no guarda comida ni maridaje. Un
 * maridaje que se queda sin ninguna bebida se apaga.
 */
export function limpiarMenuNovedad(menu: MenuNovedad): MenuNovedad {
  if (menu.tipo === "cata") {
    return { ...menuNovedadVacio(), tipo: "cata", cata: menu.cata.map(limpiarLinea).filter(esLinea) };
  }
  const secciones: SeccionesMenuNovedad = {
    primero: limpiarLineas(menu.secciones.primero),
    segundo: limpiarLineas(menu.secciones.segundo),
    postre: limpiarLineas(menu.secciones.postre),
    bebidas: menu.incluye_bebidas ? limpiarLineas(menu.secciones.bebidas) : [],
  };
  const maridajes: Record<string, LineaBebidaNovedad> = {};
  if (menu.maridaje) {
    for (const seccion of SECCIONES_MENU) {
      for (const item of secciones[seccion]) {
        const linea = limpiarLinea(menu.maridajes[item.id]);
        if (linea) maridajes[item.id] = linea;
      }
    }
  }
  return {
    tipo: "menu",
    incluye_bebidas: menu.incluye_bebidas,
    maridaje: Object.keys(maridajes).length > 0,
    secciones,
    maridajes,
    cata: [],
  };
}

/** ¿Hay algún plato en primero, segundo o postre? */
export const menuTieneComida = (menu: MenuNovedad): boolean =>
  SECCIONES_MENU.some((seccion) => limpiarLineas(menu.secciones[seccion]).length > 0);

export const menuTieneBebidas = (menu: MenuNovedad): boolean => limpiarLineas(menu.secciones.bebidas).length > 0;

/** ¿Algún plato que sigue en el menú tiene bebida de maridaje con nombre? (sin mirar el interruptor) */
export const menuTieneMaridajes = (menu: MenuNovedad): boolean =>
  SECCIONES_MENU.some((seccion) =>
    menu.secciones[seccion].some((item) => item.nombre.trim() !== "" && limpiarLinea(menu.maridajes[item.id]) !== null),
  );

/** ¿La cata tiene alguna bebida con nombre? (sin mirar el tipo) */
export const cataTieneBebidas = (menu: MenuNovedad): boolean => menu.cata.some((linea) => linea.nombre.trim() !== "");

/**
 * ¿Pintaría la web «Ver menú»? (L3) Un Menú necesita algún plato y una Cata
 * alguna bebida. Sustituye a `menuTieneComida` en la vista previa.
 */
export const menuPintable = (menu: MenuNovedad): boolean =>
  menu.tipo === "cata" ? cataTieneBebidas(menu) : menuTieneComida(menu);

/** Las bebidas que se guardarían, en orden: las de cada plato (primero, segundo, postre) o las de la cata. */
export function lineasBebidaMenu(menu: MenuNovedad): LineaBebidaNovedad[] {
  const limpio = limpiarMenuNovedad(menu);
  if (limpio.tipo === "cata") return limpio.cata;
  return SECCIONES_MENU.flatMap((seccion) =>
    limpio.secciones[seccion].flatMap((item) => (limpio.maridajes[item.id] ? [limpio.maridajes[item.id]] : [])),
  );
}

// Avisos de E10: lo del otro tipo se conserva al editar, pero no se guarda.
export const AVISO_GUARDAR_COMO_CATA = "Al guardar como Cata no se guardarán los platos del menú.";
export const AVISO_GUARDAR_COMO_MENU = "Al guardar como Menú no se guardará la lista de la cata.";
export const AVISO_MARIDAJE_APAGADO = "Con el maridaje apagado no se guardarán las bebidas de los platos.";

/** Qué hay en el editor que no se guardará con el tipo y el maridaje elegidos (E10). */
export function avisosMenuNovedad(menu: MenuNovedad): string[] {
  if (menu.tipo === "cata") {
    return menuTieneComida(menu) || menuTieneBebidas(menu) ? [AVISO_GUARDAR_COMO_CATA] : [];
  }
  const avisos: string[] = [];
  if (cataTieneBebidas(menu)) avisos.push(AVISO_GUARDAR_COMO_MENU);
  if (!menu.maridaje && menuTieneMaridajes(menu)) avisos.push(AVISO_MARIDAJE_APAGADO);
  return avisos;
}

function serializarTraducciones(traducciones: TraduccionesNovedad | undefined): { [idioma: string]: Json } | null {
  const salida: { [idioma: string]: Json } = {};
  for (const idioma of IDIOMAS_TRADUCIDOS) {
    const variante = traducciones?.[idioma];
    const nombre = texto(variante?.nombre);
    if (!variante || !nombre) continue;
    salida[idioma] = { nombre, descripcion: texto(variante.descripcion) || null };
  }
  return Object.keys(salida).length > 0 ? salida : null;
}

/** Los campos de `LineaBebidaNovedad`, en el orden del contrato. */
function serializarLinea(linea: LineaBebidaNovedad): { [clave: string]: Json } {
  const salida: { [clave: string]: Json } = {
    id: linea.id,
    origen: linea.origen,
    refId: linea.refId,
    nombre: linea.nombre,
    descripcion: linea.descripcion,
    sulfitos: linea.sulfitos,
  };
  const traducciones = serializarTraducciones(linea.traducciones);
  if (traducciones) salida.traducciones = traducciones;
  return salida;
}

/** Solo los campos del contrato, en un orden fijo (nada de propiedades sueltas). */
function serializarItem(item: ItemMenuNovedad, maridaje?: LineaBebidaNovedad): { [clave: string]: Json } {
  const salida: { [clave: string]: Json } = {
    id: item.id,
    origen: item.origen,
    platoId: item.platoId,
    nombre: item.nombre,
    descripcion: item.descripcion,
    imagenUrl: item.imagenUrl,
    imagenPosicionY: item.imagenPosicionY,
    alergenos: [...item.alergenos],
    alergenosInferidos: [...item.alergenosInferidos],
    alergenosNotas: item.alergenosNotas,
  };
  const traducciones = serializarTraducciones(item.traducciones);
  if (traducciones) salida.traducciones = traducciones;
  // E3: la clave solo si el plato tiene bebida.
  if (maridaje) salida.maridaje = serializarLinea(maridaje);
  return salida;
}

/**
 * El jsonb de `novedades.menu`. Las cuatro secciones siempre presentes (E2).
 * E1 (ADR-6): un Menú sin maridaje se escribe en v1, idéntico al de antes; la
 * v2 solo con maridaje (alguna bebida en algún plato) o con tipo Cata.
 */
export function serializarMenuNovedad(menu: MenuNovedad): Json {
  const limpio = limpiarMenuNovedad(menu);
  if (limpio.tipo === "cata") {
    return {
      version: 2,
      tipo: "cata",
      incluye_bebidas: false,
      maridaje: false,
      secciones: { primero: [], segundo: [], postre: [], bebidas: [], cata: limpio.cata.map(serializarLinea) },
    };
  }
  const plato = (item: ItemMenuNovedad) => serializarItem(item, limpio.maridajes[item.id]);
  const secciones = {
    primero: limpio.secciones.primero.map(plato),
    segundo: limpio.secciones.segundo.map(plato),
    postre: limpio.secciones.postre.map(plato),
    bebidas: limpio.secciones.bebidas.map((item) => serializarItem(item)),
  };
  if (!limpio.maridaje) return { version: 1, incluye_bebidas: limpio.incluye_bebidas, secciones };
  return { version: 2, tipo: "menu", incluye_bebidas: limpio.incluye_bebidas, maridaje: true, secciones };
}

// ---------------------------------------------------------------------------
// Bebidas de la carta y sulfitos (E5, E6, ADR-9)
// ---------------------------------------------------------------------------

/** Lo que hace falta de una fila de `Vinos`. */
export interface VinoParaMenu {
  id: string;
  nombre: string | null;
  nombre_en?: string | null;
  nombre_fr?: string | null;
  alergenos_oficiales?: unknown;
}

/** Lo que hace falta de una fila de `Bebidas` (la tabla no tiene alérgenos). */
export interface BebidaParaMenu {
  id: string;
  nombre: string | null;
  nombre_en?: string | null;
  nombre_fr?: string | null;
  /** «Copas», «Tintos de verano», «Cervezas»…: decide la casilla de sulfitos inicial. */
  categoria?: string | null;
}

/** E5: entra en el buscador si está en la carta (activado Y restaurante) y tiene nombre. */
export const bebidaElegibleParaMenu = (fila: PlatoEnlazable & { nombre?: string | null }): boolean =>
  platoEnCarta(fila) && texto(fila.nombre) !== "";

/** ¿Declara `alergenos_oficiales` los sulfitos? Null, vacío o ilegible es false. */
/** Minúsculas, sin tildes y sin signos, para comparar «Fondillón» con «fondillon». */
const normalizarBusqueda = (valor: string): string =>
  valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Cómo coincide un vino o una bebida de la carta con lo que se busca, de mejor
 * a peor: 0 nombre exacto, 1 el nombre empieza por, 2 una palabra del nombre
 * empieza por, 3 el nombre lo contiene, 4 la categoría lo contiene («tintos»,
 * «licores»), 5 todas las palabras están en el nombre o la categoría. `null`
 * si no coincide. Sin texto, todo vale 0 (se queda el orden de la carta).
 */
export function coincidenciaBusqueda(nombre: string, categoria: string | null, busqueda: string): number | null {
  const buscado = normalizarBusqueda(busqueda);
  if (!buscado) return 0;
  const enNombre = normalizarBusqueda(nombre);
  if (enNombre === buscado) return 0;
  if (enNombre.startsWith(buscado)) return 1;
  if (` ${enNombre}`.includes(` ${buscado}`)) return 2;
  if (enNombre.includes(buscado)) return 3;
  const enCategoria = normalizarBusqueda(categoria ?? "");
  if (enCategoria.includes(buscado)) return 4;
  const todo = `${enNombre} ${enCategoria}`;
  return buscado.split(" ").every((palabra) => todo.includes(palabra)) ? 5 : null;
}

export const sulfitosDeVino = (alergenosOficiales: unknown): boolean =>
  parseAlergenos(alergenosOficiales).some((valor) => normalizarAlergeno(valor) === "sulfitos");

const conTraducciones = (linea: LineaBebidaNovedad, traducciones: TraduccionesNovedad | undefined) =>
  traducciones ? { ...linea, traducciones } : linea;

/** Un vino de la carta: nombre y nombres en/fr copiados, sulfitos de la carta (fijos). */
export function lineaDesdeVino(vino: VinoParaMenu): LineaBebidaNovedad {
  return conTraducciones(
    {
      id: nuevoIdItem(),
      origen: "vino",
      refId: vino.id,
      nombre: texto(vino.nombre),
      descripcion: null,
      sulfitos: sulfitosDeVino(vino.alergenos_oficiales),
    },
    traduccionesDesdeCarta({ nombre_en: vino.nombre_en, nombre_fr: vino.nombre_fr }),
  );
}

/** Categorías de `Bebidas` que son vino enteras (la carta: «Copas», «Tintos de verano»). */
const CATEGORIAS_VINO = new Set(["copa", "copas", "tinto de verano", "tintos de verano"]);

/**
 * Palabras que hacen vino una bebida, en la categoría o en el nombre. Palabra
 * entera (con su plural): «cava» sí, «cavalier» no. «Tinto de verano» va aquí
 * también para cuando no es la categoría sino el nombre («Refrescos» → «Tinto
 * de verano»).
 */
const PALABRAS_VINO =
  /\b(vinos?|cavas?|champagnes?|champan(es)?|espumos[oa]s?|sangrias?|vermut(s)?|vermus?|vermouths?|tintos? de verano)\b/;

/** «tinto», «blanco», «rosado» solo cuentan si la categoría es de copas («Ron blanco» no es vino). */
const COLORES_VINO = /\b(tintos?|blancos?|rosados?)\b/;
const CATEGORIA_DE_COPAS = /\bcopas?\b/;

/**
 * ¿Es vino esta bebida de la carta? (decisión del dueño en QA DEMO, cambia la
 * ADR-9). `Bebidas` no tiene alérgenos, así que solo sirve para el valor
 * INICIAL de la casilla de sulfitos: un vino sale marcado y se puede desmarcar.
 * Sin tildes ni mayúsculas. Cerveza, refrescos, agua, café, licores y
 * destilados no son vino.
 */
export function bebidaEsVino(categoria: string | null | undefined, nombre: string | null | undefined): boolean {
  const enCategoria = normalizarBusqueda(categoria ?? "");
  const enNombre = normalizarBusqueda(nombre ?? "");
  if (CATEGORIAS_VINO.has(enCategoria)) return true;
  if (PALABRAS_VINO.test(enCategoria) || PALABRAS_VINO.test(enNombre)) return true;
  return CATEGORIA_DE_COPAS.test(enCategoria) && (COLORES_VINO.test(enCategoria) || COLORES_VINO.test(enNombre));
}

/**
 * Una bebida de la carta: la tabla no tiene alérgenos, así que la casilla
 * empieza marcada si es vino (`bebidaEsVino`) y desmarcada si no; se puede
 * cambiar. Una línea ya guardada no pasa por aquí: se queda con lo guardado.
 */
export function lineaDesdeBebida(bebida: BebidaParaMenu): LineaBebidaNovedad {
  return conTraducciones(
    {
      id: nuevoIdItem(),
      origen: "bebida",
      refId: bebida.id,
      nombre: texto(bebida.nombre),
      descripcion: null,
      sulfitos: bebidaEsVino(bebida.categoria, bebida.nombre),
    },
    traduccionesDesdeCarta({ nombre_en: bebida.nombre_en, nombre_fr: bebida.nombre_fr }),
  );
}

/** Los dos botones de «a mano». El valor de los sulfitos lo da el botón, no el nombre (ADR-9). */
export type ClaseLineaLibre = "vino" | "otra";
export const ETIQUETA_LINEA_LIBRE: Record<ClaseLineaLibre, string> = {
  vino: "Vino, cava o champagne",
  otra: "Otra bebida",
};

export function lineaLibre(clase: ClaseLineaLibre, nombre = ""): LineaBebidaNovedad {
  return {
    id: nuevoIdItem(),
    origen: "libre",
    refId: null,
    nombre: nombre.trim(),
    descripcion: null,
    sulfitos: clase === "vino",
  };
}

/** E6: en un vino de la carta la casilla es de solo lectura. */
export const sulfitosEditables = (linea: Pick<LineaBebidaNovedad, "origen">): boolean => linea.origen !== "vino";

/** El texto de solo lectura de un vino de la carta (E6). */
export const textoSulfitosCarta = (linea: Pick<LineaBebidaNovedad, "sulfitos">): string =>
  linea.sulfitos ? "Según la carta: contiene sulfitos" : "La carta no declara sulfitos";

/** Cambia la casilla; en un vino de la carta no hace nada. */
export const conSulfitos = (linea: LineaBebidaNovedad, sulfitos: boolean): LineaBebidaNovedad =>
  sulfitosEditables(linea) ? { ...linea, sulfitos } : linea;

// ---------------------------------------------------------------------------
// Validación al guardar
// ---------------------------------------------------------------------------

export type CodigoErrorBotones =
  | "demasiados"
  | "desconocido"
  | "repetido"
  | "menu_sin_platos"
  | "bebidas_vacias"
  | "maridaje_vacio"
  | "cata_vacia"
  | "plato_sin_enlazar"
  | "plato_fuera_de_carta";

export interface ErrorBotones {
  codigo: CodigoErrorBotones;
  mensaje: string;
}

export interface BotonesParaValidar {
  /** Lo que hay en el formulario (se admite cualquier cadena: es una defensa). */
  botones: readonly string[];
  menu: MenuNovedad;
  /** De `estadoPlatoEnlazado`. Con `desconocido` no se juzga el plato. */
  estadoPlato: EstadoPlatoEnlazado;
}

/** Por qué no se puede guardar. Lista vacía = se puede. */
export function validarBotonesNovedad({ botones, menu, estadoPlato }: BotonesParaValidar): ErrorBotones[] {
  const errores: ErrorBotones[] = [];

  if (botones.length > MAX_BOTONES) {
    errores.push({ codigo: "demasiados", mensaje: `Como mucho ${MAX_BOTONES} botones por novedad: quita alguno.` });
  }
  if (botones.some((tipo) => !esTipoBoton(tipo))) {
    errores.push({ codigo: "desconocido", mensaje: "Hay un botón que no existe. Quítalo y elige uno de la lista." });
  }
  const repetidos = TIPOS_BOTON.filter((tipo) => botones.filter((b) => b === tipo).length > 1);
  for (const tipo of repetidos) {
    errores.push({
      codigo: "repetido",
      mensaje: `«${ETIQUETA_BOTON[tipo]}» está repetido: cada botón solo puede salir una vez.`,
    });
  }

  if (botones.includes("ver_menu")) {
    if (menu.tipo === "cata") {
      if (!menuPintable(menu)) {
        errores.push({ codigo: "cata_vacia", mensaje: "Una cata necesita al menos una bebida." });
      }
    } else {
      if (!menuPintable(menu)) {
        errores.push({
          codigo: "menu_sin_platos",
          mensaje: "«Ver menú» necesita al menos un plato en primero, segundo o postre.",
        });
      }
      if (menu.incluye_bebidas && !menuTieneBebidas(menu)) {
        errores.push({
          codigo: "bebidas_vacias",
          mensaje: "Con «Comida + bebidas» añade al menos una bebida, o elige «Solo comida».",
        });
      }
      if (menu.maridaje && !menuTieneMaridajes(menu)) {
        errores.push({
          codigo: "maridaje_vacio",
          mensaje: "“Con maridaje” necesita al menos una bebida en algún plato, o apágalo.",
        });
      }
    }
  }

  if (botones.includes("ver_plato")) {
    if (estadoPlato === "sin_plato") {
      errores.push({
        codigo: "plato_sin_enlazar",
        mensaje: "«Échale un vistazo» necesita un plato de la carta enlazado.",
      });
    } else if (estadoPlato === "fuera_de_carta") {
      errores.push({
        codigo: "plato_fuera_de_carta",
        mensaje: "El plato ya no está en la carta: enlaza otro o quita «Échale un vistazo».",
      });
    }
  }

  return errores;
}

// ---------------------------------------------------------------------------
// Payload (regla 2.4)
// ---------------------------------------------------------------------------

export interface CamposBotonesNovedad {
  botones: TipoBoton[];
  menu: Json | null;
  plato_id: string | null;
}

/**
 * Las claves `botones`, `menu` y `plato_id` del guardado. Vacío (sin ninguna
 * de las tres) si la novedad no tiene botones ni los tenía al abrirla: así se
 * sigue guardando igual que antes, también contra una BBDD sin la migración.
 * `menu` debe llegar ya traducido (`traducirMenuNovedad`).
 */
export function camposBotonesPayload({
  botonesAlAbrir,
  botones,
  platoId,
  menu,
}: {
  botonesAlAbrir: readonly TipoBoton[];
  botones: readonly TipoBoton[];
  platoId: string | null;
  menu: MenuNovedad;
}): Partial<CamposBotonesNovedad> {
  if (botones.length === 0 && botonesAlAbrir.length === 0) return {};
  return {
    botones: [...botones],
    menu: botones.includes("ver_menu") ? serializarMenuNovedad(menu) : null,
    plato_id: botones.includes("ver_plato") ? platoId : null,
  };
}

/**
 * ¿El error del guardado es porque la BBDD aún no tiene las columnas nuevas?
 * (PostgREST: «Could not find the 'botones' column of 'novedades' in the
 * schema cache»).
 */
export const esErrorSinColumnasBotones = (mensaje: string): boolean =>
  /'(botones|menu)' column|column "?(botones|menu)"?/i.test(mensaje);

// ---------------------------------------------------------------------------
// Traducción del menú
// ---------------------------------------------------------------------------

/** Lo que hace falta de un plato de la carta para copiar su traducción. */
export interface PlatoConTraducciones {
  nombre_en?: string | null;
  nombre_fr?: string | null;
  descripcion_en?: string | null;
  descripcion_fr?: string | null;
}

const traduccionCompleta = (item: ItemMenuNovedad): boolean =>
  IDIOMAS_TRADUCIDOS.every((idioma) => !!item.traducciones?.[idioma]?.nombre);

/** Las traducciones de un plato de la carta (`nombre_en`, `descripcion_fr`...). */
export function traduccionesDesdeCarta(plato: PlatoConTraducciones): TraduccionesNovedad | undefined {
  const traducciones: TraduccionesNovedad = {};
  for (const idioma of IDIOMAS_TRADUCIDOS) {
    const nombre = texto(idioma === "en" ? plato.nombre_en : plato.nombre_fr);
    if (!nombre) continue;
    const descripcion = texto(idioma === "en" ? plato.descripcion_en : plato.descripcion_fr);
    traducciones[idioma] = { nombre, descripcion: descripcion || null };
  }
  return Object.keys(traducciones).length > 0 ? traducciones : undefined;
}

/**
 * Tras un cambio en el editor: una línea cuyo nombre o descripción en español
 * ha cambiado pierde sus traducciones (ya no dicen lo mismo) y se vuelve a
 * traducir al guardar. Las demás las conservan.
 */
export function conservarTraduccionesVigentes(
  anteriores: readonly ItemMenuNovedad[],
  siguientes: readonly ItemMenuNovedad[],
): ItemMenuNovedad[] {
  const porId = new Map(anteriores.map((item) => [item.id, item]));
  return siguientes.map((item) => {
    if (!item.traducciones) return item;
    const antes = porId.get(item.id);
    if (!antes) return item;
    const igual =
      antes.nombre.trim() === item.nombre.trim() && (antes.descripcion ?? "") === (item.descripcion ?? "");
    if (igual) return item;
    const { traducciones: _viejas, ...sinTraducciones } = item;
    return sinTraducciones;
  });
}

/**
 * Lo mismo para una bebida: si cambia el nombre (solo se puede a mano) pierde
 * todas sus traducciones; si solo cambia la descripción, conserva los nombres
 * (en una bebida de la carta vienen de la carta) y pierde las descripciones.
 */
export function conservarTraduccionesLinea(
  antes: LineaBebidaNovedad | null | undefined,
  despues: LineaBebidaNovedad,
): LineaBebidaNovedad {
  if (!despues.traducciones || !antes || antes.id !== despues.id) return despues;
  const mismoNombre = antes.nombre.trim() === despues.nombre.trim();
  if (mismoNombre && texto(antes.descripcion) === texto(despues.descripcion)) return despues;
  const { traducciones, ...sinTraducciones } = despues;
  if (!mismoNombre) return sinTraducciones;
  const soloNombres: TraduccionesNovedad = {};
  for (const idioma of IDIOMAS_TRADUCIDOS) {
    const variante = traducciones[idioma];
    if (variante) soloNombres[idioma] = { nombre: variante.nombre, descripcion: null };
  }
  return { ...sinTraducciones, traducciones: soloNombres };
}

/** Cómo se llama a `traducir-contenido` (inyectado para poder probarlo). */
export type InvocarTraductorMenu = (body: {
  tipo: "menu";
  datos: Record<SeccionMenu, string>;
}) => Promise<{ data: unknown; error: unknown }>;

export interface ResultadoTraduccionMenu {
  /** El menú limpio y con las `traducciones` que se hayan podido completar. */
  menu: MenuNovedad;
  /** Líneas que necesitaban el traductor y se quedan en castellano. */
  sinTraducir: number;
}

type Variantes = Map<IdiomaTraducido, Map<string, VarianteIdioma>>;

// Una bebida necesita el traductor si es a mano y le falta el nombre en algún
// idioma, o si tiene descripción y le falta traducirla (E8). El nombre de una
// bebida de la carta es el de la carta: si no lo tiene traducido, se queda así.
const nombreLineaPendiente = (linea: LineaBebidaNovedad): boolean =>
  linea.origen === "libre" && IDIOMAS_TRADUCIDOS.some((idioma) => !linea.traducciones?.[idioma]?.nombre);
const descripcionLineaPendiente = (linea: LineaBebidaNovedad): boolean =>
  !!linea.descripcion && IDIOMAS_TRADUCIDOS.some((idioma) => !linea.traducciones?.[idioma]?.descripcion);
const lineaPendiente = (linea: LineaBebidaNovedad): boolean =>
  nombreLineaPendiente(linea) || descripcionLineaPendiente(linea);

const huecosVacios = (): Record<SeccionMenu, ItemMenu[]> => ({ primero: [], segundo: [], postre: [] });

/** Junta las variantes de varias llamadas (los ids no se repiten entre ellas). */
function unirVariantes(todas: Variantes[]): Variantes {
  const resultado: Variantes = new Map(IDIOMAS_TRADUCIDOS.map((idioma) => [idioma, new Map()]));
  for (const variantes of todas) {
    for (const [idioma, porId] of variantes) for (const [id, variante] of porId) resultado.get(idioma)!.set(id, variante);
  }
  return resultado;
}

/** `emparejarTraduccion` empareja por líneas: cada texto ocupa exactamente una. */
const comoItem = (id: string, textoLinea: string): ItemMenu => ({
  id,
  origen: "libre",
  platoId: null,
  nombre: textoLinea.replace(/\s+/g, " ").trim(),
  descripcion: null,
  imagenUrl: null,
  imagenPosicionY: null,
  alergenos: [],
  alergenosInferidos: [],
  alergenosNotas: null,
});
const ID_NOMBRE = (id: string) => `nombre:${id}`;
const ID_DESCRIPCION = (id: string) => `descripcion:${id}`;

/**
 * Completa las traducciones del menú antes de guardarlo, igual que el menú del
 * día (EditorMenuTapasWeb):
 *  1. Lo que ya está traducido se respeta.
 *  2. Un plato de la carta copia `nombre_en/fr` y `descripcion_en/fr` del plato
 *     (gratis y exacto). Si la carta no lo tiene traducido, se queda en
 *     castellano: no se inventa una segunda versión del mismo plato.
 *  3. Los platos escritos a mano, y el plato que ya no está en la carta, van a
 *     `traducir-contenido` con `tipo: "menu"`, como en el menú del día.
 *  4. Cada bebida escrita a mano va en SU PROPIA llamada: la de la sección
 *     Bebidas en el hueco de `primero`, y la del maridaje o la cata (E8) con
 *     el nombre a mano solo en `primero` y la descripción sola en `segundo`.
 *     La función manda «Primero: …\nSegundo: …» y funde en una las líneas de
 *     bebidas de un mismo hueco (QA DEMO 31-10-2026: con 2 devolvía 1), así
 *     que nunca se mandan dos bebidas en el mismo hueco.
 * Nombre y descripción se emparejan cada uno por su lado: si falla uno, el
 * otro se guarda. Lo que no se traduce se guarda en castellano (la web enseña
 * el castellano) y se cuenta en `sinTraducir` para avisar.
 */
export async function traducirMenuNovedad(
  menu: MenuNovedad,
  platosPorId: ReadonlyMap<string, PlatoConTraducciones>,
  invocar: InvocarTraductorMenu,
): Promise<ResultadoTraduccionMenu> {
  const limpio = limpiarMenuNovedad(menu);
  const enLaCarta = (item: ItemMenuNovedad) =>
    item.origen === "carta" && !!item.platoId && platosPorId.has(item.platoId);

  // 1 y 2: la carta.
  const conCarta = {} as SeccionesMenuNovedad;
  for (const seccion of SECCIONES_MENU_NOVEDAD) {
    conCarta[seccion] = limpio.secciones[seccion].map((item) => {
      if (traduccionCompleta(item) || !enLaCarta(item)) return item;
      const deCarta = traduccionesDesdeCarta(platosPorId.get(item.platoId as string) as PlatoConTraducciones);
      return deCarta ? { ...item, traducciones: { ...item.traducciones, ...deCarta } } : item;
    });
  }

  // 3 y 4: el traductor.
  const pendiente = (item: ItemMenuNovedad) => !traduccionCompleta(item) && !enLaCarta(item);
  const comida = Object.fromEntries(
    SECCIONES_MENU.map((seccion) => [seccion, conCarta[seccion].filter(pendiente)]),
  ) as Record<SeccionMenu, ItemMenuNovedad[]>;
  const llamadasBebidas = conCarta.bebidas
    .filter(pendiente)
    .map((item): Record<SeccionMenu, ItemMenu[]> => ({ ...huecosVacios(), primero: [item] }));
  const llamadasLineas = lineasBebidaMenu(limpio)
    .filter(lineaPendiente)
    .map(
      (linea): Record<SeccionMenu, ItemMenu[]> => ({
        ...huecosVacios(),
        primero: nombreLineaPendiente(linea) ? [comoItem(ID_NOMBRE(linea.id), linea.nombre)] : [],
        segundo: descripcionLineaPendiente(linea)
          ? [comoItem(ID_DESCRIPCION(linea.id), linea.descripcion as string)]
          : [],
      }),
    );

  const pedir = async (porSeccion: Record<SeccionMenu, ItemMenu[]>): Promise<Variantes> => {
    const variantes: Variantes = new Map(IDIOMAS_TRADUCIDOS.map((idioma) => [idioma, new Map()]));
    if (SECCIONES_MENU.every((seccion) => porSeccion[seccion].length === 0)) return variantes;
    try {
      const { data, error } = await invocar({
        tipo: "menu",
        datos: {
          primero: textoDeSeccion(porSeccion.primero),
          segundo: textoDeSeccion(porSeccion.segundo),
          postre: textoDeSeccion(porSeccion.postre),
        },
      });
      // traducir-contenido responde 200 con {ok:false, error} si falla OpenAI.
      const respuesta = (data ?? {}) as { ok?: boolean; translations?: Record<string, unknown>; error?: unknown };
      if (error || !respuesta.ok) {
        console.error("Error al traducir el menú de la novedad:", error ?? respuesta.error);
        return variantes;
      }
      for (const idioma of IDIOMAS_TRADUCIDOS) {
        const bloque = respuesta.translations?.[`menu_${idioma}`];
        if (!bloque || typeof bloque !== "object") continue;
        const textos = bloque as Record<string, unknown>;
        for (const seccion of SECCIONES_MENU) {
          const traducido = typeof textos[seccion] === "string" ? (textos[seccion] as string) : "";
          for (const [id, variante] of emparejarTraduccion(porSeccion[seccion], traducido)) {
            variantes.get(idioma)!.set(id, variante);
          }
        }
      }
    } catch (e) {
      console.error("Error al traducir el menú de la novedad:", e);
    }
    return variantes;
  };

  const [deComida, deBebidas, traduccionLineas] = await Promise.all([
    pedir(comida),
    Promise.all(llamadasBebidas.map(pedir)).then(unirVariantes),
    Promise.all(llamadasLineas.map(pedir)).then(unirVariantes),
  ]);

  let sinTraducir = 0;
  const secciones = {} as SeccionesMenuNovedad;
  for (const seccion of SECCIONES_MENU_NOVEDAD) {
    const variantes = seccion === "bebidas" ? deBebidas : deComida;
    secciones[seccion] = conCarta[seccion].map((item) => {
      if (!pendiente(item)) return item;
      const traducciones = { ...item.traducciones };
      for (const idioma of IDIOMAS_TRADUCIDOS) {
        const variante = variantes.get(idioma)?.get(item.id);
        if (variante) traducciones[idioma] = variante;
      }
      const resultado: ItemMenuNovedad = Object.keys(traducciones).length > 0 ? { ...item, traducciones } : item;
      if (!traduccionCompleta(resultado)) sinTraducir += 1;
      return resultado;
    });
  }

  const traducirLinea = (linea: LineaBebidaNovedad): LineaBebidaNovedad => {
    if (!lineaPendiente(linea)) return linea;
    const traducciones: TraduccionesNovedad = { ...linea.traducciones };
    let falta = false;
    for (const idioma of IDIOMAS_TRADUCIDOS) {
      const actual = linea.traducciones?.[idioma];
      const delTraductor = traduccionLineas.get(idioma);
      // Nombre y descripción, cada uno por su lado: si falla uno, el otro se guarda.
      let nombre = actual?.nombre ?? "";
      if (!nombre && linea.origen === "libre") {
        nombre = delTraductor?.get(ID_NOMBRE(linea.id))?.nombre ?? "";
        if (!nombre) falta = true;
      }
      let descripcion = actual?.descripcion ?? null;
      if (!descripcion && linea.descripcion) {
        descripcion = delTraductor?.get(ID_DESCRIPCION(linea.id))?.nombre ?? null;
        if (!descripcion) falta = true;
      }
      if (!nombre && !descripcion) continue;
      // Sin nombre traducido (de la carta sin traducir, o a mano y el traductor
      // no lo devolvió) la variante lleva el castellano y la descripción traducida.
      traducciones[idioma] = { nombre: nombre || linea.nombre, descripcion };
    }
    if (falta) sinTraducir += 1;
    return Object.keys(traducciones).length > 0 ? { ...linea, traducciones } : linea;
  };

  const maridajes: Record<string, LineaBebidaNovedad> = {};
  for (const [idPlato, linea] of Object.entries(limpio.maridajes)) maridajes[idPlato] = traducirLinea(linea);

  return { menu: { ...limpio, secciones, maridajes, cata: limpio.cata.map(traducirLinea) }, sinTraducir };
}
