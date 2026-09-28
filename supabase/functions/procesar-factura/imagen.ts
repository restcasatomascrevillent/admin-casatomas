// ============================================================================
//  imagen.ts · Que resolucion ve REALMENTE el modelo, y si da para leer digitos
// ----------------------------------------------------------------------------
//  Sin esto, "puede que las imagenes vayan con poca resolucion" es una
//  sospecha. Con esto es un numero por documento en el log.
//
//  EL PROBLEMA QUE MIDE
//  --------------------
//  El pipeline manda la foto tal cual la sube el usuario, con
//  `detail: "high"`. OpenAI NO la mira a resolucion completa: la reescala
//  antes. Y hay DOS algoritmos distintos, segun el modelo
//  (https://developers.openai.com/api/docs/guides/images-vision):
//
//   · POR CUADROS ("tiles"): encaja la imagen en 2048x2048, y si el lado
//     corto sigue por encima de 768 px lo baja a 768. Lo usan gpt-5,
//     gpt-5.1, gpt-4o, gpt-4.1 y gpt-4o-mini.
//
//   · POR PARCHES ("patches"): cubre la imagen con parches de 32x32 px, topa
//     el lado mayor en 2048 px y, si el numero de parches pasa del
//     presupuesto (2.500 para gpt-5-mini), la encoge hasta que quepa.
//     Lo usan gpt-5-mini (el modelo de esta funcion) y gpt-5-nano.
//
//  La diferencia NO es un detalle: el mismo A4 sale a ~93 DPI por cuadros y
//  a ~161 DPI por parches. Calcular el de cuadros creyendo que vale para
//  gpt-5-mini da un numero casi el doble de pesimista. Por eso aqui estan
//  los dos, y `resolucionEfectiva` usa por defecto el que corresponde al
//  modelo que realmente se llama.
//
//  QUE SALE DE MEDIRLO (A4 en vertical, gpt-5-mini, detail high)
//  -------------------------------------------------------------
//   - Un escaneo a 300 DPI (2480x3508) llega al modelo como ~1334x1888.
//   - Una foto de movil de 3024x4032 llega como ~1368x1824.
//   Los dos rondan los 155-161 DPI: el presupuesto de parches manda, no lo
//   que suba el usuario. De ahi que subir una foto MAS grande no arregle
//   nada — pero tampoco es la catastrofe de 90 DPI que parecia.
//
//   A ~160 DPI, un texto de 7 pt mide ~15,6 px de alto y uno de 6 pt ~13,3.
//   Azure pide un minimo de 12 px de altura de texto y AWS 15. O sea: la
//   letra pequena de una tabla de lineas esta JUSTO en el limite. Es
//   marginal, no holgado, y eso encaja con que fallen digitos sueltos
//   (591,33 leido 585,33) y no documentos enteros.
//
//   Lo unico que sube de verdad la resolucion sobre la zona que importa es
//   RECORTAR antes de subir: los mismos parches repartidos sobre media hoja
//   valen el doble de DPI. Hay evidencia de que el recorte ayuda siempre que
//   se mande ADEMAS de la pagina entera, no en su lugar.
//
//  No tiene dependencias ni efectos al importarla (mismo criterio que
//  normalizacion.ts y esquema.ts), asi que se testea con vitest.
// ============================================================================

export interface Dimensiones {
  ancho: number;
  alto: number;
  formato: "jpeg" | "png" | "webp";
}

/**
 * Lee ancho y alto de la CABECERA del fichero, sin decodificar la imagen.
 * Devuelve null si no se reconoce el formato o la cabecera esta incompleta.
 *
 * Solo hace falta pasarle los primeros kilobytes: en PNG y WebP las medidas
 * estan en los primeros 30 bytes, y en JPEG en el marcador SOF, que puede
 * estar detras de un EXIF con miniatura pero rara vez mas alla de unos pocos
 * cientos de KB.
 */
export function dimensionesImagen(bytes: Uint8Array): Dimensiones | null {
  return leerPng(bytes) ?? leerWebp(bytes) ?? leerJpeg(bytes);
}

function leerPng(b: Uint8Array): Dimensiones | null {
  // Firma PNG + longitud + "IHDR", y despues ancho y alto en big-endian.
  if (b.length < 24) return null;
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (b[i] !== firma[i]) return null;
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  return { ancho: u32(b, 16), alto: u32(b, 20), formato: "png" };
}

function leerWebp(b: Uint8Array): Dimensiones | null {
  // "RIFF" .... "WEBP" y luego el chunk, que puede ser VP8 / VP8L / VP8X.
  if (b.length < 30) return null;
  if (texto(b, 0, 4) !== "RIFF" || texto(b, 8, 4) !== "WEBP") return null;
  const chunk = texto(b, 12, 4);

  if (chunk === "VP8X") {
    // Lienzo en 24 bits little-endian, menos uno.
    return { ancho: u24le(b, 24) + 1, alto: u24le(b, 27) + 1, formato: "webp" };
  }
  if (chunk === "VP8 ") {
    // Cabecera de fotograma clave: 14 bits utiles de cada medida.
    return { ancho: u16le(b, 26) & 0x3fff, alto: u16le(b, 28) & 0x3fff, formato: "webp" };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null; // byte de firma de VP8L
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return {
      ancho: (bits & 0x3fff) + 1,
      alto: ((bits >> 14) & 0x3fff) + 1,
      formato: "webp",
    };
  }
  return null;
}

function leerJpeg(b: Uint8Array): Dimensiones | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }          // resincronizar ante relleno
    const marcador = b[i + 1];
    if (marcador === 0xff) { i++; continue; }      // relleno 0xFF
    // Marcadores sin carga util.
    if (marcador === 0xd8 || (marcador >= 0xd0 && marcador <= 0xd9)) { i += 2; continue; }
    const longitud = (b[i + 2] << 8) | b[i + 3];
    if (longitud < 2) return null;
    // SOF0..SOF15 llevan las medidas. Se excluyen DHT (C4), JPG (C8) y DAC (CC),
    // que caen en el mismo rango pero no son "start of frame".
    const esSof = marcador >= 0xc0 && marcador <= 0xcf &&
      marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc;
    if (esSof) {
      return {
        alto: (b[i + 5] << 8) | b[i + 6],
        ancho: (b[i + 7] << 8) | b[i + 8],
        formato: "jpeg",
      };
    }
    i += 2 + longitud;
  }
  return null;
}

const u32 = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const texto = (b: Uint8Array, o: number, n: number) =>
  String.fromCharCode(...b.subarray(o, o + n));

// ─── Resolucion efectiva ─────────────────────────────────────────────────────

export type EsquemaTokens = "parches" | "cuadros";

export interface ResolucionEfectiva {
  /** Lo que se sube. */
  original: { ancho: number; alto: number };
  /** Lo que el modelo mira de verdad, tras el reescalado de OpenAI. */
  efectiva: { ancho: number; alto: number };
  /** Cual de los dos algoritmos se ha aplicado. */
  esquema: EsquemaTokens;
  /** Tokens de imagen que factura la llamada. */
  tokens: number;
  /** Altura en pixeles de un texto de 7 pt (el cuerpo tipico de una tabla de
   *  lineas) a la resolucion que ve el modelo. Es mas util que el DPI: los
   *  proveedores de OCR publican minimos en PIXELES POR CARACTER (Azure 12,
   *  AWS 15), no en DPI. */
  pxTexto7pt: number;
  /** DPI equivalente SI la imagen es un A4 completo. Para un recorte el valor
   *  real es mayor, en proporcion a la fraccion de hoja que cubra. */
  dpiA4: number;
  /** Fraccion de los pixeles subidos que el modelo llega a usar. */
  aprovechado: number;
}

const A4_LADO_LARGO_PULGADAS = 297 / 25.4; // 11.69"

// Esquema por CUADROS (gpt-5, gpt-5.1, gpt-4o, gpt-4.1, gpt-4o-mini).
const CUADRADO_MAX = 2048;
const LADO_CORTO_MAX = 768;

// Esquema por PARCHES (gpt-5-mini, gpt-5-nano) — el que aplica aqui.
const PARCHE = 32;
const LADO_MAX_PARCHES = 2048;

// OJO: este numero es el unico de aqui que NO esta confirmado del todo.
// La documentacion vigente de OpenAI da 2.500 parches y lado maximo 2.048 px
// para gpt-5-mini con `detail: "high"`, y con esos valores esta funcion
// reproduce exactamente la cifra publicada de ejemplo (un A4 a 300 DPI ->
// 1333x1888 y 2.974 tokens de imagen), lo que es una comprobacion cruzada
// decente. Pero circula tambien un presupuesto de 1.536 de una version
// anterior de la documentacion, que daria ~124 DPI en vez de ~161.
//
// Se resuelve en una sola llamada real: leer `usage.prompt_tokens` de la
// respuesta y compararlo con `tokens` de aqui. Si no cuadra, el presupuesto
// es otro y basta cambiar esta constante. Mientras no se haga, tratar el DPI
// que sale de aqui como el escenario OPTIMISTA.
const PRESUPUESTO_PARCHES = 2500;
const MULTIPLICADOR_GPT5_MINI = 1.2;

/** Modelo de vision que usa `procesar-factura`. Si se cambia, hay que revisar
 *  cual de los dos esquemas le toca: no todos los modelos usan el mismo. */
export const ESQUEMA_DEL_MODELO: EsquemaTokens = "parches";

function porCuadros(ancho: number, alto: number) {
  let a = ancho, l = alto;
  const mayor = Math.max(a, l);
  if (mayor > CUADRADO_MAX) {
    const f = CUADRADO_MAX / mayor;
    a = Math.round(a * f); l = Math.round(l * f);
  }
  const menor = Math.min(a, l);
  if (menor > LADO_CORTO_MAX) {
    const f = LADO_CORTO_MAX / menor;
    a = Math.round(a * f); l = Math.round(l * f);
  }
  // gpt-5/5.1: 70 de base + 140 por cuadro de 512 px.
  const tokens = 70 + 140 * (Math.ceil(a / 512) * Math.ceil(l / 512));
  return { a, l, tokens };
}

function porParches(ancho: number, alto: number) {
  let a = ancho, l = alto;

  // 1) Topar el lado mayor en 2048 px.
  const mayor = Math.max(a, l);
  if (mayor > LADO_MAX_PARCHES) {
    const f = LADO_MAX_PARCHES / mayor;
    a = Math.floor(a * f); l = Math.floor(l * f);
  }

  // 2) Si no cabe en el presupuesto de parches, encoger. La formula es la
  //    que publica OpenAI, incluido el segundo ajuste: el primer factor deja
  //    un numero de parches no entero, y hay que corregirlo hacia abajo para
  //    no pasarse del presupuesto.
  let parches = Math.ceil(a / PARCHE) * Math.ceil(l / PARCHE);
  if (parches > PRESUPUESTO_PARCHES) {
    const f = Math.sqrt((PARCHE * PARCHE * PRESUPUESTO_PARCHES) / (a * l));
    const ajuste = f * Math.min(
      Math.floor((a * f) / PARCHE) / ((a * f) / PARCHE),
      Math.floor((l * f) / PARCHE) / ((l * f) / PARCHE),
    );
    a = Math.floor(a * ajuste);
    l = Math.floor(l * ajuste);
    parches = Math.ceil(a / PARCHE) * Math.ceil(l / PARCHE);
  }

  return { a, l, tokens: Math.ceil(parches * MULTIPLICADOR_GPT5_MINI) };
}

/**
 * Aplica el reescalado que OpenAI documenta para `detail: "high"` y traduce el
 * resultado a algo interpretable.
 *
 * `esquema` por defecto es el del modelo que se usa en esta funcion. Se puede
 * forzar el otro para comparar que se ganaria o perderia cambiando de modelo.
 */
export function resolucionEfectiva(
  ancho: number,
  alto: number,
  esquema: EsquemaTokens = ESQUEMA_DEL_MODELO,
): ResolucionEfectiva {
  const r = esquema === "parches" ? porParches(ancho, alto) : porCuadros(ancho, alto);
  const ladoLargo = Math.max(r.a, r.l);
  const dpiA4 = ladoLargo / A4_LADO_LARGO_PULGADAS;
  return {
    original: { ancho, alto },
    efectiva: { ancho: r.a, alto: r.l },
    esquema,
    tokens: r.tokens,
    // 7 pt = 7/72 de pulgada.
    pxTexto7pt: Math.round((dpiA4 * 7 / 72) * 10) / 10,
    dpiA4: Math.round(dpiA4),
    aprovechado: (ancho * alto) > 0 ? Math.min(1, (r.a * r.l) / (ancho * alto)) : 1,
  };
}

/**
 * Altura minima de caracter, en pixeles, por debajo de la cual los
 * proveedores de OCR documental no garantizan la lectura. AWS Textract pide
 * 15 px y Azure Document Intelligence 12. Se toma el mas exigente: es el que
 * marca la frontera de "aqui se pueden confundir digitos".
 */
export const PX_MINIMO_TEXTO = 15;

/** Frase para el log. Null si no se pudo medir (p.ej. un PDF: ahi manda
 *  OpenAI, que extrae por su cuenta el texto y las imagenes de cada pagina). */
export function diagnosticoResolucion(bytes: Uint8Array): string | null {
  const dim = dimensionesImagen(bytes);
  if (!dim) return null;
  const r = resolucionEfectiva(dim.ancho, dim.alto);
  const aviso = r.pxTexto7pt < PX_MINIMO_TEXTO
    ? ` AVISO: un texto de 7 pt queda en ~${r.pxTexto7pt} px de alto, por debajo de los ` +
      `${PX_MINIMO_TEXTO} px que piden los OCR documentales. Ahi es donde se confunden 3/8 y 5/6. ` +
      `Recortar el documento antes de subir sube la resolucion sobre la zona util; subir la foto mas grande NO.`
    : "";
  return (
    `[resolucion] ${dim.formato} ${dim.ancho}x${dim.alto} -> el modelo ve ` +
    `${r.efectiva.ancho}x${r.efectiva.alto} (${r.tokens} tokens de imagen, ~${r.dpiA4} DPI si es ` +
    `un A4 entero, texto de 7 pt a ~${r.pxTexto7pt} px, se aprovecha el ` +
    `${(r.aprovechado * 100).toFixed(1)}% de los pixeles).${aviso}`
  );
}
