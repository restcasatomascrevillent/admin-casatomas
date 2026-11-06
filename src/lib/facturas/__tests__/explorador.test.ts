import { describe, expect, it } from "vitest";
import {
  accionDePunto,
  ajustarConfig,
  aplicarPreset,
  claveConfig,
  colorSerie,
  CONFIG_POR_DEFECTO,
  csvExploracion,
  cuentaPorLineas,
  datosGrafica,
  elegirGrafica,
  ErrorExplorador,
  etiquetasClave,
  FILTROS_VACIOS,
  fijarExploracion,
  formatoEje,
  formatoValor,
  graficaEfectiva,
  motivoMedidaNoDisponible,
  normalizarConfig,
  normalizarExploracion,
  normalizarExploracionesFijadas,
  parametrosExplorar,
  PRESETS,
  rangoDeClave,
  resumenExploracion,
  tituloConfig,
  type ConfigExplorador,
} from "../explorador";

const cfg = (c: Partial<ConfigExplorador> = {}): ConfigExplorador => ({ ...CONFIG_POR_DEFECTO, desglose: null, ...c, filtros: { ...FILTROS_VACIOS, ...(c.filtros ?? {}) } });

const RESPUESTA = {
  parametros: { desde: "2026-01-01", hasta: "2026-12-31", hasta_efectivo: "2026-11-05", medida: "gasto", agrupar: "mes", desglose: "local", por_lineas: false, solo_productos: false, unidad: null },
  sin_datos: false,
  total: { valor: "3150.00", documentos: 10, lineas: null, variacion_pct: 12.5 },
  anterior: { desde: "2025-01-01", hasta: "2025-11-05", valor: 2800, documentos: 9 },
  unidades: null,
  series: [
    { clave: "casa_tomas", etiqueta: "Casa Tomás", id: null, valor: 2850 },
    { clave: "touza", etiqueta: "Touza", id: null, valor: 300 },
  ],
  puntos: [
    { clave: "2026-01", etiqueta: "2026-01", id: null, valor: 1500, documentos: 4, desglose: { casa_tomas: 1500 } },
    { clave: "2026-02", etiqueta: "2026-02", id: null, valor: 600, documentos: 3, desglose: { casa_tomas: 300, touza: 300 } },
    { clave: "2026-03", etiqueta: "2026-03", id: null, valor: 1050, documentos: 3, desglose: { casa_tomas: 1050 } },
  ],
  resto: null,
};

describe("parámetros → consulta", () => {
  it("manda medida, eje, desglose, top y solo los filtros que hay (con el local de la barra)", () => {
    const c = cfg({
      medida: "base",
      agrupar: "proveedor",
      desglose: "familia",
      top: 15,
      filtros: { ...FILTROS_VACIOS, proveedores: [{ id: 7, nombre: "Flope" }], familias: [{ id: 0, nombre: "Sin clasificar" }], tipos: ["factura"] },
    });
    expect(parametrosExplorar(c, { desde: "2026-03-01", hasta: "2026-03-31" }, "touza")).toEqual({
      p_desde: "2026-03-01",
      p_hasta: "2026-03-31",
      p_medida: "base",
      p_agrupar: "proveedor",
      p_desglose: "familia",
      p_filtros: { proveedores: [7], familias: [0], tipos: ["factura"], local: "touza" },
      p_top: 15,
    });
    expect(parametrosExplorar(cfg(), { desde: null, hasta: null }, null).p_filtros).toEqual({});
  });

  it("gasto y abonos van por documento: con familia o producto pasa a base (con aviso)", () => {
    const r = ajustarConfig(cfg({ medida: "gasto", agrupar: "familia" }));
    expect(r.config.medida).toBe("base");
    expect(r.aviso).toMatch(/base sin IVA/);
    expect(ajustarConfig(cfg({ medida: "abonos", agrupar: "mes", filtros: { ...FILTROS_VACIOS, productos: ["gamba"] } })).config.medida).toBe("base");
    expect(ajustarConfig(cfg({ medida: "gasto", agrupar: "proveedor" })).aviso).toBeNull();
    expect(cuentaPorLineas(cfg({ medida: "documentos", agrupar: "mes", desglose: "familia" }))).toBe(true);
    expect(cuentaPorLineas(cfg({ medida: "documentos", agrupar: "mes" }))).toBe(false);
  });

  it("cantidad y precio piden un producto; desglose = eje se quita; top entre 1 y 50", () => {
    expect(ajustarConfig(cfg({ medida: "precio" })).config.medida).toBe("gasto");
    expect(motivoMedidaNoDisponible("precio", cfg())).toMatch(/producto/);
    expect(motivoMedidaNoDisponible("precio", cfg({ filtros: { ...FILTROS_VACIOS, productos: ["gamba"] } }))).toBeNull();
    expect(motivoMedidaNoDisponible("gasto", cfg({ agrupar: "familia" }))).toMatch(/base/);
    expect(ajustarConfig(cfg({ agrupar: "local", desglose: "local" })).config.desglose).toBeNull();
    expect(ajustarConfig(cfg({ top: 400 })).config.top).toBe(50);
    expect(ajustarConfig(cfg({ grafica: "apiladas", desglose: null })).config.grafica).toBe("auto");
  });
});

describe("elección automática de gráfica", () => {
  it("tiempo: días y semanas en área/línea, meses en barras (apiladas con color); precio en línea", () => {
    expect(elegirGrafica({ medida: "gasto", agrupar: "dia", desglose: null })).toBe("area");
    expect(elegirGrafica({ medida: "gasto", agrupar: "semana", desglose: "local" })).toBe("lineas");
    expect(elegirGrafica({ medida: "gasto", agrupar: "mes", desglose: null })).toBe("barras");
    expect(elegirGrafica({ medida: "gasto", agrupar: "trimestre", desglose: "tipo" })).toBe("apiladas");
    expect(elegirGrafica({ medida: "precio", agrupar: "mes", desglose: "proveedor" })).toBe("lineas");
  });
  it("categorías: ranking horizontal; lo elegido a mano manda (salvo apiladas sin color)", () => {
    expect(elegirGrafica({ medida: "gasto", agrupar: "proveedor", desglose: null })).toBe("horizontales");
    expect(graficaEfectiva(cfg({ agrupar: "proveedor", grafica: "tabla" }))).toBe("tabla");
    expect(graficaEfectiva(cfg({ agrupar: "mes", grafica: "apiladas", desglose: null }))).toBe("barras");
  });
});

describe("lectura del JSON", () => {
  it("convierte números en texto, desgloses y anterior", () => {
    const ex = normalizarExploracion(RESPUESTA);
    expect(ex.total).toEqual({ valor: 3150, documentos: 10, lineas: null, variacionPct: 12.5, variacionAviso: null });
    expect(ex.parametros.desglose).toBe("local");
    expect(ex.puntos[1].desglose).toEqual({ casa_tomas: 300, touza: 300 });
    expect(ex.anterior?.valor).toBe(2800);
  });
  it("un {error} de la RPC se convierte en error", () => {
    expect(() => normalizarExploracion({ error: "medida debe ser…" })).toThrow(ErrorExplorador);
  });
  it("datos para la gráfica: una columna por serie, colores fijos por local", () => {
    const { filas, series } = datosGrafica(normalizarExploracion(RESPUESTA));
    expect(series.map((s) => [s.etiqueta, s.color])).toEqual([
      ["Casa Tomás", "#0369a1"],
      ["Touza", "#ea580c"],
    ]);
    expect(filas[1]).toMatchObject({ clave: "2026-02", corta: "feb", s_0: 300, s_1: 300, valor: 600 });
    // Tramo sin compras de Touza: 0 (no hueco), para que su línea se vea (QA 05/11/2026).
    expect(filas[0].s_1).toBe(0);
  });
  it("el precio medio NO se rellena con 0 (un mes sin compras no tiene precio)", () => {
    const ex = normalizarExploracion({ ...RESPUESTA, parametros: { ...RESPUESTA.parametros, medida: "precio", desglose: "local" } });
    expect(datosGrafica(ex).filas[0].s_1).toBeNull();
  });
  it("«Sin clasificar» se aparta del eje de familias si se pide", () => {
    const ex = normalizarExploracion({
      ...RESPUESTA,
      parametros: { ...RESPUESTA.parametros, agrupar: "familia", desglose: null, medida: "base" },
      series: [],
      puntos: [
        { clave: "0", etiqueta: "Sin clasificar", id: null, valor: 1000, documentos: 10 },
        { clave: "2", etiqueta: "Pescado y marisco", id: 2, valor: 80, documentos: 3 },
      ],
    });
    const r = datosGrafica(ex, { apartarSinClasificar: true });
    expect(r.filas.map((f) => f.clave)).toEqual(["2"]);
    expect(r.apartado?.valor).toBe(1000);
  });
  it("resumen textual para lectores de pantalla", () => {
    expect(resumenExploracion(normalizarExploracion(RESPUESTA))).toMatch(/^Total 3\.150,00\s€, \+12,5 % frente al periodo anterior\. El tramo más alto: enero 2026, 1\.500,00\s€\.$/i);
  });
});

describe("formatos es-ES", () => {
  it("cifras y marcas de eje", () => {
    expect(formatoValor(1234.5, "gasto")).toBe("1.234,50 €");
    expect(formatoValor(-12, "abonos")).toBe("−12,00 €");
    // La RPC da los abonos en positivo: salen con «−» igual (el mismo signo en todo Análisis).
    expect(formatoValor(12, "abonos")).toMatch(/^−12,00\s€$/);
    expect(formatoValor(1860, "documentos")).toBe("1.860");
    expect(formatoValor(2.33333, "precio", "kg")).toBe("2,3333 €/kg");
    expect(formatoValor(24.5, "cantidad", "kg")).toBe("24,5 kg");
    expect(formatoValor(null, "gasto")).toBe("—");
    expect(formatoEje(120000, "gasto")).toBe("120 k €");
    expect(formatoEje(1_250_000, "gasto")).toBe("1,3 M €");
    expect(formatoEje(850, "gasto")).toBe("850 €");
    expect(formatoEje(3.5, "precio", "kg")).toBe("3,5 €/kg");
  });
  it("etiquetas de tiempo y rangos de una clave", () => {
    expect(etiquetasClave("dia", "2026-03-05", "")).toEqual({ corta: "5 mar", larga: "5 de marzo de 2026" });
    expect(etiquetasClave("trimestre", "2026-T2", "").larga).toBe("2.º trimestre de 2026");
    expect(etiquetasClave("proveedor", "7", "DISTRIBUCIONES DE BEBIDAS CATRAL, S.L.").corta).toBe("Distribuciones de Bebidas Catral");
    expect(rangoDeClave("mes", "2026-02")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(rangoDeClave("trimestre", "2026-T4")).toEqual({ desde: "2026-10-01", hasta: "2026-12-31" });
    expect(rangoDeClave("semana", "2026-12-28")).toEqual({ desde: "2026-12-28", hasta: "2027-01-03" });
    expect(rangoDeClave("proveedor", "7")).toBeNull();
    // La semana del borde se recorta al periodo de la gráfica.
    expect(rangoDeClave("semana", "2025-12-29", { desde: "2026-01-01", hasta: "2026-12-31" })).toEqual({ desde: "2026-01-01", hasta: "2026-01-04" });
    expect(rangoDeClave("semana", "2026-12-28", { desde: "2026-01-01", hasta: "2026-12-31" })).toEqual({ desde: "2026-12-28", hasta: "2026-12-31" });
    expect(rangoDeClave("semana", "2026-03-02", { desde: null, hasta: null })).toEqual({ desde: "2026-03-02", hasta: "2026-03-08" });
    expect(accionDePunto(cfg({ agrupar: "semana" }), { clave: "2025-12-29", etiqueta: "", id: null }, { desde: "2026-01-01", hasta: "2026-12-31" })).toMatchObject({
      tipo: "tramo",
      desde: "2026-01-01",
      hasta: "2026-01-04",
    });
  });
  it("color: el mismo proveedor, el mismo color en la gráfica; «Otros» gris; familia por id", () => {
    expect(colorSerie("proveedor", "7", 2)).toBe(colorSerie("proveedor", "9", 2));
    expect(colorSerie("proveedor", "__otros__", 3)).toBe("#64748b");
    expect(colorSerie("familia", "2", 0)).toBe(colorSerie("familia", "2", 5));
    expect(colorSerie("tipo", "abono", 0)).toBe("#e11d48");
  });
});

describe("tocar un punto", () => {
  it("en el tiempo: ver solo ese tramo y bajar un nivel el eje", () => {
    expect(accionDePunto(cfg({ agrupar: "mes" }), { clave: "2026-03", etiqueta: "", id: null })).toEqual({
      tipo: "tramo",
      desde: "2026-03-01",
      hasta: "2026-03-31",
      eje: "dia",
    });
    expect(accionDePunto(cfg({ agrupar: "trimestre" }), { clave: "2026-T1", etiqueta: "", id: null })).toMatchObject({ eje: "mes" });
  });
  it("proveedor, familia, producto y tipo se añaden como filtro; local cambia el local; «Otros» no", () => {
    const a = accionDePunto(cfg({ agrupar: "proveedor" }), { clave: "298", etiqueta: "EMBAJADORES MADRID", id: 298 });
    expect(a).toMatchObject({ tipo: "filtro" });
    if (a?.tipo === "filtro") expect(a.filtros.proveedores).toEqual([{ id: 298, nombre: "Embajadores Madrid" }]);
    const f = accionDePunto(cfg({ agrupar: "familia", medida: "base" }), { clave: "0", etiqueta: "Sin clasificar", id: null });
    if (f?.tipo === "filtro") expect(f.filtros.familias).toEqual([{ id: 0, nombre: "Sin clasificar" }]);
    const p = accionDePunto(cfg({ agrupar: "producto", medida: "base" }), { clave: "gamba roja", etiqueta: "Gamba roja", id: null });
    if (p?.tipo === "filtro") expect(p.filtros.productos).toEqual(["gamba roja"]);
    expect(accionDePunto(cfg({ agrupar: "local" }), { clave: "touza", etiqueta: "Touza", id: null })).toEqual({ tipo: "local", local: "touza" });
    expect(accionDePunto(cfg({ agrupar: "proveedor" }), { clave: "__otros__", etiqueta: "Otros", id: null })).toBeNull();
    expect(
      accionDePunto(cfg({ agrupar: "proveedor", filtros: { ...FILTROS_VACIOS, proveedores: [{ id: 298, nombre: "x" }] } }), { clave: "298", etiqueta: "x", id: 298 }),
    ).toBeNull();
  });
});

describe("presets, fijados y CSV", () => {
  it("presets de un toque", () => {
    const precio = PRESETS.find((p) => p.id === "precio-producto");
    expect(precio?.pideProducto).toBe(true);
    const top = aplicarPreset(cfg({ filtros: { ...FILTROS_VACIOS, productos: ["gamba"] } }), PRESETS.find((p) => p.id === "top-proveedores")!);
    expect(top).toMatchObject({ medida: "gasto", agrupar: "proveedor", desglose: null });
    expect(top.filtros.productos).toEqual([]);
    const fam = aplicarPreset(cfg(), PRESETS.find((p) => p.id === "familias")!);
    expect(fam).toMatchObject({ medida: "base", agrupar: "familia" });
  });
  it("fijar guarda la configuración, sin repetir; lo guardado se lee sin fiarse", () => {
    const c = cfg({ agrupar: "proveedor", filtros: { ...FILTROS_VACIOS, tipos: ["abono"] } });
    const una = fijarExploracion([], c, new Date("2026-11-05T10:00:00Z"));
    expect(una).toHaveLength(1);
    expect(una[0].titulo).toBe("Gasto con IVA por proveedor · Abono");
    expect(fijarExploracion(una, c)).toBe(una);
    expect(claveConfig(c)).not.toBe(claveConfig({ ...c, top: 5 }));
    const leidas = normalizarExploracionesFijadas([...JSON.parse(JSON.stringify(una)), { id: "x", config: { medida: "hackeo" } }, "basura", una[0]]);
    expect(leidas).toHaveLength(1);
    expect(leidas[0].config).toEqual(c);
    expect(normalizarConfig({ medida: "gasto", agrupar: "familia" })?.medida).toBe("base");
    expect(normalizarConfig({ medida: "gasto", agrupar: "mes", filtros: { proveedores: [{ id: -1, nombre: "x" }, { id: 3, nombre: "y" }] } })?.filtros.proveedores).toEqual([
      { id: 3, nombre: "y" },
    ]);
  });
  it("CSV para Excel en español: BOM, «;», coma decimal y total", () => {
    const csv = csvExploracion(normalizarExploracion(RESPUESTA), "Gasto con IVA por mes");
    const lineas = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lineas[1]).toBe("Mes;Casa Tomás;Touza;Gasto con IVA;Documentos");
    expect(lineas[3]).toBe("Febrero 2026;300;300;600;3");
    expect(lineas.at(-1)).toBe("Total;2850;300;3150;10");
  });
  it("CSV: un texto que empieza por = + - @ no se ejecuta como fórmula en Excel", () => {
    const ex = normalizarExploracion({
      ...RESPUESTA,
      parametros: { ...RESPUESTA.parametros, agrupar: "proveedor", desglose: null },
      series: [],
      puntos: [
        { clave: "1", etiqueta: '=HYPERLINK("http://x";"y")', id: 1, valor: 10, documentos: 1 },
        { clave: "2", etiqueta: "+34 Pescados", id: 2, valor: 5, documentos: 1 },
        { clave: "3", etiqueta: "@SUM(A1)", id: 3, valor: 5, documentos: 1 },
        { clave: "4", etiqueta: "-1+1", id: 4, valor: 5, documentos: 1 },
      ],
    });
    const lineas = csvExploracion(ex, "t").replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lineas[2]).toBe(`"'=HYPERLINK(""http://x"";""y"")";10;1`);
    expect(lineas[3]).toBe("'+34 Pescados;5;1");
    expect(lineas[4]).toBe("'@SUM(A1);5;1");
    expect(lineas[5]).toBe("'-1+1;5;1");
  });
  it("CSV de abonos: con «−», como en el resto de Análisis", () => {
    const ex = normalizarExploracion({ ...RESPUESTA, parametros: { ...RESPUESTA.parametros, medida: "abonos", desglose: null }, series: [] });
    expect(csvExploracion(ex, "t").trim().split("\r\n").at(-1)).toBe("Total;-3150;10");
  });
  it("título de la configuración", () => {
    expect(tituloConfig({ medida: "precio", agrupar: "mes", desglose: "proveedor" })).toBe("Precio medio sin IVA por mes, por proveedor");
  });
});
