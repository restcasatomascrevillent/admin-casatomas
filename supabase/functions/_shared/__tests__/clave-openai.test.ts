import { describe, expect, it } from "vitest";
import { claveOpenAI } from "../clave-openai.ts";

const entorno = (vars: Record<string, string | undefined>) => (n: string) => vars[n];

describe("claveOpenAI", () => {
  it("usa la clave específica de cada proceso cuando existe", () => {
    const env = entorno({ OPENAI_API_KEY: "general", OPENAI_API_KEY_OCR: "k-ocr", OPENAI_API_KEY_CHAT: "k-chat" });
    expect(claveOpenAI("ocr", env)).toBe("k-ocr");
    expect(claveOpenAI("chat", env)).toBe("k-chat");
  });

  it("'otros' usa siempre OPENAI_API_KEY, aunque existan las específicas", () => {
    const env = entorno({ OPENAI_API_KEY: "general", OPENAI_API_KEY_OCR: "k-ocr", OPENAI_API_KEY_CHAT: "k-chat" });
    expect(claveOpenAI("otros", env)).toBe("general");
  });

  it("si falta la específica, cae a OPENAI_API_KEY (comportamiento actual intacto)", () => {
    const env = entorno({ OPENAI_API_KEY: "general" });
    expect(claveOpenAI("ocr", env)).toBe("general");
    expect(claveOpenAI("chat", env)).toBe("general");
  });

  it("una específica vacía o con espacios cuenta como ausente", () => {
    const env = entorno({ OPENAI_API_KEY: "general", OPENAI_API_KEY_OCR: "  ", OPENAI_API_KEY_CHAT: "" });
    expect(claveOpenAI("ocr", env)).toBe("general");
    expect(claveOpenAI("chat", env)).toBe("general");
  });

  it("recorta espacios y devuelve cadena vacía si no hay ninguna", () => {
    expect(claveOpenAI("ocr", entorno({ OPENAI_API_KEY_OCR: " k-ocr \n" }))).toBe("k-ocr");
    expect(claveOpenAI("chat", entorno({}))).toBe("");
  });

  it("sin lector inyectado y sin Deno no revienta", () => {
    expect(claveOpenAI("otros")).toBe("");
  });
});
