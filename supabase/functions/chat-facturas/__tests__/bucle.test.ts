import { describe, expect, it } from "vitest";
import { ejecutarConversacion, MAX_TOOL_CALLS_POR_RONDA, type EstadoUso, type Traza } from "../bucle.ts";

// Acumulador mínimo con la forma de AcumuladorUso (el real importa supabase-js por URL).
function acumulador(modelo: string) {
  return {
    modelo, llamadas: 0, prompt: 0, completion: 0, estado: "ok",
    sumar(u?: { prompt_tokens?: number; completion_tokens?: number }) {
      this.llamadas++;
      this.prompt += u?.prompt_tokens ?? 0;
      this.completion += u?.completion_tokens ?? 0;
    },
    marcarError() { this.estado = "error"; },
  };
}
function estado(modelo: string): EstadoUso {
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = acumulador(modelo) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { usosChat: [a], usoEmbed: acumulador("text-embedding-3-small") as any, nuevoAcumuladorChat: (m) => acumulador(m) as any };
}

// Supabase de mentira: cada RPC devuelve un objeto pequeño y apunta la llamada.
function supabaseFalso() {
  const rpcs: { fn: string; args: unknown }[] = [];
  return {
    rpcs,
    rpc(fn: string, args: unknown) {
      rpcs.push({ fn, args });
      if (fn === "asociar_pregunta_agente" || fn === "meses_compras_incompletos") return Promise.resolve({ data: [], error: null });
      if (fn === "asociar_termino_agente") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: { total_documentos: 3, gasto_total: 100 }, error: null });
    },
    from() { throw new Error("no se espera lectura de tablas en este test"); },
  };
}

type Resp = { status?: number; body: unknown };
function openaiFalso(respuestas: Resp[]) {
  const cuerpos: Record<string, unknown>[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    cuerpos.push(JSON.parse(String(init.body)));
    const r = respuestas.shift();
    if (!r) throw new Error("llamada de más a OpenAI");
    const status = r.status ?? 200;
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status });
  }) as unknown as typeof fetch;
  return { f, cuerpos };
}

const usage = (p: number, c: number) => ({ prompt_tokens: p, completion_tokens: c, prompt_tokens_details: { cached_tokens: 0 } });
const llamadaTool = (nombre: string, id = "t1") => ({ id, type: "function", function: { name: nombre, arguments: "{}" } });

describe("chat-facturas · bucle compartido (ejecutarConversacion)", () => {
  it("ejecuta la herramienta pedida, redacta y deja traza y consumo", async () => {
    const sb = supabaseFalso();
    const ai = openaiFalso([
      { body: { choices: [{ message: { role: "assistant", content: null, tool_calls: [llamadaTool("estadisticas_globales")] } }], usage: usage(1000, 20) } },
      { body: { choices: [{ message: { role: "assistant", content: "Has gastado 100 €." } }], usage: usage(1200, 30) } },
    ]);
    const uso = estado("gpt-4.1-mini");
    const traza: Traza = { llamadas: [], herramientas: [] };
    const auditadas: string[] = [];
    const r = await ejecutarConversacion({
      supabase: sb, claveOpenAI: "x", mensaje: "¿cuánto he gastado?", modelo: "gpt-4.1-mini", uso, traza,
      fetchImpl: ai.f, hoy: "2026-11-07", alEjecutarHerramienta: (h) => auditadas.push(h.nombre),
    });
    expect(r.respuesta).toBe("Has gastado 100 €.");
    expect(traza.llamadas).toHaveLength(2);
    expect(traza.herramientas.map((h) => [h.nombre, h.resultado])).toEqual([["estadisticas_globales", "completada"]]);
    expect(auditadas).toEqual(["estadisticas_globales"]);
    expect((uso.usosChat[0] as unknown as { llamadas: number; prompt: number }).llamadas).toBe(2);
    expect((uso.usosChat[0] as unknown as { prompt: number }).prompt).toBe(2200);
    // Mismo prompt de sistema y herramientas que el copiloto; pregunta al final.
    const primero = ai.cuerpos[0] as { model: string; messages: { role: string; content: string }[]; tools?: unknown[]; temperature?: number };
    expect(primero.model).toBe("gpt-4.1-mini");
    expect(primero.messages[0].role).toBe("system");
    expect(primero.messages[0].content).toContain("2026-11-07");
    expect(primero.messages.at(-1)).toEqual({ role: "user", content: "¿cuánto he gastado?" });
    expect(Array.isArray(primero.tools)).toBe(true);
    expect(sb.rpcs.some((x) => x.fn === "estadisticas_globales_agente")).toBe(true);
  });

  it("los seguimientos llevan el historial antes de la pregunta", async () => {
    const ai = openaiFalso([{ body: { choices: [{ message: { role: "assistant", content: "Vale." } }], usage: usage(10, 2) } }]);
    await ejecutarConversacion({
      supabase: supabaseFalso(), claveOpenAI: "x", mensaje: "hazme la comparativa", modelo: "gpt-6-luna", uso: estado("gpt-6-luna"),
      historial: [{ role: "user", content: "litros de cerveza" }, { role: "assistant", content: "20.000 l" }], fetchImpl: ai.f,
    });
    const c = ai.cuerpos[0] as { messages: { role: string; content: string }[]; reasoning_effort?: string };
    expect(c.messages.filter((m) => m.role !== "system").map((m) => m.content)).toEqual(["litros de cerveza", "20.000 l", "hazme la comparativa"]);
    expect(c.reasoning_effort).toBe("none");
  });

  it("contesta las herramientas que pasan del tope de ronda sin ejecutarlas", async () => {
    const muchas = Array.from({ length: MAX_TOOL_CALLS_POR_RONDA + 1 }, (_, i) => llamadaTool("estadisticas_globales", `t${i}`));
    const ai = openaiFalso([
      { body: { choices: [{ message: { role: "assistant", content: null, tool_calls: muchas } }], usage: usage(10, 2) } },
      { body: { choices: [{ message: { role: "assistant", content: "Listo." } }], usage: usage(10, 2) } },
    ]);
    const traza: Traza = { llamadas: [], herramientas: [] };
    await ejecutarConversacion({ supabase: supabaseFalso(), claveOpenAI: "x", mensaje: "hola", modelo: "gpt-4.1-mini", uso: estado("gpt-4.1-mini"), traza, fetchImpl: ai.f });
    expect(traza.herramientas.filter((h) => h.resultado === "no_ejecutada")).toHaveLength(1);
    const segunda = ai.cuerpos[1] as { messages: { role: string }[] };
    expect(segunda.messages.filter((m) => m.role === "tool")).toHaveLength(MAX_TOOL_CALLS_POR_RONDA + 1);
  });

  it("si OpenAI rechaza el modelo, reintenta UNA vez con el respaldo y lo cuenta aparte", async () => {
    const ai = openaiFalso([
      { status: 404, body: { error: { message: "The model `gpt-x` does not exist", code: "model_not_found" } } },
      { body: { choices: [{ message: { role: "assistant", content: "Ok." } }], usage: usage(5, 1) } },
    ]);
    const uso = estado("gpt-x");
    const r = await ejecutarConversacion({ supabase: supabaseFalso(), claveOpenAI: "x", mensaje: "hola", modelo: "gpt-x", respaldo: "gpt-4.1-mini", uso, fetchImpl: ai.f });
    expect(r.modelo).toBe("gpt-4.1-mini");
    expect(uso.usosChat.map((a) => a.modelo)).toEqual(["gpt-x", "gpt-4.1-mini"]);
  });

  it("parametrosExtra (solo evaluación) pisa reasoning_effort; la traza guarda el error de la herramienta", async () => {
    const sb = supabaseFalso();
    sb.rpc = ((fn: string) => fn === "estadisticas_globales_agente"
      ? Promise.resolve({ data: null, error: { message: "canceling statement due to statement timeout" } })
      : Promise.resolve({ data: [], error: null })) as typeof sb.rpc;
    const ai = openaiFalso([
      { body: { choices: [{ message: { role: "assistant", content: null, tool_calls: [llamadaTool("estadisticas_globales")] } }], usage: usage(10, 2) } },
      { body: { choices: [{ message: { role: "assistant", content: "No he podido." } }], usage: usage(10, 2) } },
    ]);
    const traza: Traza = { llamadas: [], herramientas: [] };
    const auditadas: unknown[] = [];
    await ejecutarConversacion({
      supabase: sb, claveOpenAI: "x", mensaje: "hola", modelo: "gpt-6.1-sol", uso: estado("gpt-6.1-sol"), traza, fetchImpl: ai.f,
      parametrosExtra: { reasoning_effort: "low" }, alEjecutarHerramienta: (h) => auditadas.push(h),
    });
    expect((ai.cuerpos[0] as { reasoning_effort: string }).reasoning_effort).toBe("low");
    expect(traza.herramientas[0]).toMatchObject({ resultado: "fallida", error: expect.stringContaining("statement timeout") });
    expect(auditadas[0]).not.toHaveProperty("error");
  });

  it("sin respaldo, el error de OpenAI se lanza (el llamante lo traduce)", async () => {
    const ai = openaiFalso([{ status: 500, body: "fallo" }]);
    await expect(ejecutarConversacion({ supabase: supabaseFalso(), claveOpenAI: "x", mensaje: "hola", modelo: "gpt-6-sol", uso: estado("gpt-6-sol"), fetchImpl: ai.f }))
      .rejects.toThrow(/OpenAI chat 500/);
  });
});

describe("chat-facturas · respaldo semantico de compras_producto (11/11/2026)", () => {
  // Caso real: «chuletero de ternera a Embajadores» sin coincidencia -> el embedding fallaba y el bot
  // contestaba «problema tecnico». El respaldo es solo un extra de sugerencias.
  it("si el embedding falla, se responde con el resultado sin datos y NO es fallo de herramienta", async () => {
    const sinDatos = { buscado: "chuletero ternera", coincidencia: "ninguna", sin_datos: true, nota: "No hay compras" };
    const sb = {
      rpcs: [] as { fn: string; args: unknown }[],
      rpc(fn: string, args: unknown) {
        this.rpcs.push({ fn, args });
        if (fn === "compras_producto_agente") return Promise.resolve({ data: sinDatos, error: null });
        return Promise.resolve({ data: fn === "asociar_termino_agente" ? null : [], error: null });
      },
      from() { throw new Error("no"); },
    };
    const ai = openaiFalso([
      { body: { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "compras_producto", arguments: JSON.stringify({ producto: "chuletero ternera", proveedor: "Grupo Embajadores" }) } }] } }], usage: usage(10, 5) } },
      { body: { choices: [{ message: { role: "assistant", content: "No hay chuletero de ternera de Embajadores." } }], usage: usage(10, 5) } },
    ]);
    const f = (async (url: string, init: RequestInit) => {
      if (String(url).includes("/embeddings")) return new Response("boom", { status: 500 });
      return ai.f(url, init);
    }) as unknown as typeof fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await ejecutarConversacion({ supabase: sb as any, claveOpenAI: "x", mensaje: "chuletero de ternera a grupo embajadores", modelo: "gpt-x", uso: estado("gpt-x"), fetchImpl: f });
    expect(r.huboFalloDeHerramienta).toBe(false);
    expect(r.respuesta).toContain("Embajadores");
    const llamada = sb.rpcs.find((x) => x.fn === "compras_producto_agente")!.args as Record<string, unknown>;
    expect(llamada.p_proveedor).toBe("Grupo Embajadores");
    expect(llamada.p_texto).toBe("chuletero ternera");
  });
});
