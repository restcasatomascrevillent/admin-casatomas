// «Al instante» bajo la gráfica de Explorar (06/11/2026): las consultas usan el
// periodo de arriba cuando la RPC lo admite y sus datos se pintan con la misma
// gráfica que el explorador.
import { describe, expect, it, vi } from "vitest";
import {
  CHIPS_AL_INSTANTE,
  consultarAlInstante,
  exploracionCategorias,
  exploracionGastoPorMes,
  exploracionTopProveedores,
  gastoDeResumen,
  mesesEntre,
  rangosGastoMes,
  textoAyudaChip,
  type LlamarRpc,
} from "../alInstante";
import { destinoVolver, enlacePantallaCompleta, esClicDeNuevaPestana, esRutaIaCompleta } from "../copilotoCompleto";

const HOY = new Date(2026, 10, 6, 12);
const ANIO = { desde: "2026-01-01", hasta: "2026-12-31" };

function doble(respuestas: Record<string, unknown> = {}) {
  const llamadas: { fn: string; args: Record<string, unknown> }[] = [];
  const llamar: LlamarRpc = vi.fn(async (fn, args) => {
    llamadas.push({ fn, args });
    return respuestas[fn] ?? { filas: [], total_filas: 0, truncado: false };
  });
  return { llamar, llamadas };
}

describe("catálogo", () => {
  it("los diez chips que pidió el dueño, en su orden, con su explicación", () => {
    expect(CHIPS_AL_INSTANTE.map((c) => c.etiqueta)).toEqual([
      "Gasto este mes",
      "Gasto por mes",
      "Top proveedores",
      "Productos más comprados",
      "Por revisar",
      "Con avisos",
      "Sin total",
      "Gasto por categoría",
      "Qué ha subido de precio",
      "Evolución de precio",
    ]);
    const conAvisos = CHIPS_AL_INSTANTE.find((c) => c.id === "con-avisos")!;
    expect(textoAyudaChip(conAvisos)).toBe("Con avisos: Documentos con avisos de lectura o de importes");
    expect(CHIPS_AL_INSTANTE.every((c) => c.descripcion.length > 10 && c.rpc.endsWith("_agente"))).toBe(true);
  });
});

describe("consultas: periodo de arriba", () => {
  it("Top proveedores: gasto por proveedor del periodo (facturas y albaranes sin factura)", async () => {
    const { llamar, llamadas } = doble();
    await consultarAlInstante("top-proveedores", llamar, { ...ANIO, hoy: HOY });
    expect(llamadas).toEqual([
      { fn: "ranking_agente", args: { p_criterio: "gasto_proveedor", p_tipo: null, p_limite: 10, p_desde: "2026-01-01", p_hasta: "2026-12-31", p_orden: "desc" } },
    ]);
  });

  it("Gasto por mes: con fechas, el resumen del periodo; con todo el histórico, las estadísticas globales", async () => {
    const a = doble({ resumen_periodo_agente: { meses: [{ mes: "2026-01", facturas: 3, gasto: 100 }] } });
    const r = await consultarAlInstante("gasto-por-mes", a.llamar, { ...ANIO, hoy: HOY });
    expect(a.llamadas).toEqual([{ fn: "resumen_periodo_agente", args: { p_desde: "2026-01-01", p_hasta: "2026-12-31" } }]);
    expect(r).toMatchObject({ id: "gasto-por-mes", meses: [{ mes: "2026-01" }] });

    const b = doble({ estadisticas_globales_agente: { meses: [{ mes: "2025-12", facturas: 1, gasto: 5 }], meses_truncado: true } });
    const t = await consultarAlInstante("gasto-por-mes", b.llamar, { desde: null, hasta: null, hoy: HOY });
    expect(b.llamadas.map((l) => l.fn)).toEqual(["estadisticas_globales_agente"]);
    expect(t).toMatchObject({ truncado: true, desde: null });
  });

  it("Gasto por mes de un solo mes: el resumen no trae meses y se hace uno con el gasto del panel", async () => {
    const { llamar } = doble({ resumen_periodo_agente: { gasto_total: { importe: 834.9, documentos: 1 }, facturas: { n: 1, gasto: 834.9 }, albaranes: { n: 0, valor: 0 } } });
    const r = await consultarAlInstante("gasto-por-mes", llamar, { desde: "2026-11-01", hasta: "2026-11-30", hoy: HOY });
    expect(r).toMatchObject({ meses: [{ mes: "2026-11", gasto: 834.9, facturas: 1 }] });
  });

  it("Gasto este mes: el mes en curso y el anterior, sea cual sea el periodo de arriba", async () => {
    const { llamar, llamadas } = doble({ resumen_periodo_agente: { facturas: { n: 0, gasto: 0 } } });
    await consultarAlInstante("gasto-mes", llamar, { ...ANIO, hoy: HOY });
    expect(llamadas.map((l) => l.args)).toEqual([
      { p_desde: "2026-11-01", p_hasta: "2026-11-30" },
      { p_desde: "2026-10-01", p_hasta: "2026-10-31" },
    ]);
    expect(rangosGastoMes(new Date(2026, 0, 15)).anterior).toMatchObject({ mes: "2025-12", desde: "2025-12-01", hasta: "2025-12-31" });
  });

  it("Por revisar, Con avisos y Sin total: su filtro, el periodo y los 50 más recientes", async () => {
    const { llamar, llamadas } = doble();
    for (const id of ["por-revisar", "con-avisos", "sin-total"] as const) await consultarAlInstante(id, llamar, { ...ANIO, hoy: HOY });
    expect(llamadas.map((l) => l.args.p_filtro)).toEqual(["sin_verificar", "con_alertas", "sin_total"]);
    expect(llamadas[0].args).toMatchObject({ p_desde: "2026-01-01", p_hasta: "2026-12-31", p_orden: "fecha_desc", p_limite: 50 });
  });

  it("Productos más comprados: un ranking por unidad (kilos con kilos), sin servicios", async () => {
    const { llamar, llamadas } = doble();
    const r = await consultarAlInstante("productos-mas-comprados", llamar, { ...ANIO, hoy: HOY });
    expect(llamadas.map((l) => l.args.p_unidad)).toEqual(["kg", "l", "ud"]);
    expect(llamadas.every((l) => l.args.p_criterio === "cantidad" && l.args.p_incluir_servicios === false && l.args.p_desde === "2026-01-01")).toBe(true);
    expect(r).toMatchObject({ grupos: [{ titulo: "En kilos" }, { titulo: "En litros" }, { titulo: "En unidades" }] });
  });

  it("Categoría, subidas y evolución de precio llevan el periodo; las subidas, el umbral configurado", async () => {
    const { llamar, llamadas } = doble({ variacion_precios_agente: { productos: [] }, gasto_categorias_agente: {}, serie_precios_agente: { sin_datos: true } });
    await consultarAlInstante("gasto-categoria", llamar, { ...ANIO, hoy: HOY });
    await consultarAlInstante("subidas-precio", llamar, { ...ANIO, hoy: HOY, umbralSubidaPrecio: async () => 15 });
    await consultarAlInstante("evolucion-precio", llamar, { ...ANIO, hoy: HOY, producto: { producto: " Merluza ", unidad: "kg" } });
    expect(llamadas[0].args).toMatchObject({ p_desde: "2026-01-01", p_hasta: "2026-12-31" });
    expect(llamadas[1].args).toMatchObject({ p_desde: "2026-01-01", p_umbral_pct: 15, p_sentido: "subidas" });
    expect(llamadas[2]).toEqual({ fn: "serie_precios_agente", args: { p_texto: "Merluza", p_desde: "2026-01-01", p_hasta: "2026-12-31", p_unidad: "kg" } });
  });

  it("Evolución de precio sin producto no consulta; un `{error}` de la RPC es un error", async () => {
    const a = doble();
    await expect(consultarAlInstante("evolucion-precio", a.llamar, { ...ANIO, hoy: HOY })).rejects.toThrow("Elige un producto.");
    expect(a.llamadas).toEqual([]);
    const b = doble({ ranking_agente: { error: "Criterio no válido" } });
    await expect(consultarAlInstante("top-proveedores", b.llamar, { ...ANIO, hoy: HOY })).rejects.toThrow("Criterio no válido");
  });
});

describe("a la gráfica del explorador", () => {
  it("Gasto por mes: los meses sin documentos a 0, hasta el mes en curso (nada de meses futuros)", () => {
    const ex = exploracionGastoPorMes(
      { id: "gasto-por-mes", desde: "2026-01-01", hasta: "2026-12-31", truncado: false, meses: [{ mes: "2026-01", facturas: 2, gasto: 100, albaranes: 1 }, { mes: "2026-03", facturas: 1, gasto: 50 }] },
      HOY,
    );
    expect(ex.puntos.map((p) => p.clave)).toEqual(mesesEntre("2026-01", "2026-11"));
    expect(ex.puntos.slice(0, 3).map((p) => [p.valor, p.documentos])).toEqual([[100, 3], [0, 0], [50, 1]]);
    expect(ex.total).toMatchObject({ valor: 150, documentos: 4 });
    expect(ex.parametros).toMatchObject({ medida: "gasto", agrupar: "mes" });
  });

  it("Top proveedores y categorías: barras por entidad (categorías en base sin IVA, de más a menos)", () => {
    const top = exploracionTopProveedores({ filas: [{ proveedor: "EMBAJADORES", documentos: 9, importe: 101519.68 }], total_filas: 1, truncado: false }, null, null);
    expect(top.puntos[0]).toMatchObject({ etiqueta: "EMBAJADORES", valor: 101519.68, documentos: 9 });
    const cat = exploracionCategorias({ categorias: [{ categoria: "Bebidas", importe: 10, lineas: 2 }, { categoria: "Pescado", importe: 30, lineas: 5 }] }, null, null);
    expect(cat.parametros.medida).toBe("base");
    expect(cat.puntos.map((p) => p.etiqueta)).toEqual(["Pescado", "Bebidas"]);
  });

  it("el gasto de un resumen es el del panel (gasto_total) o, si la RPC es anterior, facturas + albaranes", () => {
    expect(gastoDeResumen({ gasto_total: { importe: 30 }, facturas: { n: 1, gasto: 20 } })).toBe(30);
    expect(gastoDeResumen({ facturas: { n: 1, gasto: 20 }, albaranes: { n: 1, valor: 5 } })).toBe(25);
  });
});

describe("pantalla completa del copiloto: enlaces", () => {
  it("ruta propia con la conversación y vuelta a la URL de Análisis de antes", () => {
    expect(enlacePantallaCompleta("c-1")).toBe("/facturas/ia?c=c-1");
    expect(enlacePantallaCompleta(null)).toBe("/facturas/ia");
    expect(esRutaIaCompleta("/facturas/ia/")).toBe(true);
    expect(esRutaIaCompleta("/facturas")).toBe(false);
    expect(destinoVolver({ volverA: "/facturas?tab=chat&local=touza" })).toBe("/facturas?tab=chat&local=touza");
    expect(destinoVolver({ volverA: "https://otra.web" })).toBe("/facturas?tab=chat");
    expect(destinoVolver(null)).toBe("/facturas?tab=chat");
  });

  it("ctrl/cmd, mayúsculas o la rueda: al navegador (otra pestaña)", () => {
    const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    expect(esClicDeNuevaPestana(base)).toBe(false);
    expect(esClicDeNuevaPestana({ ...base, ctrlKey: true })).toBe(true);
    expect(esClicDeNuevaPestana({ ...base, metaKey: true })).toBe(true);
    expect(esClicDeNuevaPestana({ ...base, button: 1 })).toBe(true);
  });
});
