import { describe, expect, it } from "vitest";
import {
  costeUsd, cuerpoPrueba, esDeInteres, esModeloDeChat, MAX_PREGUNTAS_EVAL, modelosDeRespuesta, peticionEvaluar, PRESUPUESTO_EVAL_MAX_USD,
  procesoDeFuncion, sumarUsage, textoRespuesta,
} from "../logica";

describe("ia-modelos-openai · lógica", () => {
  it("limpia la lista de /v1/models (sin duplicados ni ids raros, ordenada)", () => {
    const r = modelosDeRespuesta({
      data: [
        { id: "gpt-6-luna", owned_by: "system", created: 1757808000 },
        { id: "gpt-4.1-mini", owned_by: "system", created: 1744000000 },
        { id: "gpt-6-luna", owned_by: "otro" },
        { id: "mal id; drop" },
        { id: 42 },
      ],
    });
    expect(r.map((m) => m.id)).toEqual(["gpt-4.1-mini", "gpt-6-luna"]);
    expect(r[1]).toEqual({ id: "gpt-6-luna", owned_by: "system", created: 1757808000 });
    expect(() => modelosDeRespuesta({ error: "x" })).toThrow();
  });

  it("familias de interés y modelos de chat", () => {
    expect(esDeInteres("gpt-6-sol")).toBe(true);
    expect(esDeInteres("o4-mini")).toBe(true);
    expect(esDeInteres("text-embedding-3-small")).toBe(true);
    expect(esDeInteres("dall-e-3")).toBe(false);
    expect(esModeloDeChat("gpt-6-luna")).toBe(true);
    expect(esModeloDeChat("gpt-4o-mini-tts")).toBe(false);
    expect(esModeloDeChat("text-embedding-3-small")).toBe(false);
    expect(esModeloDeChat("gpt-image-2")).toBe(false);
  });

  it("cada función se prueba con la clave de su proyecto", () => {
    expect(procesoDeFuncion("chat-facturas")).toBe("chat");
    expect(procesoDeFuncion("chat-web")).toBe("chatweb");
    expect(procesoDeFuncion("ocr-trabajo")).toBe("ocr");
    expect(procesoDeFuncion(null)).toBe("otros");
  });

  it("la prueba usa los parámetros de la familia y una herramienta", () => {
    const g6 = cuerpoPrueba("gpt-6-luna");
    expect(g6).toMatchObject({ model: "gpt-6-luna", reasoning_effort: "none", tool_choice: "auto" });
    expect(g6).not.toHaveProperty("temperature");
    expect(Array.isArray(g6.tools)).toBe(true);
    expect(cuerpoPrueba("gpt-4.1-mini")).toMatchObject({ max_tokens: 16, temperature: 0 });
    expect(() => cuerpoPrueba("x; y")).toThrow();
  });

  it("texto de la respuesta", () => {
    expect(textoRespuesta({ choices: [{ message: { content: " funciona " } }] })).toBe("funciona");
    expect(textoRespuesta({ choices: [{ message: { content: null }, finish_reason: "tool_calls" }] })).toContain("tool_calls");
    expect(textoRespuesta(null)).toBe("(sin texto)");
  });
});

describe("ia-modelos-openai · evaluar", () => {
  it("valida la petición: modelo de chat, 1-3 preguntas, historial y tope de 3 $", () => {
    const p = peticionEvaluar({
      modelo: "gpt-6-luna",
      preguntas: [{ id: "q3", mensaje: " hazme la comparativa ", historial: [{ rol: "user", contenido: "litros" }, { rol: "assistant", contenido: "20 l" }] }],
      presupuesto_usd: 50,
    });
    expect(p.modelo).toBe("gpt-6-luna");
    expect(p.presupuestoUsd).toBe(PRESUPUESTO_EVAL_MAX_USD);
    expect(p.preguntas[0]).toEqual({ id: "q3", mensaje: "hazme la comparativa", historial: [{ role: "user", content: "litros" }, { role: "assistant", content: "20 l" }] });
    expect(peticionEvaluar({ modelo: "gpt-4.1-mini", preguntas: [{ mensaje: "x" }], presupuesto_usd: 1 }).presupuestoUsd).toBe(1);
    expect(() => peticionEvaluar({ modelo: "text-embedding-3-small", preguntas: [{ mensaje: "x" }] })).toThrow();
    expect(() => peticionEvaluar({ modelo: "gpt-6-sol", preguntas: [] })).toThrow();
    expect(() => peticionEvaluar({ modelo: "gpt-6-sol", preguntas: Array(MAX_PREGUNTAS_EVAL + 1).fill({ mensaje: "x" }) })).toThrow();
    expect(() => peticionEvaluar({ modelo: "gpt-6-sol", preguntas: [{ mensaje: "" }] })).toThrow();
    expect(peticionEvaluar({ modelo: "gpt-6-sol", preguntas: [{ id: "mal id;", mensaje: "x" }] }).preguntas[0].id).toBe("p1");
    expect(p.esfuerzo).toBeNull();
    expect(peticionEvaluar({ modelo: "gpt-6.1-sol", preguntas: [{ mensaje: "x" }], reasoning_effort: "low" }).esfuerzo).toBe("low");
    expect(() => peticionEvaluar({ modelo: "gpt-6.1-sol", preguntas: [{ mensaje: "x" }], reasoning_effort: "xhigh" })).toThrow();
  });

  it("suma tokens de varias llamadas (cacheados y razonamiento dentro, sin pasarse)", () => {
    const t = sumarUsage([
      { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 }, completion_tokens_details: { reasoning_tokens: 10 } },
      { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 999 } },
      null,
    ]);
    expect(t).toEqual({ entrada: 1100, cacheados: 900, salida: 55, razonamiento: 10 });
  });

  it("coste con la tarifa de ia_precios (cacheada al precio de entrada si no tiene)", () => {
    const t = { entrada: 1_000_000, cacheados: 500_000, salida: 100_000, razonamiento: 0 };
    expect(costeUsd({ usd_por_m_input: 2, usd_por_m_cached: 0.2, usd_por_m_output: 10 }, t)).toBeCloseTo(1 + 0.1 + 1, 6);
    expect(costeUsd({ usd_por_m_input: 2, usd_por_m_cached: null, usd_por_m_output: 10 }, t)).toBeCloseTo(2 + 1, 6);
    expect(costeUsd(null, t)).toBeNull();
  });
});
