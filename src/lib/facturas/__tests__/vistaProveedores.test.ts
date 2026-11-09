import { describe, expect, it } from "vitest";
import type { CambioPrecio, DecisionFacturas } from "../decision";
import type { Exploracion } from "../explorador";
import {
  avisosPorProveedor,
  concentracion,
  filasProveedores,
  filtrarProveedores,
  idsPorCompletar,
  textoDiferencia,
  ultimoMesConCompras,
} from "../vistaProveedores";

/** explorar_compras por proveedor: [id, gasto, documentos]. */
function ex(filas: [number, number, number][], resto: Exploracion["resto"] = null): Exploracion {
  return {
    parametros: { desde: null, hasta: null, hastaEfectivo: null, medida: "gasto", agrupar: "proveedor", desglose: null, porLineas: false, soloProductos: false, unidad: null },
    sinDatos: false,
    total: { valor: filas.reduce((s, f) => s + f[1], 0), documentos: 0, lineas: null, variacionPct: null },
    anterior: null,
    unidades: null,
    series: [],
    puntos: filas.map(([id, valor, documentos]) => ({ clave: String(id), etiqueta: `PROV ${id}`, id, valor, documentos, desglose: null })),
    resto,
  };
}

const cambio = (tipo: string, proveedorId: number, extra: Record<string, unknown> = {}, impactoMes: number | null = null): CambioPrecio =>
  ({ alerta: { id: `${tipo}-${proveedorId}-${impactoMes}`, tipo, datos: { proveedorId, ...extra } }, impactoMes, campana: false, doc: null, docOtro: null }) as unknown as CambioPrecio;

const decision = (c: Partial<DecisionFacturas["cambios"]>) =>
  ({ cambios: { sube: [], baja: [], mejor: [], proveedor: [], pactado: [], familia: [], otros: [], ...c } }) as unknown as DecisionFacturas;

const base = { respaldo: [], total: 1000, comparable: true, avisos: new Map() };

describe("vista Proveedores: la lista", () => {
  it("compara con el anterior: sube, nuevo y ya no compras", () => {
    const filas = filasProveedores({ ...base, actual: ex([[1, 600, 6], [2, 300, 3], [3, 100, 1]]), anterior: ex([[1, 400, 4], [2, 300, 3], [4, 250, 2]]) });
    const por = Object.fromEntries(filas.map((f) => [f.id, f]));
    expect(por[1]).toMatchObject({ gasto: 600, anterior: 400, variacionPct: 50, estado: "normal", pct: 60, ticket: 100 });
    expect(por[3]).toMatchObject({ anterior: 0, variacionPct: null, estado: "nuevo" });
    expect(por[4]).toMatchObject({ gasto: 0, anterior: 250, estado: "dejado" });
    expect(filtrarProveedores(filas, "todos").map((f) => f.id)).toEqual([1, 2, 3]);
    expect(filtrarProveedores(filas, "mas").map((f) => f.id)).toEqual([1]);
    expect(filtrarProveedores(filas, "nuevos").map((f) => f.id)).toEqual([3]);
    expect(filtrarProveedores(filas, "dejados").map((f) => f.id)).toEqual([4]);
  });

  it("sin periodo comparable no inventa nuevos ni dejados", () => {
    const filas = filasProveedores({ ...base, comparable: false, actual: ex([[1, 600, 6]]), anterior: ex([[4, 250, 2]]) });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ anterior: null, estado: "normal" });
  });

  it("con «resto» solo se fía de lo que ha preguntado aparte", () => {
    const actual = ex([[1, 600, 6]], { entidades: 10, valor: 50, documentos: 10 });
    const anterior = ex([[1, 500, 5], [4, 250, 2]], { entidades: 3, valor: 20, documentos: 3 });
    expect(idsPorCompletar(actual, anterior)).toEqual([4]);
    // Sin completar: el 4 puede estar en el resto del periodo.
    expect(filasProveedores({ ...base, actual, anterior }).some((f) => f.id === 4)).toBe(false);
    // Preguntado y sin compras: ya no se le compra.
    const sinNada = filasProveedores({ ...base, actual, anterior, completarActual: ex([]) });
    expect(sinNada.find((f) => f.id === 4)?.estado).toBe("dejado");
    // Preguntado y con algo: sigue (en el resto), no sale como dejado.
    expect(filasProveedores({ ...base, actual, anterior, completarActual: ex([[4, 5, 1]]) }).some((f) => f.id === 4)).toBe(false);
  });

  it("sin explorar_compras, la lista del tablero sin comparar", () => {
    const filas = filasProveedores({ ...base, actual: null, anterior: null, respaldo: [{ id: 9, nombre: "X", gasto: 200, pct: 20, documentos: 4 }] });
    expect(filas).toEqual([expect.objectContaining({ id: 9, gasto: 200, pct: 20, ticket: 50, anterior: null })]);
  });
});

describe("vista Proveedores: avisos, concentración y textos", () => {
  it("reparte las alertas por proveedor y suma € al mes y ahorro", () => {
    const m = avisosPorProveedor(
      decision({
        sube: [cambio("facturas_precio_sube", 1, {}, 30), cambio("facturas_precio_sube", 1, {}, 50)],
        mejor: [cambio("facturas_precio_mejor", 1, { ahorro: 120 })],
        otros: [cambio("facturas_albaran_sin_factura", 2)],
      }),
    );
    expect(m.get(1)).toMatchObject({ impactoMes: 80, ahorro90: 120 });
    expect(m.get(1)?.subidas.map((c) => c.impactoMes)).toEqual([50, 30]);
    expect(m.get(2)?.otros).toHaveLength(1);
    const filas = filasProveedores({ ...base, comparable: false, avisos: m, actual: ex([[1, 10, 1], [2, 20, 1], [3, 5, 1]]), anterior: null });
    expect(filtrarProveedores(filas, "avisos").map((f) => f.id)).toEqual([1, 2]);
  });

  it("concentración de los 5 primeros", () => {
    const filas = filasProveedores({ ...base, comparable: false, actual: ex([[1, 400, 1], [2, 200, 1], [3, 100, 1], [4, 100, 1], [5, 50, 1], [6, 50, 1]]), anterior: null });
    expect(concentracion(filas, 1000)).toEqual({ n: 5, pct: 85 });
    expect(concentracion(filas.slice(0, 5), 1000)).toBeNull();
  });

  it("textos: signo «−» y miles con punto; último mes con compras", () => {
    expect(textoDiferencia(1234.4)).toBe("+1.234 €");
    expect(textoDiferencia(-560)).toBe("−560 €");
    expect(textoDiferencia(0)).toBe("0 €");
    expect(ultimoMesConCompras([{ clave: "2026-08", valor: 10 }, { clave: "2026-09", valor: 0 }])).toBe("2026-08");
    expect(ultimoMesConCompras([])).toBeNull();
  });
});
