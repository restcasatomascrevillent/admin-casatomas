import { describe, expect, it } from "vitest";
import {
  aplicarReglasLectura,
  aplicarSignoAbono,
  avisoCajasSinUnidades,
  avisoFechaFueraDeAnio,
  cifConocido,
  documentoNoCompra,
  esOtraFacturaConNumeroDistinto,
  localDestinatario,
} from "./reglasCarga";
import { esCifCliente, esNombreCliente, normalizarDatos } from "./extraccion";
import { comprobarCuadre, deducirImportes, type DocumentoExtraido } from "./esquema";
import { quitarIvaExplicadoPorExtras } from "./guardado";

// ============================================================================
//  Reglas aprendidas en la carga manual de ~2.400 facturas históricas
//  (facturas-conocimiento/carga2/PROMPT-AGENTE.md), aplicadas al OCR diario.
// ============================================================================

const linea = (o: Record<string, unknown> = {}) => ({
  nombre: "Producto", cantidad: 1, unidad: "ud", peso_kg: null, base_precio: "por_unidad",
  precio_unitario: 10, total: 10, iva_pct: null, bonificada: false, albaran_ref: null, ...o,
});
const doc = (o: Record<string, unknown> = {}): DocumentoExtraido => ({
  tipo: "factura", proveedor: "PROVEEDOR SL", cif: "B03092038", cliente: null, numero_documento: "F-1",
  fecha: "2026-11-10", sin_importes: false, filas_tabla: 1, continua_en_otra_pagina: false,
  productos: [linea()], subtotal: 10, subtotal_literal: "10,00", iva: 1, iva_literal: "1,00",
  total: 11, total_literal: "11,00", observaciones: null, resumen: null, ...o,
} as DocumentoExtraido);
const HOY = new Date("2026-11-15T12:00:00Z");

describe("1. abonos en negativo", () => {
  it("es_abono: cabecera, líneas y cantidades en negativo; precio positivo (Osborne en positivo)", () => {
    const d = normalizarDatos(doc({ es_abono: true, productos: [linea({ cantidad: 2, precio_unitario: 5, total: 10 })] }), HOY);
    expect([d.subtotal, d.iva, d.total]).toEqual([-10, -1, -11]);
    expect(d.productos[0].total).toBe(-10);
    expect(d.productos[0].cantidad).toBe(-2);
    expect(d.productos[0].precio_unitario).toBe(5);
    expect(d.observaciones).toMatch(/Abono/);
  });
  it("devolución de envases dentro de una factura: la cantidad también en negativo", () => {
    const { data } = aplicarSignoAbono({ productos: [{ nombre: "Envase", cantidad: 3, total: -4.5 }] });
    expect(data.productos[0].cantidad).toBe(-3);
  });
});

describe("4. local por el destinatario", () => {
  it("Touza por nombre o por la calle Santa María de la Cabeza 4", () => {
    expect(localDestinatario("TOUZA COCKTAIL BAR").local).toBe("touza");
    expect(localDestinatario("MASIDE 2011 SL · C/ Santa María de la Cabeza, nº 4 Crevillent").local).toBe("touza");
  });
  it("Casa Tomás; solo MASIDE → casa_tomas con aviso; nada → null", () => {
    expect(localDestinatario("RESTAURANTE CASA TOMAS").local).toBe("casa_tomas");
    const m = localDestinatario("MASIDE 2011 S.L. B54583356");
    expect(m.local).toBe("casa_tomas");
    expect(m.aviso?.codigo).toBe("local_supuesto");
    expect(localDestinatario(null, "").local).toBeNull();
  });
  it("normalizarDatos lo devuelve", () => {
    expect(normalizarDatos(doc({ cliente: "Touza Cocktail Bar" }), HOY).local).toBe("touza");
  });
});

describe("5. líneas con IVA incluido", () => {
  it("las pasa a base con el tipo de cada línea y avisa; el cuadre ya no protesta", () => {
    const d = aplicarReglasLectura(doc({
      productos: [linea({ precio_unitario: 11, total: 11, iva_pct: 10 }), linea({ precio_unitario: 22, total: 22, iva_pct: 10 })],
      subtotal: 30, iva: 3, total: 33, filas_tabla: 2,
    }));
    expect(d.productos.map((l) => l.total)).toEqual([10, 20]);
    expect(d.avisos_reglas?.[0].codigo).toBe("lineas_con_iva_incluido");
    expect(comprobarCuadre(d).map((x) => x.codigo)).not.toContain("descuadre_cabecera");
  });
  it("no toca un documento que ya viene en base", () => {
    const d = aplicarReglasLectura(doc());
    expect(d.productos[0].total).toBe(10);
    expect(d.avisos_reglas).toBeUndefined();
  });
});

describe("6. cuadre con recargo de equivalencia y cargos fuera de base", () => {
  it("la tasa DGT fuera de base no rompe base + IVA = total", () => {
    const d = doc({ subtotal: 40, iva: 8.4, total: 52.5, cargos_fuera_base: 4.1, productos: [linea({ precio_unitario: 40, total: 40 })] });
    expect(comprobarCuadre(d).map((x) => x.codigo)).not.toContain("iva_incoherente");
    expect(comprobarCuadre({ ...d, cargos_fuera_base: null }).map((x) => x.codigo)).toContain("iva_incoherente");
  });
  it("el total deducido suma el recargo", () => {
    const { datos } = deducirImportes(doc({ total: null, total_literal: null, recargo_equivalencia: 0.52 }));
    expect(datos.total).toBe(11.52);
  });
  it("la alerta SQL iva_incoherente que explica el extra se quita", () => {
    const sql = [{ codigo: "iva_incoherente", severidad: "media", mensaje: "", detalle: { diferencia: -4.1 } }];
    expect(quitarIvaExplicadoPorExtras(sql as never, 4.1)).toEqual([]);
    expect(quitarIvaExplicadoPorExtras(sql as never, 2)).toHaveLength(1);
  });
});

describe("7/11. lo que no es compra", () => {
  const nc = (o: Record<string, unknown>) => documentoNoCompra(o, esCifCliente, esNombreCliente);
  it("adeudo SEPA, TPV, leasing… no se cargan como gasto", () => {
    expect(nc({ clase_documento: "adeudo_bancario" })?.mensaje).toMatch(/No es una factura de compra/);
    expect(nc({ clase_documento: "comision_tpv" })?.clase).toBe("comision_tpv");
    expect(nc({ clase_documento: "compra" })).toBeNull();
    expect(nc({})).toBeNull();
  });
  it("factura EMITIDA por MASIDE a otro cliente = venta", () => {
    expect(nc({ cif: "B54583356", proveedor: "MASIDE 2011 S.L.", cliente: "EVENTOS PEREZ SL" })?.clase).toBe("venta_emitida");
  });
  it("Rechgo (B16926669) siempre es compra", () => {
    expect(nc({ cif: "B-16926669", clase_documento: "otro_no_compra" })).toBeNull();
  });
  it("normalizarDatos lo marca para que guardado no lo guarde", () => {
    expect(normalizarDatos(doc({ clase_documento: "recibo_sgae" }), HOY).no_es_compra?.clase).toBe("recibo_sgae");
  });
});

describe("8. Pluxee: solo la comisión", () => {
  it("quita «Importe de cheques» y deja el total para deducirlo de base + IVA", () => {
    const d = aplicarReglasLectura(doc({
      proveedor: "PLUXEE SPAIN SA", cif: "A78604113",
      productos: [linea({ nombre: "Comisión de servicio", precio_unitario: 20, total: 20 }), linea({ nombre: "Importe de cheques (no sujeto)", precio_unitario: 1000, total: 1000 })],
      subtotal: 20, iva: 4.2, total: 1024.2, filas_tabla: 2,
    }));
    expect(d.productos.map((l) => l.nombre)).toEqual(["Comisión de servicio"]);
    expect(d.total).toBeNull();
    expect(deducirImportes(d).datos.total).toBe(24.2);
    expect(d.avisos_reglas?.[0].codigo).toBe("pluxee_cheques_quitados");
  });
});

describe("9/13. CIF conocidos", () => {
  it("Nicolás y Valero 2025 (B30120745) → ficha B06805246; embalaje con IVA 10 %", () => {
    expect(cifConocido("B30120745", "NICOLAS Y VALERO").cif).toBe("B06805246");
    const d = normalizarDatos(doc({ cif: "B30120745", productos: [linea({ nombre: "Embalajes", precio_unitario: 1.82, total: 1.82 })] }), HOY);
    expect(d.cif).toBe("B06805246");
    expect(d.productos[0].iva_pct).toBe(10);
  });
  it("Transgourmet sin CIF visible → A17371758", () => {
    expect(cifConocido(null, "Transgourmet Ibérica S.A.U.").cif).toBe("A17371758");
    expect(cifConocido(null, "Otro").cif).toBeNull();
  });
});

describe("3/10. cajas y filas de tarifa", () => {
  it("caja sin unidades → aviso; con C6 o 12x75cl, no", () => {
    expect(avisoCajasSinUnidades([{ nombre: "VINO TINTO CRIANZA", unidad: "caja" }])?.codigo).toBe("caja_sin_unidades");
    expect(avisoCajasSinUnidades([{ nombre: "VINO TINTO CRIANZA C6", unidad: "caja" }])).toBeNull();
    expect(avisoCajasSinUnidades([{ nombre: "AGUA 12x75cl", unidad: "caja" }])).toBeNull();
  });
  it("una fila de tarifa (precio sin cantidad ni importe) no es producto", () => {
    const d = normalizarDatos(doc({
      productos: [linea(), linea({ nombre: "Tarifa: jamón ibérico", cantidad: 0, precio_unitario: 45, total: null })],
    }), HOY);
    expect(d.productos.map((p) => p.nombre)).toEqual(["Producto"]);
  });
});

describe("16. fecha fuera del año esperado", () => {
  it("avisa de años viejos y de fechas futuras; no de este año ni del anterior", () => {
    expect(avisoFechaFueraDeAnio("2026-03-01", HOY)).toBeNull();
    expect(avisoFechaFueraDeAnio("2025-12-30", HOY)).toBeNull();
    expect(avisoFechaFueraDeAnio("2024-12-30", HOY)?.codigo).toBe("fecha_fuera_de_anio");
    expect(avisoFechaFueraDeAnio("2026-12-11", HOY)?.codigo).toBe("fecha_fuera_de_anio");
  });
});

describe("17. duplicados por datos con números distintos", () => {
  it("dos números reales distintos no son duplicado; sin número o el mismo, sí", () => {
    expect(esOtraFacturaConNumeroDistinto("11-26", { numero_documento: "10-26", motivo: "datos_coincidentes" })).toBe(true);
    expect(esOtraFacturaConNumeroDistinto("A26/10,685", { numero_documento: "A26/10685", motivo: "datos_coincidentes" })).toBe(false);
    expect(esOtraFacturaConNumeroDistinto("SN-PROV-20261101", { numero_documento: "10-26", motivo: "datos_coincidentes" })).toBe(false);
    expect(esOtraFacturaConNumeroDistinto("11-26", { numero_documento: "11-26", motivo: "numero_proveedor" })).toBe(false);
  });
});
