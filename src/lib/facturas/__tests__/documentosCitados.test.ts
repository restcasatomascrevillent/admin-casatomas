import { describe, expect, it } from "vitest";
import { normalizarAdjuntos } from "../seriePrecio";

describe("adjuntos de documentos citados", () => {
  it("acepta documentos válidos y descarta los mal formados", () => {
    const r = normalizarAdjuntos([
      { tipo: "documentos", datos: [{ id: 3, numero: "A-1", proveedor: "Luga", fecha: "2026-10-02", drive_url: "https://x.y/z", tipo: "factura" }, { id: "no" }, null] },
      { tipo: "documentos", datos: [] },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({
      tipo: "documentos",
      datos: [{ id: 3, tipo: "factura", numero: "A-1", proveedor: "Luga", fecha: "2026-10-02", drive_url: "https://x.y/z", archivo_path: null }],
    });
  });
});
