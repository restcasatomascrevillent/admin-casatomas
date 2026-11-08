/**
 * Contrato común entre el motor (construirDocumento + comprobarMaquetacion) y
 * las plantillas de Instagram. Portado del prototipo instagram-studio
 * (src/plantillas/tipos.ts, 04/11/2026). Isomórfico (navegador y Node).
 *
 * Una plantilla es una función pura que recibe los datos validados de la pieza
 * y devuelve el HTML del interior del lienzo (incluido su propio <style>).
 * construirDocumento pone alrededor: <html>, los @font-face y las variables CSS
 * de la marca (generarCss), un reset y <main class="lienzo formato-{post|story}">
 * con el tamaño exacto del formato.
 *
 * Convenciones del DOM que comprobarMaquetacion revisa tras renderizar:
 * - Cada texto lleva data-campo="antetitulo|titular|cita|cta|pie|lista|numeral".
 * - Los contenedores de texto que NO pueden desbordarse llevan data-ajuste:
 *   si scrollWidth/scrollHeight superan su caja, hay un error que nombra el
 *   campo (no se recorta en silencio).
 * - Todo elemento con data-campo debe quedar dentro del margen interior
 *   (72 px) y, en story, dentro de la zona segura (250 px arriba y abajo).
 *   Fotos, velos y fondos NO llevan data-campo.
 *
 * Campos de texto:
 * - titular: máximo 6 palabras (regla de marca) y los caracteres de la plantilla.
 * - cita: cita o lema (p. ej. «Nunca é longo o camiño que conduce á casa dun
 *   amigo.»). SIN límite de palabras; solo el de caracteres de la plantilla
 *   (limites.cita) y, como todo, sin emojis. Va en data-campo="cita". Solo la
 *   usan las plantillas que la ponen en «admitidos».
 * - Si la plantilla declara titularOpcional, la pieza puede llegar sin titular
 *   siempre que traiga cita; validarPieza devuelve entonces titular "" y la
 *   plantilla no lo pinta (un titular vacío nunca llega a una plantilla que no
 *   lo haya pedido así).
 */
import type { FormatoId, MarcaId } from "./tokens.js";

export type { FormatoId, MarcaId };

export interface ElementoLista {
  etiqueta: string;
  valor?: string;
}

/** Datos de una pieza ya validados (validarPieza). */
export interface DatosPieza {
  marca: MarcaId;
  plantilla: string;
  formato: FormatoId;
  /** id del catálogo FOTOS (fotos.ts). */
  foto?: string;
  antetitulo?: string;
  /** "" solo si la plantilla tiene titularOpcional y la pieza no trae titular. */
  titular: string;
  /** Cita o lema sin límite de palabras (solo de caracteres). */
  cita?: string;
  cta?: string;
  lista?: ElementoLista[];
  pie?: string;
  /** Solo plantillas con numeral (Touza tipográfica). Por defecto "01". */
  numeral?: string;
}

export type CampoPieza = Exclude<keyof DatosPieza, "marca" | "plantilla" | "formato">;

/** Todos los campos de contenido de una pieza, en orden de formulario. */
export const CAMPOS_PIEZA: readonly CampoPieza[] = ["foto", "antetitulo", "titular", "cita", "cta", "lista", "pie", "numeral"];

export interface ContextoPlantilla {
  ancho: number;
  alto: number;
  /** 0 en post; 250/250 en story. */
  zonaSegura: { arriba: number; abajo: number };
  /** Margen interior común: 72 px. */
  margen: number;
  /** URL de una foto del catálogo (bucket «instagram», baseFotos). */
  urlFoto(id: string): string;
  /** URL de un logo (PNG en public/instagram/logos del panel, baseRecursos). */
  urlLogo(pieza: string, color: string): string;
}

/**
 * Cómo pone la plantilla la foto (08/11/2026, para usar las fotos de la carta):
 * - "sangre": la foto CUBRE el lienzo (object-fit: cover). Solo vale una foto
 *   que lo cubra ampliando como mucho un 5 % (AMPLIACION_MAXIMA).
 * - "marco": la foto va ENTERA, sin recortar ni ampliar, dentro de un marco
 *   sobre el fondo de la marca. Vale cualquier foto con el lado largo de
 *   LADO_MINIMO_MARCO px o más (las de la carta, 1200×900 apaisadas, sí).
 */
export type EncajeFoto = "sangre" | "marco";

/**
 * Papel de una plantilla en una publicación (plantillas v2, 08/11/2026). Un
 * carrusel se monta como los reels del sistema de marca: intro, planos con
 * rótulo y cierre.
 * - "portada": la primera imagen (o la única de un post o una story), con el
 *   titular de la idea y la marca.
 * - "plato": imagen interior del carrusel, limpia: la foto y el nombre del
 *   plato pequeño. Sin logo ni botón.
 * - "cierre": la última imagen: logo, lema y botón.
 * - "tipografica": sin foto, una frase o un anuncio.
 */
export type PapelPlantilla = "portada" | "plato" | "cierre" | "tipografica";
export const PAPELES: readonly PapelPlantilla[] = ["portada", "plato", "cierre", "tipografica"];

export interface Plantilla {
  /** p. ej. "ct-foto-titular" */
  id: string;
  marca: MarcaId;
  nombre: string;
  descripcion: string;
  formatos: readonly FormatoId[];
  /** Campos obligatorios además de titular. */
  obligatorios: readonly CampoPieza[];
  /**
   * El titular deja de ser obligatorio si llega una cita (hace falta al menos
   * uno de los dos). Por defecto false: titular obligatorio.
   */
  titularOpcional?: boolean;
  /** Campos que la plantilla usa (los demás se rechazan con error). */
  admitidos: readonly CampoPieza[];
  /** Máximo de caracteres por campo (en «lista», de elementos), además de las 6 palabras del titular. */
  limites?: Partial<Record<CampoPieza, number>>;
  /** Tipos de foto admitidos (FOTOS → tipo), si usa foto. */
  tiposFoto?: readonly string[];
  /** Cómo pone la foto (ver EncajeFoto). Por defecto "sangre". Solo plantillas con foto. */
  encaje?: EncajeFoto;
  /** Papel en la publicación (ver PapelPlantilla). Las clásicas no tienen. */
  papel?: PapelPlantilla;
  /**
   * Plantilla clásica (las de antes del 08/11/2026): se sigue pudiendo abrir,
   * validar y publicar (las piezas guardadas no se rompen), pero no sale en los
   * selectores ni la elige la IA.
   */
  clasica?: boolean;
  html(datos: DatosPieza, ctx: ContextoPlantilla): string;
}

/** Escapa texto para meterlo en HTML. Las plantillas DEBEN usarlo con todo dato. */
export function esc(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Encaje de la foto de una plantilla (por defecto "sangre"). Acepta también el valor suelto. */
export function encajeDe(plantilla?: Pick<Plantilla, "encaje"> | EncajeFoto | null): EncajeFoto {
  const e = typeof plantilla === "string" ? plantilla : plantilla?.encaje;
  return e === "marco" ? "marco" : "sangre";
}

/** true si la plantilla deja el titular opcional cuando hay cita. */
export function titularOpcional(plantilla: Pick<Plantilla, "titularOpcional">): boolean {
  return plantilla.titularOpcional === true;
}
