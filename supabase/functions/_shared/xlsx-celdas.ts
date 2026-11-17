/**
 * Lectura y escritura QUIRÚRGICA de un libro de Excel (.xlsx / .xlsm) para las
 * Edge Functions: se abre el zip, se tocan solo las celdas pedidas dentro del
 * XML de su hoja y se vuelve a cerrar. No se regenera el libro: los estilos,
 * las fórmulas, las validaciones, el formato condicional, los gráficos y el
 * resto de entradas del zip quedan byte a byte como estaban (las que no se
 * tocan ni siquiera se descomprimen).
 *
 * Por qué a mano y no con una librería: las que hay (SheetJS, ExcelJS) vuelven
 * a escribir el libro entero y pierden parte del formato y los gráficos. El
 * Excel de control lo mantiene el dueño a mano y tiene que seguir abriéndose
 * igual después de que el panel escriba en él.
 *
 * Qué hace:
 *  - Zip mínimo: lee por el directorio central (el Excel exportado por Google
 *    lleva «data descriptors», los tamaños no están en la cabecera local) y
 *    escribe sin ellos. Deflate con `DecompressionStream`/`CompressionStream`
 *    ("deflate-raw"), que hay en Deno y en Node ≥ 20.
 *  - Hojas por nombre (workbook.xml + sus relaciones) y textos compartidos
 *    (también con formato: `<r><t>…`).
 *  - Leer celdas: número, texto compartido, `inlineStr`, resultado de fórmula
 *    (`t="str"`) y si la celda lleva fórmula.
 *  - Escribir celdas conservando su estilo (`s`): número, texto (`inlineStr`,
 *    con escape XML), fecha (número de serie de Excel) o vacía. Se NIEGA a
 *    escribir sobre una celda con fórmula.
 *  - `fullCalcOnLoad="1"` en workbook.xml al guardar con cambios: Excel y Google
 *    Sheets recalculan todo al abrir (los valores guardados de las fórmulas
 *    quedan viejos tras escribir; `actualizarCache` permite refrescar los que
 *    se sepan calcular).
 *  - Listas de validación de datos (`<dataValidation type="list">`).
 *
 * Sin dependencias. Funciona igual en Deno (función) y en vitest/node (pruebas).
 */

export type MotivoErrorXlsx = "zip" | "formato" | "hoja" | "formula" | "referencia" | "valor";

export class ErrorXlsx extends Error {
  readonly motivo: MotivoErrorXlsx;
  constructor(mensaje: string, motivo: MotivoErrorXlsx) {
    super(mensaje);
    this.name = "ErrorXlsx";
    this.motivo = motivo;
  }
}

// ─── ZIP ────────────────────────────────────────────────────────────────────

export interface EntradaZip {
  nombre: string;
  /** 0 = almacenado, 8 = deflate. */
  metodo: number;
  crc: number;
  /** Tamaño sin comprimir. */
  tamano: number;
  /** Bytes tal cual están en el zip. */
  comprimido: Uint8Array;
  hora: number;
  fecha: number;
  /** El nombre está en UTF-8 (bit 11). */
  utf8: boolean;
}

const FIRMA_LOCAL = 0x04034b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_FIN = 0x06054b50;

let tablaCrc: Uint32Array | null = null;
export function crc32(datos: Uint8Array): number {
  if (!tablaCrc) {
    tablaCrc = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tablaCrc[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < datos.length; i++) crc = tablaCrc[(crc ^ datos[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function porFlujo(datos: Uint8Array, flujo: { readable: ReadableStream; writable: WritableStream }): Promise<Uint8Array> {
  const escritor = flujo.writable.getWriter();
  // No se espera a la escritura: la lectura de abajo es la que vacía el flujo.
  const escrito = escritor.write(datos).then(() => escritor.close());
  const [salida] = await Promise.all([new Response(flujo.readable).arrayBuffer(), escrito]);
  return new Uint8Array(salida);
}

type ConstructorFlujo = new (formato: string) => { readable: ReadableStream; writable: WritableStream };
const flujos = globalThis as unknown as { DecompressionStream?: ConstructorFlujo; CompressionStream?: ConstructorFlujo };

async function inflar(datos: Uint8Array): Promise<Uint8Array> {
  if (!flujos.DecompressionStream) throw new ErrorXlsx("Este entorno no sabe descomprimir (falta DecompressionStream)", "zip");
  try {
    return await porFlujo(datos, new flujos.DecompressionStream("deflate-raw"));
  } catch {
    throw new ErrorXlsx("El fichero está dañado: no se pudo descomprimir una de sus partes", "zip");
  }
}

async function desinflar(datos: Uint8Array): Promise<Uint8Array> {
  if (!flujos.CompressionStream) throw new ErrorXlsx("Este entorno no sabe comprimir (falta CompressionStream)", "zip");
  return await porFlujo(datos, new flujos.CompressionStream("deflate-raw"));
}

/** Entradas del zip, en el orden del directorio central. No descomprime nada. */
export function leerZip(bytes: Uint8Array): EntradaZip[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fin = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
    if (v.getUint32(i, true) === FIRMA_FIN) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new ErrorXlsx("No es un fichero de Excel válido (no es un zip)", "zip");
  const total = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  if (total === 0xffff || p === 0xffffffff) throw new ErrorXlsx("El fichero es demasiado grande (zip64)", "zip");
  const decUtf8 = new TextDecoder("utf-8");
  const decLatin = new TextDecoder("latin1");
  const entradas: EntradaZip[] = [];
  for (let n = 0; n < total; n++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== FIRMA_CENTRAL) throw new ErrorXlsx("El zip del Excel está dañado (directorio)", "zip");
    const banderas = v.getUint16(p + 8, true);
    const metodo = v.getUint16(p + 10, true);
    const hora = v.getUint16(p + 12, true);
    const fecha = v.getUint16(p + 14, true);
    const crc = v.getUint32(p + 16, true);
    const tamComprimido = v.getUint32(p + 20, true);
    const tamano = v.getUint32(p + 24, true);
    const largoNombre = v.getUint16(p + 28, true);
    const largoExtra = v.getUint16(p + 30, true);
    const largoComentario = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    if (banderas & 1) throw new ErrorXlsx("El Excel está protegido con contraseña", "zip");
    if (metodo !== 0 && metodo !== 8) throw new ErrorXlsx("El zip del Excel usa una compresión que no se sabe leer", "zip");
    const utf8 = (banderas & 0x800) !== 0;
    const nombre = (utf8 ? decUtf8 : decLatin).decode(bytes.subarray(p + 46, p + 46 + largoNombre));
    if (local + 30 > bytes.length || v.getUint32(local, true) !== FIRMA_LOCAL) throw new ErrorXlsx("El zip del Excel está dañado (cabecera)", "zip");
    const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (inicio + tamComprimido > bytes.length) throw new ErrorXlsx("El zip del Excel está cortado", "zip");
    entradas.push({ nombre, metodo, crc, tamano, comprimido: bytes.subarray(inicio, inicio + tamComprimido), hora, fecha, utf8 });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

/** Contenido (descomprimido y comprobado) de una entrada. */
export async function contenidoEntrada(e: EntradaZip): Promise<Uint8Array> {
  const datos = e.metodo === 0 ? e.comprimido : await inflar(e.comprimido);
  if (datos.length !== e.tamano || crc32(datos) !== e.crc) throw new ErrorXlsx(`El fichero está dañado («${e.nombre}» no cuadra)`, "zip");
  return datos;
}

/** Fecha y hora en el formato de MS-DOS que guarda el zip. */
function fechaDos(d: Date): { hora: number; fecha: number } {
  const anio = Math.max(1980, d.getUTCFullYear());
  return {
    hora: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    fecha: ((anio - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/** Entrada nueva (comprimida) con el mismo nombre que `base`, si se da. */
export async function entradaDesde(nombre: string, datos: Uint8Array, ahora = new Date()): Promise<EntradaZip> {
  const comprimido = await desinflar(datos);
  const usar = comprimido.length < datos.length;
  return { nombre, metodo: usar ? 8 : 0, crc: crc32(datos), tamano: datos.length, comprimido: usar ? comprimido : datos, ...fechaDos(ahora), utf8: true };
}

/** Zip con esas entradas, en ese orden. Sin «data descriptors» ni zip64. */
export function escribirZip(entradas: readonly EntradaZip[]): Uint8Array {
  const cod = new TextEncoder();
  const nombres = entradas.map((e) => cod.encode(e.nombre));
  let largo = 22;
  entradas.forEach((e, i) => (largo += 30 + 46 + 2 * nombres[i].length + e.comprimido.length));
  const salida = new Uint8Array(largo);
  const v = new DataView(salida.buffer);
  const desplazamientos: number[] = [];
  let p = 0;
  entradas.forEach((e, i) => {
    const nombre = nombres[i];
    desplazamientos.push(p);
    v.setUint32(p, FIRMA_LOCAL, true);
    v.setUint16(p + 4, 20, true);
    v.setUint16(p + 6, 0x800, true);
    v.setUint16(p + 8, e.metodo, true);
    v.setUint16(p + 10, e.hora, true);
    v.setUint16(p + 12, e.fecha, true);
    v.setUint32(p + 14, e.crc, true);
    v.setUint32(p + 18, e.comprimido.length, true);
    v.setUint32(p + 22, e.tamano, true);
    v.setUint16(p + 26, nombre.length, true);
    v.setUint16(p + 28, 0, true);
    salida.set(nombre, p + 30);
    salida.set(e.comprimido, p + 30 + nombre.length);
    p += 30 + nombre.length + e.comprimido.length;
  });
  const inicioCentral = p;
  entradas.forEach((e, i) => {
    const nombre = nombres[i];
    v.setUint32(p, FIRMA_CENTRAL, true);
    v.setUint16(p + 4, 20, true);
    v.setUint16(p + 6, 20, true);
    v.setUint16(p + 8, 0x800, true);
    v.setUint16(p + 10, e.metodo, true);
    v.setUint16(p + 12, e.hora, true);
    v.setUint16(p + 14, e.fecha, true);
    v.setUint32(p + 16, e.crc, true);
    v.setUint32(p + 20, e.comprimido.length, true);
    v.setUint32(p + 24, e.tamano, true);
    v.setUint16(p + 28, nombre.length, true);
    v.setUint32(p + 42, desplazamientos[i], true);
    salida.set(nombre, p + 46);
    p += 46 + nombre.length;
  });
  v.setUint32(p, FIRMA_FIN, true);
  v.setUint16(p + 8, entradas.length, true);
  v.setUint16(p + 10, entradas.length, true);
  v.setUint32(p + 12, p - inicioCentral, true);
  v.setUint32(p + 16, inicioCentral, true);
  return salida;
}

// ─── XML y referencias ──────────────────────────────────────────────────────

/** Sin los caracteres que XML 1.0 no admite (controles salvo tabulador y saltos). */
// deno-lint-ignore no-control-regex
// eslint-disable-next-line no-control-regex
const NO_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escaparXml(texto: string): string {
  return texto.replace(NO_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function desescaparXml(texto: string): string {
  if (!texto.includes("&")) return texto;
  return texto.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (todo, ent: string) => {
    if (ent[0] === "#") {
      const n = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : todo;
    }
    return ENTIDADES[ent] ?? todo;
  });
}

/** «A» → 1, «AB» → 28. */
export function numeroDeColumna(col: string): number {
  let n = 0;
  for (const c of col.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

/** 1 → «A», 28 → «AB». */
export function columnaDeNumero(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** «AB12» → { col: "AB", fila: 12 }. Lanza si no es una referencia de celda. */
export function partirReferencia(ref: string): { col: string; fila: number } {
  const m = /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/.exec(ref);
  if (!m) throw new ErrorXlsx(`Referencia de celda no válida: «${ref}»`, "referencia");
  return { col: m[1].toUpperCase(), fila: Number(m[2]) };
}

const DIA_MS = 86_400_000;
/** Días entre el 30-dic-1899 (día 0 de Excel) y el 1-ene-1970. */
const BASE_EXCEL = 25569;

/** «2026-11-13» → 46339 (número de serie de Excel). null si la fecha no existe. */
export function fechaASerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(a, mes - 1, d);
  const f = new Date(t);
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d || a < 1900) return null;
  return Math.round(t / DIA_MS) + BASE_EXCEL;
}

/** 46339 → «2026-11-13» (la parte de hora se descarta). null si no es un día razonable. */
export function serialAFecha(serie: number): string | null {
  if (!Number.isFinite(serie) || serie < 1 || serie > 2_958_465) return null;
  return new Date((Math.floor(serie) - BASE_EXCEL) * DIA_MS).toISOString().slice(0, 10);
}

function atributo(attrs: string, nombre: string): string | null {
  const m = new RegExp(`(?:^|\\s)${nombre}="([^"]*)"`).exec(attrs);
  return m ? desescaparXml(m[1]) : null;
}

/** Texto de un `<si>` o `<is>`: todos sus `<t>` seguidos (sin la guía fonética). */
function textoDe(xml: string): string {
  const limpio = xml.includes("<rPh") ? xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "") : xml;
  let texto = "";
  for (const m of limpio.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) texto += desescaparXml(m[1] ?? "");
  return texto;
}

/** Textos compartidos de `xl/sharedStrings.xml`, por índice. */
export function leerTextosCompartidos(xml: string): string[] {
  const salida: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) salida.push(m[1] ? textoDe(m[1]) : "");
  return salida;
}

// ─── Hojas ──────────────────────────────────────────────────────────────────

export type ValorCelda = string | number | boolean | null;

export interface Celda {
  ref: string;
  /** null = vacía. En una celda con fórmula es el último valor calculado que guardó Excel. */
  valor: ValorCelda;
  formula: boolean;
  /** Índice de estilo (`s`) tal cual está en el XML. */
  estilo: string | null;
}

/** Lo que se puede escribir: nada, un número, un texto o una fecha (ISO). */
export type ValorEscrito = string | number | null | { fecha: string };

export interface CambioCelda {
  ref: string;
  valor: ValorEscrito;
  /** Estilo a poner; sin él se conserva el que tuviera la celda. */
  estilo?: string | null;
}

export interface Validacion {
  /** Rangos a los que se aplica («B7:B506», puede haber varios separados por espacio). */
  sqref: string;
  /** Valores de la lista, si están escritos en la propia validación; null si es un rango. */
  valores: string[] | null;
}

interface PosFila {
  /** Inicio de `<row`. */
  ini: number;
  /** Fin de la etiqueta de apertura (tras `>`). */
  finApertura: number;
  /** Fin de la fila (tras `</row>` o tras `/>`). */
  fin: number;
  autocerrada: boolean;
}

interface CeldaXml extends Celda {
  col: number;
  ini: number;
  fin: number;
  /** El `<f …>…</f>` o `<f …/>` tal cual, si lo hay. */
  formulaXml: string | null;
}

const RE_CELDA = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

function numeroXml(n: number): string {
  if (!Number.isFinite(n)) throw new ErrorXlsx("No se puede escribir un número que no es finito", "valor");
  // Hasta 10 decimales: quita el ruido binario (17.140000000000001) sin perder céntimos.
  return String(Number(n.toFixed(10)));
}

function xmlCelda(ref: string, estilo: string | null, valor: ValorEscrito): string {
  const s = estilo != null && estilo !== "" ? ` s="${escaparXml(estilo)}"` : "";
  if (valor === null || valor === "") return `<c r="${ref}"${s}/>`;
  if (typeof valor === "number") return `<c r="${ref}"${s}><v>${numeroXml(valor)}</v></c>`;
  if (typeof valor === "object") {
    const serie = fechaASerial(valor.fecha);
    if (serie == null) throw new ErrorXlsx(`Fecha no válida: «${valor.fecha}»`, "valor");
    return `<c r="${ref}"${s}><v>${serie}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`;
}

export class HojaXlsx {
  readonly nombre: string;
  private texto: string;
  private readonly cadenas: readonly string[];
  private filas: Map<number, PosFila> | null = null;
  private cambiada = false;

  constructor(nombre: string, xml: string, cadenas: readonly string[] = []) {
    this.nombre = nombre;
    this.texto = xml;
    this.cadenas = cadenas;
  }

  get xml(): string {
    return this.texto;
  }

  get modificada(): boolean {
    return this.cambiada;
  }

  private indice(): Map<number, PosFila> {
    if (this.filas) return this.filas;
    const mapa = new Map<number, PosFila>();
    const re = /<row\b([^>]*)>/g;
    let anterior = 0;
    for (let m = re.exec(this.texto); m; m = re.exec(this.texto)) {
      const autocerrada = m[1].endsWith("/");
      const r = atributo(m[1], "r");
      const n = r && /^\d+$/.test(r) ? Number(r) : anterior + 1;
      anterior = n;
      const finApertura = m.index + m[0].length;
      let fin = finApertura;
      if (!autocerrada) {
        const cierre = this.texto.indexOf("</row>", finApertura);
        if (cierre < 0) throw new ErrorXlsx(`La hoja «${this.nombre}» tiene una fila sin cerrar`, "formato");
        fin = cierre + 6;
        re.lastIndex = fin;
      }
      mapa.set(n, { ini: m.index, finApertura, fin, autocerrada });
    }
    this.filas = mapa;
    return mapa;
  }

  /** Números de las filas que existen en el XML, en orden. */
  numerosDeFila(): number[] {
    return [...this.indice().keys()].sort((a, b) => a - b);
  }

  private celdasDe(fila: number, pos: PosFila): CeldaXml[] {
    if (pos.autocerrada) return [];
    const interior = this.texto.slice(pos.finApertura, pos.fin - 6);
    const salida: CeldaXml[] = [];
    let colAnterior = 0;
    RE_CELDA.lastIndex = 0;
    for (let m = RE_CELDA.exec(interior); m; m = RE_CELDA.exec(interior)) {
      const attrs = m[1];
      const dentro = m[2] ?? "";
      const r = atributo(attrs, "r");
      const col = r ? numeroDeColumna(partirReferencia(r).col) : colAnterior + 1;
      colAnterior = col;
      const tipo = atributo(attrs, "t");
      const f = /<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/.exec(dentro);
      const v = /<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/.exec(dentro);
      const crudo = v ? desescaparXml(v[1] ?? "") : null;
      let valor: ValorCelda = null;
      if (tipo === "inlineStr") {
        const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(dentro);
        valor = is ? textoDe(is[1]) : null;
      } else if (crudo != null && crudo !== "") {
        if (tipo === "s") valor = this.cadenas[Number(crudo)] ?? null;
        else if (tipo === "str" || tipo === "e" || tipo === "d") valor = crudo;
        else if (tipo === "b") valor = crudo === "1";
        else valor = Number.isFinite(Number(crudo)) ? Number(crudo) : crudo;
      }
      if (valor === "") valor = null;
      salida.push({
        ref: `${columnaDeNumero(col)}${fila}`,
        valor,
        formula: !!f,
        estilo: atributo(attrs, "s"),
        col,
        ini: pos.finApertura + m.index,
        fin: pos.finApertura + m.index + m[0].length,
        formulaXml: f ? f[0] : null,
      });
    }
    return salida;
  }

  /** Celdas de una fila, por letra de columna. Vacío si la fila no existe. */
  fila(n: number): Map<string, Celda> {
    const pos = this.indice().get(n);
    const mapa = new Map<string, Celda>();
    if (!pos) return mapa;
    for (const c of this.celdasDe(n, pos)) mapa.set(columnaDeNumero(c.col), { ref: c.ref, valor: c.valor, formula: c.formula, estilo: c.estilo });
    return mapa;
  }

  /** Una celda (null si no existe en el XML: está vacía y sin formato). */
  celda(ref: string): Celda | null {
    const { col, fila } = partirReferencia(ref);
    return this.fila(fila).get(col) ?? null;
  }

  private reemplazar(ini: number, fin: number, nuevo: string): void {
    this.texto = this.texto.slice(0, ini) + nuevo + this.texto.slice(fin);
    this.filas = null;
    this.cambiada = true;
  }

  /** Abre una fila autocerrada o crea la que falta, para poder meterle celdas. */
  private asegurarFila(n: number): PosFila {
    let pos = this.indice().get(n);
    if (pos && !pos.autocerrada) return pos;
    if (pos) {
      const apertura = this.texto.slice(pos.ini, pos.finApertura).replace(/\s*\/>$/, ">");
      this.reemplazar(pos.ini, pos.fin, `${apertura}</row>`);
    } else {
      const siguiente = this.numerosDeFila().find((x) => x > n);
      let donde: number;
      if (siguiente != null) donde = this.indice().get(siguiente)!.ini;
      else {
        donde = this.texto.indexOf("</sheetData>");
        if (donde < 0) {
          const vacia = /<sheetData\s*\/>/.exec(this.texto);
          if (!vacia) throw new ErrorXlsx(`La hoja «${this.nombre}» no tiene datos donde escribir`, "formato");
          this.reemplazar(vacia.index, vacia.index + vacia[0].length, "<sheetData></sheetData>");
          donde = this.texto.indexOf("</sheetData>");
        }
      }
      this.reemplazar(donde, donde, `<row r="${n}"></row>`);
    }
    pos = this.indice().get(n);
    if (!pos || pos.autocerrada) throw new ErrorXlsx(`No se pudo preparar la fila ${n} de «${this.nombre}»`, "formato");
    return pos;
  }

  /**
   * Escribe celdas. Conserva el estilo de cada una (salvo que el cambio traiga
   * otro) y no toca nada más. Lanza `ErrorXlsx("formula")` —sin haber escrito
   * nada— si alguna de las celdas lleva fórmula.
   */
  escribir(cambios: readonly CambioCelda[]): void {
    const porFila = new Map<number, Array<{ col: number; cambio: CambioCelda }>>();
    for (const cambio of cambios) {
      const { col, fila } = partirReferencia(cambio.ref);
      const lista = porFila.get(fila) ?? [];
      lista.push({ col: numeroDeColumna(col), cambio });
      porFila.set(fila, lista);
    }
    // Primero se comprueba todo: o se escribe todo o nada.
    for (const [fila, lista] of porFila) {
      const pos = this.indice().get(fila);
      if (!pos) continue;
      const celdas = this.celdasDe(fila, pos);
      for (const { col } of lista) {
        if (celdas.find((c) => c.col === col)?.formula) {
          throw new ErrorXlsx(`La celda ${columnaDeNumero(col)}${fila} de «${this.nombre}» tiene una fórmula: no se escribe encima`, "formula");
        }
      }
    }
    for (const [fila, lista] of porFila) {
      const pos = this.asegurarFila(fila);
      const celdas = this.celdasDe(fila, pos);
      const porCol = new Map<number, CambioCelda>(lista.map((x) => [x.col, x.cambio]));
      const piezas: string[] = [];
      let cursor = pos.finApertura;
      const pendientes = [...porCol.keys()].sort((a, b) => a - b);
      const nueva = (col: number, estiloActual: string | null) => {
        const cambio = porCol.get(col)!;
        return xmlCelda(`${columnaDeNumero(col)}${fila}`, cambio.estilo !== undefined ? cambio.estilo : estiloActual, cambio.valor);
      };
      for (const c of celdas) {
        // Celdas que no existían y van antes de esta.
        while (pendientes.length && pendientes[0] < c.col) {
          piezas.push(this.texto.slice(cursor, c.ini), nueva(pendientes.shift()!, null));
          cursor = c.ini;
        }
        if (pendientes[0] === c.col) {
          pendientes.shift();
          piezas.push(this.texto.slice(cursor, c.ini), nueva(c.col, c.estilo));
          cursor = c.fin;
        }
      }
      const finInterior = pos.fin - 6;
      piezas.push(this.texto.slice(cursor, finInterior));
      for (const col of pendientes) piezas.push(nueva(col, null));
      // `spans` es solo una pista para Excel: si se añadió una celda fuera, se quita.
      const apertura = this.texto.slice(pos.ini, pos.finApertura).replace(/\s+spans="[^"]*"/, "");
      this.reemplazar(pos.ini, pos.fin, `${apertura}${piezas.join("")}</row>`);
    }
  }

  /**
   * Cambia el valor GUARDADO de una celda con fórmula (lo que enseña una vista
   * previa sin recalcular). La fórmula no se toca. No hace nada si la celda no
   * existe o no tiene fórmula.
   */
  actualizarCache(ref: string, valor: string | number): void {
    const { col, fila } = partirReferencia(ref);
    const pos = this.indice().get(fila);
    if (!pos) return;
    const c = this.celdasDe(fila, pos).find((x) => x.col === numeroDeColumna(col));
    if (!c?.formula || !c.formulaXml) return;
    const s = c.estilo != null ? ` s="${escaparXml(c.estilo)}"` : "";
    const nuevo = typeof valor === "number"
      ? `<c r="${c.ref}"${s}>${c.formulaXml}<v>${numeroXml(valor)}</v></c>`
      : `<c r="${c.ref}"${s} t="str">${c.formulaXml}<v>${escaparXml(valor)}</v></c>`;
    if (nuevo !== this.texto.slice(c.ini, c.fin)) this.reemplazar(c.ini, c.fin, nuevo);
  }

  /** Validaciones de datos de tipo lista. */
  validaciones(): Validacion[] {
    const salida: Validacion[] = [];
    for (const m of this.texto.matchAll(/<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/g)) {
      if (atributo(m[1], "type") !== "list") continue;
      const sqref = atributo(m[1], "sqref");
      const f1 = /<formula1>([\s\S]*?)<\/formula1>/.exec(m[2]);
      if (!sqref || !f1) continue;
      const formula = desescaparXml(f1[1]).trim();
      const literal = /^"([\s\S]*)"$/.exec(formula);
      salida.push({ sqref, valores: literal ? literal[1].split(",").map((x) => x.trim()).filter(Boolean) : null });
    }
    return salida;
  }

  /** Valores del desplegable de una celda (null si no tiene lista escrita). */
  listaDe(ref: string): string[] | null {
    const { col, fila } = partirReferencia(ref);
    const c = numeroDeColumna(col);
    for (const v of this.validaciones()) {
      for (const rango of v.sqref.split(/\s+/)) {
        const [a, b = a] = rango.split(":");
        let p: { col: string; fila: number }, q: { col: string; fila: number };
        try {
          p = partirReferencia(a);
          q = partirReferencia(b);
        } catch {
          continue;
        }
        if (c >= numeroDeColumna(p.col) && c <= numeroDeColumna(q.col) && fila >= p.fila && fila <= q.fila) return v.valores;
      }
    }
    return null;
  }
}

// ─── Libro ──────────────────────────────────────────────────────────────────

const RUTA_LIBRO = "xl/workbook.xml";

function resolverDestino(destino: string): string {
  if (destino.startsWith("/")) return destino.slice(1);
  const partes: string[] = ["xl"];
  for (const tramo of destino.split("/")) {
    if (tramo === "..") partes.pop();
    else if (tramo && tramo !== ".") partes.push(tramo);
  }
  return partes.join("/");
}

/** Pone `fullCalcOnLoad="1"` en el `<calcPr>` de workbook.xml (lo crea si falta). */
export function marcarRecalculo(xmlLibro: string): string {
  const m = /<calcPr\b([^>]*?)(\/?)>/.exec(xmlLibro);
  if (m) {
    if (/\bfullCalcOnLoad="(1|true)"/.test(m[1])) return xmlLibro;
    const attrs = m[1].replace(/\s*\bfullCalcOnLoad="[^"]*"/, "").replace(/\s+$/, "");
    return `${xmlLibro.slice(0, m.index)}<calcPr${attrs} fullCalcOnLoad="1"${m[2]}>${xmlLibro.slice(m.index + m[0].length)}`;
  }
  // Orden del esquema: …sheets, functionGroups, externalReferences, definedNames, calcPr…
  for (const tras of [/<definedNames\s*\/>|<\/definedNames>/, /<externalReferences\s*\/>|<\/externalReferences>/, /<functionGroups\s*\/>|<\/functionGroups>/, /<\/sheets>/]) {
    const t = tras.exec(xmlLibro);
    if (t) return `${xmlLibro.slice(0, t.index + t[0].length)}<calcPr fullCalcOnLoad="1"/>${xmlLibro.slice(t.index + t[0].length)}`;
  }
  return xmlLibro;
}

export class LibroXlsx {
  private readonly original: Uint8Array;
  private readonly entradas: EntradaZip[];
  private readonly rutas = new Map<string, string>();
  private readonly abiertas = new Map<string, HojaXlsx>();
  private cadenas: string[] = [];
  private xmlLibro = "";

  private constructor(original: Uint8Array, entradas: EntradaZip[]) {
    this.original = original;
    this.entradas = entradas;
  }

  private async texto(ruta: string): Promise<string | null> {
    const e = this.entradas.find((x) => x.nombre === ruta);
    return e ? new TextDecoder("utf-8").decode(await contenidoEntrada(e)) : null;
  }

  static async abrir(bytes: Uint8Array): Promise<LibroXlsx> {
    const libro = new LibroXlsx(bytes, leerZip(bytes));
    const xml = await libro.texto(RUTA_LIBRO);
    const rels = await libro.texto("xl/_rels/workbook.xml.rels");
    if (!xml || !rels) throw new ErrorXlsx("No es un libro de Excel (falta workbook.xml)", "formato");
    libro.xmlLibro = xml;
    const destinos = new Map<string, { destino: string; tipo: string }>();
    for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
      const id = atributo(m[1], "Id");
      const destino = atributo(m[1], "Target");
      if (id && destino) destinos.set(id, { destino: resolverDestino(destino), tipo: atributo(m[1], "Type") ?? "" });
    }
    for (const m of xml.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
      const nombre = atributo(m[1], "name");
      const id = atributo(m[1], "r:id");
      const rel = id ? destinos.get(id) : undefined;
      if (nombre && rel) libro.rutas.set(nombre, rel.destino);
    }
    const compartidos = [...destinos.values()].find((d) => d.tipo.endsWith("/sharedStrings"));
    const xmlCadenas = compartidos ? await libro.texto(compartidos.destino) : null;
    libro.cadenas = xmlCadenas ? leerTextosCompartidos(xmlCadenas) : [];
    return libro;
  }

  /** Nombres de las hojas, en el orden del libro. */
  nombresHojas(): string[] {
    return [...this.rutas.keys()];
  }

  tieneHoja(nombre: string): boolean {
    return this.rutas.has(nombre);
  }

  /** Una hoja por su nombre. Lanza `ErrorXlsx("hoja")` si no existe. */
  async hoja(nombre: string): Promise<HojaXlsx> {
    const abierta = this.abiertas.get(nombre);
    if (abierta) return abierta;
    const ruta = this.rutas.get(nombre);
    const xml = ruta ? await this.texto(ruta) : null;
    if (xml == null) throw new ErrorXlsx(`El Excel no tiene la hoja «${nombre}»`, "hoja");
    const hoja = new HojaXlsx(nombre, xml, this.cadenas);
    this.abiertas.set(nombre, hoja);
    return hoja;
  }

  get modificado(): boolean {
    return [...this.abiertas.values()].some((h) => h.modificada);
  }

  /** Bytes del libro. Sin cambios, los mismos que se abrieron. */
  async guardar(ahora = new Date()): Promise<Uint8Array> {
    if (!this.modificado) return this.original;
    const cod = new TextEncoder();
    const nuevas = new Map<string, Uint8Array>();
    for (const [nombre, hoja] of this.abiertas) if (hoja.modificada) nuevas.set(this.rutas.get(nombre)!, cod.encode(hoja.xml));
    const recalculo = marcarRecalculo(this.xmlLibro);
    if (recalculo !== this.xmlLibro) nuevas.set(RUTA_LIBRO, cod.encode(recalculo));
    const salida: EntradaZip[] = [];
    for (const e of this.entradas) {
      const datos = nuevas.get(e.nombre);
      salida.push(datos ? await entradaDesde(e.nombre, datos, ahora) : e);
    }
    return escribirZip(salida);
  }
}
