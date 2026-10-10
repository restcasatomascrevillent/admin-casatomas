// ============================================================================
//  Coste de LEER cada documento (10-oct-2026) y contabilidad del extractor.
//  OpenAI y Supabase simulados (nada de red, nada de OpenAI real).
//
//  1) CADA llamada a OpenAI del extractor (visión, relectura, pie, contador,
//     embeddings) llega a `ia_registrar_uso` con la función correcta, en los
//     tres caminos: síncrono (procesar-factura), «sustituir» (procesar-factura)
//     y segundo plano (ocr-trabajo: pieza y consolidación). Y las Edge
//     Functions usan SIEMPRE la clave 'ocr' (claveOpenAI("ocr")).
//  2) El coste por documento (visión + embeddings) se suma y se guarda en
//     facturas.coste_lectura_usd, también el de los intentos que fallaron.
// ============================================================================

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// registrar-uso-ia.ts importa supabase-js por URL (esm.sh), que Node no carga.
vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: vi.fn() }));

import { configModelo } from "./modelo.ts";
import { crearClienteOpenAI, totalesUso } from "./openai.ts";
import { crearRegistroUso } from "./registroUso.ts";
import { costeDeCliente, guardarCosteLectura, leerCosteTrabajo, sumarCostes, sumarGastoTrabajo } from "./costeLectura.ts";
import type { ContextoGuardado } from "./guardado.ts";
import { sustituirFactura } from "./guardado.ts";
import { leerDocumentoUnico } from "./extraccion.ts";
import { ficheroDesdePayload, pendienteUnico, procesarSincrono } from "./unico.ts";
import { procesarConsolidacion, procesarPagina } from "./trabajos.ts";

const UID = "11111111-1111-4111-8111-111111111111";
const TID = "22222222-2222-4222-8222-222222222222";
const RUTA = `pendientes/${UID}/${TID}/01.jpg`;
const DRIVE_OFF = { clientId: "", clientSecret: "", refreshToken: "", parentFolder: "" };
const BYTES = Uint8Array.from({ length: 2000 }, (_, i) => (i * 31 + 7) % 256);
const B64 = Buffer.from(BYTES).toString("base64");
const CFG = configModelo({});

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

/** OpenAI simulado: visión 1000/200 tokens (0,00044 $ a la tarifa de gpt-5.6-luna), embeddings 500 tokens por llamada. */
function openaiFalso(vision: unknown[]) {
  let n = 0;
  const responder = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
  return vi.fn(async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    if (url.endsWith("/embeddings")) {
      const k = Array.isArray(body.input) ? body.input.length : 1;
      return responder({ data: Array.from({ length: k }, () => ({ embedding: [0.1] })), usage: { prompt_tokens: 500, total_tokens: 500 } });
    }
    const esquema = body.response_format?.json_schema?.name;
    const contenido = esquema === "verificacion_pie" ? PIE : vision[n++];
    return responder({
      choices: [{ message: { content: JSON.stringify(contenido) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 200 },
    });
  });
}

type Op = { m: string; a: unknown[] };
function supabaseFalso(o: { existente?: unknown; trabajoCoste?: Record<string, unknown>; trabajo?: Record<string, unknown>; paginas?: () => unknown[]; sinColumnas?: boolean } = {}) {
  const consultas: { tabla: string; ops: Op[] }[] = [];
  const rpcs: { nombre: string; args: Record<string, unknown> }[] = [];
  const ficheros = new Map<string, Uint8Array>([[RUTA, BYTES]]);
  const resolver = (tabla: string, ops: Op[]) => {
    const metodos = ops.map((x) => x.m);
    if (tabla === "facturas" && metodos.includes("insert")) return { data: { id: 101 }, error: null };
    if (tabla === "facturas" && metodos.includes("update") && o.sinColumnas) {
      return { data: null, error: { message: 'column "coste_lectura_usd" of relation "facturas" does not exist' } };
    }
    if (tabla === "ocr_trabajos" && metodos.includes("select")) {
      const campos = String(ops.find((x) => x.m === "select")?.a[0]);
      if (campos.startsWith("coste_usd")) {
        if (o.sinColumnas && campos.includes("llamadas")) return { data: null, error: { message: "column ocr_trabajos.llamadas does not exist" } };
        return { data: o.trabajoCoste ?? { coste_usd: 0.0123, modelo: "gpt-5.6-luna", llamadas: 4 }, error: null };
      }
      return { data: o.trabajo ?? null, error: null };
    }
    if (tabla === "ocr_trabajo_paginas" && metodos.includes("select")) return { data: o.paginas?.() ?? [], error: null };
    return { data: null, error: null };
  };
  const cadena = (tabla: string, ops: Op[] = []): unknown =>
    new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") {
          consultas.push({ tabla, ops });
          const r = resolver(tabla, ops);
          return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(r).then(ok, ko);
        }
        return (...a: unknown[]) => cadena(tabla, [...ops, { m: prop, a }]);
      },
    });
  const supabase = {
    from: (tabla: string) => cadena(tabla),
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      rpcs.push({ nombre, args });
      if (nombre === "ocr_factura_existente") return { data: o.existente ?? null, error: null };
      if (nombre === "validar_cordura_factura") return { data: [], error: null };
      if (nombre === "ocr_despachar") return { data: 1, error: null };
      if (nombre === "ocr_sustituir_factura") return { data: { lineas_antes: 1, lineas: 1, historial_borrado: 0, historial_creado: 1 }, error: null };
      return { data: true, error: null };
    },
    storage: {
      from: () => ({
        upload: async (path: string, blob: Blob) => {
          ficheros.set(path, new Uint8Array(await blob.arrayBuffer()));
          return { data: { path }, error: null };
        },
        download: async (path: string) => {
          const b = ficheros.get(path);
          return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: "Object not found" } };
        },
        list: async () => ({ data: [], error: null }),
        move: async () => ({ error: null }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
  };
  return { supabase, consultas, rpcs };
}

/** Registro en ia_uso simulado: devuelve las filas como `funcion|operacion|disparador|modelo`. */
function iaUsoFalso(funcion: "procesar-factura" | "ocr-trabajo", disparador: string) {
  const rpc = vi.fn(async () => ({ error: null }));
  const registro = crearRegistroUso({ funcion, disparador, cliente: { rpc } });
  const filas = () =>
    rpc.mock.calls.map((c) => {
      const a = (c as unknown as [string, Record<string, unknown>])[1];
      return `${a.p_funcion}|${a.p_operacion}|${a.p_disparador}|${a.p_modelo}`;
    });
  return { registro, filas, rpc };
}

const EMB = "text-embedding-3-small";

describe("ia_uso: TODAS las llamadas del extractor se registran, en los tres caminos", () => {
  it("síncrono (procesar-factura): visión + relectura + pie + embeddings de cabecera y líneas", async () => {
    const sb = supabaseFalso();
    const uso = iaUsoFalso("procesar-factura", "subida:abc");
    const oa = openaiFalso([doc({ total: 115 }), doc()]);
    const ctx: ContextoGuardado = {
      supabase: sb.supabase,
      openai: crearClienteOpenAI({ apiKey: "k", config: CFG, fetch: oa as never, alUsar: uso.registro.alUsar }),
      drive: DRIVE_OFF,
    };
    await procesarSincrono(ctx, ficheroDesdePayload({ nombre: "f.jpg", tipo: "image/jpeg", contenido_base64: B64 }), UID, () => TID);
    await uso.registro.esperar();

    // Una fila por llamada HTTP a OpenAI (ni una más, ni una menos).
    expect(uso.filas()).toEqual([
      `procesar-factura|vision|subida:abc#lectura|${CFG.modelo}`,
      `procesar-factura|vision|subida:abc#relectura|${CFG.modelo}`,
      `procesar-factura|vision|subida:abc#pie|${CFG.modelo}`,
      `procesar-factura|embedding|subida:abc#embeddings|${EMB}`,
      `procesar-factura|embedding|subida:abc#embeddings|${EMB}`,
    ]);
    expect(oa).toHaveBeenCalledTimes(uso.rpc.mock.calls.length);
  });

  it("segundo plano (ocr-trabajo): la pieza única (lectura + pie) y la consolidación (embeddings)", async () => {
    const trabajo = { id: TID, num_paginas: 1, contexto_p1: null, estado: "pagina1", nombre_original: "f.jpg" };
    let filaPagina: Record<string, unknown> | null = null;
    const sb = supabaseFalso({ trabajo, paginas: () => (filaPagina ? [filaPagina] : []) });
    const usoPieza = iaUsoFalso("ocr-trabajo", `trabajo:${TID}`);
    const oaPieza = openaiFalso([doc()]);
    const cliente = crearClienteOpenAI({ apiKey: "k", config: CFG, fetch: oaPieza as never, alUsar: usoPieza.registro.alUsar });
    await procesarPagina(sb.supabase, cliente, { id: 7, trabajo_id: TID, numero: 1, pieza: "pagina", storage_path: RUTA, mime: "image/jpeg", relecturas: 0 }, cliente);
    await usoPieza.registro.esperar();
    expect(usoPieza.filas()).toEqual([
      `ocr-trabajo|vision|trabajo:${TID}#lectura|${CFG.modelo}`,
      `ocr-trabajo|vision|trabajo:${TID}#pie|${CFG.modelo}`,
    ]);
    const cierre = sb.rpcs.find((r) => r.nombre === "ocr_cerrar_pagina")!.args;
    filaPagina = {
      id: 7, numero: 1, pieza: "pagina", pagina_doc: 1, franja: null, estado: "completada", storage_path: RUTA, mime: "image/jpeg",
      error: null, resultado: JSON.parse(JSON.stringify(cierre.p_resultado)), recuento: null, verificacion_pie: null,
      relecturas: 0, filas_extraidas: 1, filas_contadas: null, duracion_ms: 5,
    };

    // Consolidación: otra invocación, otro cliente, el mismo disparador de documento.
    const usoCons = iaUsoFalso("ocr-trabajo", `trabajo:${TID}`);
    const oaCons = openaiFalso([]);
    const clienteCons = crearClienteOpenAI({ apiKey: "k", config: CFG, fetch: oaCons as never, alUsar: usoCons.registro.alUsar });
    await procesarConsolidacion(
      { supabase: sb.supabase, openai: clienteCons, drive: DRIVE_OFF },
      { ...trabajo, estado: "consolidando", original_path: RUTA, original_mime: "image/jpeg", intentos_consolidacion: 1, ronda_relectura: 0 },
    );
    await usoCons.registro.esperar();
    expect(usoCons.filas()).toEqual([
      `ocr-trabajo|embedding|trabajo:${TID}#embeddings|${EMB}`,
      `ocr-trabajo|embedding|trabajo:${TID}#embeddings|${EMB}`,
    ]);
  });

  it("«sustituir» (procesar-factura): los embeddings de la sustitución", async () => {
    // Documento pendiente tal y como lo deja la lectura de un duplicado.
    const oaLectura = openaiFalso([doc()]);
    const listo = await leerDocumentoUnico(
      crearClienteOpenAI({ apiKey: "k", config: CFG, fetch: oaLectura as never }),
      { b64: B64, mime: "image/jpeg", nombre: "f.jpg" },
    );
    const existente = { id: 77, numero_documento: "F-001", proveedor: "Pescados Ría SL", fecha: "2026-09-03", total: 110, lineas: 1, alertas: 0, alertas_graves: 0 };
    const { pendiente } = pendienteUnico(listo, existente as never, TID);
    const trabajo = { id: TID, estado: "duplicado", documento_pendiente: pendiente, original_path: null, original_mime: null, nombre_original: "f.jpg", creado_por: UID };
    const sb = supabaseFalso({ trabajo, trabajoCoste: { coste_usd: 0.0123, modelo: "gpt-5.6-luna", llamadas: 3 } });
    const uso = iaUsoFalso("procesar-factura", `trabajo:${TID}`);
    const oa = openaiFalso([]);
    const ctx: ContextoGuardado = {
      supabase: sb.supabase,
      openai: crearClienteOpenAI({ apiKey: "k", config: CFG, fetch: oa as never, alUsar: uso.registro.alUsar }),
      drive: DRIVE_OFF,
    };
    const r = await sustituirFactura(ctx, { trabajoId: TID, facturaId: 77, userId: UID, esperado: {} });
    await uso.registro.esperar();
    expect(uso.filas()).toEqual([
      `procesar-factura|embedding|trabajo:${TID}#embeddings|${EMB}`,
      `procesar-factura|embedding|trabajo:${TID}#embeddings|${EMB}`,
    ]);
    // Coste de la factura sustituida = la lectura del trabajo + 2 llamadas de embeddings (500 tokens a 0,02 $/M).
    const upd = sb.consultas.find((c) => c.tabla === "facturas" && c.ops.some((x) => x.m === "update"))!;
    expect(upd.ops.find((x) => x.m === "update")!.a[0]).toEqual({ coste_lectura_usd: 0.0123 + 0.00002, lectura_llamadas: 5, lectura_modelo: "gpt-5.6-luna" });
    expect(r.coste_usd).toBeCloseTo(0.01232, 6);
  });
});

describe("las Edge Functions del extractor usan SIEMPRE la clave 'ocr' y registran en ia_uso", () => {
  const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");
  const procesar = leer("./index.ts");
  const ocr = leer("../ocr-trabajo/index.ts");
  const clasificar = leer("../clasificar-productos/index.ts");

  it("procesar-factura y ocr-trabajo crean TODOS sus clientes de OpenAI con claveOpenAI('ocr') y alUsar", () => {
    for (const [nombre, src] of [["procesar-factura", procesar], ["ocr-trabajo", ocr]] as const) {
      const llamadas = src.match(/crearClienteOpenAI\(\{[^}]*\}\)/g) ?? [];
      expect(llamadas.length, nombre).toBeGreaterThan(0);
      for (const l of llamadas) {
        expect(l, nombre).toContain('apiKey: claveOpenAI("ocr")');
        expect(l, nombre).toContain("alUsar: registro.alUsar");
      }
    }
  });

  it("clasificar-productos usa la clave 'ocr' y registra su uso", () => {
    expect(clasificar).toContain('claveOpenAI("ocr")');
    expect(clasificar).toContain("registrarUso(");
  });

  it("ninguna lee OPENAI_API_KEY directamente (se saltaría la clave del proceso)", () => {
    for (const src of [procesar, ocr, clasificar]) expect(src).not.toMatch(/Deno\.env\.get\(\s*["']OPENAI_API_KEY/);
  });

  it("cada función registra con SU nombre (ia_proceso_gasto las manda a 'ocr')", () => {
    expect(procesar).toContain('funcion: "procesar-factura"');
    expect(ocr).toContain('funcion: "ocr-trabajo"');
  });
});

describe("coste por documento", () => {
  it("los embeddings se cuentan aparte (no cambian lo que se guarda por pieza) pero suman al total", async () => {
    const cliente = crearClienteOpenAI({ apiKey: "k", config: CFG, fetch: openaiFalso([doc()]) as never });
    await leerDocumentoUnico(cliente, { b64: B64, mime: "image/jpeg", nombre: "f.jpg" });
    const soloVision = cliente.uso.costeUsd;
    expect(cliente.uso.costeEmbeddingsUsd).toBe(0);
    await cliente.embed(["Merluza", "Pulpo"]); // 1 llamada, 500 tokens simulados
    await cliente.embed("Resumen"); // otra
    expect(cliente.uso.costeUsd).toBe(soloVision);
    expect(cliente.uso).toMatchObject({ llamadasEmbeddings: 2, tokensEmbeddings: 1000, costeEmbeddingsUsd: 0.00002 });
    expect(totalesUso(cliente.uso)).toEqual({ usd: Math.round((soloVision + 0.00002) * 1e6) / 1e6, llamadas: cliente.uso.llamadas + 2 });
    expect(costeDeCliente(cliente.uso, CFG.modelo)).toMatchObject({ llamadas: 4, modelo: CFG.modelo });
  });

  it("sumarCostes: llamadas desconocidas contagian null, el coste siempre suma", () => {
    expect(sumarCostes({ usd: 0.01, llamadas: 3, modelo: null }, { usd: 0.002, llamadas: 2, modelo: "m" })).toEqual({ usd: 0.012, llamadas: 5, modelo: "m" });
    expect(sumarCostes({ usd: 0.01, llamadas: null, modelo: "a" }, { usd: 0.002, llamadas: 2, modelo: "m" })).toEqual({ usd: 0.012, llamadas: null, modelo: "a" });
  });

  it("leerCosteTrabajo: sin la columna `llamadas` (migración sin aplicar) lee el coste igualmente", async () => {
    const con = supabaseFalso();
    expect(await leerCosteTrabajo(con.supabase, TID)).toEqual({ usd: 0.0123, llamadas: 4, modelo: "gpt-5.6-luna" });
    const sin = supabaseFalso({ sinColumnas: true });
    expect(await leerCosteTrabajo(sin.supabase, TID)).toEqual({ usd: 0.0123, llamadas: null, modelo: "gpt-5.6-luna" });
  });

  it("guardarCosteLectura nunca lanza: columna inexistente = solo aviso", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sb = supabaseFalso({ sinColumnas: true });
    await expect(guardarCosteLectura(sb.supabase, 101, { usd: 0.01, llamadas: 3, modelo: "m" })).resolves.toBeUndefined();
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("un intento que FALLA después de pagar la visión suma su coste al trabajo (no se pierde)", async () => {
    const trabajo = { id: TID, num_paginas: 1, contexto_p1: null, estado: "pagina1", nombre_original: "f.jpg" };
    const sb = supabaseFalso({ trabajo });
    // El modelo responde algo que no cumple el contrato: 1 llamada de visión pagada y fallo definitivo.
    const cliente = crearClienteOpenAI({ apiKey: "k", config: CFG, fetch: openaiFalso([{ tipo: "nota" }, { tipo: "nota" }]) as never });
    await procesarPagina(sb.supabase, cliente, { id: 7, trabajo_id: TID, numero: 1, pieza: "pagina", storage_path: RUTA, mime: "image/jpeg", relecturas: 0 }, cliente);
    expect(sb.rpcs.find((r) => r.nombre === "ocr_cerrar_pagina")).toBeUndefined();
    const suma = sb.rpcs.find((r) => r.nombre === "ocr_sumar_gasto")!;
    expect(suma.args).toEqual({ p_trabajo_id: TID, p_coste: 0.00044, p_llamadas: 1 });
  });

  it("una pieza que sale bien solo suma las llamadas (su coste ya lo suma ocr_cerrar_pagina)", async () => {
    const trabajo = { id: TID, num_paginas: 1, contexto_p1: null, estado: "pagina1", nombre_original: "f.jpg" };
    const sb = supabaseFalso({ trabajo });
    const cliente = crearClienteOpenAI({ apiKey: "k", config: CFG, fetch: openaiFalso([doc()]) as never });
    await procesarPagina(sb.supabase, cliente, { id: 7, trabajo_id: TID, numero: 1, pieza: "pagina", storage_path: RUTA, mime: "image/jpeg", relecturas: 0 }, cliente);
    const cierre = sb.rpcs.find((r) => r.nombre === "ocr_cerrar_pagina")!.args;
    expect(cierre.p_coste).toBe(0.00088);
    expect(sb.rpcs.find((r) => r.nombre === "ocr_sumar_gasto")!.args).toEqual({ p_trabajo_id: TID, p_coste: 0, p_llamadas: 2 });
  });

  it("sumarGastoTrabajo no hace nada sin llamadas y no lanza si falta la RPC", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vacio = crearClienteOpenAI({ apiKey: "k", config: CFG, fetch: vi.fn() as never });
    const rpc = vi.fn(async () => ({ data: null, error: { message: "function ocr_sumar_gasto does not exist" } }));
    await sumarGastoTrabajo({ rpc }, TID, vacio.uso, true);
    expect(rpc).not.toHaveBeenCalled();
    const c = crearClienteOpenAI({ apiKey: "k", config: CFG, fetch: openaiFalso([doc()]) as never });
    await leerDocumentoUnico(c, { b64: B64, mime: "image/jpeg", nombre: "f.jpg" });
    await expect(sumarGastoTrabajo({ rpc }, TID, c.uso, true)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
    aviso.mockRestore();
  });
});
