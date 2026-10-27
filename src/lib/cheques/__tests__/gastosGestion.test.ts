import { describe, expect, it } from "vitest";
import { calcularGastosGestion, comisionEstandarStripe, configGastosValida } from "../gastosGestion";

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

  it("con la tarifa estándar, lo que paga el comprador menos la comisión deja el cheque íntegro", () => {
    expect(comisionEstandarStripe(51.02)).toBe(1.02);
    for (const importe of [25, 50, 100, 150, 250, 500]) {
      const total = Math.round((importe + calcularGastosGestion(importe, ESTANDAR)) * 100) / 100;
      const neto = Math.round((total - comisionEstandarStripe(total)) * 100) / 100;
      expect(neto).toBeGreaterThanOrEqual(importe);
      expect(neto).toBeLessThanOrEqual(importe + 0.01);
    }
  });
});
