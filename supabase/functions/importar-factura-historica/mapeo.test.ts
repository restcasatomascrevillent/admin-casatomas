import { describe, expect, it } from "vitest";
import { normalizarDatos } from "../procesar-factura/extraccion";
import { valorSinDescuento } from "../procesar-factura/guardado";
import { aplicarExtras, mismaFacturaPorImporte, numero, prepararImportacion, validarEntrada, valorBruto } from "./mapeo";

// ============================================================================
//  mapeo.test.ts · importación histórica: JSON extraído → crudo del OCR
// ----------------------------------------------------------------------------
//  Los fixtures siguen facturas reales de facturas-conocimiento (R1000 de
//  B06805246 con embalajes en el pie, R1028 de B54968045 con descuento del
//  29 %, R245 de Osborne: abono), recortados.
// ============================================================================

const linea = (o: Record<string, unknown>) => ({
  orden: 1,
  pagina: 1,
  nombre: "PRODUCTO",
  producto_ficha: null,
  cantidad: 1,
  unidad: "ud",
  bultos: null,
  contenido_cantidad: null,
  contenido_unidad: null,
  precio_unitario: 10,
  descuento_pct: null,
  total: 10,
  iva_pct: 10,
  albaran_ref: null,
  bonificada: false,
  ...o,
});

const factura = (o: Record<string, unknown> = {}) => ({
  archivo: "R1000.pdf",
  paginas_pdf: [1],
  tipo: "factura",
  proveedor: "MARISCOS EJEMPLO SL",
  cif: "B06805246",
  local: "casa_tomas",
  numero_documento: "A26/1234",
  fecha: "2026-03-14",
  productos: [
    linea({ orden: 1, nombre: "CAÑAILLA XL", cantidad: 2, unidad: "kg", bultos: 1, precio_unitario: 32, total: 64, albaran_ref: "A26/12.347" }),
    linea({ orden: 2, nombre: "GAMBA ROJA N1", cantidad: 2, unidad: "kg", bultos: 1, precio_unitario: 122, total: 244 }),
  ],
  cargos_pie: [{ concepto: "Gestión de embalajes (16 x 1,82 EUR)", importe: 29.12, iva_pct: 10 }],
  subtotal: 337.12,
  desglose_iva: [{ base: 337.12, pct: 10, cuota: 33.71 }],
  iva: 33.71,
  recargo_equivalencia: null,
  retencion_irpf: null,
  total: 370.83,
  observaciones: "Pago por transferencia a 30 días",
  alertas: [],
  ...o,
});

/** Lo que hace la función antes de guardar. */
function convertir(datos: unknown, opciones: Parameters<typeof prepararImportacion>[1] = {}) {
  const prep = prepararImportacion(datos, opciones);
  const d = normalizarDatos(prep.crudo);
  d.productos = aplicarExtras(d.productos, prep.extras);
  d.observaciones = prep.observaciones;
  return { prep, d };
}

const suma = (xs: { total: number | null }[]) => Math.round(xs.reduce((a, x) => a + (x.total ?? 0), 0) * 100) / 100;

describe("prepararImportacion + normalizarDatos", () => {
  it("factura normal: cabecera impresa, líneas y cargos de pie que suman la base", () => {
    const { d, prep } = convertir(factura());
    expect(d.tipo).toBe("factura");
    expect(d.proveedor).toBe("MARISCOS EJEMPLO SL");
    expect(d.cif).toBe("B06805246");
    expect(d.numero_documento).toBe("A26/1234");
    expect(d.fecha).toBe("2026-03-14");
    expect([d.subtotal, d.iva, d.total]).toEqual([337.12, 33.71, 370.83]);
    expect(d.productos).toHaveLength(3);
    expect(suma(d.productos)).toBe(337.12);
    const cargo = d.productos[2];
    expect(cargo.nombre).toBe("Gestión de embalajes (16 x 1,82 EUR)");
    expect([cargo.cantidad, cargo.precio_unitario, cargo.total, cargo.iva_pct]).toEqual([1, 29.12, 29.12, 10]);
    expect(d.productos[0]).toMatchObject({ cantidad: 2, unidad: "kg", precio_unitario: 32, total: 64, albaran_ref: "A26/12.347", iva_pct: 10 });
    expect(prep.local).toBe("casa_tomas");
    expect(prep.paginas).toBe(1);
    expect(prep.alertas).toEqual([]);
  });

  it("bultos del JSON se conservan (normalizarDatos los perdería)", () => {
    const { d } = convertir(factura());
    expect(d.productos[0].bultos).toBe(1);
    expect(d.productos[2].bultos).toBeNull();
  });

  it("observaciones: las del JSON + «Importada del histórico (archivo …)»", () => {
    const { d } = convertir(factura());
    expect(d.observaciones).toBe("Pago por transferencia a 30 días. Importada del histórico (archivo R1000.pdf).");
  });

  it("alertas del JSON: van a observaciones y como un aviso de la factura", () => {
    const { d, prep } = convertir(factura({ alertas: ["IVA por línea no impreso.", "Lote ilegible"] }));
    expect(d.observaciones).toContain("Aviso de la extracción: IVA por línea no impreso. Aviso de la extracción: Lote ilegible.");
    expect(prep.alertas).toHaveLength(1);
    expect(prep.alertas[0]).toMatchObject({ codigo: "extraccion_historica", severidad: "media" });
    expect(String(prep.alertas[0].mensaje)).toContain("2 aviso(s)");
  });

  it("línea con descuento: precio neto como el OCR y valor sin descuento aparte", () => {
    const { d } = convertir(factura({
      productos: [linea({ nombre: "AQUARIUS LIMON *24", unidad: "caja", precio_unitario: 35.2, descuento_pct: 29, total: 24.99 })],
      cargos_pie: [],
    }));
    const l = d.productos[0];
    expect(l.total).toBe(24.99);
    expect(l.precio_unitario).toBe(24.99);
    expect(l).toMatchObject({ descuento_pct: 29, importe_bruto: 35.2, importe_bruto_estimado: false });
  });

  it("regalo con precio impreso: total 0 y valor sin descuento = cantidad × precio", () => {
    const { d } = convertir(factura({
      productos: [linea({ nombre: "CAJA REGALO", cantidad: 2, precio_unitario: 10, total: 0, bonificada: true, descuento_pct: 100 })],
      cargos_pie: [],
    }));
    expect(d.productos[0]).toMatchObject({ total: 0, descuento_pct: 100, importe_bruto: 20, importe_bruto_estimado: false });
  });

  it("regalo sin precio con precio_referencia: valor estimado", () => {
    const { d } = convertir(factura({
      productos: [linea({ nombre: "LIMONES", cantidad: 3, precio_unitario: null, total: 0, bonificada: true, precio_referencia: 4.5 })],
      cargos_pie: [],
    }));
    expect(d.productos[0]).toMatchObject({ total: 0, importe_bruto: 13.5, importe_bruto_estimado: true });
  });

  it("sin precio ni referencia: no hay valor sin descuento", () => {
    const { d } = convertir(factura({
      productos: [linea({ nombre: "LIMONES", cantidad: 3, precio_unitario: null, total: 0, bonificada: true })],
      cargos_pie: [],
    }));
    expect(d.productos[0]).not.toHaveProperty("importe_bruto");
    expect(d.productos[0]).not.toHaveProperty("descuento_pct");
  });

  it("abono: entra como factura con importes y cantidades en negativo (precio positivo)", () => {
    const { d, prep } = convertir(factura({
      archivo: "R245.pdf",
      tipo: "abono",
      proveedor: "GRUPO OSBORNE, S.A.",
      cif: "A11535564",
      numero_documento: "80013670",
      productos: [linea({ nombre: "Jamón Bellota 5J", cantidad: 2, unidad: "pieza", precio_unitario: 519.4, total: 1038.8 })],
      cargos_pie: [{ concepto: "Portes", importe: 10, iva_pct: 21 }],
      subtotal: 1048.8,
      iva: -105.98,
      total: 1154.78,
    }));
    expect(prep.esAbono).toBe(true);
    expect(d.tipo).toBe("factura");
    expect([d.subtotal, d.iva, d.total]).toEqual([-1048.8, -105.98, -1154.78]);
    expect(d.productos[0]).toMatchObject({ cantidad: -2, precio_unitario: 519.4, total: -1038.8, importe_bruto: -1038.8 });
    expect(d.productos[1]).toMatchObject({ cantidad: -1, precio_unitario: 10, total: -10 });
    expect(suma(d.productos)).toBe(-1048.8);
    expect(d.observaciones).toContain("Abono (factura rectificativa): importes guardados en negativo");
  });

  it("albarán sigue siendo albarán; devolución dentro de factura lleva cantidad negativa", () => {
    const { d } = convertir(factura({
      tipo: "albaran",
      productos: [linea({}), linea({ orden: 2, nombre: "ENVASE RETORNABLE", cantidad: 3, precio_unitario: 2, total: -6 })],
      cargos_pie: [],
    }));
    expect(d.tipo).toBe("albaran");
    expect(d.productos[1]).toMatchObject({ cantidad: -3, total: -6, importe_bruto: -6 });
  });

  it("las líneas que normalizarDatos descarta no descolocan los extras (se casan por orden)", () => {
    const { d } = convertir(factura({
      productos: [
        linea({ nombre: "PERCEBE", cantidad: null, precio_unitario: null, total: null }),
        linea({ orden: 2, nombre: "ALMEJA", cantidad: 2, precio_unitario: 20, descuento_pct: 10, total: 36, bultos: 3 }),
      ],
      cargos_pie: [],
    }));
    expect(d.productos).toHaveLength(1);
    expect(d.productos[0]).toMatchObject({ nombre: "ALMEJA", descuento_pct: 10, importe_bruto: 40, bultos: 3 });
    expect(d.avisos.map((a: { codigo: string }) => a.codigo)).toContain("lineas_descartadas");
  });

  it("páginas: la de cada línea es relativa al PDF de esta factura", () => {
    const { d, prep } = convertir(factura({
      paginas_pdf: [3, 4],
      productos: [linea({ pagina: 3 }), linea({ orden: 2, pagina: 4 })],
      cargos_pie: [],
    }));
    expect(prep.paginas).toBe(2);
    expect(d.productos.map((p: { pagina: number }) => p.pagina)).toEqual([1, 2]);
  });

  it("local: casa_tomas | touza; «no_consta» → null; el del manifiesto manda", () => {
    expect(prepararImportacion(factura({ local: "touza" })).local).toBe("touza");
    expect(prepararImportacion(factura({ local: "no_consta" })).local).toBeNull();
    expect(prepararImportacion(factura({ local: "no_consta" }), { local: "casa_tomas" }).local).toBe("casa_tomas");
  });

  it("recargo de equivalencia y retención quedan anotados en observaciones", () => {
    const { d } = convertir(factura({ recargo_equivalencia: 1.4, retencion_irpf: 5 }));
    expect(d.observaciones).toContain("Recargo de equivalencia impreso: 1.4 €");
    expect(d.observaciones).toContain("Retención IRPF impresa: 5 €");
  });

  it("sin número impreso: número provisional como el OCR", () => {
    const { d } = convertir(factura({ numero_documento: null }));
    expect(d.numero_documento).toMatch(/^SN-/);
  });

  it("rechaza una lista en vez de una factura", () => {
    expect(() => prepararImportacion([factura()])).toThrow(/UNA factura/);
  });
});

describe("valorBruto / numero", () => {
  it("cantidad × precio, redondeado a céntimos; el precio 0 cuenta como sin precio", () => {
    expect(valorBruto(3, 1.333, null)).toEqual({ importe_bruto: 4, importe_bruto_estimado: false });
    expect(valorBruto(2, 0, 5)).toEqual({ importe_bruto: 10, importe_bruto_estimado: true });
    expect(valorBruto(2, null, null)).toEqual({ importe_bruto: null, importe_bruto_estimado: false });
  });
  it("lee números de texto", () => {
    expect(numero("1.234,56")).toBe(1234.56);
    expect(numero("12.5")).toBe(12.5);
    expect(numero("")).toBeNull();
    expect(numero(null)).toBeNull();
  });
});

describe("guardado: columnas de valor sin descuento solo si vienen", () => {
  it("valorSinDescuento", () => {
    expect(valorSinDescuento({ nombre: "x" })).toEqual({});
    expect(valorSinDescuento({ descuento_pct: 29, importe_bruto: 35.2, importe_bruto_estimado: false }))
      .toEqual({ descuento_pct: 29, importe_bruto: 35.2, importe_bruto_estimado: false });
    expect(valorSinDescuento({ importe_bruto: 13.5, importe_bruto_estimado: true }))
      .toEqual({ importe_bruto: 13.5, importe_bruto_estimado: true });
  });
});

describe("mismaFacturaPorImporte", () => {
  const nueva = { cif: "B-06805246", proveedor: "Mariscos Ejemplo", total: 370.83, fecha: "2026-03-14" };
  it("mismo CIF (con otro formato), fecha y total → duplicada", () => {
    const f = { id: 7, cif: "B06805246", proveedor: "OTRO NOMBRE", total: 370.83, fecha: "2026-03-14" };
    expect(mismaFacturaPorImporte(nueva, [f])).toBe(f);
  });
  it("otro total u otra fecha → no", () => {
    expect(mismaFacturaPorImporte(nueva, [{ cif: "B06805246", total: 370.9, fecha: "2026-03-14" }])).toBeNull();
    expect(mismaFacturaPorImporte(nueva, [{ cif: "B06805246", total: 370.83, fecha: "2026-03-15" }])).toBeNull();
  });
  it("sin CIF compara por nombre", () => {
    const n = { ...nueva, cif: null };
    expect(mismaFacturaPorImporte(n, [{ cif: null, proveedor: "MARISCOS EJEMPLO", total: "370.83", fecha: "2026-03-14" }])).not.toBeNull();
    expect(mismaFacturaPorImporte(n, [{ cif: null, proveedor: "OTRO", total: 370.83, fecha: "2026-03-14" }])).toBeNull();
  });
  it("sin total no se decide nada", () => {
    expect(mismaFacturaPorImporte({ ...nueva, total: null }, [{ cif: "B06805246", total: null, fecha: "2026-03-14" }])).toBeNull();
  });
});

describe("validarEntrada", () => {
  const ok = { clave: "zip2026:R1.pdf#0", datos: factura(), pdf_b64: "data:application/pdf;base64,JVBERi0=", nombre_pdf: "R1.pdf" };
  it("válida; quita la cabecera data:", () => {
    const v = validarEntrada(ok);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.pdfB64).toBe("JVBERi0=");
  });
  it.each([
    [{ ...ok, clave: "" }, /clave/],
    [{ ...ok, datos: [factura()] }, /datos/],
    [{ ...ok, pdf_b64: "" }, /PDF/],
    [null, /vacío/],
  ])("rechaza %#", (cuerpo, error) => {
    const v = validarEntrada(cuerpo);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(error);
  });
});

describe("igualarColumnasValor (insert por lotes con columnas mezcladas)", () => {
  it("si alguna línea trae valor sin descuento, todas llevan las tres columnas sin NULL en el booleano", async () => {
    const { igualarColumnasValor } = await import("../procesar-factura/guardado.ts");
    const filas = igualarColumnasValor([
      { nombre: "a", total: 10 },
      { nombre: "b", total: 0, importe_bruto: 5, importe_bruto_estimado: true },
    ] as Record<string, unknown>[]);
    expect(filas[0]).toMatchObject({ importe_bruto: null, importe_bruto_estimado: false, descuento_pct: null });
    expect(filas[1]).toMatchObject({ importe_bruto: 5, importe_bruto_estimado: true });
  });
  it("si ninguna las trae (OCR), no se añaden", async () => {
    const { igualarColumnasValor } = await import("../procesar-factura/guardado.ts");
    expect(igualarColumnasValor([{ nombre: "a" }] as Record<string, unknown>[])[0]).toEqual({ nombre: "a" });
  });
});
