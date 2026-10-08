import { describe, expect, it } from "vitest";
import {
  esSerieSinDatos,
  filasGrafico,
  normalizarAdjuntos,
  normalizarSerie,
  proveedoresUsados,
  type SeriePrecio,
} from "../seriePrecio";
import { argsSeriePrecios } from "../preguntasRapidas";

const SERIE = {
  producto: "Merluza",
  unidad: "kg",
  proveedores: ["Flope", "Pescados Paco"],
  puntos: [
    ["2026-09-10", 11, 1],
    ["2026-08-01", 10.5, 0],
    ["2026-09-10", 12, 0],
  ],
  n: 3,
  min: 10.5,
  max: 12,
  ultimo: 12,
  variacion_pct: 14.3,
};

describe("normalizarSerie", () => {
  it("ordena los puntos por fecha y conserva el resumen de la RPC", () => {
    const s = normalizarSerie(SERIE) as SeriePrecio;
    expect(s.puntos.map((p) => p[0])).toEqual(["2026-08-01", "2026-09-10", "2026-09-10"]);
    expect(s).toMatchObject({ producto: "Merluza", unidad: "kg", n: 3, min: 10.5, max: 12, ultimo: 12, variacion_pct: 14.3 });
  });

  it("{sin_datos} pasa tal cual y lo no reconocible da null", () => {
    const sd = normalizarSerie({ sin_datos: true, buscado: "pulpo" });
    expect(sd && esSerieSinDatos(sd)).toBe(true);
    expect(normalizarSerie(null)).toBeNull();
    expect(normalizarSerie("hola")).toBeNull();
    expect(normalizarSerie({ producto: "x" })).toBeNull();
  });

  it("descarta puntos mal formados y, si no queda ninguno, es «sin datos»", () => {
    const s = normalizarSerie({ ...SERIE, puntos: [["ayer", 3, 0], ["2026-01-01", "x", 0], ["2026-01-02", 5, 0]] }) as SeriePrecio;
    expect(s.puntos).toEqual([["2026-01-02", 5, 0]]);
    const vacia = normalizarSerie({ ...SERIE, puntos: [["ayer", 3, 0]] });
    expect(vacia && esSerieSinDatos(vacia)).toBe(true);
  });

  it("calcula min/max/último si la RPC no los trae", () => {
    const s = normalizarSerie({ producto: "A", puntos: [["2026-01-01", 4, 0], ["2026-02-01", 2, 0]] }) as SeriePrecio;
    expect(s).toMatchObject({ min: 2, max: 4, ultimo: 2, n: 2, unidad: null, variacion_pct: null });
  });
});

describe("filasGrafico", () => {
  it("una fila por fecha y una columna por proveedor; la última compra del día manda", () => {
    const s = normalizarSerie(SERIE) as SeriePrecio;
    const filas = filasGrafico(s);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ fecha: "2026-08-01", p0: 10.5 });
    expect(filas[1]).toMatchObject({ fecha: "2026-09-10", p1: 11, p0: 12 });
    expect(filas[0].t).toBeLessThan(filas[1].t);
    expect(proveedoresUsados(s)).toEqual([0, 1]);
  });
});

describe("normalizarAdjuntos", () => {
  it("solo deja los serie_precio válidos", () => {
    const r = normalizarAdjuntos([
      { tipo: "serie_precio", datos: SERIE },
      { tipo: "otro", datos: {} },
      { tipo: "serie_precio", datos: 3 },
      null,
    ]);
    expect(r).toHaveLength(1);
    expect(normalizarAdjuntos(undefined)).toEqual([]);
    expect(normalizarAdjuntos({})).toEqual([]);
  });
});

describe("argsSeriePrecios", () => {
  it("manda toda la historia y la unidad vacía como null", () => {
    expect(argsSeriePrecios({ producto: " Merluza ", unidad: " " })).toEqual({
      p_texto: "Merluza",
      p_desde: null,
      p_hasta: null,
      p_unidad: null,
    });
    expect(argsSeriePrecios({ producto: "Merluza", unidad: "kg" }).p_unidad).toBe("kg");
  });
});
