import { describe, it, expect, beforeEach } from "vitest";
import type { Factura, ProductoFactura } from "@/hooks/useFacturas";
import {
  detalleError,
  errorDefinitivo,
  reintentarConsulta,
  avisosCabecera,
  avisosFicha,
  crearResolverDeLista,
  decodificarLista,
  faltaFuncionCompras,
  listaDesdeCompletos,
  SIN_REGALADO,
} from "../listaCompras";
import { borrarCopiasLista, CADUCIDAD_COPIA_MS, guardarCopiaLista, leerCopiaLista } from "../copiaListaCompras";
import { agregarPorProveedor } from "../resumenCompras";
import { contarFiltrosDocumentos, filtrarDocumentos } from "../compras";

// Una fila tal cual la devuelve documentos_lista() (orden de la migración 20261105190000).
const FILA = [
  7, "factura", "F-7", "PESCADOS MARTA, S.L.", 3, "B123", "2026-10-02", null, "touza", "90.00", "99.00", "leido",
  null, "facturas/7.pdf", false, "auto", 4, [["iva_incoherente", "alta"]], [12.5, true, 1], true,
];
const CRUDO = { v: 1, proveedores: { 3: "Pescados Marta S.L." }, docs: [FILA, [8, "albaran", "A-8", null, null, null, "2026-10-01", 7, null, null, null, null, null, null, true, null, 0, null, null, false]] };

describe("decodificarLista", () => {
  it("convierte cada array en una cabecera con sus tipos", () => {
    const [f, a] = decodificarLista(CRUDO);
    expect(f).toEqual({
      id: 7, tipo: "factura", numero_documento: "F-7", proveedor: "PESCADOS MARTA, S.L.", proveedor_id: 3,
      proveedor_canonico: "Pescados Marta S.L.", cif: "B123", fecha: "2026-10-02", facturado_en_id: null, local: "touza",
      subtotal: 90, total: 99, total_origen: "leido", drive_url: null, archivo_path: "facturas/7.pdf", verificada: false,
      verificacion_origen: "auto", n_lineas: 4, alertas: [{ codigo: "iva_incoherente", severidad: "alta" }],
      regalado: { importe: 12.5, estimado: true, regalos: 1 }, precio_atipico: true,
    });
    expect(a).toMatchObject({ id: 8, tipo: "albaran", facturado_en_id: 7, proveedor: null, total: null, alertas: [], regalado: SIN_REGALADO, precio_atipico: false });
  });

  it("rechaza lo que no es la respuesta v1", () => {
    expect(() => decodificarLista(null)).toThrow();
    expect(() => decodificarLista({ v: 2, docs: [] })).toThrow();
  });
});

describe("avisos, filtros y proveedores con cabeceras", () => {
  const cabeceras = decodificarLista(CRUDO);

  it("avisos de la fila: los guardados más el de precio atípico", () => {
    expect(avisosCabecera(cabeceras[0]).map((a) => a.codigo)).toEqual(["iva_incoherente", "precio_atipico_pagina"]);
    expect(avisosCabecera(cabeceras[1])).toEqual([]);
  });

  it("el resolver da el proveedor unificado por el id del documento; lo demás, con el de base", () => {
    const resolver = crearResolverDeLista(cabeceras, (t) => ({ clave: `texto:${t}`, nombre: t }));
    expect(resolver("PESCADOS MARTA, S.L.")).toEqual({ clave: "#3", nombre: "Pescados Marta S.L." });
    expect(resolver("Otro")).toEqual({ clave: "texto:Otro", nombre: "Otro" });
  });

  it("buscar: la cabecera casa sola; lo que dice el servidor (líneas) se suma", () => {
    const avisos = new Map(cabeceras.map((d) => [d.id, avisosCabecera(d)]));
    expect(filtrarDocumentos(cabeceras, "f-7", "todo", avisos).map((d) => d.id)).toEqual([7]);
    expect(filtrarDocumentos(cabeceras, "merluza", "todo", avisos)).toEqual([]);
    expect(filtrarDocumentos(cabeceras, "merluza", "todo", avisos, new Set([8])).map((d) => d.id)).toEqual([8]);
    const c = contarFiltrosDocumentos(cabeceras, "", avisos);
    expect(c).toMatchObject({ todo: 2, facturas: 1, albaranes: 1, con_avisos: 1, sin_revisar: 1, albaranes_sin_factura: 0 });
  });

  it("por proveedor suma el regalado que ya trae la cabecera", () => {
    const resolver = crearResolverDeLista(cabeceras, (t) => ({ clave: t, nombre: t }));
    const a = agregarPorProveedor(cabeceras, resolver).get("#3");
    expect(a).toMatchObject({ gasto: 99, regalado: 12.5, regaladoEstimado: true, documentos: [cabeceras[0]] });
  });

  it("faltaFuncionCompras reconoce la migración sin aplicar", () => {
    expect(faltaFuncionCompras({ code: "PGRST202", message: "x" })).toBe(true);
    expect(faltaFuncionCompras({ code: "42883", message: "x" })).toBe(true);
    expect(faltaFuncionCompras({ message: "Could not find the function public.documentos_lista in the schema cache" })).toBe(true);
    expect(faltaFuncionCompras({ code: "42501", message: "permission denied" })).toBe(false);
  });
});

// ─── Sin la migración: lo mismo, calculado con los documentos completos ─────
const linea = (id: number, nombre: string, precio: number, extra: Partial<ProductoFactura> = {}): ProductoFactura => ({
  id, producto_nombre: nombre, precio, precio_unitario: precio, cantidad: 1, proveedor: null, ...extra,
});
const doc = (id: number, tipo: string, productos: ProductoFactura[], extra: Partial<Factura> = {}): Factura => ({
  id, tipo, numero_documento: `D-${id}`, proveedor: "Marta", proveedor_normalizado: "marta", cif: null, fecha: `2026-10-${String(id).padStart(2, "0")}`,
  subtotal: null, iva: null, total: 10, total_origen: null, observaciones: null, productos, drive_url: null, archivo_path: null,
  alertas: [], procesado_en: null, created_at: null, verificada: true, ...extra,
});

describe("listaDesdeCompletos (carga de antes)", () => {
  it("precio atípico por tipo, regalado, nº de líneas y la media de cada línea", () => {
    const facturas = [
      doc(1, "factura", [linea(11, "Merluza", 10), linea(12, "Portes", 5)]),
      doc(2, "factura", [linea(21, "MERLUZA", 12), linea(22, "Gamba", 0, { importe_bruto: 40, importe_bruto_estimado: true })]),
      doc(3, "factura", [linea(31, "merluza", 30), linea(32, "Portes", 50)]),
    ];
    const albaranes = [doc(4, "albaran", [linea(41, "Merluza", 31)])];
    const { cabeceras, completos } = listaDesdeCompletos(facturas, albaranes);
    expect(cabeceras.map((c) => c.id)).toEqual([4, 3, 2, 1]);
    const porId = new Map(cabeceras.map((c) => [c.id, c]));
    expect(porId.get(3)!.precio_atipico).toBe(true); // 30 > 2 × 11
    expect(porId.get(1)!.precio_atipico).toBe(false);
    expect(porId.get(4)!.precio_atipico).toBe(false); // el albarán no se compara con las facturas
    expect(porId.get(2)!.regalado).toEqual({ importe: 40, estimado: true, regalos: 1 });
    expect(porId.get(1)!.n_lineas).toBe(2);
    const ficha = completos.get(3)!;
    expect(ficha.productos.map((p) => p.media_referencia)).toEqual([11, null]); // portes: sin media
    expect(avisosFicha(ficha).map((a) => a.codigo)).toEqual(["precio_atipico_pagina"]);
  });
});

describe("copia de la lista en el dispositivo", () => {
  beforeEach(() => window.localStorage.clear());

  it("se guarda por usuario y se lee tal cual", () => {
    guardarCopiaLista("u1", CRUDO, 1000);
    expect(leerCopiaLista("u1", 2000)).toEqual({ crudo: CRUDO, guardado: 1000 });
    expect(leerCopiaLista("u2", 2000)).toBeNull();
    expect(leerCopiaLista(null, 2000)).toBeNull();
  });

  it("caducada, de otra versión o rota: no se usa", () => {
    guardarCopiaLista("u1", CRUDO, 1000);
    expect(leerCopiaLista("u1", 1000 + CADUCIDAD_COPIA_MS + 1)).toBeNull();
    window.localStorage.setItem("compras-lista:u1", JSON.stringify({ v: 99, guardado: 1000, crudo: CRUDO }));
    expect(leerCopiaLista("u1", 2000)).toBeNull();
    window.localStorage.setItem("compras-lista:u1", "{roto");
    expect(leerCopiaLista("u1", 2000)).toBeNull();
  });

  it("al cerrar sesión se borran las de todos (y nada más)", () => {
    guardarCopiaLista("u1", CRUDO);
    guardarCopiaLista("u2", CRUDO);
    window.localStorage.setItem("otra-cosa", "1");
    borrarCopiasLista();
    expect(leerCopiaLista("u1")).toBeNull();
    expect(leerCopiaLista("u2")).toBeNull();
    expect(window.localStorage.getItem("otra-cosa")).toBe("1");
  });
});

describe("reintentos de Compras (QA: no reintentar lo que no se va a arreglar)", () => {
  it("sin permiso, 4xx o PostgREST: definitivo; red o 5xx: se reintenta (hasta 2 veces)", () => {
    expect(errorDefinitivo({ code: "42501", message: "permission denied" })).toBe(true);
    expect(errorDefinitivo({ code: "PGRST116" })).toBe(true);
    expect(errorDefinitivo({ status: 403 })).toBe(true);
    expect(errorDefinitivo({ code: "XX000", status: 500 })).toBe(false);
    expect(errorDefinitivo(new Error("Failed to fetch"))).toBe(false);
    expect(reintentarConsulta(0, new Error("Failed to fetch"))).toBe(true);
    expect(reintentarConsulta(2, new Error("Failed to fetch"))).toBe(false);
    expect(reintentarConsulta(0, { code: "42501" })).toBe(false);
  });
  it("el detalle técnico lleva el mensaje y el código", () => {
    expect(detalleError({ message: "fallo", code: "XX000" })).toBe("fallo (XX000)");
    expect(detalleError(null)).toBe("error desconocido");
  });
});
