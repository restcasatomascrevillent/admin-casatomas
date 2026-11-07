import { describe, expect, it } from "vitest";
import { cuerpoPrueba, esDeInteres, esModeloDeChat, modelosDeRespuesta, procesoDeFuncion, textoRespuesta } from "../logica";

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
