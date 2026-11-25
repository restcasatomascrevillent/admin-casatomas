import { describe, expect, it } from "vitest";
import { detalleCompra, explicacionCompra, multiplicadorCompra, normalizarPrecioCompra, preciosPorVino, textoCompra } from "../precioCompraVino";

const fila = (p: Record<string, unknown> = {}) => ({
  vino_id: "v1", precio_compra: "15.2000", precio_compra_iva: "18.39", coste_efectivo: "15.2000", coste_efectivo_iva: "18.39",
  iva_pct: "21.00", iva_origen: "supuesto", botellas_sin_cargo: "0.00", proveedor: "Vinos del Mundo", fecha: "2026-11-15",
  numero_documento: "A-1", tipo_documento: "albaran", estado: "bien", iva_venta_pct: "10.00", multiplicador_min: "2.30", ...p,
});

describe("precioCompraVino", () => {
  it("normaliza la fila de la tabla (numéricos como texto)", () => {
    const p = normalizarPrecioCompra(fila())!;
    expect(p).toMatchObject({ vinoId: "v1", precioCompra: 15.2, precioCompraIva: 18.39, ivaPct: 21, ivaVentaPct: 10, multiplicadorMin: 2.3 });
    expect(textoCompra(p)).toBe("Compra: 18,39 € (IVA incl.)");
  });

  it("sin precio o sin vino no hay fila; el mapa va por vino", () => {
    expect(normalizarPrecioCompra(fila({ precio_compra: null }))).toBeNull();
    expect(normalizarPrecioCompra(fila({ precio_compra: 0 }))).toBeNull();
    expect(normalizarPrecioCompra(fila({ vino_id: "" }))).toBeNull();
    const m = preciosPorVino([fila(), fila({ vino_id: "v2" }), fila({ vino_id: "v3", precio_compra: null })]);
    expect([...m.keys()]).toEqual(["v1", "v2"]);
  });

  it("si faltan las columnas con IVA, las calcula", () => {
    const p = normalizarPrecioCompra(fila({ precio_compra_iva: null, coste_efectivo_iva: null, coste_efectivo: 12 }))!;
    expect(p.precioCompraIva).toBe(18.39);
    expect(p.costeEfectivoIva).toBe(14.52);
  });

  it("multiplicador: precio de carta sin IVA ÷ coste efectivo; nada sin precio o con dato por revisar", () => {
    const p = normalizarPrecioCompra(fila())!;
    expect(multiplicadorCompra(42.5, p)).toBe(2.54); // 38,64 ÷ 15,20
    expect(multiplicadorCompra(null, p)).toBeNull();
    expect(multiplicadorCompra(0, p)).toBeNull();
    expect(multiplicadorCompra(42.5, { ...p, estado: "dudoso" })).toBeNull();
    expect(multiplicadorCompra(42.5, { ...p, costeEfectivo: 10 })).toBe(3.86);
  });

  it("detalle y explicación: albarán, IVA supuesto y origen", () => {
    const p = normalizarPrecioCompra(fila())!;
    expect(detalleCompra(p, "2026-11-25")).toBe("Vinos del Mundo · 15/11");
    const e = explicacionCompra(p, 2.54);
    expect(e).toMatch(/^Precio de compra en el último albarán de Vinos del Mundo \(15\/11\/26, nº A-1\): 15,20 € sin IVA/);
    expect(e).toMatch(/21 % de IVA \(supuesto: el albarán no lo dice\) = 18,39 €/);
    expect(e).toMatch(/Multiplicador 2,54×/);
    expect(e).toMatch(/Solo lo ven quienes pueden editar la carta/);
  });
});
