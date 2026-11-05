/**
 * Qué entra en la carta impresa y en qué orden, con el mismo criterio que la
 * web pública (web-casatomas):
 *
 *  · Solo lo activo y publicado en la carta elegida: `activado` y
 *    `restaurante` (Casa Tomás) o `touza` (Touza), como piden a Supabase
 *    `CartaPlatos.tsx` y `CartaVinos.tsx`.
 *  · Platos por categoría en el orden de la web (`CATEGORIAS_PLATOS` de
 *    src/lib/carta-ssg.ts; las que no están en esa lista, detrás por orden
 *    alfabético) y, dentro, por `orden` y luego por `id`.
 *  · Vinos por tipo (tintos, blancos, espumosos, rosados, otros: el orden de
 *    las píldoras de la web), por denominación y, dentro, por `orden` e `id`.
 *  · Idioma: columna `campo_{idioma}` → `traducciones[idioma][campo]` →
 *    castellano (`resolveTranslatedItem` de src/lib/carta-i18n.ts). Si falta
 *    la traducción, sale en castellano.
 *  · Precios en es-ES («12,50 €», también en inglés y francés, como la web).
 */
import { categoriaCorta, esCategoriaOrigenPendiente, TIPOS_VINO, tipoVino, type TipoVino } from "@/lib/tipos-vino";
import { normalizarUnidadPlato } from "@/lib/unidades-platos";
import { clavesAlergenosFila, nombreEnFrase, numeracionAlergenos, type EntradaLeyenda } from "./alergenos";
import { CONSULTAR_ORIGEN, TEXTOS, type IdiomaCarta } from "./textos";

export type TipoCartaImpresa = "platos" | "vinos";
export type CartaImpresa = "restaurante" | "touza";

export const NOMBRE_CARTA: Record<CartaImpresa, string> = {
  restaurante: "Casa Tomás",
  touza: "Touza",
};

/** Lo que se lee de una fila de `Platos` o `Vinos` (las del panel, con `select("*")`). */
export interface FilaCarta {
  id: string;
  nombre: string | null;
  categoria: string | null;
  precio_eur: number | null;
  descripcion?: string | null;
  orden?: ValorOrden;
  activado?: boolean | null;
  restaurante?: boolean | null;
  touza?: boolean | null;
  alergenos_oficiales?: unknown;
  alergenos_inferidos?: unknown;
}

export interface FilaPlato extends FilaCarta {
  unidad?: string | null;
}

export interface FilaVino extends FilaCarta {
  ubicacion_region?: string | null;
  ubicacion_pais?: string | null;
  denominacion_origen?: string | null;
  copeo?: boolean | null;
  precio_copa_eur?: number | null;
}

/** Un plato o un vino ya listo para pintar. */
export interface ElementoCarta {
  id: string;
  nombre: string;
  /** Platos: la descripción de la carta. Vinos: la zona (región y, fuera de España, país). */
  detalle: string | null;
  /** «12,50 €» o «Consultar precio». */
  precio: string;
  /** «kg», «100 g»… (sin «Unidad» ni «Ración», que no hace falta decir). */
  unidad: string | null;
  /** Vinos por copas: «Copa 4,50 €». */
  copa: string | null;
  /** Números de la leyenda de alérgenos. */
  alergenos: number[];
}

export interface GrupoCarta {
  /** Denominación (vinos); null en platos. */
  titulo: string | null;
  elementos: ElementoCarta[];
}

export interface SeccionCarta {
  clave: string;
  titulo: string;
  /** Empieza en página nueva (cada tipo de vino). */
  paginaNueva: boolean;
  grupos: GrupoCarta[];
}

export interface ContenidoCarta {
  tipo: TipoCartaImpresa;
  carta: CartaImpresa;
  idioma: IdiomaCarta;
  secciones: SeccionCarta[];
  /** Leyenda de alérgenos (vacía si ningún elemento lleva número). */
  leyenda: EntradaLeyenda[];
  /** Alérgenos que llevan TODOS los vinos («Todos nuestros vinos contienen sulfitos.»). */
  notaComun: string | null;
}

// ─── Comunes ────────────────────────────────────────────────────────────────

/** Mismo orden que `CATEGORIAS_PLATOS` de la web (web-casatomas/src/lib/carta-ssg.ts). */
export const ORDEN_CATEGORIAS_PLATOS = [
  "NOVEDADES DEL DÍA",
  "SNACK",
  "ENTRANTES FRÍOS",
  "ENTRANTES CALIENTES",
  "ENSALADAS",
  "SALAZONES",
  "MARISCOS",
  "PESCADOS",
  "CARNES",
  "ARROCES",
  "POSTRES",
] as const;

const FORMATO_EUROS = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

/** «12,50 €»: siempre dos decimales y espacio duro antes del €, en los tres idiomas (como la web). */
export function formatearPrecio(precio: number): string {
  return FORMATO_EUROS.format(precio);
}

export const precioConocido = (precio: unknown): precio is number =>
  typeof precio === "number" && Number.isFinite(precio) && precio > 0;

export function textoPrecio(precio: unknown, idioma: IdiomaCarta): string {
  return precioConocido(precio) ? formatearPrecio(precio) : TEXTOS[idioma].consultarPrecio;
}

/** ¿Sale en la carta elegida? El mismo filtro que la web: `activado` y su interruptor. */
export function publicadoEnCarta(fila: FilaCarta, carta: CartaImpresa): boolean {
  return fila.activado === true && fila[carta] === true;
}

const texto = (valor: unknown): string => (typeof valor === "string" ? valor.trim() : "");

function parseTraducciones(valor: unknown): Record<string, Record<string, unknown>> | null {
  if (!valor) return null;
  if (typeof valor === "string") {
    try {
      const parsed = JSON.parse(valor);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof valor === "object" ? (valor as Record<string, Record<string, unknown>>) : null;
}

/**
 * Un campo en el idioma pedido: `campo_{idioma}` → `traducciones[idioma][campo]`
 * → castellano. Un texto vacío cuenta como «sin traducir».
 */
export function campoTraducido(fila: object, campo: string, idioma: IdiomaCarta): string {
  const registro = fila as Record<string, unknown>;
  const base = texto(registro[campo]);
  if (idioma === "es") return base;
  const columna = texto(registro[`${campo}_${idioma}`]);
  if (columna) return columna;
  const traduccion = texto(parseTraducciones(registro.traducciones)?.[idioma]?.[campo]);
  return traduccion || base;
}

/** «ENTRANTES FRÍOS» → «Entrantes fríos» (etiquetaCategoria de la web). */
export function etiquetaCategoria(clave: string): string {
  const limpio = clave.trim().toLocaleLowerCase("es");
  return limpio ? limpio.charAt(0).toLocaleUpperCase("es") + limpio.slice(1) : clave;
}

/** `orden` tal y como llega (texto en BD hasta la migración a entero). */
export type ValorOrden = string | number | null | undefined;

/**
 * Mismo criterio que `compararOrden` de src/lib/orden-carta.ts (que no se
 * importa porque arrastra el cliente de Supabase): número ascendente y los que
 * no tienen número, al final.
 */
function valorOrden(orden: ValorOrden): number | null {
  if (orden === null || orden === undefined) return null;
  if (typeof orden === "number") return Number.isFinite(orden) ? orden : null;
  const textoOrden = String(orden).trim();
  return /^-?\d+$/.test(textoOrden) ? Number(textoOrden) : null;
}

function compararOrden(a: ValorOrden, b: ValorOrden): number {
  const va = valorOrden(a);
  const vb = valorOrden(b);
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  return va - vb;
}

/** Orden dentro de una categoría: `orden` numérico (sin número, al final) y luego `id`. */
function compararFilas(a: FilaCarta, b: FilaCarta): number {
  return compararOrden(a.orden, b.orden) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function indiceEn(lista: readonly string[], clave: string): number {
  const indice = lista.indexOf(clave);
  return indice === -1 ? lista.length : indice;
}

// ─── Platos ─────────────────────────────────────────────────────────────────

export interface OpcionCategoria {
  clave: string;
  etiqueta: string;
  cantidad: number;
}

/** Platos publicados en la carta, agrupados por categoría en el orden de la web. */
function platosPorCategoria(filas: readonly FilaPlato[], carta: CartaImpresa): [string, FilaPlato[]][] {
  const grupos = new Map<string, FilaPlato[]>();
  for (const fila of filas) {
    const clave = fila.categoria?.trim();
    if (!clave || !texto(fila.nombre) || !publicadoEnCarta(fila, carta)) continue;
    const grupo = grupos.get(clave);
    if (grupo) grupo.push(fila);
    else grupos.set(clave, [fila]);
  }
  return [...grupos.entries()]
    .sort(
      ([a], [b]) =>
        indiceEn(ORDEN_CATEGORIAS_PLATOS, a) - indiceEn(ORDEN_CATEGORIAS_PLATOS, b) || a.localeCompare(b, "es"),
    )
    .map(([clave, grupo]) => [clave, [...grupo].sort(compararFilas)]);
}

/** Nombre de una categoría de platos en el idioma: el traducido del primer plato o, si no, el castellano. */
function tituloCategoriaPlatos(clave: string, platos: readonly FilaPlato[], idioma: IdiomaCarta): string {
  if (idioma !== "es" && platos[0]) {
    const traducida = campoTraducido(platos[0], "categoria", idioma);
    if (traducida && traducida !== platos[0].categoria?.trim()) return etiquetaCategoria(traducida);
  }
  return etiquetaCategoria(clave);
}

/** Categorías que se pueden elegir en el diálogo (las que tienen algún plato publicado), en orden. */
export function categoriasPlatos(filas: readonly FilaPlato[], carta: CartaImpresa): OpcionCategoria[] {
  return platosPorCategoria(filas, carta).map(([clave, platos]) => ({
    clave,
    etiqueta: etiquetaCategoria(clave),
    cantidad: platos.length,
  }));
}

/** Unidad del precio que merece decirse: «kg», «100 g»… (ni «Unidad» ni «Ración»). */
export function unidadVisible(unidad: string | null | undefined): string | null {
  const normalizada = normalizarUnidadPlato(unidad);
  if (normalizada === "Unidad" || normalizada === "Ración") return null;
  return normalizada;
}

export interface OpcionesContenido {
  carta: CartaImpresa;
  idioma: IdiomaCarta;
  /** Categorías incluidas (claves exactas de la BD). Sin indicar: todas. */
  categorias?: ReadonlySet<string> | readonly string[];
}

const incluida = (categorias: OpcionesContenido["categorias"], clave: string) =>
  !categorias || (Array.isArray(categorias) ? categorias.includes(clave) : (categorias as ReadonlySet<string>).has(clave));

export function contenidoPlatos(filas: readonly FilaPlato[], opciones: OpcionesContenido): ContenidoCarta {
  const { carta, idioma } = opciones;
  const grupos = platosPorCategoria(filas, carta).filter(([clave]) => incluida(opciones.categorias, clave));
  const clavesPorPlato = new Map(grupos.flatMap(([, platos]) => platos.map((p) => [p.id, clavesAlergenosFila(p)] as const)));
  const leyenda = numeracionAlergenos(
    [...clavesPorPlato.values()].flat(),
    idioma,
  );
  const numero = new Map(leyenda.map((e) => [e.clave, e.numero]));
  const secciones: SeccionCarta[] = grupos.map(([clave, platos]) => ({
    clave,
    titulo: tituloCategoriaPlatos(clave, platos, idioma),
    paginaNueva: false,
    grupos: [
      {
        titulo: null,
        elementos: platos.map((plato) => ({
          id: plato.id,
          nombre: campoTraducido(plato, "nombre", idioma),
          detalle: campoTraducido(plato, "descripcion", idioma) || null,
          precio: textoPrecio(plato.precio_eur, idioma),
          unidad: precioConocido(plato.precio_eur) ? unidadVisible(plato.unidad) : null,
          copa: null,
          alergenos: (clavesPorPlato.get(plato.id) ?? [])
            .map((c) => numero.get(c))
            .filter((n): n is number => n !== undefined)
            .sort((a, b) => a - b),
        })),
      },
    ],
  }));
  const hayNumeros = secciones.some((s) => s.grupos.some((g) => g.elementos.some((e) => e.alergenos.length > 0)));
  return {
    tipo: "platos",
    carta,
    idioma,
    secciones,
    leyenda: hayNumeros ? leyenda : [],
    notaComun: null,
  };
}

// ─── Vinos ──────────────────────────────────────────────────────────────────

export interface OpcionTipoVino {
  tipo: TipoVino;
  etiqueta: string;
  cantidad: number;
  denominaciones: OpcionCategoria[];
}

const PALABRAS_MENORES = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "da", "do", "das", "dos", "di", "du", "des", "en", "et"]);

function capitalizarPalabra(palabra: string): string {
  const elision = palabra.match(/^(d[’'])(.+)$/u);
  if (elision) return elision[1] + capitalizarPalabra(elision[2]);
  return palabra.replace(/(^|[-/(])(\p{L})/gu, (_, antes: string, letra: string) => antes + letra.toLocaleUpperCase("es"));
}

/** «RIBEIRA SACRA» → «Ribeira Sacra», «UTIEL-REQUENA» → «Utiel-Requena», «MOSCATO D’ASTI» → «Moscato d’Asti». */
export function tituloPropio(texto: string): string {
  return texto
    .toLocaleLowerCase("es")
    .split(" ")
    .map((palabra, i) => (i > 0 && PALABRAS_MENORES.has(palabra) ? palabra : capitalizarPalabra(palabra)))
    .join(" ");
}

/** Denominación de una categoría de vino sin su tipo, para ordenar y como último recurso («Ribera del Duero»). */
export function denominacionVino(categoria: string, idioma: IdiomaCarta): string {
  if (esCategoriaOrigenPendiente(categoria)) return CONSULTAR_ORIGEN[idioma];
  const corta = categoriaCorta(categoria);
  // Las que la web ya escribe a mano («IGP Castilla y León») se dejan; el resto, con mayúsculas de nombre propio.
  return /\p{Lu}/u.test(corta.slice(1)) ? corta : tituloPropio(corta);
}

/**
 * Cabecera de una denominación: la D.O. tal cual la guarda el vino («D.O. Ribera
 * del Duero», «AOC Champagne», «D.O.Ca. Rioja») si todos los de la categoría
 * comparten la misma; si no, el nombre de la categoría («Navarra · Chablis · Rioja»).
 */
export function tituloDenominacion(categoria: string, vinos: readonly FilaVino[], idioma: IdiomaCarta): string {
  if (esCategoriaOrigenPendiente(categoria)) return CONSULTAR_ORIGEN[idioma];
  const denominaciones = new Set(vinos.map((v) => origenComprobable(texto(v.denominacion_origen))));
  const [unica] = [...denominaciones];
  if (denominaciones.size === 1 && unica && !/^sin d\.?o\.?$/i.test(unica)) return unica;
  return denominacionVino(categoria, idioma);
}

interface TipoAgrupado {
  tipo: TipoVino;
  denominaciones: [string, FilaVino[]][];
}

function vinosAgrupados(filas: readonly FilaVino[], carta: CartaImpresa): TipoAgrupado[] {
  const porCategoria = new Map<string, FilaVino[]>();
  for (const fila of filas) {
    const clave = fila.categoria?.trim();
    if (!clave || !texto(fila.nombre) || !publicadoEnCarta(fila, carta)) continue;
    const grupo = porCategoria.get(clave);
    if (grupo) grupo.push(fila);
    else porCategoria.set(clave, [fila]);
  }
  return TIPOS_VINO.map((tipo) => ({
    tipo,
    denominaciones: [...porCategoria.entries()]
      .filter(([clave]) => tipoVino(clave) === tipo)
      .sort(
        ([a], [b]) =>
          Number(esCategoriaOrigenPendiente(a)) - Number(esCategoriaOrigenPendiente(b)) ||
          denominacionVino(a, "es").localeCompare(denominacionVino(b, "es"), "es", { sensitivity: "base" }) ||
          a.localeCompare(b, "es"),
      )
      .map(([clave, vinos]): [string, FilaVino[]] => [clave, [...vinos].sort(compararFilas)]),
  })).filter((t) => t.denominaciones.length > 0);
}

/** Tipos y denominaciones que se pueden elegir en el diálogo, en el orden de la carta. */
export function tiposVino(filas: readonly FilaVino[], carta: CartaImpresa): OpcionTipoVino[] {
  return vinosAgrupados(filas, carta).map(({ tipo, denominaciones }) => ({
    tipo,
    etiqueta: TEXTOS.es.tiposVino[tipo],
    cantidad: denominaciones.reduce((total, [, vinos]) => total + vinos.length, 0),
    denominaciones: denominaciones.map(([clave, vinos]) => ({
      clave,
      etiqueta: tituloDenominacion(clave, vinos, "es"),
      cantidad: vinos.length,
    })),
  }));
}

const plegar = (valor: string) => valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const ES_ESPANA = new Set(["espana", "spain", "espagne"]);

/** Un dato de origen sin confirmar no se imprime (`origenComprobable` de la web). */
function origenComprobable(valor: string): string {
  return /estimad|aproximad|por confirmar|pendiente|sin especificar|desconocid|segun carta|to be confirmed|a confirmer/i.test(
    plegar(valor),
  )
    ? ""
    : valor;
}

/** Zona de un vino: su región y, si es de fuera de España, el país («Chablis, Yonne · Francia»). */
export function zonaVino(vino: FilaVino, idioma: IdiomaCarta): string | null {
  const region = origenComprobable(campoTraducido(vino, "ubicacion_region", idioma));
  const pais = origenComprobable(campoTraducido(vino, "ubicacion_pais", idioma));
  const paisBase = plegar(texto(vino.ubicacion_pais));
  const extranjero = Boolean(pais) && !ES_ESPANA.has(paisBase) && !ES_ESPANA.has(plegar(pais));
  if (region && extranjero && !plegar(region).includes(plegar(pais))) return `${region} · ${pais}`;
  return region || (extranjero ? pais : "") || origenComprobable(texto(vino.denominacion_origen)) || null;
}

export function contenidoVinos(filas: readonly FilaVino[], opciones: OpcionesContenido): ContenidoCarta {
  const { carta, idioma } = opciones;
  const tipos = vinosAgrupados(filas, carta)
    .map((t) => ({ ...t, denominaciones: t.denominaciones.filter(([clave]) => incluida(opciones.categorias, clave)) }))
    .filter((t) => t.denominaciones.length > 0);
  const vinos = tipos.flatMap((t) => t.denominaciones.flatMap(([, v]) => v));
  const clavesPorVino = new Map(vinos.map((v) => [v.id, clavesAlergenosFila(v)] as const));
  // Lo que llevan todos (los sulfitos, casi siempre) va en una nota y no como número en cada vino.
  const listas = [...clavesPorVino.values()];
  const comunes = listas.length ? listas[0].filter((clave) => listas.every((l) => l.includes(clave))) : [];
  const leyendaCompleta = numeracionAlergenos(listas.flat(), idioma);
  const numero = new Map(leyendaCompleta.map((e) => [e.clave, e.numero]));
  const secciones: SeccionCarta[] = tipos.map(({ tipo, denominaciones }) => ({
    clave: tipo,
    titulo: TEXTOS[idioma].tiposVino[tipo],
    paginaNueva: true,
    grupos: denominaciones.map(([clave, lista]) => ({
      titulo: tituloDenominacion(clave, lista, idioma),
      elementos: lista.map((vino) => ({
        id: vino.id,
        nombre: campoTraducido(vino, "nombre", idioma),
        detalle: zonaVino(vino, idioma),
        precio: textoPrecio(vino.precio_eur, idioma),
        unidad: null,
        copa:
          vino.copeo === true && precioConocido(vino.precio_copa_eur)
            ? `${TEXTOS[idioma].copa} ${formatearPrecio(vino.precio_copa_eur)}`
            : null,
        alergenos: (clavesPorVino.get(vino.id) ?? [])
          .filter((c) => !comunes.includes(c))
          .map((c) => numero.get(c))
          .filter((n): n is number => n !== undefined)
          .sort((a, b) => a - b),
      })),
    })),
  }));
  const hayNumeros = secciones.some((s) => s.grupos.some((g) => g.elementos.some((e) => e.alergenos.length > 0)));
  const entradasComunes = leyendaCompleta.filter((e) => comunes.includes(e.clave));
  return {
    tipo: "vinos",
    carta,
    idioma,
    secciones,
    leyenda: hayNumeros ? leyendaCompleta : [],
    notaComun: entradasComunes.length
      ? TEXTOS[idioma].todosLosVinosContienen(
          listaEnFrase(entradasComunes.map((e) => nombreEnFrase(e, idioma)), idioma),
        )
      : null,
  };
}

const CONJUNCION: Record<IdiomaCarta, string> = { es: "y", en: "and", fr: "et" };

function listaEnFrase(partes: string[], idioma: IdiomaCarta): string {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} ${CONJUNCION[idioma]} ${partes[partes.length - 1]}`;
}

/** ¿Hay algo publicado en esa carta? (para ofrecer o no la opción Touza). */
export function hayPublicados(filas: readonly FilaCarta[], carta: CartaImpresa): boolean {
  return filas.some((fila) => texto(fila.nombre) && fila.categoria?.trim() && publicadoEnCarta(fila, carta));
}

/** `Carta-Casa-Tomas-platos-es-A5-2026-11-05.pdf` (con el tamaño, para no confundir el A5 con el A4). */
export function nombreFicheroCarta(
  tipo: TipoCartaImpresa,
  carta: CartaImpresa,
  idioma: IdiomaCarta,
  tamano: "A5" | "A4",
  fecha = new Date(),
): string {
  const marca = carta === "touza" ? "Touza" : "Casa-Tomas";
  const dia = [fecha.getFullYear(), fecha.getMonth() + 1, fecha.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
  return `Carta-${marca}-${tipo}-${idioma}-${tamano}-${dia}.pdf`;
}
