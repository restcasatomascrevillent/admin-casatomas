import { describe, expect, it } from "vitest";
import { calcularGastosGestion, configGastosValida } from "../gastosGestion";

const ESTANDAR = { activos: true, porcentaje: 1.5, fijo_eur: 0.25 };

describe("gastos de gestión (copia del cálculo de casa-tomas-story)", () => {
  // Mismos valores que comprueba casa-tomas-story en src/__tests__/gastosGestion.test.ts:
  // si alguno cambia, el panel enseñaría ejemplos distintos de lo que cobra la web.
  it("coincide con lo que cobra la web", () => {
    expect(calcularGastosGestion(50, ESTANDAR)).toBe(1.02);
    expect(calcularGastosGestion(100, ESTANDAR)).toBe(1.78);
  });

  it("apagados o fuera de límites no cobran nada", () => {
    expect(calcularGastosGestion(50, { ...ESTANDAR, activos: false })).toBe(0);
    expect(calcularGastosGestion(50, { ...ESTANDAR, porcentaje: 10 })).toBe(0);
    expect(configGastosValida({ porcentaje: 1.5, fijo_eur: 5.01 })).toBe(false);
    expect(configGastosValida({ porcentaje: 0, fijo_eur: 0 })).toBe(true);
  });
});
