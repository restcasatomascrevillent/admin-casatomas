import { describe, expect, it } from "vitest";
import { aCompras, comprasDelMes, comprasQueCuentan, hojaDelProducto, hojasDelProducto, lineasConProductoArriba, productoDeAlerta, type LineaDocumento } from "../comprasProducto";
import { ticksPrecio } from "../vistasAnalisis";

const GAMBA = { productoId: 284, nombreNormalizado: "gamba roja n1 costa alicante", nombre: "GAMBA ROJA N1" };

const linea = (id: number, pagina: number, orden: number, producto: number | null, nombre = "OTRA COSA"): LineaDocumento => ({
  id,
  nombre,
  nombreNormalizado: nombre.toLowerCase(),
  productoId: producto,
  cantidad: 2,
  unidad: "kg",
  precio: 10,
  total: 20,
  pagina,
  orden,
});

const fila = (id: number, doc: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id,
  nombre: "GAMBA ROJA N1 COSTA ALICANTE",
  nombre_normalizado: "gamba roja n1 costa alicante",
  producto_id: 284,
  cantidad: "2.000",
  unidad: "kg",
  precio_unitario: "120.00",
  total: "240",
  pagina: 1,
  orden: 1,
  factura_id: doc.id,
  facturas: { proveedor: "Nicolás y Valero", proveedor_id: 284, local: null, total: 1000, drive_url: null, archivo_path: null, facturado_en_id: null, ...doc },
  ...extra,
});

describe("compras de un producto (Comparar facturas)", () => {
  it("cuenta facturas y albaranes sin facturar; un albarán ya facturado no se cuenta dos veces", () => {
    const compras = aCompras([
      fila(1, { id: 1865, tipo: "factura", numero_documento: "A26/34512", fecha: "2026-07-15" }),
      fila(2, { id: 300, tipo: "albaran", numero_documento: "P26/14.521", fecha: "2026-07-03", facturado_en_id: 1865 }),
      fila(3, { id: 352, tipo: "albaran", numero_documento: "P26/24306", fecha: "2026-10-09" }, { precio_unitario: "178" }),
    ]);
    const cuentan = comprasQueCuentan(compras);
    expect(cuentan.map((c) => c.doc.numero)).toEqual(["P26/24306", "A26/34512"]);
    expect(cuentan[0].precio).toBe(178);
    expect(cuentan[0].doc.local).toBe("casa_tomas");
  });

  it("las líneas del producto van arriba y la hoja es la primera donde sale", () => {
    const lineas = [linea(1, 1, 1, 10), linea(2, 4, 45, 284, "GAMBA"), linea(3, 1, 2, 11), linea(4, 5, 52, 284, "GAMBA"), linea(5, 6, 60, 12)];
    const { lineas: orden, delProducto } = lineasConProductoArriba(lineas, GAMBA);
    expect(orden.map((l) => l.id)).toEqual([2, 4, 1, 3, 5]);
    expect([...delProducto]).toEqual([2, 4]);
    expect(hojaDelProducto(lineas, GAMBA)).toBe(4);
    expect(hojasDelProducto(lineas, GAMBA)).toEqual([4, 5]);
    expect(hojaDelProducto([linea(1, 1, 1, 10)], GAMBA)).toBeNull();
  });

  it("sin id de producto busca por la línea normalizada", () => {
    const p = { productoId: null, nombreNormalizado: "gamba", nombre: "Gamba" };
    expect(hojaDelProducto([linea(1, 3, 1, null, "GAMBA")], p)).toBe(3);
  });

  it("compras de un mes, en la unidad y del proveedor de la gráfica", () => {
    const compras = aCompras([
      fila(1, { id: 1, tipo: "factura", fecha: "2026-10-02" }),
      fila(2, { id: 2, tipo: "factura", fecha: "2026-10-20", proveedor_id: 9 }),
      fila(3, { id: 3, tipo: "factura", fecha: "2026-10-09" }, { unidad: "caja" }),
      fila(4, { id: 4, tipo: "factura", fecha: "2026-09-30" }),
    ]);
    expect(comprasDelMes(compras, "2026-10", "kg", 284).map((c) => c.doc.id)).toEqual([1]);
    expect(comprasDelMes(compras, "2026-10", "kg", null).map((c) => c.doc.id)).toEqual([1, 2]);
  });

  it("el producto de un aviso", () => {
    expect(productoDeAlerta({ datos: { productoId: 284, nombreNormalizado: "x", producto: "GAMBA" } })).toEqual({ productoId: 284, nombreNormalizado: "x", nombre: "GAMBA" });
    expect(productoDeAlerta({ datos: { productoId: null, nombreNormalizado: null, producto: "GAMBA" } })).toBeNull();
  });
});

describe("eje Y de la gráfica de precio", () => {
  it("valores redondos dentro del rango, de abajo arriba", () => {
    const t = ticksPrecio({ min: 92, max: 141 });
    expect(t.map((x) => x.valor)).toEqual([100, 120, 140]);
    expect(t[0].y).toBeGreaterThan(t[2].y);
    expect(ticksPrecio({ min: 9.6, max: 13.1 }).map((x) => x.valor)).toEqual([10, 11, 12, 13]);
    expect(ticksPrecio({ min: 5, max: 5 })).toEqual([]);
  });
});
