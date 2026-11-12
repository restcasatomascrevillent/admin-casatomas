import { describe, expect, it } from "vitest";
import { falloDeAlbaran } from "../fallosInternos";
import type { ResultadoProcesamiento } from "../colaSubida";

const base: ResultadoProcesamiento = { nombre: "alb.jpg", success: true, tipo: "albaran", facturaId: 9, duplicado: false, alertas: [] };

describe("falloDeAlbaran", () => {
  it("totales descuadrados: incluye el aviso y el id", () => {
    const f = falloDeAlbaran({ ...base, alertas: [{ codigo: "descuadre_cabecera", severidad: "alta", mensaje: "Los totales no cuadran" }] });
    expect(f?.datos.factura_id).toBe(9);
    expect(f?.datos.avisos).toEqual([{ codigo: "descuadre_cabecera", severidad: "alta", mensaje: "Los totales no cuadran" }]);
    expect(f?.clave).toBe("albaran:9:descuadre_cabecera");
  });
  it("ignora los avisos normales de un albarán", () => {
    expect(falloDeAlbaran({ ...base, alertas: [{ codigo: "total_ausente", severidad: "media", mensaje: "x" }] })).toBeNull();
  });
  it("no avisa de facturas, duplicados ni documentos sin id", () => {
    const a = [{ codigo: "descuadre_cabecera", severidad: "alta", mensaje: "x" }];
    expect(falloDeAlbaran({ ...base, tipo: "factura", alertas: a })).toBeNull();
    expect(falloDeAlbaran({ ...base, duplicado: true, alertas: a })).toBeNull();
    expect(falloDeAlbaran({ ...base, facturaId: undefined, alertas: a })).toBeNull();
  });
});
