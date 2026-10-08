// ============================================================================
//  Registro en ia_uso de las llamadas a OpenAI del OCR (08-oct-2026).
//  OpenAI y Supabase simulados: cada llamada (lectura, relectura, pie,
//  contador, embeddings) tiene que llegar a `alUsar` y de ahí a
//  `ia_registrar_uso`, sin que un fallo del registro toque la lectura.
// ============================================================================

import { describe, expect, it, vi } from "vitest";

// registrar-uso-ia.ts importa supabase-js por URL (esm.sh), que Node no carga.
vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: vi.fn() }));

import { configModelo } from "./modelo.ts";
import { crearClienteOpenAI, type UsoLlamada } from "./openai.ts";
import { leerDocumentoUnico } from "./extraccion.ts";
import { crearRegistroUso } from "./registroUso.ts";

const linea = (over: Record<string, unknown> = {}) => ({
  nombre: "Merluza", cantidad: 10, unidad: "ud", peso_kg: null, base_precio: "por_unidad",
  precio_unitario: 10, total: 100, bonificada: false, ...over,
});
const doc = (over: Record<string, unknown> = {}) => ({
  tipo: "factura", proveedor: "Pescados Ría SL", cif: "B12345678", numero_documento: "F-001",
  fecha: "2026-09-03", sin_importes: false, productos: [linea()], subtotal: 100, iva: 10, total: 110,
  observaciones: null, resumen: "Factura de prueba.", ...over,
});
const PIE = {
  ultimo_texto_visible: "TOTAL 110,00", fila_total_impresa: true, total_citado: "110,00",
  base_imponible_citada: "100,00", cuota_iva_citada: "10,00", motivo: "",
};

function openaiFalso(vision: unknown[]) {
  let n = 0;
  const responder = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
  return vi.fn(async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    if (url.endsWith("/embeddings")) {
      const k = Array.isArray(body.input) ? body.input.length : 1;
      return responder({
        data: Array.from({ length: k }, () => ({ embedding: [0.1, 0.2] })),
        usage: { prompt_tokens: 7 * k, total_tokens: 7 * k },
      });
    }
    const esquema = body.response_format?.json_schema?.name;
    const contenido = esquema === "verificacion_pie" ? PIE : vision[n++];
    return responder({
      choices: [{ message: { content: JSON.stringify(contenido) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 100 } },
    });
  });
}

const B64 = Buffer.from("factura").toString("base64");

describe("cliente OpenAI del OCR: cada llamada avisa a alUsar", () => {
  it("lectura + relectura por cuadre + pie, y embeddings aparte", async () => {
    const eventos: UsoLlamada[] = [];
    const cliente = crearClienteOpenAI({
      apiKey: "k",
      config: configModelo({}),
      fetch: openaiFalso([doc({ total: 115 }), doc()]) as never,
      alUsar: (u) => eventos.push(u),
    });
    await leerDocumentoUnico(cliente, { b64: B64, mime: "image/jpeg", nombre: "f.jpg" });
    await cliente.embed(["Merluza", "Pulpo"]);

    expect(eventos.map((e) => `${e.operacion}:${e.etapa}`)).toEqual([
      "vision:lectura",
      "vision:relectura",
      "vision:pie",
      "embedding:embeddings",
    ]);
    expect(eventos[0].modelo).toBe(configModelo({}).modelo);
    expect(eventos[0].usage.prompt_tokens).toBe(1000);
    expect(eventos[3].modelo).toBe("text-embedding-3-small");
    expect(eventos[3].usage.prompt_tokens).toBe(14);
    // El coste por documento de ocr_trabajos no cambia: no suma embeddings.
    expect(cliente.uso.llamadas).toBe(3);
  });

  it("el contador de filas también se anota", async () => {
    const eventos: UsoLlamada[] = [];
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ filas_tabla: 2, filas_por_bloque: [2], motivo: "" }) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 500, completion_tokens: 50 },
      }), { status: 200 }));
    const cliente = crearClienteOpenAI({ apiKey: "k", config: configModelo({}), fetch: fetch as never, alUsar: (u) => eventos.push(u) });
    await cliente.contarFilas({ type: "text", text: "x" });
    expect(eventos.map((e) => e.etapa)).toEqual(["contador"]);
  });

  it("un alUsar que lanza no rompe la lectura", async () => {
    const cliente = crearClienteOpenAI({
      apiKey: "k",
      config: configModelo({}),
      fetch: openaiFalso([doc()]) as never,
      alUsar: () => {
        throw new Error("boom");
      },
    });
    const listo = await leerDocumentoUnico(cliente, { b64: B64, mime: "image/jpeg", nombre: "f.jpg" });
    expect(listo.datos.numero_documento).toBe("F-001");
  });
});

describe("crearRegistroUso → ia_registrar_uso", () => {
  it("una fila por llamada con funcion, operacion y disparador documento#etapa", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const registro = crearRegistroUso({ funcion: "ocr-trabajo", disparador: "trabajo:abc", cliente: { rpc } });
    const cliente = crearClienteOpenAI({
      apiKey: "k",
      config: configModelo({}),
      fetch: openaiFalso([doc()]) as never,
      alUsar: registro.alUsar,
    });
    await leerDocumentoUnico(cliente, { b64: B64, mime: "image/jpeg", nombre: "f.jpg" });
    await cliente.embed("Merluza");
    await registro.esperar();

    expect(rpc).toHaveBeenCalledTimes(3);
    const args = rpc.mock.calls.map((c) => (c as unknown as [string, Record<string, unknown>]));
    expect(args.every(([fn]) => fn === "ia_registrar_uso")).toBe(true);
    expect(args.map(([, a]) => `${a.p_funcion}|${a.p_operacion}|${a.p_disparador}`)).toEqual([
      "ocr-trabajo|vision|trabajo:abc#lectura",
      "ocr-trabajo|vision|trabajo:abc#pie",
      "ocr-trabajo|embedding|trabajo:abc#embeddings",
    ]);
    expect(args[0][1]).toMatchObject({ p_prompt_tokens: 1000, p_completion_tokens: 200, p_cached_tokens: 100, p_llamadas: 1 });
  });

  it("si el registro falla, solo log: esperar() resuelve", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn(async () => ({ error: { message: "no existe" } }));
    const registro = crearRegistroUso({ funcion: "procesar-factura", disparador: "subida:x", cliente: { rpc } });
    registro.alUsar({ etapa: "lectura", operacion: "vision", modelo: "gpt-5.6-luna", usage: { prompt_tokens: 1 }, duracionMs: 5 });
    await expect(registro.esperar()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("no espera al INSERT para seguir (alUsar es síncrono)", async () => {
    let soltar!: () => void;
    const rpc = vi.fn(() => new Promise<{ error: null }>((r) => (soltar = () => r({ error: null }))));
    const registro = crearRegistroUso({ funcion: "procesar-factura", disparador: "subida:x", cliente: { rpc } });
    const t = registro.alUsar({ etapa: "pie", operacion: "vision", modelo: "m", usage: {}, duracionMs: 1 });
    expect(t).toBeUndefined();
    const fin = registro.esperar();
    await Promise.resolve();
    soltar();
    await fin;
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
