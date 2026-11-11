import { describe, expect, it } from "vitest";
import {
  ejecutarConversacion, esSeguimiento, MAX_CHARS_HISTORIAL, MAX_MENSAJES_HISTORIAL, pistaDelHilo,
  recortarHistorial, resumenDeResultado, type EstadoUso, type Traza, type TurnoHistorial,
} from "../bucle.ts";
import { contextoDeAdjuntos, trazaParaPanel } from "../hilo.ts";
import { TOOLS } from "../herramientas.ts";

// Mismos dobles que bucle.test.ts (acumulador, Supabase y OpenAI de mentira).
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = acumulador(modelo) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { usosChat: [a], usoEmbed: acumulador("text-embedding-3-small") as any, nuevoAcumuladorChat: (m) => acumulador(m) as any };
}
function supabaseFalso() {
  return {
    rpc(fn: string, _args: unknown) {
      if (fn === "asociar_pregunta_agente" || fn === "meses_compras_incompletos") return Promise.resolve({ data: [], error: null });
      if (fn === "asociar_termino_agente") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: { total_documentos: 3 }, error: null });
    },
    from() { throw new Error("no se espera lectura de tablas en este test"); },
  };
}
function openaiFalso(respuestas: { body: unknown }[]) {
  const cuerpos: Record<string, unknown>[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    cuerpos.push(JSON.parse(String(init.body)));
    const r = respuestas.shift();
    if (!r) throw new Error("llamada de más a OpenAI");
    return new Response(JSON.stringify(r.body), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, cuerpos };
}
const usage = { prompt_tokens: 10, completion_tokens: 2 };

type MensajeEnviado = {
  role: string;
  content: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

const anterior: TurnoHistorial[] = [
  { role: "user", content: "Dime precio de toda la ternera de embajadores" },
  {
    role: "assistant",
    content: "La ternera te sale a 12,40 €/kg de media.",
    herramientas: [{
      nombre: "consulta_flexible",
      argumentos: { fuente: "lineas", metricas: ["avg_precio_unitario"], agrupar: ["producto"], filtros: { proveedor: "embajadores", producto: "ternera", desde: null } },
      resumen: { proveedores: ["CARNES EMBAJADORES SL"], productos: ["TERNERA LOMO", "TERNERA FALDA"] },
    }],
  },
];

describe("chat-facturas · hilo de la conversación (11/11/2026)", () => {
  it("«Y de vaca»: llega el historial con la consulta anterior (proveedor) y el aviso de hilo", async () => {
    const ai = openaiFalso([{ body: { choices: [{ message: { role: "assistant", content: "La vaca de Embajadores…" } }], usage } }]);
    await ejecutarConversacion({
      supabase: supabaseFalso(), claveOpenAI: "x", mensaje: "Y de vaca", modelo: "gpt-6.1-terra", uso: estado("gpt-6.1-terra"),
      // El panel guarda la pregunta antes de llamar: viene repetida al final y no se duplica.
      historial: [...anterior, { role: "user", content: "Y de vaca" }],
      fetchImpl: ai.f, hoy: "2026-11-11", claveCache: "chat-facturas:abc",
    });
    const c = ai.cuerpos[0] as { prompt_cache_key: string; messages: MensajeEnviado[] };
    expect(c.prompt_cache_key).toBe("chat-facturas:abc");
    const m = c.messages;
    expect(m[0].role).toBe("system");
    expect(m[1]).toEqual({ role: "user", content: "Dime precio de toda la ternera de embajadores" });
    // La respuesta anterior se reconstruye como tool_call + resultado resumido + texto.
    expect(m[2].role).toBe("assistant");
    expect(m[2].tool_calls?.[0].function.name).toBe("consulta_flexible");
    expect(JSON.parse(m[2].tool_calls![0].function.arguments).filtros).toEqual({ proveedor: "embajadores", producto: "ternera" });
    expect(m[3]).toMatchObject({ role: "tool", tool_call_id: m[2].tool_calls![0].id });
    expect(m[3].content).toContain("CARNES EMBAJADORES SL");
    expect(m[4]).toEqual({ role: "assistant", content: "La ternera te sale a 12,40 €/kg de media." });
    // Aviso final con la fecha y el hilo, y la pregunta UNA sola vez al final.
    const aviso = m.at(-2)!;
    expect(aviso.role).toBe("system");
    expect(aviso.content).toContain("FECHA: hoy es 2026-11-11");
    expect(aviso.content).toContain("HILO");
    expect(aviso.content).toContain("ternera de embajadores");
    expect(aviso.content).toContain("CARNES EMBAJADORES SL");
    expect(m.at(-1)).toEqual({ role: "user", content: "Y de vaca" });
    expect(m.filter((x) => x.role === "user" && x.content === "Y de vaca")).toHaveLength(1);
  });

  it("la traza apunta proveedores y productos del resultado, y vuelve como contexto del siguiente turno", async () => {
    const sb = supabaseFalso();
    sb.rpc = ((fn: string) => fn === "consulta_flexible_agente"
      ? Promise.resolve({ data: { filas: [{ proveedor: "CARNES EMBAJADORES SL", producto: "VACA CHULETON", avg_precio_unitario: 20 }] }, error: null })
      : Promise.resolve({ data: [], error: null })) as typeof sb.rpc;
    const args = { fuente: "lineas", metricas: ["avg_precio_unitario"], agrupar: ["producto"], filtros: { proveedor: "embajadores", producto: "vaca" }, orden_por: null, orden_dir: null, limite: null };
    const ai = openaiFalso([
      { body: { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "consulta_flexible", arguments: JSON.stringify(args) } }] } }], usage } },
      { body: { choices: [{ message: { role: "assistant", content: "20 €/kg." } }], usage } },
    ]);
    const traza: Traza = { llamadas: [], herramientas: [] };
    await ejecutarConversacion({ supabase: sb, claveOpenAI: "x", mensaje: "precio de la vaca de embajadores", modelo: "gpt-4.1-mini", uso: estado("gpt-4.1-mini"), traza, fetchImpl: ai.f });
    expect(traza.herramientas[0].resumen).toEqual({ proveedores: ["CARNES EMBAJADORES SL"], productos: ["VACA CHULETON"] });
    const panel = trazaParaPanel(traza);
    expect(panel.herramientas[0]).toMatchObject({ nombre: "consulta_flexible", resultado: "completada", resumen: { proveedores: ["CARNES EMBAJADORES SL"] } });
    expect(panel.herramientas[0]).not.toHaveProperty("duracion_ms");
    expect(contextoDeAdjuntos([{ tipo: "documentos", datos: [] }, { tipo: "contexto", datos: panel }])).toEqual([
      { nombre: "consulta_flexible", argumentos: args, resumen: { proveedores: ["CARNES EMBAJADORES SL"], productos: ["VACA CHULETON"] } },
    ]);
    expect(contextoDeAdjuntos(null)).toEqual([]);
    expect(contextoDeAdjuntos([{ tipo: "contexto", datos: { herramientas: [{ nombre: "DROP TABLE" }, { nombre: "ranking", resultado: "no_ejecutada" }] } }])).toEqual([]);
  });

  it("recortarHistorial: últimos 10 mensajes, tope por turno y total, empieza por el usuario", () => {
    const largo = Array.from({ length: 14 }, (_, i): TurnoHistorial => ({ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` }));
    const r = recortarHistorial(largo);
    expect(r).toHaveLength(MAX_MENSAJES_HISTORIAL);
    expect(r[0]).toMatchObject({ role: "user", content: "m4" });
    const enorme = recortarHistorial([{ role: "user", content: "x".repeat(5000) }, { role: "assistant", content: "y" }]);
    expect(enorme[0].content.length).toBeLessThan(2100);
    const muchos = recortarHistorial(Array.from({ length: 10 }, (_, i): TurnoHistorial => ({ role: i % 2 === 0 ? "user" : "assistant", content: "z".repeat(1900) })));
    expect(muchos.reduce((s, m) => s + m.content.length, 0)).toBeLessThanOrEqual(MAX_CHARS_HISTORIAL);
    expect(muchos[0].role).toBe("user");
  });

  it("esSeguimiento, pistaDelHilo y resumenDeResultado", () => {
    expect(esSeguimiento("Y de vaca")).toBe(true);
    expect(esSeguimiento("¿y en cerveza?")).toBe(true);
    expect(esSeguimiento("hazme la comparativa")).toBe(true);
    expect(esSeguimiento("cuántos litros de cerveza he comprado este año")).toBe(false);
    expect(pistaDelHilo(anterior, "cuánto he gastado en octubre en total")).toBeNull();
    expect(pistaDelHilo([], "Y de vaca")).toBeNull();
    const json = JSON.stringify({ filas: [{ proveedor: "A", producto: 'B "x"' }, { proveedor_txt: "C" }] }) + '…{"proveedor":"';
    expect(resumenDeResultado(json)).toEqual({ proveedores: ["A", "C"], productos: ['B "x"'] });
  });
});

describe("chat-facturas · herramientas en modo strict (structured outputs)", () => {
  // Reglas de OpenAI para strict: todo objeto con additionalProperties false y
  // TODAS sus propiedades en required (las opcionales admiten null).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function comprobar(esquema: any, ruta: string) {
    if (!esquema || typeof esquema !== "object") return;
    const tipos = Array.isArray(esquema.type) ? esquema.type : [esquema.type];
    if (tipos.includes("object")) {
      expect(esquema.additionalProperties, ruta).toBe(false);
      expect([...(esquema.required ?? [])].sort(), ruta).toEqual(Object.keys(esquema.properties ?? {}).sort());
      for (const [k, v] of Object.entries(esquema.properties ?? {})) comprobar(v, `${ruta}.${k}`);
    }
    if (esquema.items) comprobar(esquema.items, `${ruta}[]`);
  }

  it("todas las herramientas llevan strict: true y un esquema válido para strict", () => {
    for (const t of TOOLS) {
      expect(t.function.strict, t.function.name).toBe(true);
      comprobar(t.function.parameters, t.function.name);
    }
  });
});
