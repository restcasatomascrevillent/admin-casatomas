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
// ---------------------------------------------------------------------------

import type { Json } from "@/integrations/supabase/types";
import {
  SECCIONES_MENU,
  emparejarTraduccion,
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
  en: { llamar: "Call", ver_menu: "See menu", ver_plato: "Take a look" },
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
 * plato en la carta y «Ver menú» solo si el menú tiene algún plato.
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

/** `ItemMenu` v2 del menú del día + su texto en inglés y francés. */
export interface ItemMenuNovedad extends ItemMenu {
  traducciones?: Partial<Record<IdiomaTraducido, VarianteIdioma>>;
}

export type SeccionesMenuNovedad = Record<SeccionMenuNovedad, ItemMenuNovedad[]>;

export interface MenuNovedad {
  version: 1;
  /** «Comida + bebidas» (true) o «Solo comida» (false). */
  incluye_bebidas: boolean;
  secciones: SeccionesMenuNovedad;
}

export const menuNovedadVacio = (): MenuNovedad => ({
  version: 1,
  incluye_bebidas: false,
  secciones: { primero: [], segundo: [], postre: [], bebidas: [] },
});

const texto = (valor: unknown): string => (typeof valor === "string" ? valor.trim() : "");

function parseTraducciones(valor: unknown): ItemMenuNovedad["traducciones"] | undefined {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return undefined;
  const mapa = valor as Record<string, unknown>;
  const traducciones: Partial<Record<IdiomaTraducido, VarianteIdioma>> = {};
  for (const idioma of IDIOMAS_TRADUCIDOS) {
    const variante = mapa[idioma];
    if (!variante || typeof variante !== "object" || Array.isArray(variante)) continue;
    const obj = variante as Record<string, unknown>;
    const nombre = texto(obj.nombre);
    if (!nombre) continue;
    traducciones[idioma] = { nombre, descripcion: texto(obj.descripcion) || null };
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
 * Lee `novedades.menu`. Devuelve `null` si no hay menú (columna ausente, NULL
 * o algo que no es un menú). Las secciones que falten se leen como vacías.
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
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return null;
  const obj = crudo as Record<string, unknown>;
  const secciones = obj.secciones;
  if (!secciones || typeof secciones !== "object" || Array.isArray(secciones)) return null;
  const mapa = secciones as Record<string, unknown>;

  const menu = menuNovedadVacio();
  menu.incluye_bebidas = obj.incluye_bebidas === true;
  for (const seccion of SECCIONES_MENU_NOVEDAD) {
    const lista = mapa[seccion];
    if (!Array.isArray(lista)) continue;
    menu.secciones[seccion] = lista
      .map(parseItemNovedad)
      .filter((item): item is ItemMenuNovedad => item !== null);
  }
  return menu;
}

/** Líneas con nombre vacío fuera (se añade «A mano» y puede quedarse en blanco). */
const limpiarLineas = (items: ItemMenuNovedad[]): ItemMenuNovedad[] =>
  items.map((item) => ({ ...item, nombre: item.nombre.trim() })).filter((item) => item.nombre !== "");

/** El menú tal y como se guarda: sin líneas vacías y sin bebidas con «Solo comida». */
export function limpiarMenuNovedad(menu: MenuNovedad): MenuNovedad {
  return {
    version: 1,
    incluye_bebidas: menu.incluye_bebidas,
    secciones: {
      primero: limpiarLineas(menu.secciones.primero),
      segundo: limpiarLineas(menu.secciones.segundo),
      postre: limpiarLineas(menu.secciones.postre),
      bebidas: menu.incluye_bebidas ? limpiarLineas(menu.secciones.bebidas) : [],
    },
  };
}

/** ¿Hay algún plato en primero, segundo o postre? (sin él «Ver menú» no sale). */
export const menuTieneComida = (menu: MenuNovedad): boolean =>
  SECCIONES_MENU.some((seccion) => limpiarLineas(menu.secciones[seccion]).length > 0);

export const menuTieneBebidas = (menu: MenuNovedad): boolean => limpiarLineas(menu.secciones.bebidas).length > 0;

/** Solo los campos del contrato, en un orden fijo (nada de propiedades sueltas). */
function serializarItem(item: ItemMenuNovedad): { [clave: string]: Json } {
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
  const traducciones: { [idioma: string]: Json } = {};
  for (const idioma of IDIOMAS_TRADUCIDOS) {
    const variante = item.traducciones?.[idioma];
    const nombre = texto(variante?.nombre);
    if (!variante || !nombre) continue;
    traducciones[idioma] = { nombre, descripcion: texto(variante.descripcion) || null };
  }
  if (Object.keys(traducciones).length > 0) salida.traducciones = traducciones;
  return salida;
}

/** El jsonb de `novedades.menu`. Las cuatro secciones siempre presentes. */
export function serializarMenuNovedad(menu: MenuNovedad): Json {
  const limpio = limpiarMenuNovedad(menu);
  return {
    version: 1,
    incluye_bebidas: limpio.incluye_bebidas,
    secciones: {
      primero: limpio.secciones.primero.map(serializarItem),
      segundo: limpio.secciones.segundo.map(serializarItem),
      postre: limpio.secciones.postre.map(serializarItem),
      bebidas: limpio.secciones.bebidas.map(serializarItem),
    },
  };
}

// ---------------------------------------------------------------------------
// Validación al guardar
// ---------------------------------------------------------------------------

export type CodigoErrorBotones =
  | "demasiados"
  | "desconocido"
  | "repetido"
  | "menu_sin_platos"
  | "bebidas_vacias"
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
    if (!menuTieneComida(menu)) {
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
export function traduccionesDesdeCarta(plato: PlatoConTraducciones): ItemMenuNovedad["traducciones"] | undefined {
  const traducciones: Partial<Record<IdiomaTraducido, VarianteIdioma>> = {};
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

/**
 * Completa las traducciones del menú antes de guardarlo, igual que el menú del
 * día (EditorMenuTapasWeb):
 *  1. Lo que ya está traducido se respeta.
 *  2. Un plato de la carta copia `nombre_en/fr` y `descripcion_en/fr` del plato
 *     (gratis y exacto). Si la carta no lo tiene traducido, se queda en
 *     castellano: no se inventa una segunda versión del mismo plato.
 *  3. Lo escrito a mano, y el plato que ya no está en la carta, va a
 *     `traducir-contenido` con `tipo: "menu"`. Las bebidas van en una segunda
 *     llamada, en el hueco de `primero`.
 * Si el traductor falla o devuelve otro número de líneas, esas líneas se
 * guardan sin traducción (la web enseña el castellano) y se cuentan en
 * `sinTraducir` para avisar.
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

  // 3: el traductor.
  const pendiente = (item: ItemMenuNovedad) => !traduccionCompleta(item) && !enLaCarta(item);
  const comida = Object.fromEntries(
    SECCIONES_MENU.map((seccion) => [seccion, conCarta[seccion].filter(pendiente)]),
  ) as Record<SeccionMenu, ItemMenuNovedad[]>;
  const bebidas: Record<SeccionMenu, ItemMenuNovedad[]> = {
    primero: conCarta.bebidas.filter(pendiente),
    segundo: [],
    postre: [],
  };

  const pedir = async (porSeccion: Record<SeccionMenu, ItemMenuNovedad[]>): Promise<Variantes> => {
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

  const [deComida, deBebidas] = await Promise.all([pedir(comida), pedir(bebidas)]);

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

  return { menu: { ...limpio, secciones }, sinTraducir };
}
