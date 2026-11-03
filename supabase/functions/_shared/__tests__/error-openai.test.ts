// Motivo legible de los errores de OpenAI (03-11-2026: la demo decía «No se
// pudo leer la etiqueta» y era la cuenta de OpenAI sin saldo).
import { describe, expect, it } from "vitest";
import { MENSAJE_SIN_SALDO_OPENAI, motivoErrorOpenAI } from "../error-openai.ts";

describe("motivoErrorOpenAI", () => {
  it("429 sin saldo → aviso de añadir crédito", () => {
    const cuerpo = JSON.stringify({ error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } });
    expect(motivoErrorOpenAI(429, cuerpo)).toBe(MENSAJE_SIN_SALDO_OPENAI);
    expect(motivoErrorOpenAI(429, '{"error":{"code":"credit_balance_exhausted","message":"You have no credits remaining"}}')).toBe(MENSAJE_SIN_SALDO_OPENAI);
  });
  it("429 normal, 401 y otros con su motivo", () => {
    expect(motivoErrorOpenAI(429, '{"error":{"code":"rate_limit_exceeded"}}')).toMatch(/demasiadas peticiones/);
    expect(motivoErrorOpenAI(401, '{"error":{"message":"Incorrect API key"}}')).toMatch(/clave de OpenAI/);
    expect(motivoErrorOpenAI(400, '{"error":{"message":"Invalid image"}}')).toBe("OpenAI respondió 400: Invalid image");
    expect(motivoErrorOpenAI(500, "<html>")).toBe("OpenAI respondió 500");
  });
});
