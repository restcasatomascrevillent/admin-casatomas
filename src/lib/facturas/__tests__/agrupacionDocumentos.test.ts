import { beforeEach, describe, expect, it } from "vitest";
import type { Factura } from "@/hooks/useFacturas";
import {
  agruparDocumentos,
  claveEstadoMes,
  claveEstadoProveedor,
  claveMes,
  etiquetaMes,
  guardarPlegado,
  leerPlegado,
  mesAbierto,
  mesesRecientes,
  proveedorAbierto,
  sumaEnTotal,
  ubicacionDocumento,
} from "../agrupacionDocumentos";
import { crearResolverProveedor, type Proveedor } from "../proveedores";

const doc = (id: number, extra: Partial<Factura>): Factura => ({
  id,
  tipo: "factura",
  numero_documento: `D-${id}`,
  proveedor: "Makro",
  cif: null,
  fecha: "2026-10-03",
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
  ...extra,
});

const prov = (id: number, nombre: string, variantes: string[]): Proveedor => ({
  id,
  nombre,
  nombre_comercial: null,
  cif: null,
  activo: true,
  origen: null,
  documentos: 1,
  facturas: 1,
  albaranes: 0,
  total_facturas: 0,
  total_albaranes: 0,
  ultima_fecha: null,
  variantes,
  alias: [],
  cifs_extra: [],
});

const resolver = crearResolverProveedor([
  prov(1, "Pescados Rías Baixas", ["Pescados Rías Baixas S.L.", "PESCADOS RIAS BAIXAS"]),
  prov(2, "Makro", ["Makro", "MAKRO AUTOSERVICIO"]),
]);

describe("fechas y etiquetas", () => {
  it("saca el mes de la fecha y lo llama en español", () => {
    expect(claveMes("2026-10-03")).toBe("2026-10");
    expect(claveMes("2026-10-03T22:00:00+00:00")).toBe("2026-10");
    expect(claveMes("")).toBe("sin-fecha");
    expect(claveMes(null)).toBe("sin-fecha");
    expect(claveMes("2026-13-01")).toBe("sin-fecha");
    expect(etiquetaMes("2026-10")).toBe("Octubre 2026");
    expect(etiquetaMes("2026-01")).toBe("Enero 2026");
    expect(etiquetaMes("sin-fecha")).toBe("Sin fecha");
  });

  it("mes actual y anterior, también al cruzar de año", () => {
    expect(mesesRecientes(new Date(2026, 9, 10))).toEqual(["2026-10", "2026-09"]);
    expect(mesesRecientes(new Date(2027, 0, 5))).toEqual(["2027-01", "2026-12"]);
  });
});

describe("agruparDocumentos", () => {
  it("meses del más reciente al más antiguo y «Sin fecha» al final", () => {
    const g = agruparDocumentos(
      [
        doc(1, { fecha: "2026-08-20" }),
        doc(2, { fecha: "" }),
        doc(3, { fecha: "2026-10-01" }),
        doc(4, { fecha: "2025-12-31" }),
        doc(5, { fecha: "2026-09-15" }),
      ],
      resolver,
    );
    expect(g.map((m) => m.clave)).toEqual(["2026-10", "2026-09", "2026-08", "2025-12", "sin-fecha"]);
    expect(g.at(-1)?.etiqueta).toBe("Sin fecha");
  });

  it("agrupa por proveedor canónico (variantes juntas), A-Z y «Sin proveedor» al final", () => {
    const g = agruparDocumentos(
      [
        doc(1, { proveedor: "PESCADOS RIAS BAIXAS" }),
        doc(2, { proveedor: "Pescados Rías Baixas S.L." }),
        doc(3, { proveedor: "MAKRO AUTOSERVICIO" }),
        doc(4, { proveedor: null }),
        doc(5, { proveedor: "Bodegas del Salnés" }),
      ],
      resolver,
    );
    expect(g).toHaveLength(1);
    expect(g[0].proveedores.map((p) => p.nombre)).toEqual(["Bodegas del Salnés", "Makro", "Pescados Rías Baixas", "Sin proveedor"]);
    expect(g[0].proveedores[2].documentos.map((d) => d.id).sort()).toEqual([1, 2]);
    expect(g[0].documentos).toBe(5);
  });

  it("dentro de cada proveedor, del documento más reciente al más antiguo", () => {
    const g = agruparDocumentos(
      [doc(1, { fecha: "2026-10-01" }), doc(2, { fecha: "2026-10-09" }), doc(3, { fecha: "2026-10-09" })],
      resolver,
    );
    expect(g[0].proveedores[0].documentos.map((d) => d.id)).toEqual([3, 2, 1]);
  });

  it("total = facturas + albaranes sin factura; un albarán facturado se ve pero no suma", () => {
    const g = agruparDocumentos(
      [
        doc(1, { tipo: "factura", total: 1000.5 }),
        doc(2, { tipo: "albaran", total: 300, facturado_en_id: 1 }), // ya dentro de la factura 1
        doc(3, { tipo: "albaran", total: 120.25, facturado_en_id: null }), // sin factura: suma
        doc(4, { tipo: "albaran", total: null }), // sin importe: cuenta como documento, no suma
      ],
      resolver,
    );
    const mes = g[0];
    expect(mes.documentos).toBe(4);
    expect(mes.total).toBe(1120.75);
    expect(mes.proveedores[0].documentos).toHaveLength(4);
    expect(mes.proveedores[0].total).toBe(1120.75);
  });

  it("el total del mes es la suma de sus proveedores y no arrastra errores de coma flotante", () => {
    const g = agruparDocumentos([doc(1, { total: 0.1 }), doc(2, { total: 0.2 }), doc(3, { total: 10, proveedor: "Makro" })], resolver);
    expect(g[0].total).toBe(10.3);
  });

  it("un albarán facturado en otro mes no suma en el suyo (ya está en la factura)", () => {
    const g = agruparDocumentos(
      [doc(1, { tipo: "albaran", fecha: "2026-09-30", total: 80, facturado_en_id: 99 }), doc(2, { tipo: "albaran", fecha: "2026-10-02", total: 20 })],
      resolver,
    );
    expect(g.map((m) => [m.clave, m.total, m.documentos])).toEqual([
      ["2026-10", 20, 1],
      ["2026-09", 0, 1],
    ]);
  });

  it("lista vacía = sin grupos", () => {
    expect(agruparDocumentos([], resolver)).toEqual([]);
  });

  it("sumaEnTotal", () => {
    expect(sumaEnTotal({ tipo: "factura", facturado_en_id: null })).toBe(true);
    expect(sumaEnTotal({ tipo: "albaran", facturado_en_id: null })).toBe(true);
    expect(sumaEnTotal({ tipo: "albaran", facturado_en_id: 7 })).toBe(false);
    expect(sumaEnTotal({ tipo: "albaran" })).toBe(true);
  });
});

describe("qué grupos están abiertos", () => {
  const hoy = new Date(2026, 9, 10);

  it("por defecto, solo el mes actual y el anterior", () => {
    expect(mesAbierto("2026-10", {}, hoy, false)).toBe(true);
    expect(mesAbierto("2026-09", {}, hoy, false)).toBe(true);
    expect(mesAbierto("2026-08", {}, hoy, false)).toBe(false);
    expect(mesAbierto("sin-fecha", {}, hoy, false)).toBe(false);
  });

  it("con búsqueda o chip se abren todos, pero lo que decidió el usuario manda", () => {
    expect(mesAbierto("2026-03", {}, hoy, true)).toBe(true);
    expect(mesAbierto("2026-03", { [claveEstadoMes("2026-03")]: false }, hoy, true)).toBe(false);
    expect(mesAbierto("2026-10", { [claveEstadoMes("2026-10")]: false }, hoy, false)).toBe(false);
    expect(mesAbierto("2026-03", { [claveEstadoMes("2026-03")]: true }, hoy, false)).toBe(true);
  });

  it("los proveedores empiezan abiertos", () => {
    expect(proveedorAbierto("2026-10", "#1", {})).toBe(true);
    expect(proveedorAbierto("2026-10", "#1", { [claveEstadoProveedor("2026-10", "#1")]: false })).toBe(false);
    expect(proveedorAbierto("2026-09", "#1", { [claveEstadoProveedor("2026-10", "#1")]: false })).toBe(true);
  });

  it("ubicacionDocumento da el mes y el proveedor canónico", () => {
    expect(ubicacionDocumento({ fecha: "2026-03-04", proveedor: "MAKRO AUTOSERVICIO" }, resolver)).toEqual({ mes: "2026-03", proveedor: "#2" });
    expect(ubicacionDocumento({ fecha: "", proveedor: null }, resolver)).toEqual({ mes: "sin-fecha", proveedor: "" });
  });
});

describe("estado recordado en localStorage", () => {
  beforeEach(() => window.localStorage.clear());

  it("guarda y vuelve a leer", () => {
    guardarPlegado({ "m:2026-03": true, "m:2026-10": false });
    expect(leerPlegado()).toEqual({ "m:2026-03": true, "m:2026-10": false });
  });

  it("ignora contenido roto o de otro tipo", () => {
    window.localStorage.setItem("compras.documentos.plegado", "{no es json");
    expect(leerPlegado()).toEqual({});
    window.localStorage.setItem("compras.documentos.plegado", JSON.stringify(["a"]));
    expect(leerPlegado()).toEqual({});
    window.localStorage.setItem("compras.documentos.plegado", JSON.stringify({ a: true, b: "sí", c: 1 }));
    expect(leerPlegado()).toEqual({ a: true });
  });

  it("si localStorage falla, no revienta", () => {
    const original = Storage.prototype.getItem;
    const guardar = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error("bloqueado");
    };
    Storage.prototype.setItem = () => {
      throw new Error("bloqueado");
    };
    try {
      expect(leerPlegado()).toEqual({});
      expect(() => guardarPlegado({ a: true })).not.toThrow();
    } finally {
      Storage.prototype.getItem = original;
      Storage.prototype.setItem = guardar;
    }
  });
});
