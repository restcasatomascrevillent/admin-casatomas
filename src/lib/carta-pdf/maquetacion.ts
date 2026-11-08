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
 * Una sección por cara (08/11/2026, dueño: «cada sección ocupa exactamente una
 * página, equivalente a una cara del papel»). Las secciones son las de datos.ts:
 * las categorías de platos y los tipos de vino, en su orden. Cada una empieza
 * en página nueva y lleva en ella todos sus elementos; nunca se mezclan dos ni
 * una sigue sola en la página siguiente. Portada y contraportada se quedan.
 *
 * Para que quepa, cada formato tiene su escalera de composiciones (`variantes`),
 * de la más holgada (la de diseño) a la más compacta: primero menos aire entre
 * elementos, luego márgenes algo más justos y letra un poco menor, y al final
 * más columnas. Se usa la primera con la que la sección entera cabe en su cara.
 * La más compacta respeta un cuerpo mínimo legible (`CUERPO_MINIMO`): nombres y
 * precios de 9 pt o más y descripciones de 8 pt o más. El A4 no es el A5
 * ampliado: márgenes, letra y columnas propios (platos a una columna centrada y
 * vinos a dos, que pasan a dos o tres si hace falta).
 *
 * Si una sección no cabe ni con la más compacta, no se corta, no se oculta
 * nada ni se reparte sola: su página sale marcada (`desborda`), el informe
 * (`InformeSeccion`) lo dice y el PDF no se genera hasta que se reorganiza
 * (quitar elementos o denominaciones, cambiar de tamaño) o se pide de forma
 * expresa repartirla en varias caras (`repartir`). Repartida, cada cara repite
 * el título con «(continuación)».
 *
 * Una sección corta no se estira: se compone con su medida de diseño y el
 * bloque (título y elementos) se centra ópticamente en la página.
 *
 * Reglas dentro de una cara (en cada columna):
 *  · Un plato o un vino nunca se parte.
 *  · Una denominación nunca se queda sola al pie: va con, al menos, sus dos
 *    primeros vinos (o el único que tenga).
 *  · Si al final de una denominación solo quedaría un vino para la columna
 *    siguiente, se lleva también el anterior (no queda uno solo y huérfano).
 *  · Si una denominación sigue en la columna siguiente, allí se repite su
 *    nombre con «(continuación)».
 *  · Con varias columnas, se equilibran: no queda una llena y otra casi vacía.
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

/** Una forma de componer una sección en su cara. Medidas en puntos. */
export interface Variante {
  columnas: number;
  /** Cuerpo de letra e interlineado respecto al A5 de diseño (1 = nombres de plato de 10,5 pt). */
  escala: number;
  /** Aire entre elementos y bajo los títulos: 1 = el de diseño; menos, más juntos. */
  holgura: number;
  lateral: number;
  superior: number;
  inferior: number;
  separacion: number;
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
  /** De la más holgada a la más compacta: cada sección usa la primera con la que cabe en su cara. */
  variantes: Record<TipoCartaImpresa, Variante[]>;
}

/** Variante con las medidas en milímetros. */
const v = (columnas: number, escala: number, holgura: number, lateral: number, superior: number, inferior = superior, separacion = 0): Variante => ({
  columnas,
  escala,
  holgura,
  lateral: mm(lateral),
  superior: mm(superior),
  inferior: mm(inferior),
  separacion: mm(separacion),
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
      // Una columna a todo el ancho; dos (de 59 mm) solo para las categorías más largas.
      platos: [
        v(1, 1, 1, 14, 18),
        v(1, 1, 0.8, 14, 18),
        v(1, 1, 0.65, 13, 15),
        v(1, 0.95, 0.6, 13, 15),
        v(1, 0.9, 0.55, 12, 15),
        v(2, 0.95, 0.7, 12, 15, 15, 7),
        v(2, 0.9, 0.55, 12, 15, 15, 6),
      ],
      vinos: [
        v(1, 1, 1, 14, 18),
        v(1, 1, 0.75, 14, 18),
        v(1, 1, 0.6, 13, 15),
        v(1, 0.95, 0.55, 12, 15),
        v(2, 0.95, 0.7, 12, 15, 15, 7),
        v(2, 0.9, 0.55, 12, 15, 15, 6),
      ],
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
      // Platos a una columna centrada con márgenes anchos (en dos columnas estrechas cada
      // nombre se partía en tres o cuatro líneas); a dos, de 84 mm, solo si no caben.
      platos: [
        v(1, 1.2, 1, 26, 24),
        v(1, 1.2, 0.8, 26, 24),
        v(1, 1.15, 0.7, 24, 21),
        v(1, 1.1, 0.65, 22, 20),
        v(1, 1.05, 0.6, 22, 20),
        v(2, 1.05, 0.8, 17, 20, 20, 10),
        v(2, 1, 0.65, 15, 19, 19, 9),
        v(2, 0.95, 0.55, 15, 19, 19, 8),
      ],
      // Vinos, de nombre corto: una columna si son pocos, dos y, para los tipos más largos, tres.
      vinos: [
        v(1, 1.1, 1, 34, 24),
        v(2, 1.1, 1, 17, 24, 24, 10),
        v(2, 1.1, 0.75, 17, 24, 24, 10),
        v(2, 1.05, 0.65, 16, 21, 21, 9),
        v(2, 1, 0.6, 15, 19, 19, 9),
        v(2, 0.95, 0.55, 14, 19, 19, 8),
        v(3, 1, 0.7, 15, 19, 19, 7),
        v(3, 0.95, 0.55, 14, 19, 19, 6),
      ],
    },
  },
};

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

/** Cómo ha quedado cada sección: lo que lee el diálogo para avisar. */
export interface InformeSeccion {
  clave: string;
  /** Título en el idioma de la carta («Tintos», «Entrantes fríos»). */
  titulo: string;
  /** Platos o vinos de la sección. */
  elementos: number;
  /** Caras que ocupa en el PDF. */
  caras: number;
  /** false: no cabe en su cara (o en las pedidas) ni con la composición más compacta. */
  cabe: boolean;
  /** Ocupa varias caras porque se ha pedido repartirla. */
  repartida: boolean;
  /** Caras que necesita con la composición más compacta (1 si cabe en una). */
  carasNecesarias: number;
  /** Elementos que entran en una sola cara con la composición más compacta (todos, si cabe). */
  caben: number;
  /** Composición elegida: columnas y cuerpo de los nombres (pt). */
  columnas: number;
  cuerpo: number;
  /** Índice (desde 0) de su primera página en `paginas`. */
  pagina: number;
}

export interface MaquetaCarta {
  paginas: PaginaCarta[];
  secciones: InformeSeccion[];
}

export interface OpcionesMaquetacion {
  /** Claves de las secciones que pueden ocupar varias caras (elegido expresamente en el diálogo). */
  repartir?: ReadonlySet<string> | readonly string[];
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

/** Una franja horizontal de la página (una columna o todo el ancho útil). */
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
  /** Columnas del contenido. */
  marcos: Marco[];
  /** Todo el ancho útil (título de la sección). */
  util: Marco;
  y0: number;
  y1: number;
}

function crearContexto(medidor: Medidor, formato: Formato, tipo: TipoCartaImpresa, variante: Variante): Contexto {
  const { columnas, lateral, separacion } = variante;
  const anchoColumna = (formato.ancho - 2 * lateral - (columnas - 1) * separacion) / columnas;
  const marcos = Array.from({ length: columnas }, (_, i) => {
    const x0 = lateral + i * (anchoColumna + separacion);
    return { x0, x1: x0 + anchoColumna };
  });
  return {
    medidor,
    formato,
    tipo,
    e: variante.escala,
    t: tipografia(variante.escala, variante.holgura),
    margenLateral: lateral,
    marcos,
    util: { x0: lateral, x1: formato.ancho - lateral },
    y0: variante.superior,
    y1: formato.alto - variante.inferior,
  };
}

/** Composición de diseño: portada, contraportada, cabecera y pie. */
function contextoDiseno(medidor: Medidor, formato: Formato, tipo: TipoCartaImpresa): Contexto {
  return crearContexto(medidor, formato, tipo, {
    columnas: 1,
    escala: formato.escala[tipo],
    holgura: 1,
    lateral: formato.margenLateral[tipo],
    superior: formato.margenSuperior,
    inferior: formato.margenInferior,
    separacion: 0,
  });
}

const centroDe = (marco: Marco) => (marco.x0 + marco.x1) / 2;

// ─── Medida de los elementos ────────────────────────────────────────────────

interface ElementoMedido {
  elemento: ElementoCarta;
  lineasNombre: string[];
  lineasDetalle: string[];
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

/** Las descripciones de los platos no se meten bajo la columna de precios (en columnas estrechas, menos). */
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
  const anchoMarco = c.marcos[0].x1 - c.marcos[0].x0;
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
    // Una palabra no cabe junto al precio (columna estrecha, «Consultar precio»): las primeras
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
  let lineasDetalle: string[] = [];
  if (elemento.detalle) {
    const detalle = medidor.limpiar(elemento.detalle);
    const anchoCopa = elemento.copa ? medidor.ancho(medidor.limpiar(elemento.copa), "regular", t.copa) + 12 : 0;
    const anchoDetalle = anchoMarco - Math.max(anchoCopa, reservaPrecios(c, anchoMarco));
    lineasDetalle = partirEnLineas(medidor, detalle, "italica", m.detalle, anchoDetalle);
    if (!palabrasCaben(medidor, detalle, "italica", m.detalle, anchoDetalle)) partido = true;
  } else if (elemento.copa) {
    lineasDetalle = [""];
  }
  const alto =
    m.base +
    (lineasNombre.length - 1) * m.interlineado +
    (lineasDetalle.length ? m.primerDetalle + (lineasDetalle.length - 1) * m.interDetalle : 0) +
    m.bajo;
  return { elemento, lineasNombre, lineasDetalle, alergenos, anchoAlergenos, alto, partido };
}

// ─── Dibujo de cada pieza ───────────────────────────────────────────────────

function dibujarElemento(c: Contexto, lienzo: Lienzo, marco: Marco, medido: ElementoMedido, y: number) {
  const { medidor, t } = c;
  const m = medidasElemento(c);
  const { elemento, lineasNombre, lineasDetalle } = medido;
  let base = y + m.base;
  lineasNombre.forEach((linea, i) => {
    if (i > 0) base += m.interlineado;
    lienzo.texto(linea, marco.x0, base, "seminegrita", m.tamano, COLORES.pizarra);
  });
  const ultima = lineasNombre[lineasNombre.length - 1] ?? "";
  let finNombre = marco.x0 + medidor.ancho(ultima, "seminegrita", m.tamano);
  if (medido.alergenos) {
    lienzo.texto(medido.alergenos, finNombre + t.alergenos.separacion, base - t.alergenos.subida, "seminegrita", t.alergenos.tamano, COLORES.oro);
    finNombre += medido.anchoAlergenos;
  }
  // Precio a la derecha, en la línea de base de la última línea del nombre.
  let inicioPrecio = marco.x1;
  if (elemento.unidad) {
    inicioPrecio -= lienzo.derecha(` / ${elemento.unidad}`, inicioPrecio, base, "regular", t.unidad, COLORES.piedra);
  }
  inicioPrecio -= lienzo.derecha(elemento.precio, inicioPrecio, base, "seminegrita", m.tamano, COLORES.oro);
  // Puntos guía, alineados a una rejilla común para que los de varias líneas caigan en columna.
  const paso = t.puntos.separacion;
  const desde = Math.ceil((finNombre + t.puntos.margen - marco.x0) / paso) * paso + marco.x0;
  const hasta = Math.floor((inicioPrecio - t.puntos.margen - marco.x0) / paso) * paso + marco.x0;
  if (hasta - desde >= paso * 2) {
    const yPuntos = base - t.puntos.grosor / 2;
    lienzo.linea(desde, yPuntos, hasta, yPuntos, t.puntos.grosor, COLORES.piedraClara, paso);
  }
  if (lineasDetalle.length) {
    base += m.primerDetalle;
    const primeraDetalle = base;
    lineasDetalle.forEach((linea, i) => {
      if (i > 0) base += m.interDetalle;
      lienzo.texto(linea, marco.x0, base, "italica", m.detalle, COLORES.piedra);
    });
    if (elemento.copa) lienzo.derecha(medidor.limpiar(elemento.copa), marco.x1, primeraDetalle, "regular", t.copa, COLORES.piedra);
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

/** Alto del título de una sección (con «(continuación)» debajo en las caras siguientes de una repartida). */
function altoSeccion(c: Contexto, marco: Marco, titulo: string, continuacion = false): number {
  const { lineas } = lineasTitulo(c, titulo, marco.x1 - marco.x0);
  const s = c.t.seccion;
  return s.base + (lineas.length - 1) * s.interlineado + s.filete + (continuacion ? c.t.continuacion.alto : 0) + s.despues;
}

function dibujarSeccion(c: Contexto, lienzo: Lienzo, marco: Marco, titulo: string, y: number, continuacion?: string) {
  const s = c.t.seccion;
  const centro = centroDe(marco);
  const { lineas, espaciado } = lineasTitulo(c, titulo, marco.x1 - marco.x0);
  let base = y + s.base;
  lineas.forEach((linea, i) => {
    if (i > 0) base += s.interlineado;
    lienzo.centrado(linea, centro, base, "regular", s.tamano, COLORES.oro, espaciado);
  });
  // Filete dorado con un rombo en medio, como separador de categoría.
  const o = c.t.ornamento;
  const yFilete = base + s.filete;
  lienzo.linea(centro - o.hueco - o.brazo, yFilete, centro - o.hueco, yFilete, o.grosor, COLORES.oro);
  lienzo.linea(centro + o.hueco, yFilete, centro + o.hueco + o.brazo, yFilete, o.grosor, COLORES.oro);
  lienzo.rombo(centro, yFilete, o.rombo, COLORES.oro);
  if (continuacion) {
    lienzo.centrado(continuacion, centro, yFilete + c.t.continuacion.base, "italica", c.t.continuacion.tamano, COLORES.piedra);
  }
}

/** Cabecera de denominación en líneas que caben en la columna (en columnas estrechas, «… (continuación)» parte). */
function lineasGrupo(c: Contexto, titulo: string): string[] {
  return partirEnLineas(c.medidor, titulo, "italica", c.t.grupo.tamano, c.marcos[0].x1 - c.marcos[0].x0);
}

const altoGrupo = (c: Contexto, lineas: readonly string[]) => c.t.grupo.alto + (lineas.length - 1) * c.t.grupo.interlineado;

function dibujarGrupo(c: Contexto, lienzo: Lienzo, marco: Marco, lineas: readonly string[], y: number) {
  const g = c.t.grupo;
  let base = y + g.base;
  lineas.forEach((linea, i) => {
    if (i > 0) base += g.interlineado;
    lienzo.texto(linea, marco.x0, base, "italica", g.tamano, COLORES.oro);
  });
  // Filete fino detrás de la última línea, si queda sitio.
  const fin = marco.x0 + c.medidor.ancho(lineas[lineas.length - 1] ?? "", "italica", g.tamano) + 8 * c.e;
  if (marco.x1 - fin > 20) lienzo.linea(fin, base - 3.4 * c.e, marco.x1, base - 3.4 * c.e, 0.4, COLORES.oro);
}

// ─── Composición de una sección en su cara ──────────────────────────────────

/** Lo que fluye por las columnas: cabeceras de denominación y elementos. */
type Bloque =
  | { tipo: "grupo"; lineas: string[]; alto: number; tamanoGrupo: number }
  | { tipo: "elemento"; medido: ElementoMedido; grupo: number; posicion: number; tamanoGrupo: number; tituloGrupo: string | null };

/** Una pieza ya colocada en su columna, con `y` desde arriba del contenido. */
type Pieza = { tipo: "grupo"; lineas: string[]; y: number; alto: number } | { tipo: "elemento"; medido: ElementoMedido; y: number; alto: number };

interface Columna {
  piezas: Pieza[];
  alto: number;
}

interface Cara {
  columnas: Columna[];
  /** Cara siguiente de una sección repartida. */
  continuacion: boolean;
  altoTitulo: number;
  desborda: boolean;
}

interface Composicion {
  c: Contexto;
  caras: Cara[];
  /** Todos los elementos colocados sin pasarse de ninguna cara y sin cortar palabras. */
  cabe: boolean;
  /** Con esta composición alguna palabra se cortaría por letras. */
  partido: boolean;
  colocados: number;
}

/** Holgura numérica para comparar alturas. */
const EPS = 0.01;
/** Tope de caras de una sección repartida. */
const MAX_CARAS = 24;

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

const contarElementos = (bloques: readonly Bloque[], desde: number, hasta: number) =>
  bloques.slice(desde, hasta).filter((b) => b.tipo === "elemento").length;

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
 * Llena una columna de alto `alto` desde el bloque `desde`. Si la columna está
 * vacía, el primer elemento entra aunque no quepa (y se marca `desborda`), para
 * avanzar siempre.
 */
function llenarColumna(
  c: Contexto,
  bloques: readonly Bloque[],
  desde: number,
  alto: number,
  continuacion: string,
): { columna: Columna; hasta: number; desborda: boolean } {
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
  return { columna: { piezas, alto: altoUsado }, hasta: i, desborda };
}

function llenarColumnas(c: Contexto, bloques: readonly Bloque[], desde: number, alto: number, continuacion: string) {
  const columnas: Columna[] = [];
  let hasta = desde;
  let desborda = false;
  for (let k = 0; k < c.marcos.length && hasta < bloques.length; k++) {
    const r = llenarColumna(c, bloques, hasta, alto, continuacion);
    columnas.push(r.columna);
    hasta = r.hasta;
    desborda ||= r.desborda;
  }
  return { columnas, hasta, desborda };
}

/**
 * Una cara: llena sus columnas con el alto disponible y, si todo lo que queda
 * cabe, busca el menor alto con el que sigue cabiendo, para equilibrarlas.
 */
function colocarCara(c: Contexto, bloques: readonly Bloque[], desde: number, alto: number, continuacion: string) {
  const llena = llenarColumnas(c, bloques, desde, alto, continuacion);
  if (c.marcos.length === 1 || llena.hasta < bloques.length || llena.desborda) return llena;
  let mejor = llena;
  let bajo = 0;
  let altoMaximo = alto;
  while (altoMaximo - bajo > 0.5) {
    const medio = (bajo + altoMaximo) / 2;
    const prueba = llenarColumnas(c, bloques, desde, medio, continuacion);
    if (prueba.hasta >= bloques.length && !prueba.desborda) {
      mejor = prueba;
      altoMaximo = medio;
    } else {
      bajo = medio;
    }
  }
  return mejor;
}

/** `limite`: alto máximo del contenido en cada cara (para equilibrar las caras de una repartida). */
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
    const altoTitulo = altoSeccion(c, c.util, titulo, esContinuacion);
    const r = colocarCara(c, bloques, desde, Math.min(limite, c.y1 - c.y0 - altoTitulo), continuacion);
    caras.push({ columnas: r.columnas, continuacion: esContinuacion, altoTitulo, desborda: r.desborda });
    desde = r.hasta;
  }
  // Una composición que corta palabras por letras no vale aunque quepa: se prueba la siguiente.
  const sinPartir = bloques.every((b) => b.tipo !== "elemento" || !b.medido.partido);
  return {
    c,
    caras,
    cabe: desde >= bloques.length && caras.every((cara) => !cara.desborda) && sinPartir,
    partido: !sinPartir,
    colocados: contarElementos(bloques, 0, desde),
  };
}

interface Eleccion {
  composicion: Composicion;
  carasNecesarias: number;
  caben: number;
}

/**
 * La composición de una sección: la más holgada con la que cabe en una cara.
 * Si no cabe con ninguna y se ha pedido repartirla, el menor número de caras
 * y, con él, la más holgada. Si no, la más compacta en una cara, marcada.
 */
function elegirComposicion(
  medidor: Medidor,
  formato: Formato,
  tipo: TipoCartaImpresa,
  seccion: SeccionCarta,
  titulo: string,
  continuacion: string,
  repartir: boolean,
): Eleccion {
  const contextos = formato.variantes[tipo].map((variante) => crearContexto(medidor, formato, tipo, variante));
  const total = seccion.grupos.reduce((suma, g) => suma + g.elementos.length, 0);
  // La que más elementos mete en una cara: la que se enseña, marcada, si ninguna cabe.
  let mejor: Composicion | null = null;
  // La más compacta que no corta palabras (para contar las caras necesarias).
  let compacta = contextos[contextos.length - 1];
  for (const c of contextos) {
    const composicion = componerSeccion(c, seccion, titulo, continuacion, 1);
    if (composicion.cabe) return { composicion, carasNecesarias: 1, caben: total };
    if (composicion.partido) continue;
    compacta = c;
    if (!mejor || composicion.colocados > mejor.colocados) mejor = composicion;
  }
  const enUna = mejor ?? componerSeccion(compacta, seccion, titulo, continuacion, 1);
  const todas = componerSeccion(compacta, seccion, titulo, continuacion, MAX_CARAS);
  const carasNecesarias = todas.caras.length;
  if (!repartir) return { composicion: enUna, carasNecesarias, caben: enUna.colocados };
  for (const c of contextos) {
    const composicion = componerSeccion(c, seccion, titulo, continuacion, carasNecesarias);
    if (composicion.cabe) return { composicion: equilibrarCaras(composicion, seccion, titulo, continuacion), carasNecesarias, caben: enUna.colocados };
  }
  return { composicion: todas, carasNecesarias, caben: enUna.colocados };
}

/**
 * Una sección repartida no llena la primera cara y deja la última casi vacía:
 * busca el menor alto de contenido con el que sigue cabiendo en las mismas
 * caras, para que todas queden parecidas.
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

/** Parte del alto libre que queda encima de una sección corta: algo menos de la mitad (centro óptico). */
const CENTRO_OPTICO = 0.42;

function paginasInteriores(
  medidor: Medidor,
  formato: Formato,
  contenido: ContenidoCarta,
  primerNumero: number,
  repartir: (clave: string) => boolean,
): MaquetaCarta {
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
    const eleccion = elegirComposicion(medidor, formato, contenido.tipo, seccion, titulo, textos.continuacion, repartir(seccion.clave));
    const { c, caras, cabe } = eleccion.composicion;
    const primeraPagina = paginas.length;
    for (const cara of caras) {
      const lienzo = nuevaPagina(seccion.clave, cara.desborda || !cabe);
      const altoContenido = Math.max(0, ...cara.columnas.map((columna) => columna.alto));
      const libre = c.y1 - c.y0 - cara.altoTitulo - altoContenido;
      // Una sección corta no se estira: el bloque se centra ópticamente. Las repartidas, arriba.
      const y = c.y0 + (caras.length === 1 ? Math.max(0, libre) * CENTRO_OPTICO : 0);
      dibujarSeccion(c, lienzo, c.util, titulo, y, cara.continuacion ? textos.continuacion : undefined);
      const yContenido = y + cara.altoTitulo;
      cara.columnas.forEach((columna, k) => {
        for (const pieza of columna.piezas) {
          if (pieza.tipo === "grupo") dibujarGrupo(c, lienzo, c.marcos[k], pieza.lineas, yContenido + pieza.y);
          else dibujarElemento(c, lienzo, c.marcos[k], pieza.medido, yContenido + pieza.y);
        }
      });
    }
    secciones.push({
      clave: seccion.clave,
      titulo: seccion.titulo,
      elementos: total,
      caras: caras.length,
      cabe,
      repartida: caras.length > 1,
      carasNecesarias: eleccion.carasNecesarias,
      caben: eleccion.caben,
      columnas: c.marcos.length,
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
 * La carta entera: portada, una cara por sección (o las pedidas, si se ha
 * elegido repartirla) y contraportada, con el informe de cada sección.
 */
export function maquetarCarta(
  medidor: Medidor,
  contenido: ContenidoCarta,
  tamano: TamanoCarta = "A5",
  opciones: OpcionesMaquetacion = {},
): MaquetaCarta {
  const formato = FORMATOS[tamano];
  const repartir = new Set(opciones.repartir ?? []);
  const diseno = contextoDiseno(medidor, formato, contenido.tipo);
  const interiores = paginasInteriores(medidor, formato, contenido, 2, (clave) => repartir.has(clave));
  return {
    paginas: [portada(diseno, contenido), ...interiores.paginas, contraportada(diseno, contenido, interiores.paginas.length + 2)],
    secciones: interiores.secciones,
  };
}

/** Secciones que no caben en su cara (o en las caras pedidas): el PDF no se genera con ellas. */
export const seccionesQueNoCaben = (maqueta: MaquetaCarta) => maqueta.secciones.filter((s) => !s.cabe);
