import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { analizarPdf, dividirPdf } from "../dividirPdf";

async function pdf(paginas: [number, number][]): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  paginas.forEach(([w, h], i) => {
    const p = d.addPage([w, h]);
    p.drawText(`Pagina ${i + 1}`, { x: 20, y: h - 40, size: 12 });
  });
  return d.save();
}

describe("dividirPdf", () => {
  it("PDF de 3 páginas A4 → 3 PDF de una página, en orden", async () => {
    const d = await dividirPdf(await pdf([[595, 842], [595, 842], [595, 842]]));
    expect(d.numPaginas).toBe(3);
    expect(d.piezas.map((p) => [p.pagina, p.franja])).toEqual([[1, null], [2, null], [3, null]]);
    for (const p of d.piezas) expect((await PDFDocument.load(p.bytes)).getPageCount()).toBe(1);
  });
  it("PDF de 1 página normal → camino de una página", async () => {
    expect(await analizarPdf(await pdf([[595, 842]]))).toEqual({ paginas: 1, alguna_alta: false });
  });
  it("página muy alta (ticket continuo) → franjas recortando el MediaBox", async () => {
    const d = await dividirPdf(await pdf([[300, 1200]]));
    expect(d.piezas.length).toBeGreaterThan(1);
    const primeras = await PDFDocument.load(d.piezas[0].bytes);
    const caja = primeras.getPage(0).getMediaBox();
    expect(caja.height).toBeLessThan(1200);
    expect(caja.y + caja.height).toBeCloseTo(1200, 0); // la franja 1 es la de ARRIBA
    expect(d.piezas.every((p) => p.franjasPagina === d.piezas.length)).toBe(true);
  });
});
