// @vitest-environment node
/**
 * El PDF de la carta impresa: A5 (419,53 × 595,28 pt) o A4 (595,28 × 841,89
 * pt), con Libre Baskerville incrustada (texto vectorial), tildes, ñ y € sin
 * errores, interletraje y, con sangrado, la hoja más grande y el A5 como
 * TrimBox.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { contenidoPlatos, contenidoVinos, type FilaPlato, type FilaVino } from "../datos";
import { cargarFontkit, crearFuentesKit, crearMedidor, limpiarTexto, type BytesFuentes, type FuentesKit } from "../fuentes";
import { maquetarCarta, mm, type Medidor, type TamanoCarta } from "../maquetacion";
import { crearPdfCarta, tramosRuta, trozosConInterletraje, type RecursosPdf } from "../pdf";

const carpeta = resolve(__dirname, "../../../assets/fuentes/carta-pdf");
const leer = (nombre: string) => new Uint8Array(readFileSync(resolve(carpeta, nombre)));

let recursos: RecursosPdf;
let kit: FuentesKit;
let medidor: Medidor;

beforeAll(async () => {
  const bytes: BytesFuentes = {
    regular: leer("LibreBaskerville-Regular.ttf"),
    italica: leer("LibreBaskerville-Italic.ttf"),
    seminegrita: leer("LibreBaskerville-SemiBold.ttf"),
  };
  const fontkit = await cargarFontkit();
  kit = crearFuentesKit(fontkit, bytes);
  medidor = crearMedidor(kit);
  recursos = { fontkit, bytes, kit };
});

const PLATOS: FilaPlato[] = [
  { id: "1", nombre: "Pulpo a la brasa con «alioli» de ajo negro", categoria: "ENTRANTES CALIENTES", precio_eur: 21.5, descripcion: "Pulpo gallego, patata y pimentón de La Vera — ¡muy tierno!", activado: true, restaurante: true, alergenos_oficiales: ["moluscos"] },
  { id: "2", nombre: "Crème brûlée", categoria: "POSTRES", precio_eur: 8, descripcion: "Con helado de yema 🍦", activado: true, restaurante: true, alergenos_oficiales: ["huevos", "lácteos"] },
  { id: "3", nombre: "Ñoquis de calabaza", categoria: "POSTRES", precio_eur: 12.5, unidad: "kg", activado: true, restaurante: true },
];
const VINOS: FilaVino[] = [
  { id: "v1", nombre: "Côtes du Rhône Guigal", categoria: "VINOS TINTOS — CÔTES DU RHÔNE", precio_eur: 38, activado: true, restaurante: true, ubicacion_region: "Valle del Ródano", ubicacion_pais: "Francia", denominacion_origen: "AOC Côtes du Rhône", alergenos_oficiales: ["sulfitos"] },
];

async function generar(tamano: TamanoCarta, sangrado: boolean, tipo: "platos" | "vinos" = "platos") {
  const contenido = tipo === "platos" ? contenidoPlatos(PLATOS, { carta: "restaurante", idioma: "es" }) : contenidoVinos(VINOS, { carta: "restaurante", idioma: "es" });
  const paginas = maquetarCarta(medidor, contenido, tamano);
  const bytes = await crearPdfCarta(paginas, recursos, { sangrado, titulo: "Casa Tomás · Carta", idioma: "es", tamano, fecha: new Date("2026-11-05T10:00:00Z") });
  return { paginas, bytes, doc: await PDFDocument.load(bytes) };
}

describe("crearPdfCarta", () => {
  it("genera un PDF A5 de 419,53 × 595,28 pt sin errores", async () => {
    const { paginas, doc } = await generar("A5", false);
    expect(doc.getPageCount()).toBe(paginas.length);
    for (const pagina of doc.getPages()) {
      expect(pagina.getWidth()).toBeCloseTo(419.53, 1);
      expect(pagina.getHeight()).toBeCloseTo(595.28, 1);
      const corte = pagina.getTrimBox();
      expect(corte.width).toBeCloseTo(419.53, 1);
    }
    expect(doc.getTitle()).toBe("Casa Tomás · Carta");
    expect(doc.getAuthor()).toBe("Casa Tomás");
  });

  it("y uno A4 de 595,28 × 841,89 pt", async () => {
    const { doc } = await generar("A4", false, "vinos");
    for (const pagina of doc.getPages()) {
      expect(pagina.getWidth()).toBeCloseTo(595.28, 1);
      expect(pagina.getHeight()).toBeCloseTo(841.89, 1);
    }
  });

  it.each(["A5", "A4"] as TamanoCarta[])("con sangrado en %s: 10 mm más por lado, TrimBox del tamaño final y 3 mm de sangrado", async (tamano) => {
    const { doc } = await generar(tamano, true);
    const [ancho, alto] = tamano === "A5" ? [419.53, 595.28] : [595.28, 841.89];
    const pagina = doc.getPage(0);
    expect(pagina.getWidth()).toBeCloseTo(ancho + 2 * mm(10), 1);
    expect(pagina.getHeight()).toBeCloseTo(alto + 2 * mm(10), 1);
    const corte = pagina.getTrimBox();
    expect([corte.x, corte.y, corte.width, corte.height].map((v) => Math.round(v * 100) / 100)).toEqual(
      [mm(10), mm(10), ancho, alto].map((v) => Math.round(v * 100) / 100),
    );
    const sangrado = pagina.getBleedBox();
    expect(sangrado.width).toBeCloseTo(ancho + 2 * mm(3), 1);
  });

  it("lleva incrustadas las tres Libre Baskerville (texto vectorial, no imágenes)", async () => {
    const { doc } = await generar("A5", false);
    const fuentes = new Set<string>();
    let imagenes = 0;
    for (const [, objeto] of doc.context.enumerateIndirectObjects()) {
      if (objeto instanceof PDFDict && objeto.get(PDFName.of("Type")) === PDFName.of("FontDescriptor")) {
        expect(objeto.get(PDFName.of("FontFile2"))).toBeDefined();
        fuentes.add(String(objeto.get(PDFName.of("FontName"))));
      }
      if (objeto instanceof PDFRawStream && objeto.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) imagenes++;
    }
    expect([...fuentes].sort()).toEqual([
      expect.stringContaining("LibreBaskerville-Italic"),
      expect.stringContaining("LibreBaskerville-Regular"),
      expect.stringContaining("LibreBaskerville-SemiBold"),
    ]);
    expect(imagenes).toBe(0);
  });
});

describe("texto", () => {
  it("aplica el interletraje de la fuente («T» y «o» se acercan)", () => {
    const trozos = trozosConInterletraje("Tomás", kit.regular);
    expect(trozos[0]).toBe("T");
    expect(typeof trozos[1]).toBe("number");
    expect(trozos[1] as number).toBeGreaterThan(0);
    expect(trozos.filter((t) => typeof t === "string").join("")).toBe("Tomás");
  });

  it("deja tildes, ñ, comillas y €, y quita lo que la fuente no tiene", () => {
    const tiene = (codigo: number) => kit.regular.hasGlyphForCodePoint(codigo);
    expect(limpiarTexto("Ñoquis «crème» — 12,50 €", tiene)).toBe("Ñoquis «crème» — 12,50 €");
    expect(limpiarTexto("Helado 🍦\tde­yema", tiene)).toBe("Helado de yema".replace(" de yema", " deyema"));
    expect(limpiarTexto("Ελληνικά", tiene)).toBe("");
  });

  it("lee las rutas de los logos", () => {
    expect(tramosRuta("M1 2L3 4C5 6 7 8 9 10")).toEqual([
      { op: "M", p: [1, 2] },
      { op: "L", p: [3, 4] },
      { op: "C", p: [5, 6, 7, 8, 9, 10] },
    ]);
    // Tras un M, los pares siguientes son líneas (como en SVG).
    expect(tramosRuta("M0 0 1.5 -2")).toEqual([
      { op: "M", p: [0, 0] },
      { op: "L", p: [1.5, -2] },
    ]);
  });
});
