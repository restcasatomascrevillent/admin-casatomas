/**
 * Regresión (auditoría 18/10/2026): `redondear` hacía
 * `Math.round((n + Number.EPSILON) * 100) / 100`. EPSILON solo compensa el
 * error binario de números cercanos a 1; con importes normales un medio
 * céntimo exacto se redondeaba hacia abajo. IVA del 21 % sobre 21,50 € =
 * 4,515 → salía 4,51 € (correcto 4,52 €). Medido: 478 de cada millón de bases
 * al 21 % y 4.573 al 10 % salían con un céntimo de menos.
 */
import { describe, expect, it } from "vitest";
import { nuevaFactura, redondear, totalesFactura, type Factura } from "../modelo";

/** Referencia exacta en enteros: céntimos × porcentaje, mitad hacia arriba. */
const ivaExacto = (centimos: number, porcentaje: number) => {
  const centesimas = centimos * porcentaje;
  return (Math.floor(centesimas / 100) + (centesimas % 100 >= 50 ? 1 : 0)) / 100;
};

const facturaConBase = (precio: number, iva = 21): Factura => {
  const f = nuevaFactura();
  f.ivaGlobal = iva;
  f.lineas = [{ ...f.lineas[0], concepto: "Servicio", cantidad: 1, precio, descuento: 0, iva }];
  return f;
};

describe("redondeo monetario de las facturas", () => {
  it("redondea medio céntimo hacia arriba aunque el número binario quede por debajo", () => {
    expect(redondear(4.515)).toBe(4.52);
    expect(redondear(9.975)).toBe(9.98);
    expect(redondear(1.005)).toBe(1.01);
    expect(redondear(16.275)).toBe(16.28);
    expect(redondear(999999.995)).toBe(1000000);
  });

  it("no altera importes que ya tienen dos decimales ni el ruido de las sumas", () => {
    expect(redondear(0.1 + 0.2)).toBe(0.3);
    expect(redondear(37.050000000000004)).toBe(37.05);
    expect(redondear(4.5149)).toBe(4.51);
    expect(redondear(0)).toBe(0);
    expect(Object.is(redondear(-0.001), 0)).toBe(true);
  });

  it("es simétrico con importes negativos (descuentos y retenciones mostrados en negativo)", () => {
    expect(redondear(-4.515)).toBe(-4.52);
    expect(redondear(-0.004)).toBe(0);
  });

  it("IVA del 21 % sobre 21,50 € es 4,52 € y el total 26,02 €", () => {
    const t = totalesFactura(facturaConBase(21.5));
    expect(t.iva).toBe(4.52);
    expect(t.grupos).toEqual([{ tipo: 21, base: 21.5, importe: 4.52 }]);
    expect(t.total).toBe(26.02);
  });

  it("IVA del 10 % sobre 21,35 € es 2,14 €", () => {
    expect(totalesFactura(facturaConBase(21.35, 10)).iva).toBe(2.14);
  });

  it("coincide con el cálculo exacto en céntimos para todas las bases de 0,01 € a 2.000 €", () => {
    for (const porcentaje of [21, 10, 4]) {
      const errores: string[] = [];
      for (let centimos = 1; centimos <= 200000; centimos++) {
        const calculado = redondear((centimos / 100) * porcentaje / 100);
        const exacto = ivaExacto(centimos, porcentaje);
        if (calculado !== exacto && errores.length < 3) errores.push(`${centimos / 100} € al ${porcentaje} %: ${calculado} ≠ ${exacto}`);
      }
      expect(errores).toEqual([]);
    }
  });
});
