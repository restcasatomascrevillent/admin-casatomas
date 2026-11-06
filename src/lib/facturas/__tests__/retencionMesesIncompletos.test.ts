/**
 * Retención de IRPF (20261106300000) y meses incompletos (20261106310000) en
 * la lectura de las RPC del panel: documentos_lista, tablero_compras y
 * explorar_compras. Solo se AÑADIERON campos: sin ellos todo sigue igual.
 */
import { describe, expect, it } from "vitest";
import { decodificarLista, decodificarMesesIncompletos } from "../listaCompras";
import { normalizarTablero, textoMesesIncompletos } from "../tableroCompras";
import { ajustarConfig, datosGrafica, FILTROS_VACIOS, MEDIDAS, motivoMedidaNoDisponible, normalizarExploracion, type ConfigExplorador } from "../explorador";
import { etiquetaRetencion, notaRetencionGasto } from "../retencion";

const fila = (id: number, extra: unknown[] = []) => [
  id, "factura", `F-${id}`, "SALVADOR MAS MAS", 3, "B1", "2026-10-01", null, null, 1100, 1122,
  "leido", null, null, true, "auto", 1, null, null, false, ...extra,
];

describe("documentos_lista: retención y meses incompletos", () => {
  it("docs[i][20] es la retención; sin ese elemento (lista vieja) o 0, null", () => {
    const [con, sin, cero] = decodificarLista({ v: 1, proveedores: {}, docs: [fila(1, ["209.00"]), fila(2), fila(3, [0])] });
    expect(con.retencion_irpf).toBe(209);
    expect(sin.retencion_irpf).toBeNull();
    expect(cero.retencion_irpf).toBeNull();
  });

  it("meses_incompletos: objetos con mes o textos; lo que no sea AAAA-MM se ignora; sin el campo, vacío", () => {
    expect([...decodificarMesesIncompletos({ meses_incompletos: [{ mes: "2026-10", documentos: 65 }, "2026-11", { mes: "oct" }, null] })]).toEqual(["2026-10", "2026-11"]);
    expect(decodificarMesesIncompletos({ v: 1, docs: [] }).size).toBe(0);
    expect(decodificarMesesIncompletos(null).size).toBe(0);
  });
});

describe("tablero_compras: retención y meses incompletos", () => {
  const crudo = {
    periodo: { desde: "2026-10-01", hasta: "2026-10-31", anterior: { desde: "2026-09-01", hasta: "2026-09-30" } },
    indicadores: {
      gasto: 30000, variacion_pct: -77.5, retencion_irpf: "601.43", retencion_irpf_documentos: 4,
      meses_incompletos: 1, meses_incompletos_anterior: 0,
      variacion_aviso: "La comparación incluye meses incompletos (10/2026): faltan facturas por subir y la variación no es fiable.",
    },
    meses: [{ mes: "2026-10", total: 30000, documentos: 65, incompleto: true }, { mes: "2026-09", total: 1, documentos: 188, incompleto: false }],
    meses_incompletos: [{ mes: "2026-10", documentos: 65, referencia: 195, motivo: "reciente" }, { mes: "x" }],
  };

  it("lee los campos nuevos", () => {
    const t = normalizarTablero(crudo);
    expect(t.indicadores).toMatchObject({ retencionIrpf: 601.43, retencionIrpfDocumentos: 4, mesesIncompletos: 1, mesesIncompletosAnterior: 0 });
    expect(t.indicadores.variacionAviso).toMatch(/no es fiable/);
    expect(t.meses.map((m) => m.incompleto)).toEqual([true, false]);
    expect(t.mesesIncompletos).toEqual(["2026-10"]);
  });

  it("sin los campos (migración sin aplicar): retención 0, sin meses incompletos ni aviso", () => {
    const t = normalizarTablero({ indicadores: { gasto: 5 }, meses: [{ mes: "2026-10", total: 5, documentos: 1 }] });
    expect(t.indicadores).toMatchObject({ retencionIrpf: 0, mesesIncompletos: 0, mesesIncompletosAnterior: null, variacionAviso: null });
    expect(t.meses[0].incompleto).toBe(false);
    expect(t.mesesIncompletos).toEqual([]);
  });

  it("texto de los meses incompletos", () => {
    expect(textoMesesIncompletos([])).toBeNull();
    expect(textoMesesIncompletos(["2026-10"])).toBe("Octubre 2026 está incompleto: faltan facturas por subir");
    expect(textoMesesIncompletos(["2026-10", "2026-11"])).toBe("2 meses incompletos (Octubre 2026, Noviembre 2026): faltan facturas por subir");
  });
});

describe("retención: textos", () => {
  it("nota bajo «Gasto con IVA»: lo retenido y el coste real (gasto + retención); sin retención, nada", () => {
    expect(notaRetencionGasto(1122, 209)).toMatch(/^incluye −209,00\s€ de IRPF retenido; coste real 1\.331,00\s€$/);
    expect(notaRetencionGasto(1000, 0)).toBeNull();
    expect(notaRetencionGasto(1000, null)).toBeNull();
  });

  it("etiqueta con el porcentaje en español", () => {
    expect(etiquetaRetencion(19)).toBe("Retención IRPF (−19 %)");
    expect(etiquetaRetencion(15.5)).toBe("Retención IRPF (−15,5 %)");
    expect(etiquetaRetencion(null)).toBe("Retención IRPF");
  });
});

describe("explorar_compras: medida retención IRPF y meses incompletos", () => {
  const config = (c: Partial<ConfigExplorador>): ConfigExplorador =>
    ({ medida: "gasto", agrupar: "mes", desglose: null, grafica: "auto", top: 10, filtros: FILTROS_VACIOS, ...c }) as ConfigExplorador;

  it("«Retención IRPF» es una medida por documento: con familias no se puede y pasa a la base", () => {
    expect(MEDIDAS.some((m) => m.valor === "retencion_irpf" && !m.porLineas && m.formato === "eur")).toBe(true);
    expect(motivoMedidaNoDisponible("retencion_irpf", config({}))).toBeNull();
    expect(motivoMedidaNoDisponible("retencion_irpf", config({ agrupar: "familia" }))).toMatch(/base sin IVA/);
    expect(ajustarConfig(config({ medida: "retencion_irpf", agrupar: "familia" })).config.medida).toBe("base");
  });

  it("puntos incompletos, meses_incompletos y aviso de la variación; la gráfica los marca", () => {
    const ex = normalizarExploracion({
      parametros: { medida: "retencion_irpf", agrupar: "mes" },
      total: { valor: 601.43, documentos: 4, variacion_pct: -20, variacion_aviso: "La comparación incluye meses incompletos (10/2026)" },
      meses_incompletos: ["2026-10", "mal"],
      puntos: [
        { clave: "2026-09", valor: 600, documentos: 4, incompleto: false },
        { clave: "2026-10", valor: 601.43, documentos: 4, incompleto: true },
      ],
    });
    expect(ex.parametros.medida).toBe("retencion_irpf");
    expect(ex.total.variacionAviso).toMatch(/incompletos/);
    expect(ex.mesesIncompletos).toEqual(["2026-10"]);
    expect(ex.puntos.map((p) => p.incompleto === true)).toEqual([false, true]);
    expect(datosGrafica(ex).filas.map((f) => f.incompleto === true)).toEqual([false, true]);
  });

  it("sin los campos nuevos: nada incompleto ni aviso", () => {
    const ex = normalizarExploracion({ parametros: { medida: "gasto", agrupar: "mes" }, total: {}, puntos: [{ clave: "2026-10", valor: 1, documentos: 1 }] });
    expect(ex.total.variacionAviso).toBeNull();
    expect(ex.mesesIncompletos).toEqual([]);
    expect(ex.puntos[0].incompleto).toBeUndefined();
  });
});
