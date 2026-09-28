import { describe, expect, it } from "vitest";
import {
  diagnosticoResolucion,
  dimensionesImagen,
  PX_MINIMO_TEXTO,
  resolucionEfectiva,
} from "./imagen.ts";

// ============================================================================
//  imagen.test.ts
// ----------------------------------------------------------------------------
//  Lo que se comprueba aqui es la ARITMETICA del reescalado que OpenAI aplica
//  a `detail: "high"`, porque es la que explica por que un documento se lee
//  mal: la foto de 12 megapixeles que sube el usuario llega al modelo como
//  1024x768.
// ============================================================================

// ─── Constructores de cabeceras minimas ─────────────────────────────────────

function png(ancho: number, alto: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const be = (v: number, o: number) => {
    b[o] = (v >>> 24) & 0xff; b[o + 1] = (v >>> 16) & 0xff;
    b[o + 2] = (v >>> 8) & 0xff; b[o + 3] = v & 0xff;
  };
  be(ancho, 16);
  be(alto, 20);
  return b;
}

/** JPEG con un segmento APP1 (EXIF) por delante, como el de cualquier movil:
 *  asi se comprueba que el escaneo de marcadores salta la carga util y no se
 *  queda con el primer 0xFFC0 que encuentre dentro del EXIF. */
function jpeg(ancho: number, alto: number, rellenoExif = 200): Uint8Array {
  const cuerpo: number[] = [0xff, 0xd8];
  const lonApp = rellenoExif + 2;
  cuerpo.push(0xff, 0xe1, (lonApp >> 8) & 0xff, lonApp & 0xff);
  for (let i = 0; i < rellenoExif; i++) cuerpo.push(0xc0); // ruido, no marcadores
  cuerpo.push(0xff, 0xc0, 0x00, 0x11, 0x08);
  cuerpo.push((alto >> 8) & 0xff, alto & 0xff);
  cuerpo.push((ancho >> 8) & 0xff, ancho & 0xff);
  for (let i = 0; i < 8; i++) cuerpo.push(0x00);
  return new Uint8Array(cuerpo);
}

function webpVp8x(ancho: number, alto: number): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x52, 0x49, 0x46, 0x46], 0);  // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8);  // WEBP
  b.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  const le24 = (v: number, o: number) => {
    b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; b[o + 2] = (v >> 16) & 0xff;
  };
  le24(ancho - 1, 24);
  le24(alto - 1, 27);
  return b;
}

// ─── Lectura de cabeceras ────────────────────────────────────────────────────

describe("dimensionesImagen", () => {
  it("lee un PNG", () => {
    expect(dimensionesImagen(png(1700, 2338))).toEqual({ ancho: 1700, alto: 2338, formato: "png" });
  });

  it("lee un JPEG saltando el EXIF", () => {
    expect(dimensionesImagen(jpeg(4032, 3024))).toEqual({ ancho: 4032, alto: 3024, formato: "jpeg" });
  });

  it("lee un JPEG con un EXIF grande (miniatura incrustada)", () => {
    expect(dimensionesImagen(jpeg(3024, 4032, 4000))?.ancho).toBe(3024);
  });

  it("lee un WebP VP8X", () => {
    expect(dimensionesImagen(webpVp8x(2480, 3508))).toEqual({ ancho: 2480, alto: 3508, formato: "webp" });
  });

  it("devuelve null con basura o con un PDF, sin lanzar", () => {
    expect(dimensionesImagen(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBeNull(); // "%PDF-"
    expect(dimensionesImagen(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(dimensionesImagen(new Uint8Array(0))).toBeNull();
  });

  it("no se cuelga con un JPEG truncado", () => {
    expect(dimensionesImagen(jpeg(100, 100).subarray(0, 10))).toBeNull();
  });
});

// ─── El calculo que explica el problema ──────────────────────────────────────

describe("resolucionEfectiva — esquema por PARCHES (gpt-5-mini, el que se usa)", () => {
  it("reproduce la cifra documentada para un A4 escaneado a 300 DPI", () => {
    // Contraste contra el ejemplo publicado por OpenAI: 2480x3508 con
    // presupuesto de 2.500 parches y multiplicador 1.2 -> 1333x1888 y 2.974
    // tokens de imagen. Si esta cifra deja de salir, es que OpenAI ha
    // cambiado el presupuesto y hay que revisar la constante.
    const r = resolucionEfectiva(2480, 3508);
    expect(r.efectiva).toEqual({ ancho: 1333, alto: 1888 });
    expect(r.tokens).toBe(2974);
    expect(r.dpiA4).toBe(161);
  });

  it("subir una foto MAS grande no cambia practicamente nada", () => {
    // El presupuesto de parches manda, no lo que suba el usuario: por eso
    // "sube la foto con mas megapixeles" no es la solucion.
    const normal = resolucionEfectiva(3024, 4032);
    const enorme = resolucionEfectiva(6048, 8064);
    expect(enorme.efectiva).toEqual(normal.efectiva);
    expect(enorme.tokens).toBe(normal.tokens);
    // Y se tira el 93% de los pixeles subidos.
    expect(enorme.aprovechado).toBeLessThan(0.07);
  });

  it("un A4 fotografiado entero deja la letra pequena JUSTO en el limite", () => {
    // Este es el hallazgo honesto: no es una catastrofe de 90 DPI, pero
    // tampoco hay holgura. A ~156 DPI un cuerpo de 7 pt mide ~15,2 px, justo
    // en el minimo de 15 px de AWS, y uno de 6 pt se queda en ~13, por
    // debajo. Encaja con que fallen digitos sueltos y no documentos enteros.
    const r = resolucionEfectiva(3024, 4032);
    expect(r.dpiA4).toBe(156);
    expect(r.pxTexto7pt).toBeGreaterThanOrEqual(PX_MINIMO_TEXTO);
    expect(r.pxTexto7pt).toBeLessThan(PX_MINIMO_TEXTO + 1); // sin margen
    const px6pt = r.dpiA4 * 6 / 72;
    expect(px6pt).toBeLessThan(PX_MINIMO_TEXTO); // 6 pt no llega
  });

  it("recortar SI sube la resolucion sobre la zona util", () => {
    // Misma foto recortada a la franja de la tabla de lineas. Los parches se
    // reparten sobre menos superficie de papel, asi que cada caracter recibe
    // mas pixeles. Es el unico preprocesado que mueve la aguja de verdad.
    const entera = resolucionEfectiva(3024, 4032);
    const soloTabla = resolucionEfectiva(3024, 1400);
    // Sobre el ancho de un A4 (210 mm), px por pulgada del recorte vs entera.
    const dpiRecorte = soloTabla.efectiva.ancho / (210 / 25.4);
    const dpiEntera = entera.efectiva.ancho / (210 / 25.4);
    expect(dpiRecorte).toBeGreaterThan(dpiEntera * 1.4);
  });

  it("una imagen pequena no se toca y se aprovecha entera", () => {
    const r = resolucionEfectiva(1024, 700);
    expect(r.efectiva).toEqual({ ancho: 1024, alto: 700 });
    expect(r.aprovechado).toBe(1);
  });
});

describe("resolucionEfectiva — el esquema equivocado da un numero muy distinto", () => {
  it("por CUADROS sale casi la mitad de resolucion que por PARCHES", () => {
    // Esto es por lo que hay que saber que algoritmo usa el modelo. Calcular
    // el de cuadros (gpt-5, gpt-4o, gpt-4.1) creyendo que vale para
    // gpt-5-mini da ~93 DPI en vez de ~161: casi el doble de pesimista, y
    // llevaria a cambiar de modelo por un problema que no es el que hay.
    const parches = resolucionEfectiva(2480, 3508, "parches");
    const cuadros = resolucionEfectiva(2480, 3508, "cuadros");
    expect(cuadros.efectiva).toEqual({ ancho: 768, alto: 1086 });
    expect(cuadros.dpiA4).toBe(93);
    expect(parches.dpiA4).toBeGreaterThan(cuadros.dpiA4 * 1.6);
  });

  it("por cuadros si aplica el tope de 768 px en el lado corto", () => {
    expect(resolucionEfectiva(4032, 3024, "cuadros").efectiva).toEqual({ ancho: 1024, alto: 768 });
  });
});

describe("diagnosticoResolucion", () => {
  it("informa de lo subido, de lo que ve el modelo y de cuanto se tira", () => {
    const d = diagnosticoResolucion(jpeg(4032, 3024))!;
    expect(d).toContain("4032x3024");   // lo que sube el usuario
    expect(d).toContain("1824x1368");   // lo que mira el modelo
    expect(d).toContain("DPI");
    expect(d).toContain("se aprovecha el");
    // De los 12,2 Mpx que se suben, el modelo usa 2,5: se tira ~el 80%.
    expect(resolucionEfectiva(4032, 3024).aprovechado).toBeCloseTo(0.205, 2);
  });

  it("cuando avisa, dice que la salida es recortar y no subir fotos mas grandes", () => {
    const d = diagnosticoResolucion(png(1000, 900))!;
    expect(d).toContain("AVISO");
    expect(d).toContain("Recortar");
  });

  it("avisa cuando la imagen subida es demasiado pequena para empezar", () => {
    // Una captura de pantalla o una foto de 1 Mpx: aqui ni siquiera se llega
    // al presupuesto de parches, manda la resolucion de origen.
    const d = diagnosticoResolucion(png(1000, 900))!;
    expect(d).toContain("AVISO");
    expect(resolucionEfectiva(1000, 900).pxTexto7pt).toBeLessThan(PX_MINIMO_TEXTO);
  });

  it("no avisa con una foto de movil de una hoja entera: pasa por los pelos", () => {
    // 15,2 px para 7 pt contra un minimo de 15. Pasa, pero sin margen: por
    // eso fallan digitos sueltos y no documentos enteros.
    const d = diagnosticoResolucion(jpeg(3024, 4032))!;
    expect(d).not.toContain("AVISO");
    expect(d).toContain("1368x1824");
  });

  it("devuelve null para un PDF: ahi el reescalado lo hace OpenAI", () => {
    expect(diagnosticoResolucion(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
  });
});
