/** CT-REM-FN-17: secreto compartido en tiempo constante y fail-closed. */
import { describe, it, expect } from "vitest";
import { secretoCompartidoValido } from "../secreto.ts";
import { compararTiempoConstante } from "../../_shared/tiempo-constante.ts";

describe("secretoCompartidoValido", () => {
  it("acepta el secreto correcto", () => {
    expect(secretoCompartidoValido("s3creto-largo", "s3creto-largo")).toBe(true);
  });
  it("rechaza un secreto incorrecto de la misma longitud", () => {
    expect(secretoCompartidoValido("s3creto-largo", "s3creto-largX")).toBe(false);
  });
  it("rechaza longitudes distintas y prefijos", () => {
    expect(secretoCompartidoValido("abcdef", "abc")).toBe(false);
    expect(secretoCompartidoValido("abc", "abcdef")).toBe(false);
  });
  it("rechaza sin cabecera o con cabecera vacía", () => {
    expect(secretoCompartidoValido("abc", null)).toBe(false);
    expect(secretoCompartidoValido("abc", "")).toBe(false);
  });
  it("falla cerrado si no hay secreto configurado (ni vacío contra vacío)", () => {
    expect(secretoCompartidoValido("", "")).toBe(false);
    expect(secretoCompartidoValido("", "algo")).toBe(false);
  });
});

describe("compararTiempoConstante", () => {
  it("compara contenido y longitud", () => {
    expect(compararTiempoConstante("a", "a")).toBe(true);
    expect(compararTiempoConstante("a", "b")).toBe(false);
    expect(compararTiempoConstante("a", "aa")).toBe(false);
  });
});
