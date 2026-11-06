/**
 * PDF de la carta impresa con pdf-lib: texto vectorial con Libre Baskerville
 * incrustada (solo los glifos usados) y logos vectoriales. Nada se rasteriza.
 *
 * El texto lleva el interletraje (kerning) de la fuente: pdf-lib no lo aplica
 * con `drawText`, así que cada línea se escribe con el operador TJ y los
 * ajustes que da fontkit, igual que en la vista previa (que los aplica el
 * navegador con la misma fuente).
 *
 * Con «sangrado de imprenta» la hoja crece 10 mm por lado: 3 mm de sangrado
 * (BleedBox) y marcas de corte fuera de él; el formato final (TrimBox) sigue
 * siendo el A5 o el A4 elegido.
 */
import type { Font } from "@pdf-lib/fontkit";
import type { PDFFont, PDFName, PDFOperator, PDFPage } from "pdf-lib";
import type { BytesFuentes, Fontkit, FuentesKit } from "./fuentes";
import { CRUZ_TOUZA, LOGO_CASA_TOMAS, MEDALLON_CASA_TOMAS, type LogoVectorial } from "./logos";
import { mm, type FuenteCarta, type TamanoCarta, type LogoCarta, type PaginaCarta, type Trazo } from "./maquetacion";
import type { IdiomaCarta } from "./textos";

export const SANGRADO = mm(3);
/** Espacio fuera del corte con sangrado: 3 mm de sangrado + 2 mm + 5 mm de marca. */
export const MARGEN_MARCAS = mm(10);
const INICIO_MARCA = mm(3);
const LARGO_MARCA = mm(5);

const LOGOS: Record<LogoCarta, LogoVectorial> = {
  casaTomas: LOGO_CASA_TOMAS,
  medallon: MEDALLON_CASA_TOMAS,
  touza: CRUZ_TOUZA,
};

const IDIOMA_PDF: Record<IdiomaCarta, string> = { es: "es-ES", en: "en-GB", fr: "fr-FR" };

export interface OpcionesPdf {
  sangrado: boolean;
  /** Solo para los metadatos: el tamaño real va en cada página. */
  tamano: TamanoCarta;
  titulo: string;
  idioma: IdiomaCarta;
  fecha?: Date;
}

export interface RecursosPdf {
  fontkit: Fontkit;
  bytes: BytesFuentes;
  kit: FuentesKit;
}

/** Ruta de logos.ts (M, L y C absolutas) en tramos para los operadores del PDF. */
export function tramosRuta(d: string): ({ op: "M" | "L"; p: number[] } | { op: "C"; p: number[] })[] {
  const tramos: ({ op: "M" | "L"; p: number[] } | { op: "C"; p: number[] })[] = [];
  const fichas = d.match(/[MLC]|-?\d+(?:\.\d+)?/g) ?? [];
  let op: "M" | "L" | "C" = "M";
  let numeros: number[] = [];
  const necesita = { M: 2, L: 2, C: 6 };
  for (const ficha of fichas) {
    if (ficha === "M" || ficha === "L" || ficha === "C") {
      op = ficha;
      continue;
    }
    numeros.push(Number(ficha));
    if (numeros.length === necesita[op]) {
      tramos.push({ op, p: numeros });
      numeros = [];
      // Tras un M, los pares siguientes son L (como en SVG).
      if (op === "M") op = "L";
    }
  }
  return tramos;
}

/** Trozos de texto y ajustes (milésimas de em, en negativo = acercar) para el operador TJ. */
export function trozosConInterletraje(texto: string, fuente: Font): (string | number)[] {
  const run = fuente.layout(texto);
  const partes: (string | number)[] = [];
  let inicio = 0;
  let posicion = 0;
  run.glyphs.forEach((glifo, i) => {
    posicion += glifo.codePoints.reduce((total, codigo) => total + (codigo > 0xffff ? 2 : 1), 0);
    const ajuste = run.positions[i].xAdvance - glifo.advanceWidth;
    if (ajuste !== 0 && i < run.glyphs.length - 1) {
      partes.push(texto.slice(inicio, posicion), Math.round((-ajuste * 1000 * 100) / fuente.unitsPerEm) / 100);
      inicio = posicion;
    }
  });
  // Si fontkit no devuelve una letra por posición del texto (no debería), sin interletraje.
  if (posicion !== texto.length) return [texto];
  partes.push(texto.slice(inicio));
  return partes.filter((parte) => parte !== "");
}

export async function crearPdfCarta(paginas: PaginaCarta[], recursos: RecursosPdf, opciones: OpcionesPdf): Promise<Uint8Array> {
  const pdfLib = await import("pdf-lib");
  const {
    PDFDocument,
    PDFArray,
    PDFNumber,
    PDFOperator: Operador,
    PDFOperatorNames,
    LineCapStyle,
    rgb,
    pushGraphicsState,
    popGraphicsState,
    beginText,
    endText,
    setFontAndSize,
    setCharacterSpacing,
    moveText,
    setFillingRgbColor,
    concatTransformationMatrix,
    moveTo,
    lineTo,
    appendBezierCurve,
    closePath,
    fill,
  } = pdfLib;

  const doc = await PDFDocument.create();
  doc.registerFontkit(recursos.fontkit);
  const fuentes: Record<FuenteCarta, PDFFont> = {
    regular: await doc.embedFont(recursos.bytes.regular, { subset: true }),
    italica: await doc.embedFont(recursos.bytes.italica, { subset: true }),
    seminegrita: await doc.embedFont(recursos.bytes.seminegrita, { subset: true }),
  };
  const fecha = opciones.fecha ?? new Date();
  doc.setTitle(opciones.titulo);
  doc.setAuthor("Casa Tomás");
  doc.setSubject(`${opciones.titulo} · ${opciones.tamano}`);
  doc.setCreator("Panel de Casa Tomás");
  doc.setLanguage(IDIOMA_PDF[opciones.idioma]);
  doc.setCreationDate(fecha);
  doc.setModificationDate(fecha);

  const margen = opciones.sangrado ? MARGEN_MARCAS : 0;
  // Página que se está pintando (cada una lleva su tamaño).
  let alto = 0;
  const X = (x: number) => margen + x;
  const Y = (y: number) => margen + alto - y;

  const pintarTexto = (pagina: PDFPage, claves: Map<FuenteCarta, PDFName>, t: Extract<Trazo, { tipo: "texto" }>): PDFOperator[] => {
    let clave = claves.get(t.fuente);
    if (!clave) {
      clave = pagina.node.newFontDictionary(fuentes[t.fuente].name, fuentes[t.fuente].ref);
      claves.set(t.fuente, clave);
    }
    const array = PDFArray.withContext(doc.context);
    for (const parte of trozosConInterletraje(t.texto, recursos.kit[t.fuente])) {
      array.push(typeof parte === "string" ? fuentes[t.fuente].encodeText(parte) : PDFNumber.of(parte));
    }
    return [
      pushGraphicsState(),
      setFillingRgbColor(t.color.r, t.color.g, t.color.b),
      beginText(),
      setFontAndSize(clave, t.tamano),
      setCharacterSpacing(t.espaciado ?? 0),
      moveText(X(t.x), Y(t.y)),
      Operador.of(PDFOperatorNames.ShowTextAdjusted, [array]),
      endText(),
      popGraphicsState(),
    ];
  };

  const pintarLogo = (t: Extract<Trazo, { tipo: "logo" }>): PDFOperator[] => {
    const logo = LOGOS[t.logo];
    const escala = t.ancho / logo.ancho;
    const operadores: PDFOperator[] = [
      pushGraphicsState(),
      setFillingRgbColor(t.color.r, t.color.g, t.color.b),
      concatTransformationMatrix(escala, 0, 0, -escala, X(t.x), Y(t.y)),
    ];
    for (const tramo of tramosRuta(logo.d)) {
      if (tramo.op === "M") operadores.push(moveTo(tramo.p[0], tramo.p[1]));
      else if (tramo.op === "L") operadores.push(lineTo(tramo.p[0], tramo.p[1]));
      else operadores.push(appendBezierCurve(tramo.p[0], tramo.p[1], tramo.p[2], tramo.p[3], tramo.p[4], tramo.p[5]));
    }
    // Par-impar, como el SVG trazado: los huecos del nudo y de las letras quedan en blanco.
    operadores.push(Operador.of(PDFOperatorNames.FillEvenOdd), popGraphicsState());
    return operadores;
  };

  for (const pagina of paginas) {
    const ancho = pagina.ancho;
    alto = pagina.alto;
    const hoja = doc.addPage([ancho + 2 * margen, alto + 2 * margen]);
    hoja.setTrimBox(margen, margen, ancho, alto);
    if (opciones.sangrado) {
      hoja.setBleedBox(margen - SANGRADO, margen - SANGRADO, ancho + 2 * SANGRADO, alto + 2 * SANGRADO);
    }
    const claves = new Map<FuenteCarta, PDFName>();
    for (const trazo of pagina.trazos) {
      if (trazo.tipo === "texto") {
        hoja.pushOperators(...pintarTexto(hoja, claves, trazo));
      } else if (trazo.tipo === "linea") {
        hoja.drawLine({
          start: { x: X(trazo.x1), y: Y(trazo.y1) },
          end: { x: X(trazo.x2), y: Y(trazo.y2) },
          thickness: trazo.grosor,
          color: rgb(trazo.color.r, trazo.color.g, trazo.color.b),
          ...(trazo.puntos ? { dashArray: [0, trazo.puntos], lineCap: LineCapStyle.Round } : {}),
        });
      } else if (trazo.tipo === "rombo") {
        const { x, y, radio, color } = trazo;
        hoja.pushOperators(
          pushGraphicsState(),
          setFillingRgbColor(color.r, color.g, color.b),
          moveTo(X(x), Y(y - radio)),
          lineTo(X(x + radio), Y(y)),
          lineTo(X(x), Y(y + radio)),
          lineTo(X(x - radio), Y(y)),
          closePath(),
          fill(),
          popGraphicsState(),
        );
      } else {
        hoja.pushOperators(...pintarLogo(trazo));
      }
    }
    if (opciones.sangrado) {
      // Marcas de corte en las cuatro esquinas, fuera del sangrado.
      const negro = rgb(0, 0, 0);
      const esquinas = [
        [margen, margen, -1, -1],
        [margen + ancho, margen, 1, -1],
        [margen, margen + alto, -1, 1],
        [margen + ancho, margen + alto, 1, 1],
      ];
      for (const [cx, cy, dx, dy] of esquinas) {
        hoja.drawLine({ start: { x: cx + dx * INICIO_MARCA, y: cy }, end: { x: cx + dx * (INICIO_MARCA + LARGO_MARCA), y: cy }, thickness: 0.25, color: negro });
        hoja.drawLine({ start: { x: cx, y: cy + dy * INICIO_MARCA }, end: { x: cx, y: cy + dy * (INICIO_MARCA + LARGO_MARCA) }, thickness: 0.25, color: negro });
      }
    }
  }
  return doc.save();
}
