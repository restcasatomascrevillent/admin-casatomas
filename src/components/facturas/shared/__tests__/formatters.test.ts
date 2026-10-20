import { describe, expect, it } from "vitest";
import type { Factura, ProductoFactura } from "@/hooks/useFacturas";
import {
  avisosDocumento,
  claveProveedor,
  esLineaDeServicio,
  formatCantidadLinea,
  formatNumero,
  tieneAnomaliaPrecio,
} from "../formatters";

let siguienteId = 1;

const linea = (producto_nombre: string, precio_unitario: number): ProductoFactura => ({
  id: siguienteId++,
  producto_nombre,
  precio: precio_unitario,
  cantidad: 1,
  unidad: null,
  proveedor: null,
  precio_unitario,
});

const doc = (
  id: number,
  proveedor: string,
  productos: ProductoFactura[],
  proveedor_normalizado?: string | null,
): Factura => ({
  id,
  tipo: "albaran",
  numero_documento: String(id),
  proveedor,
  proveedor_normalizado,
  cif: null,
  fecha: "2026-10-01",
  subtotal: null,
  iva: null,
  total: null,
  total_origen: null,
  observaciones: null,
  productos,
  drive_url: null,
  archivo_path: null,
  alertas: [],
  procesado_en: null,
  created_at: null,
  verificada: false,
});

describe("tieneAnomaliaPrecio", () => {
  it("no compara los portes de Angelmar con los de ENCHENTA (caso real, albaranes 45 y 47)", () => {
    const angelmar = doc(45, "HEREDEROS ANGEL MARIÑO HERMO C.B. (ANGELMAR)", [
      linea("Centolla hembra 1-1.5 kg", 49),
      linea("Portes", 57),
    ], "herederos angel marino hermo c.b");
    const enchenta = doc(47, "ENCHENTA SLU", [linea("NAVAJA", 32), linea("PORTES", 25.45)], "enchenta");
    const todos = [angelmar, enchenta];

    expect(tieneAnomaliaPrecio(angelmar, todos)).toBe(false);
    expect(avisosDocumento(angelmar, todos)).toEqual([]);
  });

  it("no compara el mismo producto entre proveedores distintos", () => {
    const a = doc(1, "Proveedor A", [linea("Aceite de oliva 5 L", 60)]);
    const b = doc(2, "Proveedor B", [linea("ACEITE DE OLIVA 5 L", 20)]);
    expect(tieneAnomaliaPrecio(a, [a, b])).toBe(false);
  });

  it("sigue avisando si el MISMO proveedor cobra mas del doble", () => {
    const viejo = doc(1, "Bodega Campoluz, S.L.", [linea("BRUGAL 1888 70 CL.", 34.05)]);
    const nuevo = doc(2, "BODEGA CAMPOLUZ, S.L.", [linea("Brugal 1888 70 cl.", 340.5)]);
    expect(tieneAnomaliaPrecio(nuevo, [viejo, nuevo])).toBe(true);
    expect(avisosDocumento(nuevo, [viejo, nuevo]).map((a) => a.codigo)).toEqual(["precio_atipico_pagina"]);
  });

  it("usa proveedor_normalizado cuando viene de la base", () => {
    const viejo = doc(1, "Joselito (Cárnicas Joselito)", [linea("Jamón", 100)], "joselito");
    const nuevo = doc(2, "JOSELITO", [linea("Jamón", 500)], "joselito");
    expect(tieneAnomaliaPrecio(nuevo, [viejo, nuevo])).toBe(true);
  });

  it("ignora las lineas de servicio aunque sean del mismo proveedor", () => {
    const viejo = doc(1, "Enchenta", [linea("PORTES", 10), linea("Gestión y logística", 1)]);
    const nuevo = doc(2, "Enchenta", [linea("Portes", 57), linea("GESTION Y LOGISTICA", 5)]);
    expect(tieneAnomaliaPrecio(nuevo, [viejo, nuevo])).toBe(false);
  });

  it("no usa precios a 0 (bonificaciones o importes no leidos) como referencia", () => {
    const viejo = doc(1, "Campoluz", [linea("TANQUERAY 70 CL.", 0), linea("TANQUERAY 70 CL.", 11.4)]);
    const nuevo = doc(2, "Campoluz", [linea("TANQUERAY 70 CL.", 11.4)]);
    expect(tieneAnomaliaPrecio(nuevo, [viejo, nuevo])).toBe(false);
  });
});

describe("claveProveedor", () => {
  it("prefiere proveedor_normalizado", () => {
    expect(claveProveedor({ proveedor: "Bodega Campoluz, S.L.", proveedor_normalizado: "bodega campoluz" })).toBe(
      "bodega campoluz",
    );
  });

  it("si no lo hay, normaliza igual que normalizar_proveedor()", () => {
    expect(claveProveedor({ proveedor: "Bodega Campoluz, S.L." })).toBe("bodega campoluz");
    expect(claveProveedor({ proveedor: "BODEGA CAMPOLUZ, S.L." })).toBe("bodega campoluz");
    expect(claveProveedor({ proveedor: "DISTRIBUCIONES GUILLÉN, S.L." })).toBe("distribuciones guillen");
    expect(claveProveedor({ proveedor: "JOSELITO (Cárnicas Joselito)" })).toBe("joselito");
    expect(claveProveedor({ proveedor: null })).toBe("");
  });
});

describe("esLineaDeServicio", () => {
  it.each(["Portes", "PORTES", "Porte", "Transporte", "Gastos de envío", "GESTION Y LOGISTICA", "Punto Verde", "Canon punto verde"])(
    "%s es servicio",
    (nombre) => expect(esLineaDeServicio(nombre)).toBe(true),
  );

  it.each(["Centolla hembra 1-1.5 kg", "NAVAJA", "BRUGAL 1888 70 CL.", "Aceite de oliva"])(
    "%s es mercancia",
    (nombre) => expect(esLineaDeServicio(nombre)).toBe(false),
  );
});

describe("formatCantidadLinea (líneas por peso con sus unidades)", () => {
  it("línea por peso con bultos: «12 ud · 24 kg»", () => {
    expect(formatCantidadLinea({ cantidad: 24, unidad: "kg", bultos: 12 })).toBe("12 ud · 24 kg");
    expect(formatCantidadLinea({ cantidad: 75.48, unidad: "kg", bultos: 8 })).toBe("8 ud · 75,48 kg");
  });
  it("sin bultos: solo la cantidad con su unidad", () => {
    expect(formatCantidadLinea({ cantidad: 3, unidad: "ud", bultos: null })).toBe("3 ud");
    expect(formatCantidadLinea({ cantidad: 4.96, unidad: "kg" })).toBe("4,96 kg");
    expect(formatCantidadLinea({ cantidad: 2, unidad: null })).toBe("2");
  });
  it("sin cantidad: guion", () => {
    expect(formatCantidadLinea({ cantidad: undefined, unidad: "kg", bultos: null })).toBe("-");
  });
  it("formatNumero: coma decimal y hasta 3 decimales", () => {
    expect(formatNumero(111.8)).toBe("111,8");
    expect(formatNumero(7.355)).toBe("7,355");
    expect(formatNumero(24)).toBe("24");
  });
});
