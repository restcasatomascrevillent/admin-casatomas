import { describe, expect, it } from "vitest";
import { ejecutarConversacion, type EstadoUso, type Traza } from "../bucle.ts";
import {
  datosIncidencia,
  esConsultaDeVino,
  MAX_CHARS_FILTRAR,
  MAX_PREGUNTA_INCIDENCIA,
  MAX_VINOS_CARTA,
  motivoDeError,
  prepararLlamada,
  resultadoVacio,
  resumenVinoCarta,
  sinCompras,
} from "../herramientas.ts";

// Arreglos de la evaluación de 123 preguntas reales (17/11/2026): falsos «no hay»,
// vinos por botella, fallos sin rastro y «no hay» que animan a valorar.

function acumulador(modelo: string) {
  return { modelo, llamadas: 0, sumar() { this.llamadas++; }, marcarError() { /* sin uso */ } };
}
function estado(modelo: string): EstadoUso {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { usosChat: [acumulador(modelo) as any], usoEmbed: acumulador("emb") as any, nuevoAcumuladorChat: (m) => acumulador(m) as any };
}
/** Supabase de mentira: `respuestas[fn]` es el dato (o una función de los argumentos). */
function supabaseFalso(respuestas: Record<string, unknown>) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    rpcs,
    rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      if (fn === "asociar_pregunta_agente" || fn === "meses_compras_incompletos") return Promise.resolve({ data: [], error: null });
      const r = respuestas[fn];
      const data = typeof r === "function" ? (r as (a: Record<string, unknown>) => unknown)(args) : r ?? null;
      return Promise.resolve({ data, error: null });
    },
    from() {
      const q = { select: () => q, in: () => q, limit: () => Promise.resolve({ data: [], error: null }) };
      return q;
    },
  };
}
function openaiFalso(mensajes: unknown[]) {
  const cuerpos: { messages: { role: string; content: string }[] }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    if (String(url).endsWith("/embeddings")) {
      return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }], usage: { prompt_tokens: 3 } }), { status: 200 });
    }
    cuerpos.push(JSON.parse(String(init.body)));
    const message = mensajes.shift();
    if (!message) throw new Error("llamada de más a OpenAI");
    return new Response(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, cuerpos };
}
const tool = (nombre: string, args: unknown) => ({
  role: "assistant", content: null,
  tool_calls: [{ id: "t1", type: "function", function: { name: nombre, arguments: JSON.stringify(args) } }],
});
const resultadoTool = (ai: ReturnType<typeof openaiFalso>) =>
  JSON.parse(ai.cuerpos[1].messages.filter((m) => m.role === "tool").at(-1)!.content);

const ASOC_VINO = { tipo: "producto", categoria: "Vinos", familia: "Bebidas" };
const VINO_CARTA = {
  vinos: [{
    nombre: "Laurent‑Perrier La Cuvée", precio_carta: 68, coste_botella: 38.9, coste_factura: 40.19, botellas_sin_cargo: 4,
    multiplicador: 1.59, estado: "bajo", producto_comprado: "La Cuvée 75 cl", categoria: "CHAMPAGNE", precio_sugerido: 98,
    ultima_factura: { fecha: "2026-08-31", proveedor: "Marqués de Riscal", numero: "VFN 26/009277", precio: 241.14, unidad: "caja" },
  }],
};

describe("vinos: coste efectivo por botella junto a la consulta del producto", () => {
  it("compras_producto de un vino pide a la vez el coste de la carta y lo pone delante", async () => {
    const sb = supabaseFalso({
      asociar_termino_agente: ASOC_VINO,
      compras_producto_agente: { buscado: "laurent perrier", total: { importe: 26047.26, lineas: 5 } },
      margenes_carta_agente: VINO_CARTA,
    });
    const ai = openaiFalso([
      tool("compras_producto", { producto: "laurent perrier", desde: null, hasta: null, tipo: null, orden: null, excluir: null, unidad: null, proveedor: null }),
      { role: "assistant", content: "La botella te sale a 38,90 €." },
    ]);
    const r = await ejecutarConversacion({
      supabase: sb, claveOpenAI: "x", mensaje: "A cuánto compro el Laurent Perrier", modelo: "gpt-4.1-mini", uso: estado("gpt-4.1-mini"),
      fetchImpl: ai.f, hoy: "2026-11-17",
    });
    expect(sb.rpcs.find((x) => x.fn === "margenes_carta_agente")?.args).toMatchObject({ p_texto: "laurent perrier", p_vista: "vinos" });
    const visto = resultadoTool(ai);
    expect(Object.keys(visto)[0]).toBe("vino_carta");
    expect(visto.vino_carta.vinos[0]).toMatchObject({ coste_botella: 38.9, precio_carta: 68, multiplicador: 1.59, botellas_sin_cargo: 4 });
    expect(visto.vino_carta.vinos[0].ultima_factura).toEqual({ fecha: "2026-08-31", proveedor: "Marqués de Riscal", numero: "VFN 26/009277" });
    expect(visto.vino_carta.como_leer).toMatch(/nunca en €\/litro/);
    expect(r.sinDatos).toBe(false);
  });

  it("un producto que no es vino no consulta la carta; una familia desviada a volumen tampoco", () => {
    const ll = prepararLlamada("compras_producto", { producto: "gamba roja" }, "kilos de gamba roja", { tipo: "producto", categoria: "Marisco" });
    expect(esConsultaDeVino(ll, { tipo: "producto", categoria: "Marisco" })).toBe(false);
    expect(esConsultaDeVino(ll, ASOC_VINO as never)).toBe(true);
    const familia = prepararLlamada("compras_producto", { producto: "vino" }, "cuánto vino", { tipo: "familia", categoria: "Vinos" });
    expect(esConsultaDeVino(familia, { tipo: "familia", categoria: "Vinos" })).toBe(false);
  });

  it("resumenVinoCarta: solo lo necesario, con tope, y null si la carta no tiene ese vino", () => {
    expect(resumenVinoCarta({ vinos: [] })).toBeNull();
    expect(resumenVinoCarta(null)).toBeNull();
    const r = resumenVinoCarta({ vinos: Array.from({ length: 9 }, () => VINO_CARTA.vinos[0]) })!;
    expect(r.vinos).toHaveLength(MAX_VINOS_CARTA);
    expect(r.vinos[0]).not.toHaveProperty("precio_sugerido");
    expect(r.vinos[0]).not.toHaveProperty("categoria");
  });
});

describe("antes de decir «no hay»: historial_precios y grafico_precio prueban como compras_producto", () => {
  it("historial sin compras → compras_producto_agente y, si tampoco, el respaldo por significado", async () => {
    const sb = supabaseFalso({
      historial_precios_agente: { producto_consultado: "sierra cantabria primeur", compras_encontradas: 0, compras: [] },
      compras_producto_agente: (a: Record<string, unknown>) => a.p_embedding
        ? { buscado: "sierra cantabria primeur", sin_datos: true, coincidencia: "semantica", sugerencias: ["S. CANTABRIA 25 PRIMEUR 3/4x6b"] }
        : { buscado: "sierra cantabria primeur", sin_datos: true, coincidencia: "ninguna" },
    });
    const ai = openaiFalso([
      tool("historial_precios", { producto: "sierra cantabria primeur" }),
      { role: "assistant", content: "No hay compras con ese nombre. ¿Es «S. CANTABRIA 25 PRIMEUR»?" },
    ]);
    const traza: Traza = { llamadas: [], herramientas: [] };
    const r = await ejecutarConversacion({
      supabase: sb, claveOpenAI: "x", mensaje: "Precio botella Sierra Cantabria primeur", modelo: "gpt-4.1-mini", uso: estado("gpt-4.1-mini"),
      fetchImpl: ai.f, hoy: "2026-11-17", traza,
    });
    expect(sb.rpcs.map((x) => x.fn).filter((f) => f.endsWith("_agente") && !f.startsWith("asociar"))).toEqual([
      "historial_precios_agente", "compras_producto_agente", "compras_producto_agente",
    ]);
    expect(resultadoTool(ai).sugerencias).toEqual(["S. CANTABRIA 25 PRIMEUR 3/4x6b"]);
    expect(traza.herramientas[0].resultado).toBe("completada");
    // Todas las consultas vacías: el panel preguntará si debería haber datos.
    expect(r.sinDatos).toBe(true);
    expect(r.sinRespuesta).toBe(false);
  });

  it("sinCompras: solo el vacío de verdad (ni subproductos ni errores)", () => {
    expect(sinCompras("historial_precios", { compras_encontradas: 0, compras: [] })).toBe(true);
    expect(sinCompras("historial_precios", { compras_encontradas: 0, subproductos: ["Espinas de rape"] })).toBe(false);
    expect(sinCompras("historial_precios", { compras_encontradas: 3 })).toBe(false);
    expect(sinCompras("grafico_precio", { sin_datos: true, buscado: "x" })).toBe(true);
    expect(sinCompras("grafico_precio", { error: "x", sin_datos: true })).toBe(false);
    expect(sinCompras("compras_producto", { sin_datos: true })).toBe(false);
  });
});

describe("totales siempre de la base de datos", () => {
  it("filtrar_documentos deja sitio a las sumas, como_leer y por_mes", () => {
    const ll = prepararLlamada("filtrar_documentos", { filtro: "todos", texto: "acciona", desde: "2026-01-01", hasta: "2026-12-31" });
    expect(ll.tipo === "rpc" && ll.maxChars).toBe(MAX_CHARS_FILTRAR);
  });
});

describe("incidencias: lo que se registra en fallos_internos (chat_error)", () => {
  it("motivo de cada tipo de error", () => {
    expect(motivoDeError("timeout: presupuesto de tiempo agotado")).toBe("tiempo_agotado");
    expect(motivoDeError("The operation was aborted")).toBe("tiempo_agotado");
    expect(motivoDeError("OpenAI chat 429: rate limit")).toBe("ia_saturada");
    expect(motivoDeError("OpenAI chat 401: bad key")).toBe("ia_configuracion");
    expect(motivoDeError("OpenAI chat 500: x")).toBe("ia_no_responde");
    expect(motivoDeError("Unexpected token")).toBe("error");
  });

  it("datos sin usuario: pregunta recortada, duración, motivo y herramientas acotadas", () => {
    const d = datosIncidencia({
      motivo: "herramienta_fallida", pregunta: "  chuletero   de ternera\n" + "x".repeat(500), duracionMs: 20_123.7, modelo: "gpt-6.1-terra",
      herramientas: Array.from({ length: 12 }, (_, i) => ({ nombre: "compras_producto", resultado: "fallida", duracion_ms: i, error: "e".repeat(400) })),
    });
    expect(d.motivo).toBe("herramienta_fallida");
    expect(String(d.pregunta).startsWith("chuletero de ternera x")).toBe(true);
    expect(String(d.pregunta).length).toBe(MAX_PREGUNTA_INCIDENCIA + 1);
    expect(d.duracion_ms).toBe(20124);
    expect(d.herramientas).toHaveLength(8);
    expect((d.herramientas as { error: string }[])[0].error).toHaveLength(200);
    expect(JSON.stringify(d)).not.toMatch(/usuario|email|user/i);
  });

  it("resultadoVacio: sin_datos o lista vacía; con vino de la carta o JSON cortado, no", () => {
    expect(resultadoVacio(JSON.stringify({ sin_datos: true }))).toBe(true);
    expect(resultadoVacio(JSON.stringify({ resultados: [], truncado: false }))).toBe(true);
    expect(resultadoVacio(JSON.stringify({ vino_carta: { vinos: [{}] }, sin_datos: true }))).toBe(false);
    expect(resultadoVacio(JSON.stringify({ total: { importe: 3 } }))).toBe(false);
    expect(resultadoVacio('{"filas":[{"id":1')).toBe(false);
  });

  it("sin respuesta redactada: se marca sinRespuesta (el handler la registra)", async () => {
    const sb = supabaseFalso({});
    const ai = openaiFalso([{ role: "assistant", content: "" }]);
    const r = await ejecutarConversacion({
      supabase: sb, claveOpenAI: "x", mensaje: "Dime el precio del bonito", modelo: "gpt-4.1-mini", uso: estado("gpt-4.1-mini"),
      fetchImpl: ai.f, hoy: "2026-11-17",
    });
    expect(r.sinRespuesta).toBe(true);
    expect(r.respuesta).toMatch(/No he conseguido resolver/);
  });
});
