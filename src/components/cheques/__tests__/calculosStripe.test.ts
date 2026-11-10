import { describe, expect, it } from "vitest";
import { agrupacionPara, fechasDeRango, hoyLocal, rangoAnterior, serieIngresos, variacionPct } from "../stripe/calculos";

describe("cálculos de la pestaña Stripe", () => {
  it("hoy es el día local, no el de UTC", () => {
    // 00:30 del 10/11 en hora local: toISOString() daría todavía el 9 en España.
    expect(hoyLocal(new Date(2026, 10, 10, 0, 30))).toBe("2026-11-10");
  });

  it("rangos rápidos", () => {
    expect(fechasDeRango("mes", "2026-11-10")).toEqual({ desde: "2026-11-01", hasta: "2026-11-10" });
    expect(fechasDeRango("mes_pasado", "2026-11-10")).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(fechasDeRango("30", "2026-11-10")).toEqual({ desde: "2026-10-12", hasta: "2026-11-10" });
    expect(fechasDeRango("90", "2026-11-10")).toEqual({ desde: "2026-08-13", hasta: "2026-11-10" });
    expect(fechasDeRango("anio", "2026-11-10")).toEqual({ desde: "2026-01-01", hasta: "2026-11-10" });
    expect(fechasDeRango("personalizado", "2026-11-10")).toBeNull();
  });

  it("periodo anterior de la misma duración y variación", () => {
    expect(rangoAnterior("2026-10-12", "2026-11-10")).toEqual({ desde: "2026-09-12", hasta: "2026-10-11" });
    expect(rangoAnterior("2026-11-10", "2026-11-10")).toEqual({ desde: "2026-11-09", hasta: "2026-11-09" });
    expect(variacionPct(150, 100)).toBe(50);
    expect(variacionPct(10, 0)).toBeNull();
    expect(variacionPct(10, null)).toBeNull();
  });

  it("la serie de ingresos tiene todos los días, también los que no hubo pagos", () => {
    const { agrupacion, puntos } = serieIngresos([{ dia: "2026-11-02", pagos: 2, bruto_eur: 150 }, { dia: "2026-11-05", pagos: 1, bruto_eur: 50 }], "2026-11-01", "2026-11-07");
    expect(agrupacion).toBe("dia");
    expect(puntos.map((p) => p.bruto_eur)).toEqual([0, 150, 0, 0, 50, 0, 0]);
    expect(puntos[1]).toMatchObject({ etiqueta: "02/11", titulo: "lunes 2 de noviembre", pagos: 2 });
    // Un solo día también se pinta (antes la gráfica desaparecía).
    expect(serieIngresos([{ dia: "2026-11-02", pagos: 1, bruto_eur: 20 }], "2026-11-02", "2026-11-02").puntos).toHaveLength(1);
  });

  it("agrupa por semana o mes en rangos largos", () => {
    expect([agrupacionPara(31), agrupacionPara(90), agrupacionPara(365)]).toEqual(["dia", "semana", "mes"]);
    const semanas = serieIngresos([{ dia: "2026-08-13", pagos: 1, bruto_eur: 10 }, { dia: "2026-08-16", pagos: 1, bruto_eur: 5 }], "2026-08-13", "2026-11-10");
    expect(semanas.agrupacion).toBe("semana");
    expect(semanas.puntos[0]).toMatchObject({ clave: "2026-08-10", bruto_eur: 15, pagos: 2 });
    const meses = serieIngresos([{ dia: "2026-03-04", pagos: 3, bruto_eur: 300 }], "2026-01-01", "2026-11-10");
    expect(meses.puntos.map((p) => p.bruto_eur)).toEqual([0, 0, 300, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
