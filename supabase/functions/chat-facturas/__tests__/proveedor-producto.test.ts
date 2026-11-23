// Producto que es un proveedor, y al revés (23/11/2026).
// Conversación real de producción (20/11/2026): «Detállame el gasto de suministros altamira» → el modelo
// la buscó como producto y la respuesta fue «No encuentro "suministros altamira"». Con la migración
// 20261217100000 la búsqueda de productos devuelve `es_proveedor` y la ficha de proveedor `es_producto`;
// el bucle consulta entonces lo que toca en la misma ronda.
import { describe, expect, it } from "vitest";
import { ejecutarConversacion, type EstadoUso, type Traza } from "../bucle.ts";
import { ayudaDeResultado } from "../hilo.ts";
import { necesitaRespaldoSemantico, notaDesvioProducto, notaDesvioProveedor, productoPedido, proveedorPedido, resultadoVacio } from "../herramientas.ts";

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

/** Supabase de mentira: cada RPC contesta lo que diga `respuestas` (por nombre) y apunta la llamada. */
function supabaseFalso(respuestas: Record<string, (args: Record<string, unknown>) => unknown>) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    rpcs,
    rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      if (fn === "asociar_pregunta_agente" || fn === "meses_compras_incompletos") return Promise.resolve({ data: [], error: null });
      if (fn === "asociar_termino_agente") return Promise.resolve({ data: null, error: null });
      const r = respuestas[fn];
      if (!r) return Promise.resolve({ data: null, error: { message: `RPC inesperada: ${fn}` } });
      return Promise.resolve({ data: r(args), error: null });
    },
    from() { return { select: () => ({ in: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }; },
  };
}

function openaiFalso(mensajes: unknown[]) {
  const cuerpos: Record<string, unknown>[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    cuerpos.push(JSON.parse(String(init.body)));
    const m = mensajes.shift();
    if (!m) throw new Error("llamada de más a OpenAI");
    return new Response(JSON.stringify({ choices: [{ message: m }], usage: { prompt_tokens: 100, completion_tokens: 10 } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, cuerpos };
}

const tool = (nombre: string, args: Record<string, unknown>) => ({
  role: "assistant", content: null,
  tool_calls: [{ id: "t1", type: "function", function: { name: nombre, arguments: JSON.stringify(args) } }],
});

/** El resultado de herramienta que recibió el modelo en la segunda llamada. */
function resultadoVisto(cuerpos: Record<string, unknown>[]): Record<string, unknown> {
  const ms = cuerpos[1].messages as { role: string; content: string }[];
  return JSON.parse(ms.filter((m) => m.role === "tool").pop()!.content);
}

const ES_PROVEEDOR = {
  buscado: "suministros altamira", coincidencia: "proveedor", sin_datos: true,
  es_proveedor: "SUMINISTROS HOSTELEROS ALTAMIRA, S. L.",
  nota: "«suministros altamira» no es un producto: es el proveedor SUMINISTROS HOSTELEROS ALTAMIRA, S. L..",
};
const FICHA = { proveedor: "SUMINISTROS HOSTELEROS ALTAMIRA, S. L.", docs: 25, gasto: 50423.88, top_productos: [{ producto: "Detergente", ultimo_precio: 20 }] };

describe("lo pedido como producto es un proveedor", () => {
  it("proveedorPedido: solo con sin_datos y es_proveedor", () => {
    expect(proveedorPedido(ES_PROVEEDOR)).toBe("SUMINISTROS HOSTELEROS ALTAMIRA, S. L.");
    expect(proveedorPedido({ sin_datos: true, sugerencias: ["x"] })).toBeNull();
    expect(proveedorPedido({ es_proveedor: "X", total: { importe: 3 } })).toBeNull();
    expect(proveedorPedido({ error: "x", sin_datos: true, es_proveedor: "X" })).toBeNull();
    expect(proveedorPedido({ sin_datos: true, es_proveedor: "  " })).toBeNull();
    expect(proveedorPedido(null)).toBeNull();
    expect(proveedorPedido([])).toBeNull();
  });

  it("no gasta el embedding de sugerencias: no es un «no hay»", () => {
    expect(necesitaRespaldoSemantico(ES_PROVEEDOR)).toBe(false);
  });

  it("«gasto de suministros altamira» por compras_producto: el modelo recibe la ficha del proveedor en la misma ronda", async () => {
    const sb = supabaseFalso({
      compras_producto_agente: () => ES_PROVEEDOR,
      ficha_proveedor_agente: () => FICHA,
    });
    const ai = openaiFalso([
      tool("compras_producto", { producto: "suministros altamira", orden: "importe" }),
      { role: "assistant", content: "El gasto con Suministros Hosteleros Altamira es de 50.423,88 €." },
    ]);
    const traza: Traza = { llamadas: [], herramientas: [] };
    const r = await ejecutarConversacion({
      supabase: sb, claveOpenAI: "k", mensaje: "Detállame el gasto de suministros altamira", modelo: "gpt-4.1-mini",
      uso: estado("gpt-4.1-mini"), traza, fetchImpl: ai.f,
    });
    expect(sb.rpcs.map((x) => x.fn)).toContain("ficha_proveedor_agente");
    expect(sb.rpcs.find((x) => x.fn === "ficha_proveedor_agente")!.args).toEqual({ p_texto: "SUMINISTROS HOSTELEROS ALTAMIRA, S. L." });
    const visto = resultadoVisto(ai.cuerpos);
    expect(visto.gasto).toBe(50423.88);
    expect(visto.sin_datos).toBeUndefined();
    expect(String(visto.nota_ruta)).toBe(notaDesvioProveedor("suministros altamira", "SUMINISTROS HOSTELEROS ALTAMIRA, S. L."));
    expect(r.sinDatos).toBe(false);
    expect(r.respuesta).toContain("50.423,88");
  });

  it("si la ficha falla, se queda el aviso de que es un proveedor (el modelo puede llamarla)", async () => {
    const sb = supabaseFalso({ compras_producto_agente: () => ES_PROVEEDOR });   // ficha_proveedor_agente → error
    const ai = openaiFalso([
      tool("compras_producto", { producto: "suministros altamira" }),
      { role: "assistant", content: "Es un proveedor." },
    ]);
    await ejecutarConversacion({
      supabase: sb, claveOpenAI: "k", mensaje: "gasto de suministros altamira", modelo: "gpt-4.1-mini",
      uso: estado("gpt-4.1-mini"), fetchImpl: ai.f,
    });
    const visto = resultadoVisto(ai.cuerpos);
    expect(visto.es_proveedor).toBe("SUMINISTROS HOSTELEROS ALTAMIRA, S. L.");
    expect(visto.sin_datos).toBe(true);
  });

  it("historial_precios sin compras cae a compras_producto y, si es un proveedor, a su ficha", async () => {
    const sb = supabaseFalso({
      historial_precios_agente: () => ({ compras: [], compras_encontradas: 0, producto_consultado: "suministros altamira" }),
      compras_producto_agente: () => ES_PROVEEDOR,
      ficha_proveedor_agente: () => FICHA,
    });
    const ai = openaiFalso([
      tool("historial_precios", { producto: "suministros altamira" }),
      { role: "assistant", content: "Altamira: 50.423,88 €." },
    ]);
    await ejecutarConversacion({
      supabase: sb, claveOpenAI: "k", mensaje: "precios de suministros altamira", modelo: "gpt-4.1-mini",
      uso: estado("gpt-4.1-mini"), fetchImpl: ai.f,
    });
    expect(sb.rpcs.map((x) => x.fn).filter((f) => f.endsWith("_agente") && !f.startsWith("asociar"))).toEqual([
      "historial_precios_agente", "compras_producto_agente", "ficha_proveedor_agente",
    ]);
    expect(resultadoVisto(ai.cuerpos).gasto).toBe(50423.88);
  });
});

describe("lo pedido como proveedor es un producto", () => {
  const SIN_PROVEEDOR = { buscado: "leon beyer", sin_datos: true, es_producto: true, nota: "Ningun proveedor se llama exactamente asi." };
  const COMPRAS = { buscado: "leon beyer", coincidencia: "aproximada", total: { lineas: 1, importe: 97.5 }, ultima_factura: { numero: "FV26072899", precio_unitario: 16.25 } };

  it("productoPedido: solo ficha_proveedor sin datos, con es_producto y sin proveedores parecidos", () => {
    expect(productoPedido("ficha_proveedor", SIN_PROVEEDOR)).toBe(true);
    expect(productoPedido("ficha_proveedor", { ...SIN_PROVEEDOR, proveedores_parecidos: ["Beyer S.L."] })).toBe(false);
    expect(productoPedido("ficha_proveedor", { sin_datos: true })).toBe(false);
    expect(productoPedido("ficha_proveedor", { proveedor: "X", gasto: 3, es_producto: true })).toBe(false);
    expect(productoPedido("compras_producto", SIN_PROVEEDOR)).toBe(false);
    expect(productoPedido("ficha_proveedor", null)).toBe(false);
  });

  it("ficha_proveedor de un producto: el modelo recibe sus compras", async () => {
    const sb = supabaseFalso({
      ficha_proveedor_agente: () => SIN_PROVEEDOR,
      compras_producto_agente: () => COMPRAS,
    });
    const ai = openaiFalso([
      tool("ficha_proveedor", { proveedor: "leon beyer" }),
      { role: "assistant", content: "16,25 € por botella." },
    ]);
    await ejecutarConversacion({
      supabase: sb, claveOpenAI: "k", mensaje: "leon beyer", modelo: "gpt-4.1-mini",
      uso: estado("gpt-4.1-mini"), fetchImpl: ai.f,
    });
    expect(sb.rpcs.find((x) => x.fn === "compras_producto_agente")!.args.p_texto).toBe("leon beyer");
    const visto = resultadoVisto(ai.cuerpos);
    expect((visto.ultima_factura as { precio_unitario: number }).precio_unitario).toBe(16.25);
    expect(String(visto.nota_ruta)).toBe(notaDesvioProducto("leon beyer"));
  });

  it("si tampoco hay compras, se queda el «no hay proveedor»", async () => {
    const sb = supabaseFalso({
      ficha_proveedor_agente: () => SIN_PROVEEDOR,
      compras_producto_agente: () => ({ buscado: "leon beyer", sin_datos: true, coincidencia: "ninguna" }),
    });
    const ai = openaiFalso([
      tool("ficha_proveedor", { proveedor: "leon beyer" }),
      { role: "assistant", content: "No lo encuentro." },
    ]);
    await ejecutarConversacion({
      supabase: sb, claveOpenAI: "k", mensaje: "leon beyer", modelo: "gpt-4.1-mini",
      uso: estado("gpt-4.1-mini"), fetchImpl: ai.f,
    });
    expect(resultadoVisto(ai.cuerpos).es_producto).toBe(true);
  });
});

describe("búsqueda por partes: lo que ve el panel", () => {
  it("las sugerencias por partes salen como botones («¿Es alguno de estos?»)", () => {
    const d = {
      buscado: "copas riedel", sin_datos: true, coincidencia: "ninguna",
      sugerencias: ["COPA INVENTA7BARTENDER CHAMPAGNE 30CL", "COPAS SERIGRAF CASA TOMAS 6 UNID.* 1", "COPA SPIEGELAU VINO RISCAL"],
    };
    expect(ayudaDeResultado(JSON.stringify(d)).sugerencias).toEqual(d.sugerencias);
    expect(resultadoVacio(JSON.stringify(d))).toBe(true);
  });

  it("un producto encontrado por partes («leon beyer» = «L.Beyer…») no es un «no hay»", () => {
    const d = {
      por_partes: { nota: "Ninguna linea lleva juntas todas las palabras…" }, coincidencia: "aproximada",
      total: { lineas: 1, importe: 97.5 }, productos_coincidentes: [{ nombre: "L.Beyer Gewurztraminer 2021 (cód. 730226)", lineas: 1 }],
    };
    expect(resultadoVacio(JSON.stringify(d))).toBe(false);
    expect(necesitaRespaldoSemantico(d)).toBe(false);
  });
});
