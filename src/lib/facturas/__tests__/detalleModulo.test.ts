// Detalle en grande de un módulo (06/11/2026): qué se pide a la RPC, filas,
// buscador, rango de importe, orden y CSV.
import { describe, expect, it } from "vitest";
import { normalizarExploracion } from "../explorador";
import {
  consultaExplorar,
  csvDetalle,
  filasDeExploracion,
  filasDeFijos,
  filasDeSubidas,
  filtrarFilas,
  leerImporte,
  nombreCsv,
  ordenarFilas,
  SPECS,
  sumaValor,
} from "../detalleModulo";

const ex = (o: Record<string, unknown>) =>
  normalizarExploracion({
    parametros: { desde: "2026-01-01", hasta: "2026-12-31", medida: "gasto", agrupar: "proveedor", desglose: null },
    sin_datos: false,
    total: { valor: 1000, documentos: 10 },
    series: [],
    puntos: [
      { clave: "1", etiqueta: "CAMIÓN DEL NORTE, S.L.", id: 1, valor: 600, documentos: 6 },
      { clave: "2", etiqueta: "Bodegas Ávila", id: 2, valor: 300, documentos: 3 },
      { clave: "3", etiqueta: "Zumos Zeta", id: 3, valor: 100, documentos: 1 },
    ],
    ...o,
  });

describe("consultaExplorar", () => {
  it("proveedores: gasto con IVA, o base sin IVA (con «Sin IVA» o con una familia)", () => {
    const base = { agrupar: "mes" as const, local: null };
    expect(consultaExplorar("proveedores", { ...base, iva: "con", familias: 0 })).toEqual({ medida: "gasto", agrupar: "proveedor", desglose: null, top: 50 });
    expect(consultaExplorar("proveedores", { ...base, iva: "sin", familias: 0 })?.medida).toBe("base");
    expect(consultaExplorar("proveedores", { ...base, iva: "con", familias: 1 })?.medida).toBe("base");
  });

  it("por mes: desglose por local salvo si se elige uno; Casa Tomás y Touza, siempre los dos", () => {
    expect(consultaExplorar("gasto_mes", { iva: "con", agrupar: "trimestre", local: null, familias: 0 })).toMatchObject({ agrupar: "trimestre", desglose: "local" });
    expect(consultaExplorar("gasto_mes", { iva: "con", agrupar: "mes", local: "touza", familias: 0 })?.desglose).toBeNull();
    expect(consultaExplorar("locales", { iva: "con", agrupar: "mes", local: "touza", familias: 0 })?.desglose).toBe("local");
    expect(SPECS.locales.local).toBe(false);
  });

  it("los del tablero y los documentos no van por explorar", () => {
    expect(consultaExplorar("subidas", { iva: "con", agrupar: "mes", local: null, familias: 0 })).toBeNull();
    expect(consultaExplorar("por_revisar", { iva: "con", agrupar: "mes", local: null, familias: 0 })).toBeNull();
  });
});

describe("filas", () => {
  it("de explorar: nombre corto, % del total y documentos; los abonos en negativo", () => {
    const { columnas, filas } = filasDeExploracion(ex({}), "Gasto con IVA");
    expect(columnas.map((c) => c.id)).toEqual(["nombre", "valor", "pct", "documentos"]);
    expect(filas[0]).toMatchObject({ nombre: "Camión del Norte", nombreLargo: "CAMIÓN DEL NORTE, S.L.", id: 1, valor: 600 });
    expect(filas[0].celdas.pct).toBe(60);
    const ab = filasDeExploracion(ex({ parametros: { medida: "abonos", agrupar: "proveedor" } }), "Abonado");
    expect(ab.filas[0].valor).toBe(-600);
  });

  it("de un eje de tiempo con desglose: una columna por serie y sin %", () => {
    const t = ex({
      parametros: { medida: "gasto", agrupar: "mes", desglose: "local" },
      series: [{ clave: "casa_tomas", etiqueta: "Casa Tomás", valor: 900 }, { clave: "touza", etiqueta: "Touza", valor: 100 }],
      puntos: [{ clave: "2026-07", etiqueta: "2026-07", valor: 1000, documentos: 5, desglose: { casa_tomas: 900, touza: 100 } }],
    });
    const { columnas, filas } = filasDeExploracion(t, "Gasto con IVA");
    expect(columnas.map((c) => c.etiqueta)).toEqual(["Mes", "Casa Tomás", "Touza", "Total", "Documentos"]);
    expect(filas[0]).toMatchObject({ nombre: "Julio 2026", celdas: { "s:touza": 100, valor: 1000 } });
  });

  it("de subidas y de gastos fijos", () => {
    const s = filasDeSubidas([
      { producto: "PAN", nombre_normalizado: "pan", unidad: "ud", proveedor_id: 7, proveedor: "HORNO, S.L.", precio_inicio: 1, precio_fin: 1.5, variacion_pct: 50, compras_inicio: 1, compras_fin: 1, importe: 300 },
    ]);
    expect(s.filas[0]).toMatchObject({ nombre: "PAN", id: 7, valor: 50, celdas: { proveedor: "Horno", importe: 300 } });
    const f = filasDeFijos([{ id: 9, nombre: "LUZ, S.A.", medio_mes: 400, meses: 9, meses_con_datos: 10, documentos: 9, desdeMedia: null, hastaMedia: null }]);
    expect(f.filas[0].celdas).toMatchObject({ nombre: "Luz", valor: 400, meses: "9 de 10" });
  });
});

describe("filtrar, ordenar y sumar", () => {
  const { filas } = filasDeExploracion(ex({}), "Gasto");

  it("el buscador no distingue tildes ni mayúsculas y pide todas las palabras", () => {
    expect(filtrarFilas(filas, { texto: "camion", min: null, max: null }).map((f) => f.id)).toEqual([1]);
    expect(filtrarFilas(filas, { texto: "AVILA bodegas", min: null, max: null }).map((f) => f.id)).toEqual([2]);
    expect(filtrarFilas(filas, { texto: "avila norte", min: null, max: null })).toEqual([]);
  });

  it("rango de importe (en valor absoluto: también para los abonos) y proveedores", () => {
    expect(filtrarFilas(filas, { texto: "", min: 200, max: 600 }).map((f) => f.id)).toEqual([1, 2]);
    const ab = filasDeExploracion(ex({ parametros: { medida: "abonos", agrupar: "proveedor" } }), "Abonado").filas;
    expect(filtrarFilas(ab, { texto: "", min: 250, max: null }).map((f) => f.id)).toEqual([1, 2]);
    expect(filtrarFilas(filas, { texto: "", min: null, max: null, proveedores: [3] }).map((f) => f.id)).toEqual([3]);
  });

  it("ordena por cualquier columna (texto en español, números) y suma lo que se ve", () => {
    expect(ordenarFilas(filas, "nombre", "asc").map((f) => f.nombre)).toEqual(["Bodegas Ávila", "Camión del Norte", "Zumos Zeta"]);
    expect(ordenarFilas(filas, "valor", "asc").map((f) => f.id)).toEqual([3, 2, 1]);
    expect(ordenarFilas(filas, "documentos", "desc").map((f) => f.id)).toEqual([1, 2, 3]);
    expect(sumaValor(filas)).toBe(1000);
  });

  it("lee importes escritos a la española", () => {
    expect(leerImporte("1.000")).toBe(1000);
    expect(leerImporte("1.234,50 €")).toBe(1234.5);
    expect(leerImporte("")).toBeNull();
    expect(leerImporte("abc")).toBeNull();
  });
});

describe("CSV", () => {
  it("con BOM, `;`, coma decimal, el nombre completo y sin fórmulas", () => {
    const { columnas, filas } = filasDeExploracion(
      ex({ puntos: [{ clave: "1", etiqueta: "=HYPERLINK(\"x\")", id: 1, valor: 1234.5, documentos: 2 }] }),
      "Gasto con IVA",
    );
    const csv = csvDetalle("Proveedores · 2026", columnas, filas);
    expect(csv.startsWith("﻿# Proveedores · 2026\r\n")).toBe(true);
    expect(csv).toContain("Proveedor;Gasto con IVA;% del total;Documentos\r\n");
    expect(csv).toContain(`"'=HYPERLINK(""x"")";1234,5;123,45;2`);
  });

  it("nombre del fichero", () => {
    expect(nombreCsv("Gasto por familia", "2026-01-01", "2026-12-31")).toBe("gasto-por-familia-2026-01-01-2026-12-31.csv");
    expect(nombreCsv("Casa Tomás y Touza", null, null)).toBe("casa-tomas-y-touza-historico.csv");
  });
});
