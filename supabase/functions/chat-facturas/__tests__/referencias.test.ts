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
