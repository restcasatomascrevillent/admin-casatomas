import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { generarVistaRegalo } from "../chequeRegaloPdf";
import { CHEQUE_EJEMPLO, PLANTILLA_REGALO } from "../regalo";
import { LOGO_CASA_TOMAS } from "../casaTomas";

describe("Trazado compartido del PDF y la vista previa", () => {
  it("incluye el logo y los textos de la plantilla en una página A4", async () => {
    const vista = await generarVistaRegalo(CHEQUE_EJEMPLO, PLANTILLA_REGALO, LOGO_CASA_TOMAS);
    const pdf = await PDFDocument.load(vista.pdf);
    expect(vista.paginas).toHaveLength(pdf.getPageCount());
    expect(vista.paginas).toHaveLength(1);
    expect(vista.paginas[0]).toContain('viewBox="0 0 595.28 841.89"');
    expect(vista.paginas[0]).toContain('<image href="data:image/png;base64,');
    expect(vista.paginas[0]).toContain("CT-EJEMPLO");
    expect(vista.paginas[0]).toContain("100,00 €");
  });
  it.each([false, true])("respeta importe oculto=%s con y sin dedicatoria", async ocultar_importe => {
    for (const incluir of [false, true]) {
      const vista = await generarVistaRegalo({ ...CHEQUE_EJEMPLO, ocultar_importe, mensaje: incluir ? CHEQUE_EJEMPLO.mensaje : null }, PLANTILLA_REGALO, LOGO_CASA_TOMAS);
      const svg = vista.paginas.join("");
      expect(svg.includes("100,00 €")).toBe(!ocultar_importe);
      expect(svg.includes("¡Feliz cumpleaños!")).toBe(incluir);
      expect(svg).toContain("CT-EJEMPLO");
      expect((await PDFDocument.load(vista.pdf)).getPageCount()).toBe(1);
    }
  });
  it("escapa texto de compradores y mantiene la paginación y ocultación de importe", async () => {
    const vista = await generarVistaRegalo({ ...CHEQUE_EJEMPLO, ocultar_importe: true, destinatario_nombre: "<script>&Hola</script>", mensaje: "PalabraLarga".repeat(45) }, { ...PLANTILLA_REGALO, pdf_instrucciones: "Instrucciones de uso ".repeat(40) }, LOGO_CASA_TOMAS);
    const pdf = await PDFDocument.load(vista.pdf);
    expect(vista.paginas).toHaveLength(pdf.getPageCount());
    expect(vista.paginas.length).toBeGreaterThan(1);
    const svg = vista.paginas.join("");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;&amp;Hola&lt;/script&gt;");
    expect(svg).not.toContain("100,00 €");
  });
});
