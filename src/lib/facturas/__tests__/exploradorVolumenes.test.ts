// Medidas «Litros» y «Kilos» del explorador de Análisis (20261106400000_facturas_volumenes).
import { describe, expect, it } from "vitest";
import {
  ajustarConfig, cuentaPorLineas, CONFIG_POR_DEFECTO, formatoValor, MEDIDAS, motivoMedidaNoDisponible,
  normalizarConfig, normalizarExploracion, type ConfigExplorador,
} from "../explorador";

const base: ConfigExplorador = { ...CONFIG_POR_DEFECTO, medida: "litros", agrupar: "mes", desglose: null };

describe("explorador: litros y kilos", () => {
  it("están en el catálogo de medidas, por líneas y sin exigir producto", () => {
    for (const v of ["litros", "kilos"] as const) {
      const m = MEDIDAS.find((x) => x.valor === v)!;
      expect(m).toMatchObject({ formato: "cantidad", porLineas: true, requiereProducto: false, iva: null });
      expect(motivoMedidaNoDisponible(v, base)).toBeNull();
    }
    expect(cuentaPorLineas(base)).toBe(true);
  });

  it("quitan el filtro de unidad (la RPC lo rechaza) con un aviso", () => {
    const { config, aviso } = ajustarConfig({ ...base, filtros: { ...base.filtros, unidad: "caja" } });
    expect(config.filtros.unidad).toBeNull();
    expect(config.medida).toBe("litros");
    expect(aviso).toMatch(/quita el filtro de unidad/);
  });

  it("formatean con la unidad que da la RPC y leen lineas_sin_convertir", () => {
    expect(formatoValor(20520.88, "litros", "l")).toMatch(/^20\.520,88 l$/);
    const ex = normalizarExploracion({
      parametros: { medida: "litros", agrupar: "mes", unidad: "l", por_lineas: true },
      total: { valor: 117.72, documentos: 1, lineas: 5, lineas_sin_convertir: 1 },
      puntos: [], series: [],
    });
    expect(ex.parametros.medida).toBe("litros");
    expect(ex.parametros.unidad).toBe("l");
    expect(ex.total.lineasSinConvertir).toBe(1);
  });

  it("una configuración fijada con litros se conserva", () => {
    expect(normalizarConfig({ ...base })?.medida).toBe("litros");
  });
});
