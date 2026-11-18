/**
 * Presupuestos de proveedor en el chat de Facturas (16/11/2026): lectura,
 * normalizacion, turno de adjuntar (siempre pregunta el descuento) y la
 * herramienta comparar_presupuesto. Sin Deno ni red: OpenAI y Supabase de mentira.
 */
import { describe, expect, it, vi } from "vitest";
import {
  contenidoCanonico,
  mensajeTrasAdjuntar,
  normalizarPresupuesto,
  tipoDePresupuesto,
  unidadCanonica,
  unirEmparejadas,
} from "../presupuesto.ts";
import { procesarPresupuesto } from "../adjuntar.ts";
import { llamadaPresupuesto, prepararLlamada, TOOLS } from "../herramientas.ts";

const ID = "11111111-1111-1111-1111-111111111111";

describe("tipoDePresupuesto", () => {
  it("reconoce PDF, foto, Excel y CSV por MIME o por extension", () => {
    expect(tipoDePresupuesto("application/pdf", "a")).toBe("pdf");
    expect(tipoDePresupuesto("", "oferta.PDF")).toBe("pdf");
    expect(tipoDePresupuesto("image/jpeg", "f")).toBe("imagen");
    expect(tipoDePresupuesto("", "foto.png")).toBe("imagen");
    expect(tipoDePresupuesto("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "x")).toBe("excel");
    expect(tipoDePresupuesto("", "tarifa.xls")).toBe("excel");
    expect(tipoDePresupuesto("text/csv", "t")).toBe("csv");
    expect(tipoDePresupuesto("application/zip", "a.zip")).toBeNull();
  });
});

describe("normalizarPresupuesto", () => {
  it("unidades canonicas y contenido en kg/l (cl, ml y g se convierten)", () => {
    expect(unidadCanonica("Kilos")).toBe("kg");
    expect(unidadCanonica("botella")).toBe("ud");
    expect(unidadCanonica("Cajas")).toBe("caja");
    expect(contenidoCanonico(75, "cl")).toEqual({ cantidad: 0.75, unidad: "l" });
    expect(contenidoCanonico(500, "g")).toEqual({ cantidad: 0.5, unidad: "kg" });
    expect(contenidoCanonico(null, "kg")).toEqual({ cantidad: null, unidad: null });
  });

  it("descarta lineas sin producto o sin precio y lo avisa", () => {
    const r = normalizarPresupuesto({
      proveedor: " Luga ", fecha: "2026-11-10", precios_con_iva: false,
      lineas: [
        { producto: "Gamba roja", formato: null, unidad: "kg", contenido_cantidad: null, contenido_unidad: null, cantidad: 5, precio: 42.5, iva_pct: null },
        { producto: "", unidad: "kg", precio: 3 },
        { producto: "Sin precio", unidad: "kg", precio: 0 },
      ],
    });
    expect(r.proveedor).toBe("Luga");
    expect(r.fecha).toBe("2026-11-10");
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0]).toMatchObject({ producto: "Gamba roja", unidad: "kg", cantidad: 5, precio: 42.5 });
    expect(r.avisos.join(" ")).toMatch(/2 linea/);
  });

  it("precios con IVA incluido: se quita el IVA de cada linea; sin tipo, se avisa", () => {
    const r = normalizarPresupuesto({
      proveedor: null, fecha: null, precios_con_iva: true,
      lineas: [
        { producto: "A", unidad: "kg", precio: 110, iva_pct: 10 },
        { producto: "B", unidad: "kg", precio: 50, iva_pct: null },
      ],
    });
    expect(r.lineas[0].precio).toBe(100);
    expect(r.lineas[1].precio).toBe(50);
    expect(r.avisos.join(" ")).toMatch(/IVA incluido/);
  });
});

describe("unirEmparejadas / mensajeTrasAdjuntar", () => {
  it("une por posicion y deja sin producto lo que no casa", () => {
    const lineas = [
      { producto: "A", formato: null, unidad: "kg", contenido_cantidad: null, contenido_unidad: null, cantidad: null, precio: 1 },
      { producto: "B", formato: null, unidad: "kg", contenido_cantidad: null, contenido_unidad: null, cantidad: null, precio: 2 },
    ];
    const r = unirEmparejadas(lineas, [{ i: 1, producto_id: 7, producto_catalogo: "Aaa", metodo: "texto", confianza: "alta", similitud: 0.9 }, { i: 2 }]);
    expect(r[0]).toMatchObject({ producto_id: 7, confianza: "alta" });
    expect(r[1].producto_id).toBeUndefined();
  });

  it("la respuesta SIEMPRE pregunta por el descuento", () => {
    const t = mensajeTrasAdjuntar({ archivo: "p.pdf", proveedor: "Luga", lineas: 4, queCompras: 3, avisos: ["algo"] });
    expect(t).toMatch(/¿Este proveedor te aplica algún descuento\?/);
    expect(t).toMatch(/Luga/);
    expect(t).toMatch(/Aviso: algo/);
  });
});

/** OpenAI de mentira: chat/completions (lectura) y embeddings. */
function openaiFalso(lectura: unknown) {
  return vi.fn(async (url: string) => {
    if (String(url).endsWith("/chat/completions")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(lectura) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2] }, { index: 1, embedding: [0.3, 0.4] }], usage: { prompt_tokens: 4 } }), { status: 200 });
  }) as unknown as typeof fetch;
}

function supabaseFalso(opts: { rpcError?: string } = {}) {
  const insertado: unknown[] = [];
  const rpc = vi.fn(async (n: string, p: { p_lineas: unknown[] }) =>
    n === "nombres_compras_agente" ? { data: [{ n: "GAMBA ROJA HUELVA", p: 5, c: "Gamba" }], error: null } : opts.rpcError
      ? { data: null, error: { message: opts.rpcError } }
      : { data: p.p_lineas.map((_, i) => (i === 0 ? { i: 1, producto_id: 5, producto_catalogo: "Gamba", metodo: "texto", confianza: "alta" } : { i: i + 1 })), error: null });
  const from = vi.fn(() => ({
    delete: () => ({ lt: async () => ({}) }),
    insert: (fila: unknown) => { insertado.push(fila); return { select: () => ({ single: async () => ({ data: { id: ID }, error: null }) }) }; },
  }));
  return { cliente: { rpc, from }, rpc, insertado };
}

const LECTURA = {
  proveedor: "Mariscos Luga", fecha: "2026-11-10", precios_con_iva: false,
  lineas: [
    { producto: "Gamba roja", formato: "kg", unidad: "kg", contenido_cantidad: null, contenido_unidad: null, cantidad: 5, precio: 42, iva_pct: null },
    { producto: "Cosa rara", formato: null, unidad: "ud", contenido_cantidad: null, contenido_unidad: null, cantidad: null, precio: 3, iva_pct: null },
  ],
};

describe("procesarPresupuesto (turno de adjuntar)", () => {
  const base = { sessionId: "s1", usuarioId: "u1", clave: "k", modelo: "gpt-4.1-mini", parametros: { max_tokens: 100 } };

  it("lee, casa, guarda y SOLO pregunta el descuento (no compara)", async () => {
    const f = openaiFalso(LECTURA);
    const sb = supabaseFalso();
    const r = await procesarPresupuesto({
      ...base, supabase: sb.cliente, fetchImpl: f,
      adjunto: { nombre: "luga.pdf", mime: "application/pdf", base64: "QUJD" },
    });
    expect(r.success).toBe(true);
    expect(r.presupuesto_id).toBe(ID);
    expect(r.respuesta).toMatch(/¿Este proveedor te aplica algún descuento\?/);
    expect(r.respuesta).toMatch(/2 productos, 1 de ellos/);
    // Emparejar, nombres de compra (para las reglas fijas y la confirmación) y nada de comparar.
    expect(sb.rpc.mock.calls.map((c) => c[0])).toEqual(["emparejar_presupuesto_agente", "nombres_compras_agente"]);
    const fila = sb.insertado[0] as { session_id: string; lineas: Array<{ producto_id?: number }> };
    expect(fila.session_id).toBe("s1");
    expect(fila.lineas[0].producto_id).toBe(5);
    expect(fila.lineas[1].producto_id).toBeUndefined();
    // El PDF viaja como bloque `file`; los embeddings, en UNA llamada.
    const llamadas = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(JSON.stringify(JSON.parse((llamadas[0][1] as { body: string }).body).messages)).toMatch(/"type":"file"/);
    expect(llamadas.filter((c) => String(c[0]).endsWith("/embeddings"))).toHaveLength(1);
  });

  it("CSV: lectura determinista; la IA solo confirma las candidatas; Excel sin lector: se rechaza", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ parejas: [{ id: 0, opcion: 1, decision: "mismo_formato", motivo: "" }] }) } }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    }), { status: 200 })) as unknown as typeof fetch;
    const insertado: Array<Record<string, unknown>> = [];
    const cliente = {
      rpc: vi.fn(async () => ({ data: [{ n: "GAMBA ROJA HUELVA", p: 5, c: "Gamba roja" }], error: null })),
      from: vi.fn(() => ({
        delete: () => ({ lt: async () => ({}) }),
        insert: (fila: Record<string, unknown>) => { insertado.push(fila); return { select: () => ({ single: async () => ({ data: { id: ID }, error: null }) }) }; },
      })),
    };
    const csv = btoa("producto;precio\nGamba roja Huelva;42,5\nTornillos;0,10");
    const ok = await procesarPresupuesto({ ...base, supabase: cliente, fetchImpl: f, adjunto: { nombre: "t.csv", mime: "text/csv", base64: csv } });
    expect(ok.success).toBe(true);
    // UNA llamada (un lote) y solo con la candidata, no con toda la hoja.
    expect(f).toHaveBeenCalledTimes(1);
    const cuerpo = String(((f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as { body: string }).body);
    expect(cuerpo).toMatch(/Gamba roja Huelva/);
    expect(cuerpo).not.toMatch(/Tornillos/);
    expect(cliente.rpc).toHaveBeenCalledWith("nombres_compras_agente");
    expect(insertado[0]).toMatchObject({ lineas_sin_compra: 1, proveedor: null });
    expect(insertado[0].lineas).toMatchObject([{ producto_id: 5, confianza: "alta" }]);
    expect(ok.respuesta).toMatch(/¿De qué proveedor es y te aplica algún descuento\?/);
    expect(ok.respuesta).toMatch(/1 son artículos que no compras|otros 1 son/);
    const sinLector = await procesarPresupuesto({ ...base, supabase: cliente, fetchImpl: f, adjunto: { nombre: "t.xlsx", mime: "", base64: csv } });
    expect(sinLector.success).toBe(false);
  });

  it("rechaza tipos no admitidos, vacios y demasiado grandes sin llamar a OpenAI", async () => {
    const f = openaiFalso(LECTURA);
    const sb = supabaseFalso();
    const r1 = await procesarPresupuesto({ ...base, supabase: sb.cliente, fetchImpl: f, adjunto: { nombre: "a.zip", mime: "application/zip", base64: "QUJD" } });
    const r2 = await procesarPresupuesto({ ...base, supabase: sb.cliente, fetchImpl: f, adjunto: { nombre: "a.pdf", mime: "application/pdf", base64: "" } });
    const r3 = await procesarPresupuesto({ ...base, supabase: sb.cliente, fetchImpl: f, adjunto: { nombre: "a.pdf", mime: "application/pdf", base64: "A".repeat(12_000_000) } });
    expect([r1.success, r2.success, r3.success]).toEqual([false, false, false]);
    expect(r3.respuesta).toMatch(/8 MB/);
    expect(f).not.toHaveBeenCalled();
  });

  it("sin lineas legibles: lo dice y no guarda nada", async () => {
    const f = openaiFalso({ proveedor: null, fecha: null, precios_con_iva: null, lineas: [] });
    const sb = supabaseFalso();
    const r = await procesarPresupuesto({ ...base, supabase: sb.cliente, fetchImpl: f, adjunto: { nombre: "a.pdf", mime: "application/pdf", base64: "QUJD" } });
    expect(r.success).toBe(false);
    expect(sb.insertado).toHaveLength(0);
  });

  it("si falla el emparejado en BD, lanza (el handler lo convierte en mensaje)", async () => {
    const f = openaiFalso(LECTURA);
    const sb = supabaseFalso({ rpcError: "boom" });
    await expect(procesarPresupuesto({ ...base, supabase: sb.cliente, fetchImpl: f, adjunto: { nombre: "a.pdf", mime: "application/pdf", base64: "QUJD" } })).rejects.toThrow(/boom/);
  });
});

describe("comparar_presupuesto (herramienta)", () => {
  it("esta en TOOLS con descuento explicito y sin id (lo pone el servidor)", () => {
    const t = TOOLS.find((x) => x.function.name === "comparar_presupuesto")!.function;
    const props = (t.parameters as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(["descuento_tipo", "descuento_valor", "proveedor"]);
  });

  it("porcentaje, importe y ninguno van a la RPC con el id del servidor", () => {
    const pct = llamadaPresupuesto({ descuento_tipo: "porcentaje", descuento_valor: 5 }, ID);
    expect(pct).toMatchObject({ tipo: "rpc", rpc: "comparar_presupuesto_agente", params: { p_presupuesto_id: ID, p_descuento_pct: 5, p_descuento_importe: null, p_proveedor: null } });
    expect(llamadaPresupuesto({ descuento_tipo: "porcentaje", descuento_valor: 5, proveedor: " Disbeya " }, ID).params).toMatchObject({ p_proveedor: "Disbeya" });
    const imp = llamadaPresupuesto({ descuento_tipo: "importe", descuento_valor: 120 }, ID);
    expect(imp).toMatchObject({ params: { p_descuento_pct: null, p_descuento_importe: 120 } });
    const nin = llamadaPresupuesto({ descuento_tipo: "ninguno", descuento_valor: null }, ID);
    expect(nin).toMatchObject({ params: { p_descuento_pct: null, p_descuento_importe: null } });
    expect(prepararLlamada("comparar_presupuesto", { descuento_tipo: "ninguno", descuento_valor: null }, undefined, null, ID).tipo).toBe("rpc");
  });

  it("sin presupuesto, sin tipo de descuento o sin valor: error corregible (no calcula)", () => {
    expect(() => llamadaPresupuesto({ descuento_tipo: "ninguno" }, null)).toThrow(/presupuesto/);
    expect(() => llamadaPresupuesto({}, ID)).toThrow(/descuento_tipo/);
    expect(() => llamadaPresupuesto({ descuento_tipo: "porcentaje", descuento_valor: null }, ID)).toThrow(/descuento_valor/);
  });
});
