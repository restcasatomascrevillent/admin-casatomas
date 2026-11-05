import { describe, expect, it } from "vitest";
import type { Factura, ProductoFactura } from "@/hooks/useFacturas";
import { crearResolverProveedor, type Proveedor } from "../proveedores";
import {
  agregarPorProveedor,
  esAbono,
  esLineaRegalo,
  localDe,
  mesCorto,
  mesesGrafica,
  mismoPeriodo,
  ordenarProveedoresPorGasto,
  pasaLocal,
  pasaPeriodo,
  rangoPeriodo,
  regaladoDocumento,
  resumirCompras,
  textoPeriodo,
  topProveedores,
} from "../resumenCompras";

const doc = (id: number, extra: Partial<Factura>): Factura => ({
  id,
  tipo: "factura",
  numero_documento: `D-${id}`,
  proveedor: "Makro",
  cif: null,
  fecha: "2026-11-03",
  subtotal: null,
  iva: null,
  total: 100,
  total_origen: "leido",
  observaciones: null,
  productos: [],
  drive_url: null,
  archivo_path: null,
  alertas: [],
  procesado_en: null,
  created_at: null,
  verificada: true,
  facturado_en_id: null,
  local: null,
  ...extra,
});

const linea = (id: number, extra: Partial<ProductoFactura>): ProductoFactura => ({
  id,
  producto_nombre: `L-${id}`,
  precio: 10,
  proveedor: null,
  ...extra,
});

const prov = (id: number, nombre: string, variantes: string[]): Proveedor => ({
  id,
  nombre,
  nombre_comercial: null,
  cif: null,
  activo: true,
  origen: null,
  documentos: 0,
  facturas: 0,
  albaranes: 0,
  total_facturas: 0,
  total_albaranes: 0,
  ultima_fecha: null,
  variantes,
  alias: [],
  cifs_extra: [],
});

const PROVEEDORES = [prov(1, "Makro", ["Makro"]), prov(2, "Pescados Marta", ["PESCADOS MARTA, S.L."]), prov(3, "Hielos", ["Hielos"])];
const resolver = crearResolverProveedor(PROVEEDORES);
const HOY = new Date(2026, 10, 5); // 5 de noviembre de 2026

describe("local", () => {
  it("lo que no trae local (subidas del OCR) es de Casa Tomás", () => {
    expect(localDe({ local: null })).toBe("casa_tomas");
    expect(localDe({})).toBe("casa_tomas");
    expect(localDe({ local: "touza" })).toBe("touza");
    expect(pasaLocal({ local: null }, "casa_tomas")).toBe(true);
    expect(pasaLocal({ local: null }, "touza")).toBe(false);
    expect(pasaLocal({ local: "touza" }, "todos")).toBe(true);
  });
});

describe("periodo", () => {
  it("rangos: mes, mes anterior (también en enero), trimestre y año naturales, todo", () => {
    expect(rangoPeriodo({ tipo: "este_mes" }, HOY)).toEqual({ desde: "2026-11", hasta: "2026-11" });
    expect(rangoPeriodo({ tipo: "mes_anterior" }, HOY)).toEqual({ desde: "2026-10", hasta: "2026-10" });
    expect(rangoPeriodo({ tipo: "mes_anterior" }, new Date(2027, 0, 10))).toEqual({ desde: "2026-12", hasta: "2026-12" });
    expect(rangoPeriodo({ tipo: "trimestre" }, HOY)).toEqual({ desde: "2026-10", hasta: "2026-12" });
    expect(rangoPeriodo({ tipo: "trimestre" }, new Date(2026, 1, 1))).toEqual({ desde: "2026-01", hasta: "2026-03" });
    expect(rangoPeriodo({ tipo: "anio" }, HOY)).toEqual({ desde: "2026-01", hasta: "2026-12" });
    expect(rangoPeriodo({ tipo: "mes", mes: "2025-03" }, HOY)).toEqual({ desde: "2025-03", hasta: "2025-03" });
    expect(rangoPeriodo({ tipo: "todo" }, HOY)).toBeNull();
  });

  it("pasaPeriodo: por mes del documento; sin fecha solo en «Todo»", () => {
    const r = rangoPeriodo({ tipo: "trimestre" }, HOY);
    expect(pasaPeriodo({ fecha: "2026-10-01" }, r)).toBe(true);
    expect(pasaPeriodo({ fecha: "2026-12-31" }, r)).toBe(true);
    expect(pasaPeriodo({ fecha: "2026-09-30" }, r)).toBe(false);
    expect(pasaPeriodo({ fecha: "" }, r)).toBe(false);
    expect(pasaPeriodo({ fecha: "" }, null)).toBe(true);
  });

  it("texto del periodo y meses cortos", () => {
    expect(textoPeriodo({ tipo: "este_mes" }, HOY)).toBe("Noviembre 2026");
    expect(textoPeriodo({ tipo: "trimestre" }, HOY)).toBe("4.º trimestre 2026 (oct–dic)");
    expect(textoPeriodo({ tipo: "anio" }, HOY)).toBe("Año 2026");
    expect(textoPeriodo({ tipo: "todo" }, HOY)).toBe("Todo el histórico");
    expect(textoPeriodo({ tipo: "mes", mes: "2025-03" }, HOY)).toBe("Marzo 2025");
    expect(mesCorto("2026-01")).toBe("ene");
    expect(mesCorto("2026-01", true)).toBe("ene 26");
    expect(mismoPeriodo({ tipo: "mes", mes: "2025-03" }, { tipo: "mes", mes: "2025-03" })).toBe(true);
    expect(mismoPeriodo({ tipo: "mes", mes: "2025-03" }, { tipo: "mes", mes: "2025-04" })).toBe(false);
    expect(mismoPeriodo({ tipo: "todo" }, { tipo: "anio" })).toBe(false);
  });
});

describe("abonos y regalado", () => {
  it("abono = total negativo", () => {
    expect(esAbono({ total: -0.01 })).toBe(true);
    expect(esAbono({ total: 0 })).toBe(false);
    expect(esAbono({ total: null })).toBe(false);
  });

  it("regalado = bruto − importe en las líneas donde es mayor; marca lo estimado y cuenta los regalos", () => {
    const d = doc(1, {
      productos: [
        linea(1, { precio: 0, importe_bruto: 24 }), // regalo
        linea(2, { precio: 90, importe_bruto: 100, descuento_pct: 10, importe_bruto_estimado: true }), // descuento
        linea(3, { precio: 50, importe_bruto: 50 }), // sin diferencia
        linea(4, { precio: 30, importe_bruto: null }), // sin dato
        linea(5, { precio: 40, importe_bruto: 35 }), // bruto menor: no cuenta
      ],
    });
    expect(regaladoDocumento(d)).toEqual({ importe: 34, estimado: true, regalos: 1 });
    expect(regaladoDocumento(doc(2, {}))).toEqual({ importe: 0, estimado: false, regalos: 0 });
    expect(esLineaRegalo({ precio: 0, importe_bruto: 5 })).toBe(true);
    expect(esLineaRegalo({ precio: 1, importe_bruto: 5 })).toBe(false);
    expect(esLineaRegalo({ precio: 0, importe_bruto: null })).toBe(false);
  });
});

const DOCS: Factura[] = [
  doc(1, { proveedor: "Makro", total: 1000, productos: [linea(1, { precio: 0, importe_bruto: 20, importe_bruto_estimado: true })] }),
  doc(2, { proveedor: "Makro", total: -100, fecha: "2026-11-04" }), // abono
  doc(3, { proveedor: "PESCADOS MARTA, S.L.", total: 300, tipo: "albaran" }), // sin factura: suma
  doc(4, { proveedor: "PESCADOS MARTA, S.L.", total: 300, tipo: "albaran", facturado_en_id: 5, productos: [linea(2, { precio: 0, importe_bruto: 99 })] }), // facturado: no suma ni regala
  doc(5, { proveedor: "PESCADOS MARTA, S.L.", total: 300, fecha: "2026-10-20", local: "touza" }),
  doc(6, { proveedor: null, total: 50, fecha: "2026-01-02" }),
  doc(7, { proveedor: "Makro", total: 70, fecha: "2025-11-30" }), // fuera de los 12 meses
];

describe("resumen", () => {
  it("gasto neto con IVA, abonos, regalado y documentos (con el mismo criterio que la lista)", () => {
    expect(resumirCompras(DOCS)).toEqual({
      gasto: 1000 - 100 + 300 + 300 + 50 + 70,
      abonos: -100,
      nAbonos: 1,
      regalado: 20,
      regaladoEstimado: true,
      documentos: 7,
    });
    expect(resumirCompras([])).toEqual({ gasto: 0, abonos: 0, nAbonos: 0, regalado: 0, regaladoEstimado: false, documentos: 0 });
  });

  it("12 meses hasta el de hoy, repartidos por local", () => {
    const meses = mesesGrafica(DOCS, HOY);
    expect(meses).toHaveLength(12);
    expect(meses[0].clave).toBe("2025-12");
    expect(meses.at(-1)).toEqual({ clave: "2026-11", casa_tomas: 1200, touza: 0, total: 1200 });
    expect(meses.find((m) => m.clave === "2026-10")).toEqual({ clave: "2026-10", casa_tomas: 0, touza: 300, total: 300 });
    expect(meses.find((m) => m.clave === "2026-01")?.total).toBe(50);
  });

  it("por proveedor: gasto, abonos, regalado, albaranes sin factura, documentos ordenados", () => {
    const a = agregarPorProveedor(DOCS, resolver);
    const makro = a.get("#1")!;
    expect(makro.gasto).toBe(970);
    expect(makro.abonos).toBe(-100);
    expect(makro.nAbonos).toBe(1);
    expect(makro.regalado).toBe(20);
    expect(makro.regaladoEstimado).toBe(true);
    expect(makro.documentos.map((d) => d.id)).toEqual([2, 1, 7]);
    expect(makro.ultimaFecha).toBe("2026-11-04");
    const marta = a.get("#2")!;
    expect(marta.gasto).toBe(600);
    expect(marta.regalado).toBe(0); // el regalo del albarán facturado no cuenta (ya va en su factura)
    expect(marta.albaranesSinFactura).toBe(1);
    expect(a.get("")?.nombre).toBe("Sin proveedor");
  });

  it("top de proveedores por gasto, sin «Sin proveedor»", () => {
    const top = topProveedores(agregarPorProveedor(DOCS, resolver), 10);
    expect(top.map((t) => t.clave)).toEqual(["#1", "#2"]);
    expect(topProveedores(agregarPorProveedor(DOCS, resolver), 1)).toHaveLength(1);
  });

  it("lista de proveedores por gasto; con filtros, solo los que tienen documentos", () => {
    const a = agregarPorProveedor(DOCS, resolver);
    expect(ordenarProveedoresPorGasto([...PROVEEDORES].reverse(), a, false).map((p) => p.id)).toEqual([1, 2, 3]);
    expect(ordenarProveedoresPorGasto(PROVEEDORES, a, true).map((p) => p.id)).toEqual([1, 2]);
  });
});
