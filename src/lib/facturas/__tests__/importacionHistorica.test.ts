import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import {
  bytesABase64,
  construirPdf,
  elegirFactura,
  type enviarFactura,
  importarEntrada,
  indexarCarpeta,
  lectorCarpeta,
  leerManifiesto,
  nombrePdf,
} from "../importacionHistorica";

/** PDF de `n` páginas; cada una con un ancho distinto (100 + i) para reconocerla. */
async function pdfDe(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= n; i++) doc.addPage([100 + i, 200]);
  return doc.save();
}

const fichero = (ruta: string, contenido: BlobPart) => {
  const f = new File([contenido], ruta.split("/").pop() as string);
  Object.defineProperty(f, "webkitRelativePath", { value: ruta });
  return f;
};

const ENTRADA = {
  clave: "zip2026:R1.pdf#0",
  json: "json/R1.json",
  paginas: [{ pdf: "pdf/R1.pdf", pages: [2, 3] }],
  proveedor: "PROVEEDOR SL",
  total: 12.5,
  fecha: "2026-03-14",
  local: "casa_tomas",
};

describe("leerManifiesto", () => {
  it("normaliza las entradas", () => {
    const [e] = leerManifiesto([{ ...ENTRADA, json: "./json\\R1.json", total: "12.5" }]);
    expect(e).toMatchObject({ clave: "zip2026:R1.pdf#0", json: "json/R1.json", total: 12.5, indice: null });
    expect(e.paginas).toEqual([{ pdf: "pdf/R1.pdf", pages: [2, 3] }]);
  });
  it.each([
    [{}, /tiene que ser una lista/],
    [[{ ...ENTRADA, clave: "" }], /clave/],
    [[ENTRADA, ENTRADA], /repetida/],
    [[{ ...ENTRADA, paginas: [] }], /paginas/],
    [[{ ...ENTRADA, paginas: [{ pdf: "pdf/R1.pdf", pages: [] }] }], /pdf y pages/],
  ])("rechaza %#", (json, error) => {
    expect(() => leerManifiesto(json)).toThrow(error);
  });
});

describe("indexarCarpeta", () => {
  it("rutas relativas a la carpeta del manifest.json", () => {
    const { manifiesto, porRuta } = indexarCarpeta([
      fichero("Lote/manifest.json", "[]"),
      fichero("Lote/json/R1.json", "{}"),
      fichero("Lote/pdf/R1.pdf", "x"),
    ]);
    expect(manifiesto?.name).toBe("manifest.json");
    expect([...porRuta.keys()].sort()).toEqual(["json/R1.json", "manifest.json", "pdf/R1.pdf"]);
  });
  it("sin manifest.json", () => {
    expect(indexarCarpeta([fichero("Lote/a.json", "{}")]).manifiesto).toBeNull();
  });
});

describe("elegirFactura", () => {
  it("objeto tal cual; array por indice, por #n de la clave o el único", () => {
    expect(elegirFactura({ a: 1 }, ENTRADA)).toEqual({ a: 1 });
    expect(elegirFactura([{ n: 0 }, { n: 1 }], { clave: "x#1", indice: null })).toEqual({ n: 1 });
    expect(elegirFactura([{ n: 0 }, { n: 1 }], { clave: "x#1", indice: 0 })).toEqual({ n: 0 });
    expect(elegirFactura([{ n: 0 }], { clave: "x", indice: null })).toEqual({ n: 0 });
  });
  it("array de varias sin decir cuál → error", () => {
    expect(() => elegirFactura([{}, {}], { clave: "x", indice: null })).toThrow(/no dice cuál/);
    expect(() => elegirFactura([{}], { clave: "x#3", indice: null })).toThrow(/nº 3/);
  });
});

describe("construirPdf", () => {
  it("solo las páginas pedidas, en orden, de uno o varios PDF (cada PDF se carga una vez)", async () => {
    const a = await pdfDe(3);
    const b = await pdfDe(2);
    const leer = vi.fn(async (r: string) => (r === "a.pdf" ? a : b));
    const r = await construirPdf([{ pdf: "a.pdf", pages: [3, 1] }, { pdf: "b.pdf", pages: [2] }, { pdf: "a.pdf", pages: [2] }], leer);
    expect(r.numPaginas).toBe(4);
    const doc = await PDFDocument.load(r.bytes);
    expect(doc.getPages().map((p) => p.getWidth())).toEqual([103, 101, 102, 102]);
    expect(leer).toHaveBeenCalledTimes(2);
  });
  it("página que no existe → error claro", async () => {
    const a = await pdfDe(1);
    await expect(construirPdf([{ pdf: "a.pdf", pages: [2] }], async () => a)).rejects.toThrow(/no existe la 2/);
  });
});

describe("bytesABase64 / nombrePdf", () => {
  it("base64 de bytes grandes sin reventar la pila", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    const b64 = bytesABase64(bytes);
    expect(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))).toEqual(bytes);
  });
  it("nombre legible y sin caracteres prohibidos", () => {
    expect(nombrePdf(ENTRADA, { numero_documento: "A26/1234", fecha: "2026-03-14" })).toBe("2026-03-14 A26-1234 (R1).pdf");
    expect(nombrePdf(ENTRADA, {})).toBe("2026-03-14 (R1).pdf");
  });
});

describe("importarEntrada", () => {
  it("lee el JSON, monta el PDF y manda el cuerpo esperado", async () => {
    const pdf = await pdfDe(3);
    const { porRuta } = indexarCarpeta([
      fichero("L/manifest.json", "[]"),
      fichero("L/json/R1.json", JSON.stringify([{ numero_documento: "F1", fecha: "2026-03-14" }])),
      fichero("L/pdf/R1.pdf", pdf),
    ]);
    const enviar = vi.fn(async (_cuerpo: Parameters<typeof enviarFactura>[0]) => ({ estado: "importada" as const, facturaId: 9, mensaje: "ok" }));
    const r = await importarEntrada(ENTRADA, lectorCarpeta(porRuta), new Map(), enviar);
    expect(r).toEqual({ estado: "importada", facturaId: 9, mensaje: "ok" });
    const cuerpo = enviar.mock.calls[0]![0];
    expect(cuerpo).toMatchObject({ clave: ENTRADA.clave, datos: { numero_documento: "F1" }, local: "casa_tomas", paginas: 2, nombre_pdf: "2026-03-14 F1 (R1).pdf" });
    const montado = await PDFDocument.load(Uint8Array.from(atob(cuerpo.pdf_b64), (c) => c.charCodeAt(0)));
    expect(montado.getPages().map((p) => p.getWidth())).toEqual([102, 103]);
  });
  it("fichero que falta → error sin llamar a la función", async () => {
    const enviar = vi.fn();
    const r = await importarEntrada(ENTRADA, lectorCarpeta(new Map()), new Map(), enviar);
    expect(r.estado).toBe("error");
    expect(r.mensaje).toMatch(/No está en la carpeta: json\/R1.json/);
    expect(enviar).not.toHaveBeenCalled();
  });
});
