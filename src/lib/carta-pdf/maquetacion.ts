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
 * El A4 no es el A5 ampliado: márgenes propios y letra mayor; los platos, a
 * una columna centrada con márgenes anchos (sus descripciones en dos columnas
 * estrechas partían cada nombre en tres o cuatro líneas), y los vinos, de
 * nombre corto, a dos columnas. Portada y contraportada guardan la composición
 * del A5, a escala.
 *
 * Reglas de paginación (en cada columna):
 *  · Un plato o un vino nunca se parte.
 *  · Una cabecera (categoría, tipo de vino o denominación) nunca se queda sola
 *    al pie: va con, al menos, sus dos primeros elementos (o el único que tenga).
 *  · Si al final de una categoría solo quedaría un elemento para la columna
 *    siguiente, se lleva también el anterior (no queda uno solo y huérfano).
 *  · Si una categoría sigue en la columna o página siguiente, allí se repite su
 *    nombre con «(continuación)».
 *  · Cada tipo de vino empieza en columna nueva (en A5, página nueva).
 *
 * Identidad de la web pública (web-casatomas/src/index.css): Libre Baskerville
 * en todo, pizarra para el texto, oro para precios, filetes y titulares, y
 * piedra para lo secundario. Fondo blanco: no gasta tinta.
 */
import type { ContenidoCarta, ElementoCarta, GrupoCarta, SeccionCarta, TipoCartaImpresa } from "./datos";
import { TEXTOS } from "./textos";

// ─── Formatos y colores ─────────────────────────────────────────────────────

export const PUNTOS_POR_MM = 72 / 25.4;
export const mm = (valor: number) => valor * PUNTOS_POR_MM;

export const TAMANOS_CARTA = ["A5", "A4"] as const;
export type TamanoCarta = (typeof TAMANOS_CARTA)[number];

export interface Formato {
  tamano: TamanoCarta;
  /** En puntos. A5: 419,53 × 595,28. A4: 595,28 × 841,89. */
  ancho: number;
  alto: number;
  /** Márgenes generosos (≥ 12 mm) para leer en mano y para la guillotina. */
  margenLateral: Record<TipoCartaImpresa, number>;
  margenSuperior: number;
  margenInferior: number;
  /** Columnas de las páginas interiores. */
  columnas: Record<TipoCartaImpresa, number>;
  separacionColumnas: number;
  /** Cuerpo de letra e interlineado respecto al A5. */
  escala: Record<TipoCartaImpresa, number>;
}

export const FORMATOS: Record<TamanoCarta, Formato> = {
  A5: {
    tamano: "A5",
    ancho: mm(148),
    alto: mm(210),
    margenLateral: { platos: mm(14), vinos: mm(14) },
    margenSuperior: mm(18),
    margenInferior: mm(18),
    columnas: { platos: 1, vinos: 1 },
    separacionColumnas: 0,
    escala: { platos: 1, vinos: 1 },
  },
  A4: {
    tamano: "A4",
    ancho: mm(210),
    alto: mm(297),
    margenLateral: { platos: mm(26), vinos: mm(17) },
    margenSuperior: mm(24),
    margenInferior: mm(24),
    columnas: { platos: 1, vinos: 2 },
    separacionColumnas: mm(10),
    escala: { platos: 1.2, vinos: 1.1 },
  },
};

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
}

/** Proporciones (ancho / alto) de los logos de logos.ts, para no cargar las rutas aquí. */
export const PROPORCION_LOGO: Record<LogoCarta, number> = {
  casaTomas: 3017.2 / 1970.9,
  medallon: 1032.7 / 1036.2,
  touza: 2357.9 / 2819,
};

// ─── Tipografía (medidas del A5, en puntos) ─────────────────────────────────

const TIPOGRAFIA_A5 = {
  seccion: { tamano: 12.5, espaciado: 2.4, base: 11, interlineado: 15, filete: 9, despues: 16, antes: 20 },
  continuacion: { tamano: 8.5, espaciado: 1.6, base: 8, alto: 22 },
  grupo: { tamano: 11.5, base: 9.5, alto: 21, antes: 12 },
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

// ─── Contexto de una maquetación ────────────────────────────────────────────

/** Una columna de las páginas interiores. */
interface Marco {
  x0: number;
  x1: number;
}

interface Contexto {
  medidor: Medidor;
  formato: Formato;
  /** Escala tipográfica de este tipo de carta en este formato. */
  e: number;
  margenLateral: number;
  t: Tipografia;
  tipo: TipoCartaImpresa;
  marcos: Marco[];
  y0: number;
  y1: number;
}

function crearContexto(medidor: Medidor, formato: Formato, tipo: TipoCartaImpresa): Contexto {
  const columnas = formato.columnas[tipo];
  const margenLateral = formato.margenLateral[tipo];
  const anchoUtil = formato.ancho - 2 * margenLateral;
  const anchoColumna = (anchoUtil - (columnas - 1) * formato.separacionColumnas) / columnas;
  const marcos = Array.from({ length: columnas }, (_, i) => {
    const x0 = margenLateral + i * (anchoColumna + formato.separacionColumnas);
    return { x0, x1: x0 + anchoColumna };
  });
  const e = formato.escala[tipo];
  return {
    medidor,
    formato,
    e,
    margenLateral,
    t: escalar(TIPOGRAFIA_A5, e),
    tipo,
    marcos,
    y0: formato.margenSuperior,
    y1: formato.alto - formato.margenInferior,
  };
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

function medirElemento(c: Contexto, elemento: ElementoCarta): ElementoMedido {
  const { medidor, t } = c;
  const m = medidasElemento(c);
  const anchoMarco = c.marcos[0].x1 - c.marcos[0].x0;
  const anchoNombre = anchoMarco - anchoPrecio(c, elemento) - t.huecoPrecio;
  const alergenos = elemento.alergenos.join("·");
  const anchoAlergenos = alergenos ? medidor.ancho(alergenos, "seminegrita", t.alergenos.tamano) + t.alergenos.separacion : 0;
  const nombre = medidor.limpiar(elemento.nombre);
  let lineasNombre = partirEnLineas(medidor, nombre, "seminegrita", m.tamano, anchoNombre);
  // Los números de alérgenos van pegados a la última línea del nombre: si no caben, baja la última palabra.
  const ultima = lineasNombre[lineasNombre.length - 1] ?? "";
  if (anchoAlergenos && medidor.ancho(ultima, "seminegrita", m.tamano) + anchoAlergenos > anchoNombre) {
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
  } else if (elemento.copa) {
    lineasDetalle = [""];
  }
  const alto =
    m.base +
    (lineasNombre.length - 1) * m.interlineado +
    (lineasDetalle.length ? m.primerDetalle + (lineasDetalle.length - 1) * m.interDetalle : 0) +
    m.bajo;
  return { elemento, lineasNombre, lineasDetalle, alergenos, anchoAlergenos, alto };
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

function altoSeccion(c: Contexto, titulo: string): number {
  const { lineas } = lineasTitulo(c, titulo, c.marcos[0].x1 - c.marcos[0].x0);
  const s = c.t.seccion;
  return s.base + (lineas.length - 1) * s.interlineado + s.filete + s.despues;
}

function dibujarSeccion(c: Contexto, lienzo: Lienzo, marco: Marco, titulo: string, y: number) {
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
}

function dibujarContinuacion(c: Contexto, lienzo: Lienzo, marco: Marco, titulo: string, sufijo: string, y: number) {
  const k = c.t.continuacion;
  const base = y + k.base;
  const separacion = 5 * c.e;
  let espaciado = k.espaciado;
  const anchoSufijo = c.medidor.ancho(sufijo, "italica", k.tamano);
  let anchoTitulo = c.medidor.ancho(titulo, "regular", k.tamano, espaciado);
  if (anchoTitulo + separacion + anchoSufijo > marco.x1 - marco.x0) {
    espaciado = 0;
    anchoTitulo = c.medidor.ancho(titulo, "regular", k.tamano);
  }
  const inicio = centroDe(marco) - (anchoTitulo + separacion + anchoSufijo) / 2;
  lienzo.texto(titulo, inicio, base, "regular", k.tamano, COLORES.oro, espaciado);
  lienzo.texto(sufijo, inicio + anchoTitulo + separacion, base, "italica", k.tamano, COLORES.piedra);
}

function dibujarGrupo(c: Contexto, lienzo: Lienzo, marco: Marco, titulo: string, y: number) {
  const g = c.t.grupo;
  const base = y + g.base;
  const limpio = c.medidor.limpiar(titulo);
  lienzo.texto(limpio, marco.x0, base, "italica", g.tamano, COLORES.oro);
  const fin = marco.x0 + c.medidor.ancho(limpio, "italica", g.tamano) + 8 * c.e;
  if (marco.x1 - fin > 20) lienzo.linea(fin, base - 3.4 * c.e, marco.x1, base - 3.4 * c.e, 0.4, COLORES.oro);
}

// ─── Paginación ─────────────────────────────────────────────────────────────

class Paginador {
  readonly paginas: PaginaCarta[] = [];
  lienzo: Lienzo | null = null;
  columna = 0;
  y: number;

  constructor(
    private readonly c: Contexto,
    private readonly cabecera: string,
    private readonly primerNumero: number,
  ) {
    this.y = c.y0;
  }

  get marco(): Marco {
    return this.c.marcos[this.columna];
  }

  get vacia() {
    return this.y <= this.c.y0 + 0.01;
  }

  private nuevaPagina() {
    const { formato, t, medidor } = this.c;
    const lienzo = new Lienzo(medidor);
    const numero = this.primerNumero + this.paginas.length;
    const centro = formato.ancho / 2;
    lienzo.centrado(this.cabecera, centro, formato.margenSuperior * 0.64, "regular", t.cabecera.tamano, COLORES.piedra, t.cabecera.espaciado);
    lienzo.centrado(String(numero), centro, formato.alto - formato.margenInferior * 0.555, "regular", t.pie.tamano, COLORES.piedra);
    this.paginas.push({ tipo: "interior", numero, ancho: formato.ancho, alto: formato.alto, trazos: lienzo.trazos });
    this.lienzo = lienzo;
    this.columna = 0;
    this.y = this.c.y0;
  }

  /** Columna siguiente (o página nueva, si era la última). */
  siguiente() {
    if (this.lienzo && this.columna < this.c.marcos.length - 1) {
      this.columna += 1;
      this.y = this.c.y0;
    } else {
      this.nuevaPagina();
    }
  }

  cabe(alto: number) {
    return this.y + alto <= this.c.y1 + 0.01;
  }
}

/** Alto de los primeros `n` elementos con sus separaciones. */
function altoPrimeros(medidos: ElementoMedido[], n: number, entre: number) {
  return medidos.slice(0, n).reduce((total, m, i) => total + m.alto + (i > 0 ? entre : 0), 0);
}

function paginasInteriores(c: Contexto, contenido: ContenidoCarta, primerNumero: number): PaginaCarta[] {
  const { medidor, t } = c;
  const textos = TEXTOS[contenido.idioma];
  const idioma = contenido.idioma;
  const titulo = contenido.tipo === "vinos" ? textos.tituloVinos : textos.tituloPlatos;
  const marca = contenido.carta === "touza" ? "Touza" : "Casa Tomás";
  const cabecera = medidor.limpiar(mayusculas(`${marca} · ${titulo}`, idioma));
  const p = new Paginador(c, cabecera, primerNumero);
  const m = medidasElemento(c);

  const continuar = (seccion: SeccionCarta, grupo: GrupoCarta | null, enMitadDeGrupo: boolean) => {
    p.siguiente();
    dibujarContinuacion(c, p.lienzo!, p.marco, medidor.limpiar(mayusculas(seccion.titulo, idioma)), textos.continuacion, p.y);
    p.y += t.continuacion.alto;
    if (grupo?.titulo && enMitadDeGrupo) {
      dibujarGrupo(c, p.lienzo!, p.marco, `${grupo.titulo} ${textos.continuacion}`, p.y);
      p.y += t.grupo.alto;
    }
  };

  for (const seccion of contenido.secciones) {
    const tituloSeccion = medidor.limpiar(mayusculas(seccion.titulo, idioma));
    const alturaSeccion = altoSeccion(c, tituloSeccion);
    if (!p.lienzo || (seccion.paginaNueva && !p.vacia)) p.siguiente();
    let seccionDibujada = false;

    for (const grupo of seccion.grupos) {
      const medidos = grupo.elementos.map((e) => medirElemento(c, e));
      if (!medidos.length) continue;
      // Cabeceras + sus primeros elementos tienen que caber juntos.
      const antesSeccion = !seccionDibujada && !p.vacia ? t.seccion.antes : 0;
      const altoCabSeccion = !seccionDibujada ? alturaSeccion : 0;
      const antesGrupo = grupo.titulo && seccionDibujada && !p.vacia ? t.grupo.antes : 0;
      const altoGrupo = grupo.titulo ? t.grupo.alto : 0;
      const necesario =
        antesSeccion + altoCabSeccion + antesGrupo + altoGrupo + altoPrimeros(medidos, Math.min(2, medidos.length), m.entre);
      if (!p.cabe(necesario)) {
        if (seccionDibujada) continuar(seccion, grupo, false);
        else p.siguiente();
      }
      if (!seccionDibujada) {
        if (!p.vacia) p.y += t.seccion.antes;
        dibujarSeccion(c, p.lienzo!, p.marco, tituloSeccion, p.y);
        p.y += alturaSeccion;
        seccionDibujada = true;
      } else if (grupo.titulo && p.y > c.y0 + t.continuacion.alto + 0.01) {
        p.y += t.grupo.antes;
      }
      if (grupo.titulo) {
        dibujarGrupo(c, p.lienzo!, p.marco, grupo.titulo, p.y);
        p.y += t.grupo.alto;
      }

      // Elementos de este grupo que ya hay en la columna (para no dejar uno solo en la siguiente).
      let enEstaColumna: number[] = [];
      // Recién cambiada la columna: lo siguiente se coloca sí o sí (un elemento más alto que la página no da vueltas).
      let recienCambiada = false;
      for (let i = 0; i < medidos.length; i++) {
        const medido = medidos[i];
        const separacion = enEstaColumna.length ? m.entre : 0;
        if (!recienCambiada && !p.cabe(separacion + medido.alto)) {
          // Solo quedaría el último: se lleva también el anterior, si aquí siguen al menos dos con su cabecera.
          if (medidos.length - i === 1 && enEstaColumna.length >= 3) {
            p.lienzo!.trazos.splice(enEstaColumna[enEstaColumna.length - 1]);
            i -= 1;
          }
          continuar(seccion, grupo, true);
          enEstaColumna = [];
          recienCambiada = true;
          i -= 1;
          continue;
        }
        recienCambiada = false;
        p.y += separacion;
        enEstaColumna.push(p.lienzo!.trazos.length);
        dibujarElemento(c, p.lienzo!, p.marco, medido, p.y);
        p.y += medido.alto;
      }
    }
  }
  return p.paginas;
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
    y += altoSeccion(c, tituloLeyenda) - 6 * e;
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

/** La carta entera: portada, páginas interiores y contraportada. */
export function maquetarCarta(medidor: Medidor, contenido: ContenidoCarta, tamano: TamanoCarta = "A5"): PaginaCarta[] {
  const c = crearContexto(medidor, FORMATOS[tamano], contenido.tipo);
  const interiores = paginasInteriores(c, contenido, 2);
  return [portada(c, contenido), ...interiores, contraportada(c, contenido, interiores.length + 2)];
}
