import { describe, expect, it } from "vitest";
import {
  compatibilidadHerramientas, costeUsd, cuerpoPrueba, esDeInteres, esModeloDeChat, MAX_PREGUNTAS_EVAL, modelosDeRespuesta, peticionEvaluar, PRESUPUESTO_EVAL_MAX_USD,
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
      { prompt_tokens: 9208, completion_tokens: 118, prompt_tokens_details: { cached_tokens: 3502, cache_write_tokens: 5700 } },
      null,
    ]);
    expect(t).toEqual({ entrada: 10308, cacheados: 4402, escritos_cache: 5700, salida: 173, razonamiento: 10 });
  });

  it("coste con la tarifa de ia_precios (cacheada al precio de entrada si no tiene)", () => {
    const t = { entrada: 1_000_000, cacheados: 500_000, escritos_cache: 0, salida: 100_000, razonamiento: 0 };
    expect(costeUsd({ usd_por_m_input: 2, usd_por_m_cached: 0.2, usd_por_m_output: 10 }, t)).toBeCloseTo(1 + 0.1 + 1, 6);
    expect(costeUsd({ usd_por_m_input: 2, usd_por_m_cached: null, usd_por_m_output: 10 }, t)).toBeCloseTo(2 + 1, 6);
    expect(costeUsd(null, t)).toBeNull();
    // Fila real de ia_uso (gpt-6-sol, q01): 0,016142 $ con la escritura en caché a 2,5 $/M.
    const sol = { usd_por_m_input: 2, usd_por_m_cached: 0.2, usd_por_m_cache_write: 2.5, usd_por_m_output: 10 };
    expect(costeUsd(sol, { entrada: 9208, cacheados: 3502, escritos_cache: 5700, salida: 118, razonamiento: 0 })).toBeCloseTo(0.016142, 6);
  });
});

describe("compatibilidadHerramientas (20261107620000)", () => {
  it("2xx = compatible", () => {
    expect(compatibilidadHerramientas(200, null)).toEqual({ compatible: true, motivo: null });
  });
  it("los 400 de gpt-6.1-sol = incompatible con el motivo de OpenAI", () => {
    const a = compatibilidadHerramientas(400, "Unsupported value: 'reasoning_effort' does not support 'none' with this model.");
    expect(a?.compatible).toBe(false);
    expect(a?.motivo).toMatch(/^OpenAI 400: .*does not support 'none'/);
    const b = compatibilidadHerramientas(400, "Function tools with reasoning_effort are not supported for gpt-6.1-sol in /v1/chat/completions. To use function tools, use /v1/responses.");
    expect(b?.compatible).toBe(false);
    expect(compatibilidadHerramientas(400, "x".repeat(900))).toBeNull();
    expect(compatibilidadHerramientas(400, "tools " + "x".repeat(900))!.motivo!.length).toBe(400);
  });
  it("otros errores no dicen nada (no se guarda)", () => {
    expect(compatibilidadHerramientas(429, "Rate limit reached for tools")).toBeNull();
    expect(compatibilidadHerramientas(500, null)).toBeNull();
    expect(compatibilidadHerramientas(401, "Incorrect API key")).toBeNull();
    expect(compatibilidadHerramientas(400, "Invalid 'messages[0].content'")).toBeNull();
  });
  it("la prueba lleva una herramienta (si no, no detectaría nada)", () => {
    expect((cuerpoPrueba("gpt-6.1-terra").tools as unknown[]).length).toBe(1);
  });
});
