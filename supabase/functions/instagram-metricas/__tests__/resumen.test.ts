// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resumirPeriodo, serieDiaria, ultimoDia, variacion, type FilaCuenta } from "../resumen.ts";

const fila = (fecha: string, o: Partial<FilaCuenta> = {}): FilaCuenta => ({
  fecha, seguidores: null, alcance: null, visualizaciones: null, visitas_perfil: null, cuentas_interaccion: null, interacciones: null, ...o,
});

describe("resumen de la cuenta", () => {
  it("variación: null sin base o con base 0; un decimal", () => {
    expect(variacion(10, null)).toBeNull();
    expect(variacion(null, 10)).toBeNull();
    expect(variacion(10, 0)).toBeNull();
    expect(variacion(110, 100)).toBe(10);
    expect(variacion(1, 3)).toBe(-66.7);
  });

  it("suma solo los días con dato y cuenta los días de cada periodo", () => {
    const filas = [fila("2026-11-04", { alcance: 50 }), fila("2026-11-02", { alcance: 30 }), fila("2026-10-27", { alcance: 40 })];
    const r = resumirPeriodo(filas, "2026-11-04", 7);
    expect(r).toMatchObject({ desde: "2026-10-29", hasta: "2026-11-04", diasConDatos: 2, diasConDatosAnterior: 1 });
    expect(r.metricas.alcance).toEqual({ actual: 80, anterior: 40, variacion: 100 });
    expect(r.metricas.visualizaciones).toEqual({ actual: null, anterior: null, variacion: null });
  });

  it("seguidores: último valor conocido al final de cada periodo", () => {
    const filas = [fila("2026-11-03", { seguidores: 990 }), fila("2026-10-20", { seguidores: 900 })];
    expect(resumirPeriodo(filas, "2026-11-04", 7).metricas.seguidores).toEqual({ actual: 990, anterior: 900, variacion: 10, cambio: 90 });
  });

  it("serie con huecos y último día", () => {
    const filas = [fila("2026-11-04", { alcance: 5 }), fila("2026-11-02", { seguidores: 7 })];
    expect(serieDiaria(filas, "2026-11-04", 3)).toEqual([
      { fecha: "2026-11-02", alcance: null, seguidores: 7, visualizaciones: null, interacciones: null },
      { fecha: "2026-11-03", alcance: null, seguidores: null, visualizaciones: null, interacciones: null },
      { fecha: "2026-11-04", alcance: 5, seguidores: null, visualizaciones: null, interacciones: null },
    ]);
    expect(ultimoDia(filas)).toBe("2026-11-04");
    expect(ultimoDia([])).toBeNull();
  });
});
