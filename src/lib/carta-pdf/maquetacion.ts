/**
 * Maquetación de la carta impresa en A5 (148 × 210 mm) o A4 (210 × 297 mm),
 * vertical.
 *
 * Convierte el contenido (datos.ts) en páginas con una lista de trazos
 * (textos, filetes y logos) colocados en puntos tipográficos, con el origen
 * arriba a la izquierda del formato final (sin sangrado). Esa misma lista la
 * pintan la vista previa (SVG) y el PDF, así que lo que se ve es lo que se
 * imprime.
 *
 * Nunca dos secciones en el mismo folio (dueño, 08/11 y 10/11/2026). Las
 * secciones son las de datos.ts: las categorías de platos y los tipos de vino,
 * en su orden. Cada una empieza en página nueva; si no cabe en una, sigue en
 * las siguientes (que repiten el título con «(continuación)»), y la siguiente
 * sección vuelve a empezar en página nueva. Portada y contraportada se quedan.
 *
 * Un plato por línea (10/11/2026): siempre una columna, un plato o vino debajo
 * de otro. Para no gastar un folio por dos platos, cada formato tiene su
 * escalera de composiciones (`variantes`), de la de diseño a la más compacta:
 * menos aire entre elementos, márgenes algo más justos y letra un poco menor.
 * Se usa la primera con la que la sección cabe en una página; si no cabe con
 * ninguna, no se aprieta: va con la de diseño en las páginas que haga falta,
 * equilibradas (no una llena y la última casi vacía). La más compacta respeta un cuerpo mínimo
 * legible (`CUERPO_MINIMO`): nombres y precios de 9 pt o más y descripciones de
 * 8 pt o más. El A4 no es el A5 ampliado: márgenes y letra propios.
 *
 * Alineación a elegir (10/11/2026): el texto de la sección (título, platos y
 * descripciones) a la izquierda, al centro o a la derecha, y el bloque arriba,
 * en el centro o abajo de la página (`Alineacion`). Una sección corta no se
 * estira: se coloca, con su medida de diseño, donde diga la alineación.
 *
 * Reglas al pasar de página:
 *  · Un plato o un vino nunca se parte.
 *  · Una denominación nunca se queda sola al pie: va con, al menos, sus dos
 *    primeros vinos (o el único que tenga).
 *  · Si al final de una denominación solo quedaría un vino para la página
 *    siguiente, se lleva también el anterior (no queda uno solo y huérfano).
 *  · Si una denominación sigue en la página siguiente, allí se repite su
 *    nombre con «(continuación)».
 *
 * Identidad de la web pública (web-casatomas/src/index.css): Libre Baskerville
 * en todo, pizarra para el texto, oro para precios, filetes y titulares, y
 * piedra para lo secundario. Fondo blanco: no gasta tinta.
 */
import type { ContenidoCarta, ElementoCarta, SeccionCarta, TipoCartaImpresa } from "./datos";
import { TEXTOS } from "./textos";

// ─── Formatos y colores ─────────────────────────────────────────────────────

export const PUNTOS_POR_MM = 72 / 25.4;
export const mm = (valor: number) => valor * PUNTOS_POR_MM;

export const TAMANOS_CARTA = ["A5", "A4"] as const;
export type TamanoCarta = (typeof TAMANOS_CARTA)[number];

/** Una forma de componer una sección (siempre a una columna). Medidas en puntos. */
export interface Variante {
  /** Cuerpo de letra e interlineado respecto al A5 de diseño (1 = nombres de plato de 10,5 pt). */
  escala: number;
  /** Aire entre elementos y bajo los títulos: 1 = el de diseño; menos, más juntos. */
  holgura: number;
  lateral: number;
  superior: number;
  inferior: number;
}

export interface Formato {
  tamano: TamanoCarta;
  /** En puntos. A5: 419,53 × 595,28. A4: 595,28 × 841,89. */
  ancho: number;
  alto: number;
  /**
   * Márgenes de diseño (≥ 12 mm, para leer en mano y para la guillotina): los
   * de portada y contraportada, y los que sitúan la cabecera y el número de
   * página, que no se mueven de una página a otra.
   */
  margenLateral: Record<TipoCartaImpresa, number>;
  margenSuperior: number;
  margenInferior: number;
  /** Cuerpo de diseño respecto al A5 (cabecera, pie y contraportada). */
  escala: Record<TipoCartaImpresa, number>;
  /** De la más holgada a la más compacta: cada sección usa la primera con la que cabe en una página. */
  variantes: Record<TipoCartaImpresa, Variante[]>;
}

/** Variante con las medidas en milímetros. */
const v = (escala: number, holgura: number, lateral: number, superior: number, inferior = superior): Variante => ({
  escala,
  holgura,
  lateral: mm(lateral),
  superior: mm(superior),
  inferior: mm(inferior),
});

export const FORMATOS: Record<TamanoCarta, Formato> = {
  A5: {
    tamano: "A5",
    ancho: mm(148),
    alto: mm(210),
    margenLateral: { platos: mm(14), vinos: mm(14) },
    margenSuperior: mm(18),
    margenInferior: mm(18),
    escala: { platos: 1, vinos: 1 },
    variantes: {
      platos: [v(1, 1, 14, 18), v(1, 0.8, 14, 18), v(1, 0.65, 13, 15), v(0.95, 0.6, 13, 15), v(0.9, 0.55, 12, 15)],
      vinos: [v(1, 1, 14, 18), v(1, 0.75, 14, 18), v(1, 0.6, 13, 15), v(0.95, 0.55, 12, 15), v(0.9, 0.55, 12, 15)],
    },
  },
  A4: {
    tamano: "A4",
    ancho: mm(210),
    alto: mm(297),
    margenLateral: { platos: mm(26), vinos: mm(17) },
    margenSuperior: mm(24),
    margenInferior: mm(24),
    escala: { platos: 1.2, vinos: 1.1 },
    variantes: {
      // Una columna centrada con márgenes anchos (los vinos, de nombre corto, más estrecha).
      platos: [v(1.2, 1, 26, 24), v(1.2, 0.8, 26, 24), v(1.15, 0.7, 24, 21), v(1.1, 0.65, 22, 20), v(1.05, 0.6, 22, 20), v(1, 0.55, 20, 19)],
      vinos: [v(1.1, 1, 34, 24), v(1.1, 0.75, 30, 24), v(1.05, 0.65, 26, 21), v(1, 0.6, 22, 20), v(0.95, 0.55, 20, 19)],
    },
  },
};

export const ALINEACIONES_HORIZONTALES = ["izquierda", "centro", "derecha"] as const;
export type AlineacionHorizontal = (typeof ALINEACIONES_HORIZONTALES)[number];
export const ALINEACIONES_VERTICALES = ["arriba", "centro", "abajo"] as const;
export type AlineacionVertical = (typeof ALINEACIONES_VERTICALES)[number];

/** Dónde va el texto de cada sección: a qué lado y a qué altura de la página. */
export interface Alineacion {
  horizontal: AlineacionHorizontal;
  vertical: AlineacionVertical;
}

/** La de siempre: platos a la izquierda con puntos guía hasta el precio, y el bloque centrado en la página. */
export const ALINEACION_POR_DEFECTO: Alineacion = { horizontal: "izquierda", vertical: "centro" };
/** Cuerpo mínimo legible (pt): ninguna variante baja de aquí. */
export const CUERPO_MINIMO = { nombre: 9, detalle: 8 } as const;

export interface ColorRgb {
  /** 0–1 */
  r: number;
  g: number;
  b: number;
}

/** hsl(h s% l%) → RGB 0–1 (los tokens de la web están en HSL). */
export function hslARgb(h: number, s: number, l: number): ColorRgb {
  const sat = s / 100;
  const luz = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(luz, 1 - luz);
  const f = (n: number) => luz - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0), g: f(8), b: f(4) };
}

/** Colores de la web: --dark-slate, --gold y la piedra (--secondary y --stone). */
export const COLORES = {
  pizarra: hslARgb(206, 11, 25),
  oro: hslARgb(38, 59, 35),
  piedra: hslARgb(25, 13, 42),
  piedraClara: hslARgb(25, 13, 62),
} as const;

export type FuenteCarta = "regular" | "italica" | "seminegrita";

/** Mide textos con las fuentes reales (fuentes.ts) o con unas falsas en las pruebas. */
export interface Medidor {
  /** Ancho en puntos; `espaciado` (tracking, en puntos) entre letras, sin contar tras la última. */
  ancho(texto: string, fuente: FuenteCarta, tamano: number, espaciado?: number): number;
  /** Deja solo caracteres que tiene la fuente (comillas, € y tildes sí; emojis no). */
  limpiar(texto: string): string;
}

export type LogoCarta = "casaTomas" | "medallon" | "touza";

export type Trazo =
  | {
      tipo: "texto";
      /** Inicio del texto (izquierda) y línea de base. */
      x: number;
      y: number;
      texto: string;
      fuente: FuenteCarta;
      tamano: number;
      color: ColorRgb;
      /** Espacio extra entre letras, en puntos. */
      espaciado?: number;
    }
  | {
      tipo: "linea";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      grosor: number;
      color: ColorRgb;
      /** Línea de puntos redondos (puntos guía), con esta separación. */
      puntos?: number;
    }
  | { tipo: "rombo"; x: number; y: number; radio: number; color: ColorRgb }
  | { tipo: "logo"; logo: LogoCarta; x: number; y: number; ancho: number; alto: number; color: ColorRgb };

export interface PaginaCarta {
  tipo: "portada" | "interior" | "contraportada";
  /** Número de página (1 = portada). */
  numero: number;
  /** Tamaño de la página en puntos (el del formato elegido). */
  ancho: number;
  alto: number;
  trazos: Trazo[];
  /** Clave de la sección de esta página (las interiores). */
  seccion?: string;
  /** La sección no cabe en su cara: faltan elementos y el PDF no se puede generar. */
  desborda?: boolean;
}

/** Cómo ha quedado cada sección: lo que lee el diálogo. */
export interface InformeSeccion {
  clave: string;
  /** Título en el idioma de la carta («Tintos», «Entrantes fríos»). */
  titulo: string;
  /** Platos o vinos de la sección. */
  elementos: number;
  /** Páginas que ocupa (1 si cabe en una). */
  caras: number;
  /**
   * false: algún elemento no cabe ni en una página entera (un nombre o una
   * descripción desmesurados). Su página sale marcada y el PDF no se genera.
   */
  cabe: boolean;
  /** Cuerpo de los nombres (pt) de la composición elegida. */
  cuerpo: number;
  /** Índice (desde 0) de su primera página en `paginas`. */
  pagina: number;
}

export interface MaquetaCarta {
  paginas: PaginaCarta[];
  secciones: InformeSeccion[];
}

export interface OpcionesMaquetacion {
  /** Dónde va el texto de cada sección (por defecto, `ALINEACION_POR_DEFECTO`). */
  alineacion?: Partial<Alineacion>;
}
/** Proporciones (ancho / alto) de los logos de logos.ts, para no cargar las rutas aquí. */
export const PROPORCION_LOGO: Record<LogoCarta, number> = {
  casaTomas: 3017.2 / 1970.9,
  medallon: 1032.7 / 1036.2,
  touza: 2357.9 / 2819,
};

// ─── Tipografía (medidas del A5, en puntos) ─────────────────────────────────

const TIPOGRAFIA_A5 = {
  seccion: { tamano: 12.5, espaciado: 2.4, base: 11, interlineado: 15, filete: 9, despues: 16 },
  continuacion: { tamano: 9, base: 11, alto: 9 },
  grupo: { tamano: 11.5, base: 9.5, interlineado: 13.5, alto: 21, antes: 12 },
  plato: { tamano: 10.5, interlineado: 13.5, base: 8.5, detalle: 9, interDetalle: 11.8, primerDetalle: 12.4, bajo: 3.4, entre: 8 },
  vino: { tamano: 10, interlineado: 13, base: 8.2, detalle: 9, interDetalle: 11.4, primerDetalle: 12, bajo: 3.2, entre: 5.6 },
  alergenos: { tamano: 6.8, subida: 3.8, separacion: 2.2 },
  unidad: 8.5,
  copa: 8.5,
  cabecera: { tamano: 7, espaciado: 1.8 },
  pie: { tamano: 8.5 },
  puntos: { separacion: 2.8, grosor: 0.75, margen: 4 },
  huecoPrecio: 18,
  ornamento: { brazo: 23, hueco: 5, rombo: 2.1, grosor: 0.6 },
};
type Tipografia = typeof TIPOGRAFIA_A5;

/** Todas las medidas tipográficas multiplicadas por `escala`. */
function escalar<T>(valor: T, escala: number): T {
  if (typeof valor === "number") return (valor * escala) as T;
  if (valor && typeof valor === "object") {
    return Object.fromEntries(Object.entries(valor).map(([clave, v]) => [clave, escalar(v, escala)])) as T;
  }
  return valor;
}

/** Tipografía a una escala y con menos aire (holgura < 1): solo encoge los blancos, no el interlineado. */
function tipografia(escala: number, holgura: number): Tipografia {
  const t = escalar(TIPOGRAFIA_A5, escala);
  const h = holgura;
  return {
    ...t,
    seccion: { ...t.seccion, despues: t.seccion.despues * (0.4 + 0.6 * h) },
    grupo: { ...t.grupo, alto: t.grupo.base + (t.grupo.alto - t.grupo.base) * (0.5 + 0.5 * h), antes: t.grupo.antes * h },
    plato: { ...t.plato, entre: t.plato.entre * h, bajo: t.plato.bajo * (0.5 + 0.5 * h) },
    vino: { ...t.vino, entre: t.vino.entre * h, bajo: t.vino.bajo * (0.5 + 0.5 * h) },
  };
}

// ─── Utilidades de texto ────────────────────────────────────────────────────

/** Parte un texto en líneas que caben en `ancho` (palabra a palabra; una palabra imposible, por letras). */
export function partirEnLineas(
  medidor: Medidor,
  texto: string,
  fuente: FuenteCarta,
  tamano: number,
  ancho: number,
  espaciado = 0,
): string[] {
  const palabras = texto.split(/[ \t\r\n]+/).filter(Boolean);
  const lineas: string[] = [];
  let linea = "";
  const cabe = (t: string) => medidor.ancho(t, fuente, tamano, espaciado) <= ancho;
  for (const palabra of palabras) {
    const candidata = linea ? `${linea} ${palabra}` : palabra;
    if (cabe(candidata)) {
      linea = candidata;
      continue;
    }
    if (linea) lineas.push(linea);
    if (cabe(palabra)) {
      linea = palabra;
      continue;
    }
    // Palabra más ancha que la columna: se parte por letras.
    let trozo = "";
    for (const letra of Array.from(palabra)) {
      if (trozo && !cabe(trozo + letra)) {
        lineas.push(trozo);
        trozo = "";
      }
      trozo += letra;
    }
    linea = trozo;
  }
  if (linea) lineas.push(linea);
  return lineas;
}

class Lienzo {
  readonly trazos: Trazo[] = [];
  constructor(private readonly medidor: Medidor) {}

  texto(texto: string, x: number, y: number, fuente: FuenteCarta, tamano: number, color: ColorRgb, espaciado?: number) {
    if (!texto) return;
    this.trazos.push({ tipo: "texto", x, y, texto, fuente, tamano, color, ...(espaciado ? { espaciado } : {}) });
  }

  derecha(texto: string, xDerecha: number, y: number, fuente: FuenteCarta, tamano: number, color: ColorRgb, espaciado?: number) {
    const ancho = this.medidor.ancho(texto, fuente, tamano, espaciado);
    this.texto(texto, xDerecha - ancho, y, fuente, tamano, color, espaciado);
    return ancho;
  }

  centrado(texto: string, centro: number, y: number, fuente: FuenteCarta, tamano: number, color: ColorRgb, espaciado?: number) {
    const ancho = this.medidor.ancho(texto, fuente, tamano, espaciado);
    this.texto(texto, centro - ancho / 2, y, fuente, tamano, color, espaciado);
    return ancho;
  }

  linea(x1: number, y1: number, x2: number, y2: number, grosor: number, color: ColorRgb, puntos?: number) {
    this.trazos.push({ tipo: "linea", x1, y1, x2, y2, grosor, color, ...(puntos ? { puntos } : {}) });
  }

  rombo(x: number, y: number, radio: number, color: ColorRgb) {
    this.trazos.push({ tipo: "rombo", x, y, radio, color });
  }

  logo(logo: LogoCarta, x: number, y: number, ancho: number, color: ColorRgb) {
    const alto = ancho / PROPORCION_LOGO[logo];
    this.trazos.push({ tipo: "logo", logo, x, y, ancho, alto, color });
    return alto;
  }
}

const mayusculas = (texto: string, idioma: string) => texto.toLocaleUpperCase(idioma);

// ─── Contexto de una composición ────────────────────────────────────────────

/** Una franja horizontal de la página: el ancho útil de la sección. */
interface Marco {
  x0: number;
  x1: number;
}

interface Contexto {
  medidor: Medidor;
  formato: Formato;
  tipo: TipoCartaImpresa;
  /** Escala tipográfica de esta composición. */
  e: number;
  t: Tipografia;
  margenLateral: number;
  /** Ancho útil: el de los platos y el del título. */
  marco: Marco;
  /** A qué lado va el texto. */
  h: AlineacionHorizontal;
  y0: number;
  y1: number;
}

function crearContexto(medidor: Medidor, formato: Formato, tipo: TipoCartaImpresa, variante: Variante, h: AlineacionHorizontal): Contexto {
  const { lateral } = variante;
  return {
    medidor,
    formato,
    tipo,
    e: variante.escala,
    t: tipografia(variante.escala, variante.holgura),
    margenLateral: lateral,
    marco: { x0: lateral, x1: formato.ancho - lateral },
    h,
    y0: variante.superior,
    y1: formato.alto - variante.inferior,
  };
}

/** Composición de diseño: portada, contraportada, cabecera y pie. */
function contextoDiseno(medidor: Medidor, formato: Formato, tipo: TipoCartaImpresa): Contexto {
  const variante: Variante = {
    escala: formato.escala[tipo],
    holgura: 1,
    lateral: formato.margenLateral[tipo],
    superior: formato.margenSuperior,
    inferior: formato.margenInferior,
  };
  return crearContexto(medidor, formato, tipo, variante, "centro");
}

const centroDe = (marco: Marco) => (marco.x0 + marco.x1) / 2;

/** x de inicio de un texto de ancho `ancho` alineado en el marco. */
function inicioAlineado(marco: Marco, ancho: number, h: AlineacionHorizontal): number {
  if (h === "izquierda") return marco.x0;
  if (h === "derecha") return marco.x1 - ancho;
  return centroDe(marco) - ancho / 2;
}

// ─── Medida de los elementos ────────────────────────────────────────────────

interface ElementoMedido {
  elemento: ElementoCarta;
  lineasNombre: string[];
  lineasDetalle: string[];
  /** Al centro, la copa va en su propia línea, debajo de la descripción. */
  copaAparte: boolean;
  /** Números de alérgenos ya como texto («1·3·7») y su ancho. */
  alergenos: string;
  anchoAlergenos: number;
  alto: number;
  /** Alguna palabra no cabe ni partiendo en líneas: habría que cortarla por letras. */
  partido: boolean;
}

const medidasElemento = (c: Contexto) => (c.tipo === "vinos" ? c.t.vino : c.t.plato);

function anchoPrecio(c: Contexto, elemento: ElementoCarta): number {
  let ancho = c.medidor.ancho(elemento.precio, "seminegrita", medidasElemento(c).tamano);
  if (elemento.unidad) ancho += c.medidor.ancho(` / ${elemento.unidad}`, "regular", c.t.unidad);
  return ancho;
}

/** Las descripciones no son tan anchas como la línea del nombre y el precio (a la izquierda, no se meten bajo los precios). */
function reservaPrecios(c: Contexto, anchoMarco: number): number {
  if (c.tipo === "vinos") return 24 * c.e;
  return (anchoMarco > 300 ? 64 : 36) * c.e;
}

/** ¿Cabe cada palabra en el ancho? (si no, habría que partirla por letras). */
function palabrasCaben(medidor: Medidor, texto: string, fuente: FuenteCarta, tamano: number, ancho: number): boolean {
  return texto.split(/[ \t\r\n]+/).every((palabra) => !palabra || medidor.ancho(palabra, fuente, tamano) <= ancho);
}

function medirElemento(c: Contexto, elemento: ElementoCarta): ElementoMedido {
  const { medidor, t } = c;
  const m = medidasElemento(c);
  const anchoMarco = c.marco.x1 - c.marco.x0;
  const anchoNombre = anchoMarco - anchoPrecio(c, elemento) - t.huecoPrecio;
  const alergenos = elemento.alergenos.join("·");
  const anchoAlergenos = alergenos ? medidor.ancho(alergenos, "seminegrita", t.alergenos.tamano) + t.alergenos.separacion : 0;
  const nombre = medidor.limpiar(elemento.nombre);
  const anchoLinea = (linea: string) => medidor.ancho(linea, "seminegrita", m.tamano);
  let partido = false;
  let lineasNombre: string[];
  if (palabrasCaben(medidor, nombre, "seminegrita", m.tamano, anchoNombre)) {
    lineasNombre = partirEnLineas(medidor, nombre, "seminegrita", m.tamano, anchoNombre);
  } else {
    // Una palabra no cabe junto al precio («Consultar precio»): las primeras
    // líneas usan todo el ancho y solo la última, la del precio, le deja sitio.
    lineasNombre = partirEnLineas(medidor, nombre, "seminegrita", m.tamano, anchoMarco);
    const palabras = (lineasNombre.pop() ?? "").split(" ");
    const bajadas: string[] = [];
    while (palabras.length > 1 && anchoLinea(palabras.join(" ")) > anchoNombre) bajadas.unshift(palabras.pop()!);
    lineasNombre.push(palabras.join(" "));
    if (bajadas.length) lineasNombre.push(...partirEnLineas(medidor, bajadas.join(" "), "seminegrita", m.tamano, anchoNombre));
    // Ni así: una palabra partida por letras o pisando el precio. Esta composición no sirve.
    partido = !palabrasCaben(medidor, nombre, "seminegrita", m.tamano, anchoMarco) || anchoLinea(lineasNombre[lineasNombre.length - 1]) > anchoNombre;
  }
  // Los números de alérgenos van pegados a la última línea del nombre: si no caben, baja la última palabra.
  const ultima = lineasNombre[lineasNombre.length - 1] ?? "";
  if (anchoAlergenos && anchoLinea(ultima) + anchoAlergenos > anchoNombre) {
    const palabras = ultima.split(" ");
    if (palabras.length > 1) {
      lineasNombre = [...lineasNombre.slice(0, -1), palabras.slice(0, -1).join(" "), palabras[palabras.length - 1]];
    }
  }
  // Copa: a la izquierda y a la derecha, junto a la primera línea de la descripción; al centro, debajo.
  const copaAparte = Boolean(elemento.copa) && c.h === "centro";
  const anchoCopa = elemento.copa && !copaAparte ? medidor.ancho(medidor.limpiar(elemento.copa), "regular", t.copa) + 12 : 0;
  let lineasDetalle: string[] = [];
  if (elemento.detalle) {
    const detalle = medidor.limpiar(elemento.detalle);
    const anchoDetalle = anchoMarco - Math.max(anchoCopa, reservaPrecios(c, anchoMarco));
    lineasDetalle = partirEnLineas(medidor, detalle, "italica", m.detalle, anchoDetalle);
    if (!palabrasCaben(medidor, detalle, "italica", m.detalle, anchoDetalle)) partido = true;
  } else if (elemento.copa && !copaAparte) {
    lineasDetalle = [""];
  }
  const lineasBajo = lineasDetalle.length + (copaAparte ? 1 : 0);
  const alto =
    m.base +
    (lineasNombre.length - 1) * m.interlineado +
    (lineasBajo ? m.primerDetalle + (lineasBajo - 1) * m.interDetalle : 0) +
    m.bajo;
  return { elemento, lineasNombre, lineasDetalle, copaAparte, alergenos, anchoAlergenos, alto, partido };
}

// ─── Dibujo de cada pieza ───────────────────────────────────────────────────

/**
 * Un plato o un vino, según la alineación:
 *  · izquierda: nombre a la izquierda, puntos guía y precio al margen derecho;
 *  · derecha: todo pegado al margen derecho, el precio detrás del nombre;
 *  · centro: cada línea centrada, el precio detrás de la última del nombre.
 */
function dibujarElemento(c: Contexto, lienzo: Lienzo, marco: Marco, medido: ElementoMedido, y: number) {
  const { medidor, t, h } = c;
  const m = medidasElemento(c);
  const { elemento, lineasNombre, lineasDetalle } = medido;
  const ancho = (linea: string) => medidor.ancho(linea, "seminegrita", m.tamano);
  const precio = anchoPrecio(c, elemento);
  // Entre el nombre y el precio cuando no hay puntos guía.
  const hueco = t.huecoPrecio * 0.6;
  const ultima = lineasNombre.length - 1;
  const anchoUltima = ancho(lineasNombre[ultima] ?? "") + medido.anchoAlergenos;
  // Borde derecho del nombre (a la derecha) y comienzo de la última línea con su precio (al centro).
  const finNombreDerecha = marco.x1 - precio - hueco;
  const inicioUltimaCentro = centroDe(marco) - (anchoUltima + hueco + precio) / 2;

  let base = y + m.base;
  let finNombre = marco.x0;
  lineasNombre.forEach((linea, i) => {
    if (i > 0) base += m.interlineado;
    const conAlergenos = i === ultima ? medido.anchoAlergenos : 0;
    const x =
      h === "izquierda"
        ? marco.x0
        : h === "derecha"
          ? finNombreDerecha - ancho(linea) - conAlergenos
          : i === ultima
            ? inicioUltimaCentro
            : centroDe(marco) - ancho(linea) / 2;
    lienzo.texto(linea, x, base, "seminegrita", m.tamano, COLORES.pizarra);
    finNombre = x + ancho(linea);
  });
  if (medido.alergenos) {
    lienzo.texto(medido.alergenos, finNombre + t.alergenos.separacion, base - t.alergenos.subida, "seminegrita", t.alergenos.tamano, COLORES.oro);
    finNombre += medido.anchoAlergenos;
  }
  // Precio en la línea de base de la última línea del nombre.
  const inicioPrecio = h === "centro" ? finNombre + hueco : marco.x1 - precio;
  lienzo.texto(elemento.precio, inicioPrecio, base, "seminegrita", m.tamano, COLORES.oro);
  if (elemento.unidad) {
    lienzo.texto(` / ${elemento.unidad}`, inicioPrecio + medidor.ancho(elemento.precio, "seminegrita", m.tamano), base, "regular", t.unidad, COLORES.piedra);
  }
  if (h === "izquierda") {
    // Puntos guía, alineados a una rejilla común para que los de varias líneas caigan en columna.
    const paso = t.puntos.separacion;
    const desde = Math.ceil((finNombre + t.puntos.margen - marco.x0) / paso) * paso + marco.x0;
    const hasta = Math.floor((inicioPrecio - t.puntos.margen - marco.x0) / paso) * paso + marco.x0;
    if (hasta - desde >= paso * 2) {
      const yPuntos = base - t.puntos.grosor / 2;
      lienzo.linea(desde, yPuntos, hasta, yPuntos, t.puntos.grosor, COLORES.piedraClara, paso);
    }
  }
  if (!lineasDetalle.length && !medido.copaAparte) return;
  base += m.primerDetalle;
  const primeraDetalle = base;
  const copa = elemento.copa ? medidor.limpiar(elemento.copa) : null;
  const anchoCopa = copa && !medido.copaAparte ? medidor.ancho(copa, "regular", t.copa) + 12 : 0;
  // Bloque de la descripción: a la derecha, todo pegado al margen (antes de la copa, si la hay).
  const marcoDetalle: Marco = h === "derecha" ? { x0: marco.x0, x1: marco.x1 - anchoCopa } : marco;
  lineasDetalle.forEach((linea, i) => {
    if (i > 0) base += m.interDetalle;
    lienzo.texto(linea, inicioAlineado(marcoDetalle, medidor.ancho(linea, "italica", m.detalle), h), base, "italica", m.detalle, COLORES.piedra);
  });
  if (!copa) return;
  if (medido.copaAparte) {
    if (lineasDetalle.length) base += m.interDetalle;
    lienzo.centrado(copa, centroDe(marco), base, "regular", t.copa, COLORES.piedra);
  } else {
    lienzo.derecha(copa, marco.x1, primeraDetalle, "regular", t.copa, COLORES.piedra);
  }
}

/** Líneas de un título de sección que cabe en el marco (si no cabe, menos espaciado y, si hace falta, dos líneas). */
function lineasTitulo(c: Contexto, titulo: string, ancho: number): { lineas: string[]; espaciado: number } {
  const { tamano } = c.t.seccion;
  for (const espaciado of [c.t.seccion.espaciado, c.t.seccion.espaciado / 2]) {
    if (c.medidor.ancho(titulo, "regular", tamano, espaciado) <= ancho) return { lineas: [titulo], espaciado };
  }
  const espaciado = c.t.seccion.espaciado / 2;
  return { lineas: partirEnLineas(c.medidor, titulo, "regular", tamano, ancho, espaciado), espaciado };
}

/** Alto del título de una sección (con «(continuación)» debajo en las páginas siguientes). */
function altoSeccion(c: Contexto, marco: Marco, titulo: string, continuacion = false): number {
  const { lineas } = lineasTitulo(c, titulo, marco.x1 - marco.x0);
  const s = c.t.seccion;
  return s.base + (lineas.length - 1) * s.interlineado + s.filete + (continuacion ? c.t.continuacion.alto : 0) + s.despues;
}

/** Título de sección con su filete y rombo dorados, alineado como el texto (`c.h`). */
function dibujarSeccion(c: Contexto, lienzo: Lienzo, marco: Marco, titulo: string, y: number, continuacion?: string) {
  const s = c.t.seccion;
  const { lineas, espaciado } = lineasTitulo(c, titulo, marco.x1 - marco.x0);
  let base = y + s.base;
  lineas.forEach((linea, i) => {
    if (i > 0) base += s.interlineado;
    lienzo.texto(linea, inicioAlineado(marco, c.medidor.ancho(linea, "regular", s.tamano, espaciado), c.h), base, "regular", s.tamano, COLORES.oro, espaciado);
  });
  // Filete dorado con un rombo en medio, como separador de categoría.
  const o = c.t.ornamento;
  const anchoOrnamento = 2 * (o.brazo + o.hueco);
  const centro = inicioAlineado(marco, anchoOrnamento, c.h) + anchoOrnamento / 2;
  const yFilete = base + s.filete;
  lienzo.linea(centro - o.hueco - o.brazo, yFilete, centro - o.hueco, yFilete, o.grosor, COLORES.oro);
  lienzo.linea(centro + o.hueco, yFilete, centro + o.hueco + o.brazo, yFilete, o.grosor, COLORES.oro);
  lienzo.rombo(centro, yFilete, o.rombo, COLORES.oro);
  if (continuacion) {
    const k = c.t.continuacion;
    lienzo.texto(continuacion, inicioAlineado(marco, c.medidor.ancho(continuacion, "italica", k.tamano), c.h), yFilete + k.base, "italica", k.tamano, COLORES.piedra);
  }
}

/** Cabecera de denominación en líneas que caben en el ancho («… (continuación)» puede partir). */
function lineasGrupo(c: Contexto, titulo: string): string[] {
  return partirEnLineas(c.medidor, titulo, "italica", c.t.grupo.tamano, c.marco.x1 - c.marco.x0);
}

const altoGrupo = (c: Contexto, lineas: readonly string[]) => c.t.grupo.alto + (lineas.length - 1) * c.t.grupo.interlineado;

/** Cabecera de denominación con un filete fino: detrás (izquierda), delante (derecha) o a los dos lados (centro). */
function dibujarGrupo(c: Contexto, lienzo: Lienzo, marco: Marco, lineas: readonly string[], y: number) {
  const g = c.t.grupo;
  const anchoDe = (linea: string) => c.medidor.ancho(linea, "italica", g.tamano);
  let base = y + g.base;
  let x = marco.x0;
  lineas.forEach((linea, i) => {
    if (i > 0) base += g.interlineado;
    x = inicioAlineado(marco, anchoDe(linea), c.h);
    lienzo.texto(linea, x, base, "italica", g.tamano, COLORES.oro);
  });
  const fin = x + anchoDe(lineas[lineas.length - 1] ?? "");
  const hueco = 8 * c.e;
  const yFilete = base - 3.4 * c.e;
  const filete = (desde: number, hasta: number) => {
    if (hasta - desde > 20) lienzo.linea(desde, yFilete, hasta, yFilete, 0.4, COLORES.oro);
  };
  if (c.h === "izquierda") filete(fin + hueco, marco.x1);
  else if (c.h === "derecha") filete(marco.x0, x - hueco);
  else {
    const largo = Math.min(40 * c.e, x - hueco - marco.x0);
    filete(x - hueco - largo, x - hueco);
    filete(fin + hueco, fin + hueco + largo);
  }
}

// ─── Composición de una sección en sus páginas ──────────────────────────────

/** Lo que va pasando de una página a otra: cabeceras de denominación y elementos. */
type Bloque =
  | { tipo: "grupo"; lineas: string[]; alto: number; tamanoGrupo: number }
  | { tipo: "elemento"; medido: ElementoMedido; grupo: number; posicion: number; tamanoGrupo: number; tituloGrupo: string | null };

/** Una pieza ya colocada en su página, con `y` desde arriba del contenido. */
type Pieza = { tipo: "grupo"; lineas: string[]; y: number; alto: number } | { tipo: "elemento"; medido: ElementoMedido; y: number; alto: number };

interface Cara {
  piezas: Pieza[];
  /** Alto del contenido (sin el título). */
  alto: number;
  /** Página siguiente de una sección que no cabe en una. */
  continuacion: boolean;
  altoTitulo: number;
  /** Un elemento no cabe ni solo en la página. */
  desborda: boolean;
}

interface Composicion {
  c: Contexto;
  caras: Cara[];
  /** Todos los elementos colocados sin pasarse de ninguna página y sin cortar palabras. */
  cabe: boolean;
  /** Con esta composición alguna palabra se cortaría por letras. */
  partido: boolean;
}

/** Holgura numérica para comparar alturas. */
const EPS = 0.01;
/** Tope de páginas de una sección (una carta de verdad no llega). */
const MAX_CARAS = 40;

function bloquesSeccion(c: Contexto, seccion: SeccionCarta): Bloque[] {
  const bloques: Bloque[] = [];
  seccion.grupos.forEach((grupo, g) => {
    if (!grupo.elementos.length) return;
    const titulo = grupo.titulo ? c.medidor.limpiar(grupo.titulo) : null;
    const tamanoGrupo = grupo.elementos.length;
    if (titulo) {
      const lineas = lineasGrupo(c, titulo);
      bloques.push({ tipo: "grupo", lineas, alto: altoGrupo(c, lineas), tamanoGrupo });
    }
    grupo.elementos.forEach((elemento, posicion) =>
      bloques.push({ tipo: "elemento", medido: medirElemento(c, elemento), grupo: g, posicion, tamanoGrupo, tituloGrupo: titulo }),
    );
  });
  return bloques;
}

/** Alto de los `n` elementos que siguen a `desde`, con sus separaciones. */
function altoSiguientes(bloques: readonly Bloque[], desde: number, n: number, entre: number): number {
  let alto = 0;
  let contados = 0;
  for (let i = desde; i < bloques.length && contados < n; i++) {
    const b = bloques[i];
    if (b.tipo !== "elemento") break;
    alto += b.medido.alto + (contados > 0 ? entre : 0);
    contados += 1;
  }
  return alto;
}

/**
 * Llena una página con contenido de alto `alto` desde el bloque `desde`. Si la
 * página está vacía, el primer elemento entra aunque no quepa (y se marca
 * `desborda`), para avanzar siempre.
 */
function llenarPagina(
  c: Contexto,
  bloques: readonly Bloque[],
  desde: number,
  alto: number,
  continuacion: string,
): { piezas: Pieza[]; alto: number; hasta: number; desborda: boolean } {
  const { t } = c;
  const m = medidasElemento(c);
  const piezas: Pieza[] = [];
  let y = 0;
  let anterior: "nada" | "grupo" | "elemento" = "nada";
  let elementos = 0;
  let delGrupo = 0;
  let grupoActual = -1;
  let desborda = false;
  let i = desde;

  // Empieza a mitad de una denominación: se repite su nombre con «(continuación)».
  const primero = bloques[i];
  if (primero?.tipo === "elemento" && primero.tituloGrupo && primero.posicion > 0) {
    const lineas = lineasGrupo(c, `${primero.tituloGrupo} ${continuacion}`);
    const altoCabecera = altoGrupo(c, lineas);
    piezas.push({ tipo: "grupo", lineas, y: 0, alto: altoCabecera });
    y = altoCabecera;
    anterior = "grupo";
  }

  for (; i < bloques.length; i++) {
    const b = bloques[i];
    if (b.tipo === "grupo") {
      const antes = anterior === "nada" ? 0 : t.grupo.antes;
      // La cabecera, con sus dos primeros elementos (o el único).
      const necesario = antes + b.alto + altoSiguientes(bloques, i + 1, Math.min(2, b.tamanoGrupo), m.entre);
      if (y + necesario > alto + EPS && elementos > 0) break;
      y += antes;
      piezas.push({ tipo: "grupo", lineas: b.lineas, y, alto: b.alto });
      y += b.alto;
      anterior = "grupo";
      continue;
    }
    const separacion = anterior === "elemento" ? m.entre : 0;
    if (y + separacion + b.medido.alto > alto + EPS) {
      if (elementos > 0) {
        // Solo quedaría el último de la denominación: se lleva también el anterior, si aquí siguen al menos dos.
        if (b.posicion === b.tamanoGrupo - 1 && b.grupo === grupoActual && delGrupo >= 3) {
          piezas.pop();
          i -= 1;
        }
        break;
      }
      desborda = true;
    }
    y += separacion;
    piezas.push({ tipo: "elemento", medido: b.medido, y, alto: b.medido.alto });
    y += b.medido.alto;
    anterior = "elemento";
    elementos += 1;
    if (b.grupo !== grupoActual) {
      grupoActual = b.grupo;
      delGrupo = 0;
    }
    delGrupo += 1;
  }
  const altoUsado = piezas.reduce((maximo, p) => Math.max(maximo, p.y + p.alto), 0);
  return { piezas, alto: altoUsado, hasta: i, desborda };
}

/** `limite`: alto máximo del contenido en cada página (para equilibrar las de una sección larga). */
function componerSeccion(
  c: Contexto,
  seccion: SeccionCarta,
  titulo: string,
  continuacion: string,
  maxCaras: number,
  limite = Infinity,
): Composicion {
  const bloques = bloquesSeccion(c, seccion);
  const caras: Cara[] = [];
  let desde = 0;
  while (desde < bloques.length && caras.length < maxCaras) {
    const esContinuacion = caras.length > 0;
    const altoTitulo = altoSeccion(c, c.marco, titulo, esContinuacion);
    const r = llenarPagina(c, bloques, desde, Math.min(limite, c.y1 - c.y0 - altoTitulo), continuacion);
    caras.push({ piezas: r.piezas, alto: r.alto, continuacion: esContinuacion, altoTitulo, desborda: r.desborda });
    desde = r.hasta;
  }
  // Una composición que corta palabras por letras no vale aunque quepa: se prueba la siguiente.
  const sinPartir = bloques.every((b) => b.tipo !== "elemento" || !b.medido.partido);
  return {
    c,
    caras,
    cabe: desde >= bloques.length && caras.every((cara) => !cara.desborda) && sinPartir,
    partido: !sinPartir,
  };
}

/**
 * Las páginas de una sección larga no quedan una llena y la última casi vacía:
 * busca el menor alto de contenido con el que sigue cabiendo en las mismas
 * páginas, para que todas queden parecidas.
 */
function equilibrarCaras(composicion: Composicion, seccion: SeccionCarta, titulo: string, continuacion: string): Composicion {
  const { c, caras } = composicion;
  if (caras.length < 2) return composicion;
  let mejor = composicion;
  let bajo = 0;
  let alto = c.y1 - c.y0;
  while (alto - bajo > 1) {
    const medio = (bajo + alto) / 2;
    const prueba = componerSeccion(c, seccion, titulo, continuacion, caras.length, medio);
    if (prueba.cabe) {
      mejor = prueba;
      alto = medio;
    } else {
      bajo = medio;
    }
  }
  return mejor;
}

/**
 * La composición de una sección: la más holgada con la que cabe en una página.
 * Si no cabe en una con ninguna, no se aprieta: va con la de diseño (la
 * primera que no corta palabras) en las páginas que haga falta, equilibradas.
 */
function elegirComposicion(medidor: Medidor, formato: Formato, tipo: TipoCartaImpresa, h: AlineacionHorizontal, seccion: SeccionCarta, titulo: string, continuacion: string): Composicion {
  const contextos = formato.variantes[tipo].map((variante) => crearContexto(medidor, formato, tipo, variante, h));
  let holgada: Contexto | null = null;
  for (const c of contextos) {
    const composicion = componerSeccion(c, seccion, titulo, continuacion, 1);
    if (composicion.cabe) return composicion;
    if (!composicion.partido) holgada ??= c;
  }
  const todas = componerSeccion(holgada ?? contextos[contextos.length - 1], seccion, titulo, continuacion, MAX_CARAS);
  return todas.cabe ? equilibrarCaras(todas, seccion, titulo, continuacion) : todas;
}

/** Parte del alto libre que queda encima del bloque, según la alineación vertical (centro: algo por encima de la mitad, el centro óptico). */
const HUECO_ARRIBA: Record<AlineacionVertical, number> = { arriba: 0, centro: 0.42, abajo: 1 };

function paginasInteriores(medidor: Medidor, formato: Formato, contenido: ContenidoCarta, primerNumero: number, alineacion: Alineacion): MaquetaCarta {
  const textos = TEXTOS[contenido.idioma];
  const idioma = contenido.idioma;
  const diseno = contextoDiseno(medidor, formato, contenido.tipo);
  const tituloCarta = contenido.tipo === "vinos" ? textos.tituloVinos : textos.tituloPlatos;
  const marca = contenido.carta === "touza" ? "Touza" : "Casa Tomás";
  const cabecera = medidor.limpiar(mayusculas(`${marca} · ${tituloCarta}`, idioma));
  const paginas: PaginaCarta[] = [];
  const secciones: InformeSeccion[] = [];

  const nuevaPagina = (clave: string, desborda: boolean) => {
    const lienzo = new Lienzo(medidor);
    const numero = primerNumero + paginas.length;
    const centro = formato.ancho / 2;
    // Cabecera y número en el mismo sitio en todas las páginas, sea cual sea la composición.
    lienzo.centrado(cabecera, centro, formato.margenSuperior * 0.64, "regular", diseno.t.cabecera.tamano, COLORES.piedra, diseno.t.cabecera.espaciado);
    lienzo.centrado(String(numero), centro, formato.alto - formato.margenInferior * 0.555, "regular", diseno.t.pie.tamano, COLORES.piedra);
    paginas.push({ tipo: "interior", numero, ancho: formato.ancho, alto: formato.alto, trazos: lienzo.trazos, seccion: clave, ...(desborda ? { desborda } : {}) });
    return lienzo;
  };

  for (const seccion of contenido.secciones) {
    const total = seccion.grupos.reduce((suma, g) => suma + g.elementos.length, 0);
    // Sección vacía: sin página.
    if (!total) continue;
    const titulo = medidor.limpiar(mayusculas(seccion.titulo, idioma));
    const { c, caras, cabe } = elegirComposicion(medidor, formato, contenido.tipo, alineacion.horizontal, seccion, titulo, textos.continuacion);
    const primeraPagina = paginas.length;
    for (const cara of caras) {
      const lienzo = nuevaPagina(seccion.clave, cara.desborda || !cabe);
      const libre = c.y1 - c.y0 - cara.altoTitulo - cara.alto;
      // Una sección corta no se estira: el bloque se coloca arriba, en el centro o abajo.
      const y = c.y0 + Math.max(0, libre) * HUECO_ARRIBA[alineacion.vertical];
      dibujarSeccion(c, lienzo, c.marco, titulo, y, cara.continuacion ? textos.continuacion : undefined);
      const yContenido = y + cara.altoTitulo;
      for (const pieza of cara.piezas) {
        if (pieza.tipo === "grupo") dibujarGrupo(c, lienzo, c.marco, pieza.lineas, yContenido + pieza.y);
        else dibujarElemento(c, lienzo, c.marco, pieza.medido, yContenido + pieza.y);
      }
    }
    secciones.push({
      clave: seccion.clave,
      titulo: seccion.titulo,
      elementos: total,
      caras: caras.length,
      cabe,
      cuerpo: Math.round(medidasElemento(c).tamano * 10) / 10,
      // Índice en la carta completa (la portada va delante).
      pagina: primerNumero - 1 + primeraPagina,
    });
  }
  return { paginas, secciones };
}

// ─── Portada y contraportada ────────────────────────────────────────────────

/** Datos de contacto de la contraportada (los del pie del cheque regalo, src/lib/cheques/casaTomas.ts). */
export const CONTACTO_CASA_TOMAS = {
  direccion: "C/ Santa María de la Cabeza, 2 · 03330 Crevillent (Alicante)",
  telefono: "966 10 78 87",
  web: "restaurantecasatomascrevillente.es",
};

/** La portada guarda la composición del A5, proporcional al tamaño de la hoja. */
function portada(c: Contexto, contenido: ContenidoCarta): PaginaCarta {
  const { formato, medidor } = c;
  const lienzo = new Lienzo(medidor);
  const k = formato.ancho / mm(148);
  const centro = formato.ancho / 2;
  const textos = TEXTOS[contenido.idioma];
  const titulo = medidor.limpiar(mayusculas(contenido.tipo === "vinos" ? textos.tituloVinos : textos.tituloPlatos, contenido.idioma));
  const filete = (y: number) => lienzo.linea(centro - mm(9) * k, y, centro + mm(9) * k, y, 0.6 * k, COLORES.oro);
  if (contenido.carta === "touza") {
    const ancho = mm(28) * k;
    const alto = lienzo.logo("touza", centro - ancho / 2, mm(50) * k, ancho, COLORES.pizarra);
    const debajo = mm(50) * k + alto;
    lienzo.centrado("TOUZA", centro, debajo + mm(19) * k, "regular", 26 * k, COLORES.pizarra, 9 * k);
    filete(debajo + mm(28) * k);
    lienzo.centrado(titulo, centro, debajo + mm(39) * k, "regular", 13 * k, COLORES.oro, 3.6 * k);
  } else {
    const ancho = mm(68) * k;
    const alto = lienzo.logo("casaTomas", centro - ancho / 2, mm(58) * k, ancho, COLORES.pizarra);
    const debajo = mm(58) * k + alto;
    filete(debajo + mm(15) * k);
    const largo = titulo.length > 10;
    lienzo.centrado(titulo, centro, debajo + mm(27) * k, "regular", (largo ? 17 : 21) * k, COLORES.pizarra, (largo ? 4.2 : 6.5) * k);
    lienzo.centrado("Crevillent", centro, debajo + mm(35) * k, "italica", 10.5 * k, COLORES.piedra);
  }
  return { tipo: "portada", numero: 1, ancho: formato.ancho, alto: formato.alto, trazos: lienzo.trazos };
}

function contraportada(c: Contexto, contenido: ContenidoCarta, numero: number): PaginaCarta {
  const { formato, medidor } = c;
  const lienzo = new Lienzo(medidor);
  const e = c.e;
  const k = formato.ancho / mm(148);
  const centro = formato.ancho / 2;
  const textos = TEXTOS[contenido.idioma];
  const anchoTexto = mm(100) * k;
  const pagina: Marco = { x0: c.margenLateral, x1: formato.ancho - c.margenLateral };
  let y = formato.margenSuperior;

  const parrafo = (texto: string, fuente: FuenteCarta, tamano: number, color: ColorRgb, interlineado: number) => {
    for (const linea of partirEnLineas(medidor, medidor.limpiar(texto), fuente, tamano * e, anchoTexto)) {
      y += interlineado * e;
      lienzo.centrado(linea, centro, y, fuente, tamano * e, color);
    }
  };

  if (contenido.leyenda.length) {
    const tituloLeyenda = medidor.limpiar(mayusculas(textos.tituloAlergenos, contenido.idioma));
    dibujarSeccion(c, lienzo, pagina, tituloLeyenda, y);
    y += altoSeccion(c, pagina, tituloLeyenda) - 6 * e;
    parrafo(textos.explicacionAlergenos, "italica", 9, COLORES.piedra, 11.8);
    // Dos columnas, de arriba abajo: los 14 oficiales (1–7 y 8–14) y, aparte, los del restaurante (15…).
    const anchoColumna = mm(50) * k;
    const inicio = centro - anchoColumna + mm(4) * k;
    const bloques = [contenido.leyenda.filter((entrada) => entrada.oficial), contenido.leyenda.filter((entrada) => !entrada.oficial)];
    for (const bloque of bloques.filter((b) => b.length)) {
      y += 8 * e;
      const filas = Math.ceil(bloque.length / 2);
      bloque.forEach((entrada, i) => {
        const x = inicio + Math.floor(i / filas) * anchoColumna;
        const base = y + (10 + (i % filas) * 14) * e;
        lienzo.derecha(String(entrada.numero), x + 14 * e, base, "seminegrita", 9.5 * e, COLORES.oro);
        lienzo.texto(medidor.limpiar(entrada.etiqueta), x + 20 * e, base, "regular", 9.5 * e, COLORES.pizarra);
      });
      y += (10 + (filas - 1) * 14 + 4) * e;
    }
    y += 12 * e;
  } else {
    // Sin leyenda (vinos): las notas, a media altura y no pegadas arriba.
    y = mm(64) * k;
  }

  if (contenido.notaComun) {
    y += 6 * e;
    parrafo(contenido.notaComun, "italica", 9.5, COLORES.pizarra, 12.5);
    y += 6 * e;
  }

  y += 8 * e;
  parrafo(textos.ivaIncluido, "regular", 9.5, COLORES.pizarra, 12.5);
  y += 4 * e;
  parrafo(textos.notaAlergenos, "italica", 9, COLORES.piedra, 12);

  // Pie: medallón, nombre y contacto, anclado abajo.
  const ultimaBase = formato.alto - mm(16) * k;
  if (contenido.carta === "touza") {
    const ancho = mm(13) * k;
    const alto = ancho / PROPORCION_LOGO.touza;
    const baseNombre = ultimaBase - mm(6) * k;
    lienzo.logo("touza", centro - ancho / 2, baseNombre - 13 * e - alto - mm(4) * k, ancho, COLORES.pizarra);
    lienzo.centrado("TOUZA", centro, baseNombre, "regular", 11 * e, COLORES.pizarra, 4 * e);
  } else {
    const ancho = mm(20) * k;
    const lineas = [
      CONTACTO_CASA_TOMAS.direccion,
      `${textos.telefono} ${CONTACTO_CASA_TOMAS.telefono} · ${CONTACTO_CASA_TOMAS.web}`,
    ];
    const baseNombre = ultimaBase - (lineas.length * 12.5 + 4) * e;
    const yLogo = baseNombre - 13 * e - ancho / PROPORCION_LOGO.medallon - mm(4) * k;
    lienzo.logo("medallon", centro - ancho / 2, yLogo, ancho, COLORES.pizarra);
    lienzo.centrado("CASA TOMÁS", centro, baseNombre, "regular", 11 * e, COLORES.pizarra, 3.2 * e);
    lineas.forEach((linea, i) => lienzo.centrado(linea, centro, baseNombre + (4 + (i + 1) * 12.5) * e, "regular", 8.5 * e, COLORES.piedra));
  }
  return { tipo: "contraportada", numero, ancho: formato.ancho, alto: formato.alto, trazos: lienzo.trazos };
}

/**
 * La carta entera: portada, cada sección en sus páginas (nunca dos en la
 * misma) y contraportada, con el informe de cada sección.
 */
export function maquetarCarta(
  medidor: Medidor,
  contenido: ContenidoCarta,
  tamano: TamanoCarta = "A5",
  opciones: OpcionesMaquetacion = {},
): MaquetaCarta {
  const formato = FORMATOS[tamano];
  const alineacion: Alineacion = { ...ALINEACION_POR_DEFECTO, ...opciones.alineacion };
  const diseno = contextoDiseno(medidor, formato, contenido.tipo);
  const interiores = paginasInteriores(medidor, formato, contenido, 2, alineacion);
  return {
    paginas: [portada(diseno, contenido), ...interiores.paginas, contraportada(diseno, contenido, interiores.paginas.length + 2)],
    secciones: interiores.secciones,
  };
}

/** Secciones con algún elemento que no cabe ni en una página entera: el PDF no se genera con ellas. */
export const seccionesQueNoCaben = (maqueta: MaquetaCarta) => maqueta.secciones.filter((s) => !s.cabe);
