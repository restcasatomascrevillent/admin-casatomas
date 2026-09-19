/**
 * Tests para src/config/fiscal.ts
 *
 * Capa pura: tipo de IVA, desglose hacia atrás y datos fiscales del entorno.
 * Lo crítico aquí es que el ticket nunca descuadre y que el TPV no cobre de más.
 */
import { describe, it, expect } from "vitest";
import {
  DATOS_FISCALES,
  NOMBRE_ESTABLECIMIENTO_POR_DEFECTO,
  TIPO_IVA_RESTAURACION,
  TIPO_IVA_RESTAURACION_ETIQUETA,
  desglosarIvaIncluido,
  redondearCentimos,
} from "@/config/fiscal";

describe("TIPO_IVA_RESTAURACION", () => {
  it("es el 10 % de hostelería, no el 21 % general", () => {
    expect(TIPO_IVA_RESTAURACION).toBe(0.1);
  });

  it("la etiqueta se deriva de la constante", () => {
    expect(TIPO_IVA_RESTAURACION_ETIQUETA).toBe("10%");
  });
});

describe("redondearCentimos", () => {
  it("redondea a 2 decimales", () => {
    expect(redondearCentimos(10.004)).toBe(10);
    expect(redondearCentimos(10.005)).toBe(10.01);
    expect(redondearCentimos(0.1 + 0.2)).toBe(0.3);
  });
});

describe("desglosarIvaIncluido", () => {
  it("NO suma el IVA encima: el total es el importe de carta", () => {
    // 11 € de carta se cobran 11 €, no 11 € + IVA.
    expect(desglosarIvaIncluido(11).total).toBe(11);
  });

  it("desglosa hacia atrás con el tipo de restauración", () => {
    expect(desglosarIvaIncluido(11)).toEqual({
      baseImponible: 10,
      iva: 1,
      total: 11,
    });
  });

  it("devuelve los tres importes redondeados a céntimos", () => {
    const { baseImponible, iva, total } = desglosarIvaIncluido(23.457);
    for (const importe of [baseImponible, iva, total]) {
      expect(importe).toBe(redondearCentimos(importe));
    }
  });

  it("baseImponible + iva cuadra siempre con total al céntimo", () => {
    const importes = [
      0, 0.01, 0.05, 1, 1.55, 2.4, 3.33, 7.77, 9.99, 10, 12.35, 13.7, 18.95,
      23.457, 47.61, 99.99, 100, 123.45, 1234.56,
    ];

    for (const importe of importes) {
      const { baseImponible, iva, total } = desglosarIvaIncluido(importe);
      expect(redondearCentimos(baseImponible + iva)).toBe(total);
      expect(total).toBe(redondearCentimos(importe));
    }
  });

  it("con importe 0 devuelve todo a 0", () => {
    expect(desglosarIvaIncluido(0)).toEqual({ baseImponible: 0, iva: 0, total: 0 });
  });

  it("la base imponible es menor que el total cuando hay importe", () => {
    const { baseImponible, total } = desglosarIvaIncluido(50);
    expect(baseImponible).toBeLessThan(total);
  });

  it("acepta otro tipo de IVA (p. ej. el 21 % del alcohol)", () => {
    const { baseImponible, iva, total } = desglosarIvaIncluido(12.1, 0.21);
    expect(total).toBe(12.1);
    expect(baseImponible).toBe(10);
    expect(iva).toBe(2.1);
  });
});

describe("DATOS_FISCALES", () => {
  it("siempre tiene un nombre no vacío", () => {
    expect(typeof DATOS_FISCALES.nombre).toBe("string");
    expect(DATOS_FISCALES.nombre.length).toBeGreaterThan(0);
  });

  it("cae al nombre neutro si no hay variable de entorno", () => {
    if (!import.meta.env.VITE_ESTABLECIMIENTO_NOMBRE) {
      expect(DATOS_FISCALES.nombre).toBe(NOMBRE_ESTABLECIMIENTO_POR_DEFECTO);
    }
  });

  it("los datos opcionales son undefined o cadenas con contenido (nunca placeholders vacíos)", () => {
    for (const valor of [DATOS_FISCALES.cif, DATOS_FISCALES.direccion, DATOS_FISCALES.telefono]) {
      if (valor !== undefined) {
        expect(typeof valor).toBe("string");
        expect(valor.trim()).toBe(valor);
        expect(valor.length).toBeGreaterThan(0);
      }
    }
  });
});
