import { describe, expect, it } from "vitest";
import { idsDeFilas, unirReferencias, MAX_REFERENCIAS, type DocRef } from "../herramientas.ts";

const ref = (id: number): DocRef => ({ id, tipo: "factura", numero: `F-${id}`, proveedor: "P", fecha: "2026-10-01", drive_url: null, archivo_path: null });

describe("referencias de documentos", () => {
  it("une sin repetir documento y con tope", () => {
    expect(unirReferencias([[ref(1), ref(2)], [ref(2), ref(3)]]).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(unirReferencias([Array.from({ length: 30 }, (_, i) => ref(i + 1))])).toHaveLength(MAX_REFERENCIAS);
  });
  it("saca los ids de las filas de filtrar_documentos y descarta basura", () => {
    expect(idsDeFilas({ filas: [{ id: 5 }, { id: "x" }, null, { id: 7 }] })).toEqual([5, 7]);
    expect(idsDeFilas(null)).toEqual([]);
    expect(idsDeFilas({ error: "x" })).toEqual([]);
  });
});

import { documentosNombrados, elegirDocumento, nombradosEnRespuesta, respuestaNombra } from "../herramientas.ts";

describe("documentos nombrados por su número (enlace a Drive en la respuesta)", () => {
  it("apunta cada objeto con número (y proveedor) del resultado, sin repetir", () => {
    const data = {
      nota: "x",
      compras: [
        { numero: "002482", proveedor: "Catral S.L.", producto: "Amstel" },
        { numero: "002482", proveedor: "Catral S.L.", producto: "Cruzcampo" },
        { numero: 7, proveedor: "Corto" },
      ],
      albaranes: [{ numero: "AL2025/0009781", proveedor: "Bodega Campoluz, S.L." }],
      documento: { numero: "FV-12", proveedor: null },
    };
    expect(documentosNombrados(data)).toEqual([
      { numero: "002482", proveedor: "Catral S.L." },
      { numero: "AL2025/0009781", proveedor: "Bodega Campoluz, S.L." },
      { numero: "FV-12", proveedor: null },
    ]);
    expect(documentosNombrados(null)).toEqual([]);
    expect(documentosNombrados("texto")).toEqual([]);
  });

  it("la respuesta nombra el número con o sin separadores, nunca pegado a otra cifra", () => {
    expect(respuestaNombra("La factura **AL2025/0009781** de Campoluz", "AL2025/0009781")).toBe(true);
    expect(respuestaNombra("la AL 2025 0009781", "AL2025/0009781")).toBe(true);
    expect(respuestaNombra("Factura nº 002482 del 30/09", "002482")).toBe(true);
    expect(respuestaNombra("Total 1002482 €", "002482")).toBe(false);
    expect(respuestaNombra("Pagaste 24,82 €", "2482")).toBe(false);
    expect(respuestaNombra("cualquier cosa", "12")).toBe(false);
  });

  it("se queda con los nombrados que cita la respuesta, en orden y sin repetir", () => {
    const nombrados = [
      { numero: "A-11", proveedor: "Uno" },
      { numero: "B-22", proveedor: "Dos" },
      { numero: "A-11", proveedor: "Uno" },
    ];
    expect(nombradosEnRespuesta(nombrados, "Solo te cito la B-22 de Dos.")).toEqual([{ numero: "B-22", proveedor: "Dos" }]);
    expect(nombradosEnRespuesta(nombrados, "La A11 y la B 22.")).toHaveLength(2);
  });

  it("elige la fila del proveedor nombrado; sin proveedor, solo si no hay duda", () => {
    const filas = [
      { id: 1, proveedor: "DISTRIBUCIONES DE BEBIDAS CATRAL, S.L.", fecha: "2026-09-30" },
      { id: 2, proveedor: "Makro", fecha: "2026-10-01" },
    ];
    expect(elegirDocumento({ numero: "002482", proveedor: "Distribuciones de Bebidas Catral S.L." }, filas)?.id).toBe(1);
    expect(elegirDocumento({ numero: "002482", proveedor: "Otro" }, filas)).toBeNull();
    expect(elegirDocumento({ numero: "002482", proveedor: null }, filas)).toBeNull();
    expect(elegirDocumento({ numero: "002482", proveedor: null }, [filas[1]])?.id).toBe(2);
    expect(elegirDocumento({ numero: "002482", proveedor: "Makro" }, [])).toBeNull();
  });
});
