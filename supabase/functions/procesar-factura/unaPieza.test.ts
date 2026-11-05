// ============================================================================
//  Equivalencia: documento de UNA página por el camino síncrono (procesar-
//  factura sin `modo`) y por un trabajo de UNA pieza (iniciar → ocr-trabajo
//  pieza → ocr-trabajo consolidar). Con OpenAI y Supabase simulados, los dos
//  caminos tienen que mandar a OpenAI EXACTAMENTE las mismas peticiones y
//  escribir EXACTAMENTE lo mismo en la base de datos y en Storage (salvo
//  `procesado_en`, que es la hora, y `ocr_trabajo_id`, que solo tiene el
//  trabajo). Lo leído pasa por un JSON (jsonb) entre la pieza y la
//  consolidación, como en producción.
// ============================================================================

import { describe, expect, it, vi } from "vitest";
import { configModelo } from "./modelo.ts";
import { crearClienteOpenAI } from "./openai.ts";
import type { ContextoGuardado } from "./guardado.ts";
import { ficheroDesdePayload, procesarSincrono } from "./unico.ts";
import { esErrorTransitorio, iniciarTrabajo, procesarConsolidacion, procesarPagina, validarInicio } from "./trabajos.ts";

const UID = "11111111-1111-4111-8111-111111111111";
const TID = "22222222-2222-4222-8222-222222222222";
const RUTA = `pendientes/${UID}/${TID}/01.jpg`;
const DRIVE_OFF = { clientId: "", clientSecret: "", refreshToken: "", parentFolder: "" };

// ── Fichero: 70 kB deterministas (más de un trozo de 32 kB de encodeBase64) ──
const BYTES = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31 + 7) % 256);
const B64 = Buffer.from(BYTES).toString("base64");

// ── OpenAI simulado ──────────────────────────────────────────────────────────
interface Guion {
  vision: unknown[];
  pie?: unknown;
  recuento?: unknown;
}
function openaiFalso(g: Guion) {
  const cuerpos: { url: string; body: Record<string, unknown> }[] = [];
  let n = 0;
  const responder = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
  const fetch = vi.fn(async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    cuerpos.push({ url, body });
    if (url.endsWith("/embeddings")) {
      const k = Array.isArray(body.input) ? body.input.length : 1;
      return responder({ data: Array.from({ length: k }, (_, i) => ({ embedding: [i, 0.25, 0.5] })) });
    }
    const esquema = body.response_format?.json_schema?.name;
    const contenido = esquema === "verificacion_pie" ? g.pie : esquema === "recuento_filas" ? g.recuento : g.vision[n++];
    return responder({
      choices: [{ message: { content: JSON.stringify(contenido) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 200 },
    });
  });
  return { fetch, cuerpos };
}

// ── Supabase simulado: apunta todo y contesta lo que diga el escenario ──────
type Op = { m: string; a: unknown[] };
interface Escrito { tabla: string; ops: Op[] }
function supabaseFalso(opciones: {
  existente?: unknown;
  trabajo?: Record<string, unknown>;
  paginas?: () => unknown[];
  alertasSql?: unknown[];
}) {
  const consultas: Escrito[] = [];
  const rpcs: { nombre: string; args: Record<string, unknown> }[] = [];
  const subidas: { path: string; bytes: Uint8Array; opciones: unknown }[] = [];
  const borrados: string[][] = [];
  const ficheros = new Map<string, Uint8Array>([[RUTA, BYTES]]);

  const resolver = (tabla: string, ops: Op[]) => {
    const metodos = ops.map((o) => o.m);
    if (tabla === "facturas" && metodos.includes("insert")) return { data: { id: 101 }, error: null };
    if (tabla === "facturas" && metodos.includes("select")) return { data: null, error: null };
    if (tabla === "ocr_trabajos" && metodos.includes("select")) {
      const campos = String(ops.find((o) => o.m === "select")?.a[0]);
      if (campos.startsWith("coste_usd")) return { data: { coste_usd: 0.0123, modelo: "gpt-5.6-luna" }, error: null };
      if (campos.startsWith("id, creado_por")) return { data: null, error: null };
      return { data: opciones.trabajo ?? null, error: null };
    }
    if (tabla === "ocr_trabajo_paginas" && metodos.includes("select")) return { data: opciones.paginas?.() ?? [], error: null };
    return { data: null, error: null };
  };
  const cadena = (tabla: string, ops: Op[] = []): unknown =>
    new Proxy({}, {
      get(_o, prop: string) {
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
      if (nombre === "ocr_factura_existente") return { data: opciones.existente ?? null, error: null };
      if (nombre === "validar_cordura_factura") return { data: opciones.alertasSql ?? [], error: null };
      if (nombre === "ocr_despachar") return { data: 1, error: null };
      return { data: true, error: null };
    },
    storage: {
      from: () => ({
        upload: async (path: string, blob: Blob, o: unknown) => {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          subidas.push({ path, bytes, opciones: o });
          ficheros.set(path, bytes);
          return { data: { path }, error: null };
        },
        download: async (path: string) => {
          const b = ficheros.get(path);
          return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: "Object not found" } };
        },
        list: async (carpeta: string) => ({
          data: [...ficheros.keys()].filter((k) => k.startsWith(carpeta + "/"))
            .map((k) => ({ name: k.slice(carpeta.length + 1), metadata: { size: ficheros.get(k)!.length } })),
          error: null,
        }),
        move: async () => ({ error: null }),
        remove: async (paths: string[]) => {
          borrados.push(paths);
          paths.forEach((p) => ficheros.delete(p));
          return { data: paths, error: null };
        },
      }),
    },
  };
  return { supabase, consultas, rpcs, subidas, borrados };
}

// ── Documentos de prueba ─────────────────────────────────────────────────────
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
const EXISTENTE = {
  id: 77, numero_documento: "F-001", proveedor: "Pescados Ría SL", fecha: "2026-09-03", total: 110,
  total_origen: "leido", lineas: 1, alertas: 0, alertas_graves: 0, updated_at: "2026-09-04T10:00:00Z",
};

const ESCENARIOS: Record<string, { guion: () => Guion; mime: string; nombre: string; existente?: unknown; llamadas: number }> = {
  // Descuadre en la 1.ª lectura → relectura correctiva → verificador del pie.
  "relectura por cuadre + pie (imagen)": {
    guion: () => ({ vision: [doc({ total: 115 }), doc()], pie: PIE }),
    mime: "image/jpeg",
    nombre: "foto-2026-10-05-1012.jpg",
    llamadas: 3,
  },
  // Sin importes en el pie: contador de filas, deducción del total, kilos.
  "sin pie: contador + deducción + kilos (pdf)": {
    guion: () => ({
      vision: [doc({
        subtotal: null, iva: null, total: null,
        productos: [
          linea(),
          linea({ nombre: "Pulpo", cantidad: 3, unidad: "kg", peso_kg: 6, base_precio: "por_kg", precio_unitario: 4, total: 24 }),
        ],
      })],
      recuento: { filas_tabla: 2, filas_por_bloque: [2], motivo: "" },
    }),
    mime: "application/pdf",
    nombre: "albaran ría.pdf",
    llamadas: 2,
  },
  "duplicado → pendiente de decidir": {
    guion: () => ({ vision: [doc()], pie: PIE }),
    mime: "image/jpeg",
    nombre: "repetida.jpg",
    existente: EXISTENTE,
    llamadas: 2,
  },
};

const CONFIG_UNICO = configModelo({});
const CONFIG_PIEZAS = configModelo({ OCR_MODELO_PIEZAS: "gpt-5.4-mini" }, "piezas");

/** Camino síncrono, como lo llama index.ts. */
async function caminoSincrono(e: (typeof ESCENARIOS)[string]) {
  const oa = openaiFalso(e.guion());
  const sb = supabaseFalso({ existente: e.existente });
  const ctx: ContextoGuardado = {
    supabase: sb.supabase,
    openai: crearClienteOpenAI({ apiKey: "k", config: CONFIG_UNICO, fetch: oa.fetch as never }),
    drive: DRIVE_OFF,
  };
  const fichero = ficheroDesdePayload({ nombre: e.nombre, tipo: e.mime, contenido_base64: `data:${e.mime};base64,${B64}` });
  const respuesta = await procesarSincrono(ctx, fichero, UID, () => TID);
  return { respuesta, oa, sb };
}

/** Camino de trabajos: iniciar → pieza → consolidar, como ocr-trabajo. */
async function caminoTrabajo(e: (typeof ESCENARIOS)[string]) {
  const oaUnico = openaiFalso(e.guion());
  const oaPiezas = openaiFalso({ vision: [] });
  let filaPagina: Record<string, unknown> | null = null;
  const trabajo = { id: TID, num_paginas: 1, contexto_p1: null, estado: "pagina1", nombre_original: e.nombre };
  const sb = supabaseFalso({ existente: e.existente, trabajo, paginas: () => (filaPagina ? [filaPagina] : []) });
  const ruta = RUTA.replace(/\.jpg$/, e.mime.includes("pdf") ? ".pdf" : ".jpg");
  if (ruta !== RUTA) await sb.supabase.storage.from().upload(ruta, new Blob([BYTES]), {});
  sb.subidas.length = 0;

  // 1) procesar-factura {modo:"iniciar"} con una pieza.
  const v = validarInicio({
    modo: "iniciar", trabajo_id: TID, nombre: e.nombre, origen: e.mime.includes("pdf") ? "pdf" : "imagen",
    original: { path: ruta, mime: e.mime, bytes: BYTES.length },
    piezas: [{ numero: 1, path: ruta, mime: e.mime, bytes: BYTES.length, pieza: "pagina", pagina_doc: 1, franja: null, franjas_pagina: null }],
  }, UID);
  expect(v.ok).toBe(true);
  if (!v.ok) throw new Error(v.error);
  const inicio = await iniciarTrabajo(sb.supabase, UID, v.peticion, CONFIG_UNICO.modelo);
  expect(inicio).toMatchObject({ success: true, trabajo_id: TID, num_paginas: 1 });

  // 2) ocr-trabajo {modo:"pagina"}: el cliente de piezas NO se usa.
  const clientePiezas = crearClienteOpenAI({ apiKey: "k", config: CONFIG_PIEZAS, fetch: oaPiezas.fetch as never });
  const clienteUnico = crearClienteOpenAI({ apiKey: "k", config: CONFIG_UNICO, fetch: oaUnico.fetch as never });
  const pagina = { id: 7, trabajo_id: TID, numero: 1, pieza: "pagina", pagina_doc: 1, franja: null, franjas_pagina: null, storage_path: ruta, mime: e.mime, relecturas: 0 };
  await procesarPagina(sb.supabase, clientePiezas, pagina, clienteUnico);
  expect(oaPiezas.fetch).not.toHaveBeenCalled();
  const cierre = sb.rpcs.find((r) => r.nombre === "ocr_cerrar_pagina");
  expect(cierre).toBeTruthy();
  // Lo leído se guarda en jsonb: se simula el viaje de ida y vuelta.
  const a = cierre!.args;
  filaPagina = {
    id: 7, numero: 1, pieza: "pagina", pagina_doc: 1, franja: null, estado: "completada", storage_path: ruta, mime: e.mime,
    error: null, resultado: JSON.parse(JSON.stringify(a.p_resultado)), recuento: a.p_recuento, verificacion_pie: a.p_verificacion,
    relecturas: a.p_relecturas, filas_extraidas: a.p_filas_extraidas, filas_contadas: a.p_filas_contadas, duracion_ms: a.p_duracion_ms,
  };

  // 3) ocr-trabajo {modo:"consolidar"}: guarda (embeddings con el cliente de piezas, como en producción).
  const ctx: ContextoGuardado = { supabase: sb.supabase, openai: clientePiezas, drive: DRIVE_OFF };
  const reclamado = {
    ...trabajo, estado: "consolidando", original_path: ruta, original_mime: e.mime, intentos_consolidacion: 1, ronda_relectura: 0,
  };
  await procesarConsolidacion(ctx, reclamado);
  const fin = sb.rpcs.find((r) => r.nombre === "ocr_terminar_trabajo");
  expect(fin).toBeTruthy();
  return { fin: fin!.args, cierre: a, inicio, oaUnico, oaPiezas, sb, ruta };
}

// UPDATE de facturas con el coste de leer el documento (migración 20261010120000).
const esCosteLectura = (c: Escrito) =>
  c.tabla === "facturas" &&
  c.ops.some((o) => o.m === "update" && !!o.a[0] && typeof o.a[0] === "object" && "coste_lectura_usd" in (o.a[0] as object));
const costeGuardado = (sb: ReturnType<typeof supabaseFalso>) =>
  sb.consultas.filter(esCosteLectura).map((c) => ({
    ...(c.ops.find((o) => o.m === "update")!.a[0] as Record<string, unknown>),
    factura: c.ops.find((o) => o.m === "eq")?.a[1],
  }));

// Lo que se escribe en la BD, sin la hora ni el id del trabajo (ni el coste de lectura, que se prueba aparte).
const escrituras = (sb: ReturnType<typeof supabaseFalso>) =>
  sb.consultas
    .filter((c) => !esCosteLectura(c))
    .filter((c) => ["facturas", "productos_factura"].includes(c.tabla) && c.ops.some((o) => o.m === "insert" || o.m === "update"))
    .map((c) => ({
      tabla: c.tabla,
      ops: c.ops.map((o) => ({
        m: o.m,
        a: o.a.map((x) => {
          if (x && typeof x === "object" && !Array.isArray(x)) {
            const { procesado_en: _h, ocr_trabajo_id: _t, ...resto } = x as Record<string, unknown>;
            return resto;
          }
          return x;
        }),
      })),
    }));
const rpcsGuardado = (sb: ReturnType<typeof supabaseFalso>) =>
  sb.rpcs.filter((r) => ["ocr_factura_existente", "validar_cordura_factura"].includes(r.nombre));
const sinComun = (r: Record<string, unknown>) => {
  const { paginas: _p, coste_usd: _c, modelo: _m, ...resto } = r;
  return resto;
};

describe("una página: camino síncrono ≡ trabajo de una pieza", () => {
  for (const [titulo, e] of Object.entries(ESCENARIOS)) {
    it(titulo, async () => {
      const s = await caminoSincrono(e);
      const t = await caminoTrabajo(e);

      // 1) MISMAS peticiones a OpenAI, en el mismo orden (lectura y embeddings).
      const cuerposT = [...t.oaUnico.cuerpos, ...t.oaPiezas.cuerpos];
      expect(cuerposT).toEqual(s.oa.cuerpos);
      const vision = s.oa.cuerpos.filter((c) => c.url.endsWith("/chat/completions"));
      expect(vision.length).toBe(e.llamadas);
      for (const c of vision) expect(c.body.model).toBe("gpt-5.6-luna");
      const primer = vision[0].body as { messages: { content: unknown }[] };
      const bloque = (primer.messages[1].content as Record<string, unknown>[])[0];
      if (e.mime.includes("pdf")) {
        expect(bloque).toEqual({ type: "file", file: { filename: e.nombre, file_data: `data:application/pdf;base64,${B64}` } });
      } else {
        expect(bloque).toEqual({ type: "image_url", image_url: { url: `data:${e.mime};base64,${B64}`, detail: "original" } });
      }

      // 2) MISMAS comprobaciones y escrituras (cabecera, líneas, alertas, archivo).
      expect(rpcsGuardado(t.sb)).toEqual(rpcsGuardado(s.sb));
      expect(escrituras(t.sb)).toEqual(escrituras(s.sb));
      // (cabecera + líneas + alertas + archivo_path; nada si es duplicado)
      expect(escrituras(s.sb)).toHaveLength(e.existente ? 0 : 4);

      if (e.existente) {
        // 3a) Duplicado: mismo documento pendiente y mismo resumen para decidir.
        const reg = s.sb.consultas.find((c) => c.tabla === "ocr_trabajos" && c.ops[0].m === "insert")!.ops[0].a[0] as Record<string, unknown>;
        expect(t.fin.p_estado).toBe("duplicado");
        expect(t.fin.p_documento_pendiente).toEqual(JSON.parse(JSON.stringify(reg.documento_pendiente)));
        expect(sinComun(t.fin.p_resultado as Record<string, unknown>)).toEqual(sinComun(JSON.parse(JSON.stringify(s.respuesta))));
        // El coste de leer el duplicado se guarda en el trabajo (lo hereda «Sustituir la existente»)…
        expect(reg).toMatchObject({ coste_usd: s.respuesta.coste_usd });
        // …y el panel lo ve en la respuesta, igual en los dos caminos.
        expect(s.respuesta.coste_usd).toBeGreaterThan(0);
        expect(costeGuardado(s.sb)).toEqual([]);
        expect(costeGuardado(t.sb)).toEqual([]);
        // El original queda en pendientes/ (la pieza) para «Sustituir la existente».
        const insTrabajo = t.sb.consultas.find((c) => c.tabla === "ocr_trabajos" && c.ops[0].m === "insert")!.ops[0].a[0];
        expect(insTrabajo).toMatchObject({ num_paginas: 1, original_path: expect.stringMatching(/^pendientes\//), modelo: "gpt-5.6-luna" });
        expect(t.sb.borrados).toEqual([]);
      } else {
        // 3b) Guardada: misma respuesta para el panel y mismo original archivado.
        expect(t.fin.p_estado).toBe("completado");
        expect(t.fin.p_factura_id).toBe(101);
        expect(sinComun(t.fin.p_resultado as Record<string, unknown>)).toEqual(sinComun(JSON.parse(JSON.stringify(s.respuesta))));
        // Coste de lectura por documento. Síncrono: visión (e.llamadas × 0,00044 $) + 2 llamadas de
        // embeddings (cabecera y líneas) sin tokens simulados; llamadas = visión + 2.
        const costeVision = Math.round(e.llamadas * 0.00044 * 1e6) / 1e6;
        expect(s.respuesta.coste_usd).toBeCloseTo(costeVision, 6);
        expect(costeGuardado(s.sb)).toEqual([
          { coste_lectura_usd: s.respuesta.coste_usd, lectura_llamadas: e.llamadas + 2, lectura_modelo: "gpt-5.6-luna", factura: 101 },
        ]);
        // Trabajo: lo que sumaron las piezas (0,0123 simulado en ocr_trabajos) + embeddings; sin `llamadas`
        // en el simulacro del trabajo → null. El panel recibe el mismo total que se guarda.
        expect(costeGuardado(t.sb)).toEqual([
          { coste_lectura_usd: 0.0123, lectura_llamadas: null, lectura_modelo: "gpt-5.6-luna", factura: 101 },
        ]);
        expect((t.fin.p_resultado as Record<string, unknown>).coste_usd).toBe(0.0123);
        expect(t.sb.subidas.map((x) => ({ ...x, bytes: Buffer.from(x.bytes).toString("base64") })))
          .toEqual(s.sb.subidas.map((x) => ({ ...x, bytes: Buffer.from(x.bytes).toString("base64") })));
        // Sin Drive (secretos vacíos en la prueba): copia TEMPORAL, pendiente de Drive.
        expect(s.sb.subidas[0].path).toMatch(/^temporal\/101-/);
        // La copia de pendientes/ se borra una vez archivado el original.
        expect(t.sb.borrados).toEqual([[t.ruta]]);
      }
      // La factura del trabajo lleva su id (idempotencia ante reintentos).
      const insT = t.sb.consultas.find((c) => c.tabla === "facturas" && c.ops[0].m === "insert")?.ops[0].a[0] as Record<string, unknown> | undefined;
      if (!e.existente) expect(insT).toMatchObject({ ocr_trabajo_id: TID, paginas: 1 });
    });
  }
});

describe("trabajo de una pieza: validación, fallos y reintentos", () => {
  const base = `pendientes/${UID}/${TID}`;
  const pieza = (extra: Record<string, unknown> = {}) => ({
    numero: 1, path: `${base}/01.jpg`, mime: "image/jpeg", bytes: 1000, pieza: "pagina", pagina_doc: 1, ...extra,
  });
  it("validarInicio acepta una pieza «página 1 entera» y rechaza una franja suelta o vacío", () => {
    expect(validarInicio({ trabajo_id: TID, nombre: "a.jpg", origen: "imagen", piezas: [pieza()] }, UID).ok).toBe(true);
    expect(validarInicio({ trabajo_id: TID, nombre: "a.jpg", origen: "imagen", piezas: [pieza({ pieza: "franja", franja: 1, franjas_pagina: 1 })] }, UID).ok).toBe(false);
    expect(validarInicio({ trabajo_id: TID, nombre: "a.jpg", origen: "imagen", piezas: [pieza({ pagina_doc: 2 })] }, UID).ok).toBe(false);
    expect(validarInicio({ trabajo_id: TID, nombre: "a.jpg", origen: "imagen", piezas: [] }, UID).ok).toBe(false);
  });

  it("sin `original`, la pieza única queda como original del trabajo (para sustituir)", async () => {
    const sb = supabaseFalso({});
    const v = validarInicio({ trabajo_id: TID, nombre: "a.jpg", origen: "imagen", piezas: [pieza({ path: RUTA, bytes: BYTES.length })] }, UID);
    if (!v.ok) throw new Error(v.error);
    await iniciarTrabajo(sb.supabase, UID, v.peticion, "gpt-5.6-luna");
    const ins = sb.consultas.find((c) => c.tabla === "ocr_trabajos" && c.ops[0].m === "insert")!.ops[0].a[0];
    expect(ins).toMatchObject({ num_paginas: 1, original_path: RUTA, original_mime: "image/jpeg", modelo: "gpt-5.6-luna" });
    expect(sb.rpcs.map((r) => r.nombre)).toContain("ocr_despachar");
  });

  it("errores transitorios se reintentan; los demás no", () => {
    expect(esErrorTransitorio("Vision 429: rate limit")).toBe(true);
    expect(esErrorTransitorio("Vision 503: overloaded")).toBe(true);
    expect(esErrorTransitorio("TypeError: fetch failed")).toBe(true);
    expect(esErrorTransitorio(`descarga ${RUTA}: Object not found`)).toBe(true);
    expect(esErrorTransitorio("La extracción no cumple el contrato (primer intento): numero_documento")).toBe(false);
    expect(esErrorTransitorio("El modelo rechazó procesar el documento: no")).toBe(false);
    expect(esErrorTransitorio("La respuesta del modelo se cortó por el límite de tokens")).toBe(false);
  });

  const trabajo = { id: TID, num_paginas: 1, contexto_p1: null, estado: "pagina1", nombre_original: "a.jpg" };
  const pag = { id: 7, trabajo_id: TID, numero: 1, pieza: "pagina", storage_path: RUTA, mime: "image/jpeg", relecturas: 0 };

  it("fallo NO transitorio: la pieza queda «fallida» a la primera y se despacha la consolidación", async () => {
    const sb = supabaseFalso({ trabajo });
    const oa = openaiFalso({ vision: [{ tipo: "nota" }, { tipo: "nota" }] });
    const cli = crearClienteOpenAI({ apiKey: "k", config: CONFIG_UNICO, fetch: oa.fetch as never });
    await procesarPagina(sb.supabase, cli, pag, cli);
    expect(sb.rpcs.map((r) => r.nombre)).not.toContain("ocr_fallo_pagina");
    const upd = sb.consultas.find((c) => c.tabla === "ocr_trabajo_paginas" && c.ops[0].m === "update")!;
    expect(upd.ops[0].a[0]).toMatchObject({ estado: "fallida", error: expect.stringContaining("no cumple el contrato") });
    expect(sb.consultas.some((c) => c.tabla === "ocr_trabajos" && c.ops[0].m === "update" && (c.ops[0].a[0] as { estado: string }).estado === "paginas")).toBe(true);
    expect(sb.rpcs.map((r) => r.nombre)).toContain("ocr_despachar");
  });

  it("fallo transitorio (Storage): ocr_fallo_pagina, que reintenta con espera", async () => {
    const sb = supabaseFalso({ trabajo });
    const cli = crearClienteOpenAI({ apiKey: "k", config: CONFIG_UNICO, fetch: vi.fn() as never });
    await procesarPagina(sb.supabase, cli, { ...pag, storage_path: `${RUTA}.no` }, cli);
    expect(sb.rpcs.find((r) => r.nombre === "ocr_fallo_pagina")?.args).toMatchObject({ p_pagina_id: 7 });
  });

  it("consolidar una pieza fallida deja el trabajo «fallido» con el motivo", async () => {
    const sb = supabaseFalso({
      paginas: () => [{ id: 7, numero: 1, estado: "fallida", error: "El modelo rechazó procesar el documento: no", resultado: null, storage_path: RUTA }],
    });
    const cli = crearClienteOpenAI({ apiKey: "k", config: CONFIG_UNICO, fetch: vi.fn() as never });
    await procesarConsolidacion({ supabase: sb.supabase, openai: cli, drive: DRIVE_OFF }, { ...trabajo, estado: "consolidando" });
    expect(sb.rpcs.find((r) => r.nombre === "ocr_terminar_trabajo")?.args).toMatchObject({
      p_estado: "fallido", p_error: "El modelo rechazó procesar el documento: no",
      p_resultado: { success: false, error: "El modelo rechazó procesar el documento: no" },
    });
  });
});
