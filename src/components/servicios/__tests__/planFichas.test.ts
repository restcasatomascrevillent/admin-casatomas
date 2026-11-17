import { describe, expect, it } from "vitest";
import { ALTO_MAXIMO_FILA, MEDIDAS_FICHA, planFichas, repartirFichas } from "../planFichas";

describe("reparto de las fichas de Estado para que quepan sin scroll", () => {
  it("reparte las fichas parejas: ninguna fila deja huecos", () => {
    expect(repartirFichas(10, 2)).toEqual([5, 5]);
    expect(repartirFichas(10, 3)).toEqual([4, 3, 3]);
    expect(repartirFichas(11, 3)).toEqual([4, 4, 3]);
    expect(repartirFichas(7, 2)).toEqual([4, 3]);
    expect(repartirFichas(3, 1)).toEqual([3]);
  });

  it("con sitio de sobra: la ficha completa, en las menos filas posibles", () => {
    // Ventana grande del dueño (pestaña de ~1240 × 560 para las fichas): 10 servicios en dos filas de 5.
    expect(planFichas({ ancho: 1240, alto: 560, n: 10 })).toEqual({ densidad: "completa", filas: [5, 5], altoFila: 274 });
  });

  it("con poco alto baja el detalle antes que hacer scroll: compacta y, si no, mínima", () => {
    // 1280×711 (la del dueño a 150 %): las dos filas no dan para la ficha completa (236 px).
    expect(planFichas({ ancho: 1180, alto: 410, n: 10 })).toMatchObject({ densidad: "compacta", filas: [5, 5], altoFila: 199 });
    expect(planFichas({ ancho: 1180, alto: 300, n: 10 })).toMatchObject({ densidad: "minima", filas: [5, 5], altoFila: 144 });
  });

  it("con poco ancho usa menos columnas, mientras las filas quepan", () => {
    // Tablet en vertical: 4 columnas de la compacta, tres filas.
    expect(planFichas({ ancho: 720, alto: 640, n: 10 })).toMatchObject({ densidad: "compacta", filas: [4, 3, 3] });
  });

  it("si no caben ni en pequeño (móvil), no hay reparto: la pestaña hace scroll como siempre", () => {
    expect(planFichas({ ancho: 358, alto: 500, n: 10 })).toBeNull();
    expect(planFichas({ ancho: 0, alto: 500, n: 10 })).toBeNull();
    expect(planFichas({ ancho: 900, alto: -20, n: 10 })).toBeNull();
    expect(planFichas({ ancho: 900, alto: 500, n: 0 })).toBeNull();
  });

  it("una fila no se estira sin fin en pantallas muy altas, ni hay más columnas que fichas", () => {
    const plan = planFichas({ ancho: 1800, alto: 1200, n: 3 });
    expect(plan).toEqual({ densidad: "completa", filas: [3], altoFila: ALTO_MAXIMO_FILA });
    expect(MEDIDAS_FICHA.completa.alto).toBeGreaterThan(MEDIDAS_FICHA.compacta.alto);
  });
});
