import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  configModeloFuncion,
  esErrorDeModelo,
  esModeloRazonamiento,
  modeloDeFuncion,
  parametrosChat,
  vaciarCacheModelos,
} from "../modelo-funcion";

function clienteCon(respuesta: { data?: unknown; error?: unknown } | (() => Promise<never>)) {
  const maybeSingle = vi.fn(() => (typeof respuesta === "function" ? respuesta() : Promise.resolve(respuesta)));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { cliente: { from }, from, eq, maybeSingle };
}

beforeEach(() => {
  vaciarCacheModelos();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("modeloDeFuncion", () => {
  it("sin fila o sin modelo usa el de por defecto (la tabla vacía no cambia nada)", async () => {
    const { cliente } = clienteCon({ data: null, error: null });
    expect(await modeloDeFuncion("chat-facturas", "gpt-4.1-mini", { cliente })).toBe("gpt-4.1-mini");
    vaciarCacheModelos();
    const otro = clienteCon({ data: { modelo: null, modelo_respaldo: null }, error: null });
    expect(await modeloDeFuncion("chat-facturas", "gpt-4.1-mini", { cliente: otro.cliente })).toBe("gpt-4.1-mini");
  });

  it("la tabla manda sobre el secreto y trae el respaldo", async () => {
    const { cliente, eq } = clienteCon({ data: { modelo: "gpt-6-luna", modelo_respaldo: "gpt-4.1-mini" }, error: null });
    const r = await configModeloFuncion("chat-facturas", "gpt-4.1-mini", { cliente });
    expect(r).toEqual({ modelo: "gpt-6-luna", respaldo: "gpt-4.1-mini", origen: "tabla" });
    expect(eq).toHaveBeenCalledWith("funcion", "chat-facturas");
  });

  it("cachea 60 s por función", async () => {
    let t = 1_000;
    const { cliente, from } = clienteCon({ data: { modelo: "gpt-6-luna" }, error: null });
    const op = { cliente, ahora: () => t };
    await modeloDeFuncion("chat-facturas", "x-def", op);
    t += 59_000;
    await modeloDeFuncion("chat-facturas", "x-def", op);
    expect(from).toHaveBeenCalledTimes(1);
    t += 2_000;
    await modeloDeFuncion("chat-facturas", "x-def", op);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("si la lectura falla devuelve el de por defecto y no lanza", async () => {
    const { cliente } = clienteCon({ data: null, error: { message: "relation does not exist" } });
    expect(await modeloDeFuncion("chat-web", "gpt-5.6-luna", { cliente })).toBe("gpt-5.6-luna");
    vaciarCacheModelos();
    const roto = clienteCon(() => Promise.reject(new Error("red")));
    expect(await modeloDeFuncion("chat-web", "gpt-5.6-luna", { cliente: roto.cliente })).toBe("gpt-5.6-luna");
    expect(await modeloDeFuncion("chat-web", "gpt-5.6-luna", {})).toBe("gpt-5.6-luna");
  });

  it("tras un fallo sigue usando la última lectura buena", async () => {
    let t = 0;
    const bueno = clienteCon({ data: { modelo: "gpt-6-luna" }, error: null });
    await modeloDeFuncion("f", "def", { cliente: bueno.cliente, ahora: () => t });
    t += 61_000;
    const malo = clienteCon({ data: null, error: { message: "caído" } });
    expect(await modeloDeFuncion("f", "def", { cliente: malo.cliente, ahora: () => t })).toBe("gpt-6-luna");
  });

  it("timeout corto: una base de datos lenta no frena la función", async () => {
    const lento = clienteCon(() => new Promise<never>(() => {}));
    expect(await modeloDeFuncion("f", "def", { cliente: lento.cliente, timeoutMs: 20 })).toBe("def");
  });

  it("ignora valores con forma rara", async () => {
    const { cliente } = clienteCon({ data: { modelo: "gpt 4; drop table", modelo_respaldo: "" }, error: null });
    expect(await configModeloFuncion("f", "def", { cliente })).toEqual({ modelo: "def", respaldo: null, origen: "defecto" });
  });
});

describe("parámetros por familia", () => {
  it("razonamiento: gpt-5*, gpt-6*, o*", () => {
    expect(esModeloRazonamiento("gpt-5.6-luna")).toBe(true);
    expect(esModeloRazonamiento("gpt-6-luna")).toBe(true);
    expect(esModeloRazonamiento("o4-mini")).toBe(true);
    expect(esModeloRazonamiento("gpt-4.1-mini")).toBe(false);
  });
  it("max_completion_tokens y sin temperature en los de razonamiento; GPT-6 con reasoning_effort none", () => {
    expect(parametrosChat("gpt-4.1-mini", 800)).toEqual({ temperature: 0.2, max_tokens: 800 });
    expect(parametrosChat("gpt-5-mini", 800)).toEqual({ max_completion_tokens: 4000 });
    expect(parametrosChat("gpt-6-luna", 800)).toEqual({ reasoning_effort: "none", max_completion_tokens: 4000 });
  });
  it("solo los errores del modelo justifican el respaldo", () => {
    expect(esErrorDeModelo(404, '{"error":{"code":"model_not_found"}}')).toBe(true);
    expect(esErrorDeModelo(400, { error: { message: "The model `gpt-x` does not exist" } })).toBe(true);
    expect(esErrorDeModelo(429, "model_not_found")).toBe(false);
    expect(esErrorDeModelo(400, '{"error":{"message":"Invalid tool schema"}}')).toBe(false);
  });
});
