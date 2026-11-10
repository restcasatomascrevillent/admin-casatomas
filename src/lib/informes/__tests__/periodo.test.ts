import { describe, expect, it } from "vitest";
import { mesAnteriorA, mesesPorDefecto, periodoEnUrl, periodoInicial, rangoPorDefecto, sufijoArchivo, textoPeriodo, validarRango } from "../periodo";

describe("periodo de los informes", () => {
  it("meses: el que va en curso (si ya pasó el día 1) y los 12 anteriores", () => {
    const m = mesesPorDefecto("2026-11-10");
    expect(m).toHaveLength(13);
    expect(m[0]).toEqual({ clave: "2026-11", etiqueta: "Noviembre de 2026 (en curso)", enCurso: true });
    expect(m[1].clave).toBe("2026-10");
    expect(m.at(-1)!.clave).toBe("2025-11");
    // El día 1 el mes en curso aún no tiene ningún día cerrado.
    expect(mesesPorDefecto("2026-11-01")[0].clave).toBe("2026-10");
  });

  it("por defecto, el último mes cerrado y el mes anterior entero", () => {
    expect(mesAnteriorA("2026-01-15")).toBe("2025-12");
    expect(rangoPorDefecto("2026-03-15")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
  });

  it("toma de la URL solo lo que vale", () => {
    expect(periodoInicial("mes", "2026-11-10", { mes: "2026-09" })).toEqual({ tipo: "mes", mes: "2026-09" });
    expect(periodoInicial("mes", "2026-11-10", { mes: "2020-01" })).toEqual({ tipo: "mes", mes: "2026-10" });
    expect(periodoInicial("mes", "2026-11-10", { mes: "basura" })).toEqual({ tipo: "mes", mes: "2026-10" });
    expect(periodoInicial("rango", "2026-11-10", { desde: "2026-01-01", hasta: "2026-03-31" })).toEqual({ tipo: "rango", desde: "2026-01-01", hasta: "2026-03-31" });
    expect(periodoInicial("rango", "2026-11-10", { desde: "2026-03-31", hasta: "2026-01-01" })).toEqual({ tipo: "rango", desde: "2026-10-01", hasta: "2026-10-31" });
    expect(periodoInicial("ninguno", "2026-11-10", { mes: "2026-09" })).toEqual({ tipo: "ninguno" });
  });

  it("valida el rango: fechas que existen y desde ≤ hasta", () => {
    expect(validarRango("2026-02-30", "2026-03-01")).toBeNull();
    expect(validarRango("2026-03-02", "2026-03-01")).toBeNull();
    expect(validarRango("2026-03-01", "2026-03-01")).toEqual({ desde: "2026-03-01", hasta: "2026-03-01" });
  });

  it("textos, nombre de archivo y URL", () => {
    expect(textoPeriodo({ tipo: "mes", mes: "2026-10" })).toBe("Octubre de 2026");
    expect(textoPeriodo({ tipo: "rango", desde: "2026-10-01", hasta: "2026-10-31" })).toBe("1 – 31 oct 2026");
    expect(textoPeriodo({ tipo: "ninguno" })).toBe("Todos los datos");
    expect(sufijoArchivo({ tipo: "rango", desde: "2026-01-01", hasta: "2026-03-31" })).toBe("2026-01-01-a-2026-03-31");
    expect(periodoEnUrl({ tipo: "mes", mes: "2026-10" })).toEqual({ mes: "2026-10" });
    expect(periodoEnUrl({ tipo: "rango", desde: "2026-01-01", hasta: "2026-01-31" })).toEqual({ desde: "2026-01-01", hasta: "2026-01-31" });
  });
});
