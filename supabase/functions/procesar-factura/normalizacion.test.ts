import { describe, expect, it } from "vitest";
import { parseImporte, toNumber } from "./normalizacion.ts";

// ============================================================================
//  normalizacion.test.ts
// ----------------------------------------------------------------------------
//  Cubre el bug real: `toNumber("1.200,50")` debía dar 1200.50 y daba 1.2
//  (String.replace(",", ".") solo sustituye la PRIMERA coma, así que
//  "1.200,50" -> "1.200.50" -> parseFloat se detiene en el primer punto
//  sobrante -> 1.2). Estos casos son los mismos que se verificaron a mano en
//  el informe de la revisión.
// ============================================================================

describe("parseImporte / toNumber — formatos de importe", () => {
  const casos: Array<[string, number]> = [
    // ── El bug que motiva el arreglo ──
    ["1.200,50", 1200.5],
    ["9.316,67", 9316.67], // caso real citado en la migración T5 (albarán 38)

    // ── Español: miles "." + decimal "," ──
    ["1.234,56", 1234.56],
    ["45,20", 45.2],
    ["0,50", 0.5],
    ["12,5", 12.5],
    ["1.234.567,89", 1234567.89],

    // ── Inglés: miles "," + decimal "." ──
    ["1,234.56", 1234.56],
    ["1,234,567.89", 1234567.89],

    // ── JSON estándar / sin separador de miles (el caso que YA funcionaba:
    //    no debe romperse) ──
    ["45.20", 45.2],
    ["1234.56", 1234.56],
    ["1234", 1234],

    // ── Un solo separador, ambiguo, exactamente 3 dígitos detrás → miles ──
    ["1.234", 1234],
    ["1,234", 1234],
    ["120.580", 120580], // total "grande" con miles y sin decimales

    // ── Signo, espacios y símbolo de moneda ──
    ["-45,20", -45.2],
    [" 45,20 ", 45.2],
    ["1.200,50 €", 1200.5],
    ["+45,20", 45.2],
  ];

  it.each(casos)("parseImporte(%j) === %j", (entrada, esperado) => {
    expect(parseImporte(entrada)).toBeCloseTo(esperado, 6);
  });

  it.each(casos)("toNumber(%j) === %j", (entrada, esperado) => {
    expect(toNumber(entrada)).toBeCloseTo(esperado, 6);
  });

  it("no reconocido -> null en parseImporte", () => {
    expect(parseImporte("abc")).toBeNull();
    expect(parseImporte("")).toBeNull();
    expect(parseImporte("   ")).toBeNull();
  });
});

describe("toNumber — tipos y allowNull", () => {
  it("number tal cual", () => {
    expect(toNumber(45.2)).toBe(45.2);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-3)).toBe(-3);
  });

  it("null/undefined/\"\" sin allowNull -> 0", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("")).toBe(0);
  });

  it("null/undefined/\"\" con allowNull -> null", () => {
    expect(toNumber(null, true)).toBeNull();
    expect(toNumber(undefined, true)).toBeNull();
    expect(toNumber("", true)).toBeNull();
  });

  it("string no numérico -> 0, o null con allowNull", () => {
    expect(toNumber("abc")).toBe(0);
    expect(toNumber("abc", true)).toBeNull();
  });

  it("tipos inesperados (objeto/boolean) -> 0, o null con allowNull", () => {
    expect(toNumber({} as unknown)).toBe(0);
    expect(toNumber(true as unknown)).toBe(0);
    expect(toNumber({} as unknown, true)).toBeNull();
  });
});
