// Sincronización del gasto real de OpenAI. fetch y Supabase simulados: no se
// llama a OpenAI ni al BCE ni a la base de datos.
import { describe, expect, it } from "vitest";
import {
  fechaUtc,
  inicioVentana,
  listarProyectos,
  obtenerCostes,
  obtenerTipoCambio,
  sincronizar,
} from "./costes.ts";

const DIA = 86400;
const T0 = Date.UTC(2026, 8, 5) / 1000; // 2026-09-05

const resp = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

const res = (project_id: string | null, line_item: string | null, value: number, currency = "usd") => ({
  object: "organization.costs.result",
  amount: { value, currency },
  project_id,
  line_item,
});
const cubo = (inicio: number, results: unknown[]) => ({ object: "bucket", start_time: inicio, end_time: inicio + DIA, results });

type Llamada = { url: URL; auth: string | null };

/** fetch simulado: un guion por ruta, registra las llamadas. */
function fetchSimulado(rutas: Record<string, (u: URL, n: number) => Response>) {
  const llamadas: Llamada[] = [];
  const contador: Record<string, number> = {};
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const clave = url.host + url.pathname;
    const h = new Headers(init?.headers);
    llamadas.push({ url, auth: h.get("Authorization") });
    contador[clave] = (contador[clave] ?? 0) + 1;
    const ruta = rutas[clave];
    if (!ruta) throw new Error(`ruta no simulada: ${clave}`);
    return ruta(url, contador[clave]);
  }) as typeof fetch;
  return { fn, llamadas };
}

const RUTA_ECB = "data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A";
const ECB = {
  dataSets: [{ series: { "0:0:0:0:0": { observations: { "0": [1.25, 0, 0, null, null] } } } }],
  structure: { dimensions: { observation: [{ values: [{ id: "2026-10-08" }] }] } },
};

/** Supabase simulado: guarda lo que se upserta por tabla. */
function supabaseSimulado(opts: { proyectosExistentes?: string[]; sinProceso?: number; falla?: string } = {}) {
  const upserts: { tabla: string; filas: Record<string, unknown>[]; opciones: Record<string, unknown> }[] = [];
  const supabase = {
    from: (tabla: string) => ({
      upsert: async (filas: Record<string, unknown>[], opciones: Record<string, unknown>) => {
        if (opts.falla === tabla) return { error: { message: "boom" } };
        upserts.push({ tabla, filas, opciones });
        return { error: null };
      },
      select: (_cols: string, o?: { head?: boolean }) => {
        if (o?.head) return { is: async () => ({ count: opts.sinProceso ?? 0, error: null }) };
        return Promise.resolve({ data: (opts.proyectosExistentes ?? []).map((project_id) => ({ project_id })), error: null });
      },
    }),
  };
  return { supabase, upserts };
}

describe("fechaUtc / inicioVentana", () => {
  it("convierte el cubo diario a fecha UTC", () => {
    expect(fechaUtc(T0)).toBe("2026-09-05");
    expect(fechaUtc(T0 + DIA - 1)).toBe("2026-09-05");
  });
  it("la ventana empieza 35 días antes de la medianoche UTC de hoy", () => {
    const ahora = Date.UTC(2026, 9, 8, 15, 30);
    expect(fechaUtc(inicioVentana(ahora))).toBe("2026-09-03");
  });
});

describe("obtenerCostes", () => {
  it("pide día/proyecto/concepto con la Admin key y pagina con next_page", async () => {
    const { fn, llamadas } = fetchSimulado({
      "api.openai.com/v1/organization/costs": (_u, n) =>
        n === 1
          ? resp({ object: "page", data: [cubo(T0, [res("proj_ocr", "gpt-5.6-luna, input", 1.5)])], has_more: true, next_page: "pg2" })
          : resp({ object: "page", data: [cubo(T0 + DIA, [res("proj_chat", "gpt-4.1-mini, output", 0.25)])], has_more: false, next_page: null }),
    });
    const filas = await obtenerCostes({ adminKey: "sk-admin-x", desdeUnix: T0, fetch: fn });

    expect(llamadas).toHaveLength(2);
    const p1 = llamadas[0].url.searchParams;
    expect(p1.get("start_time")).toBe(String(T0));
    expect(p1.get("bucket_width")).toBe("1d");
    expect(p1.getAll("group_by")).toEqual(["project_id", "line_item"]);
    expect(p1.get("limit")).toBe("45");
    expect(p1.get("page")).toBeNull();
    expect(llamadas[1].url.searchParams.get("page")).toBe("pg2");
    expect(llamadas.every((l) => l.auth === "Bearer sk-admin-x")).toBe(true);

    expect(filas).toEqual([
      { fecha: "2026-09-05", project_id: "proj_ocr", line_item: "gpt-5.6-luna, input", usd: 1.5 },
      { fecha: "2026-09-06", project_id: "proj_chat", line_item: "gpt-4.1-mini, output", usd: 0.25 },
    ]);
  });

  it("suma resultados repetidos de la misma clave, trata null como vacío e ignora otras monedas", async () => {
    const { fn } = fetchSimulado({
      "api.openai.com/v1/organization/costs": () =>
        resp({
          object: "page",
          data: [cubo(T0, [res(null, null, 0.1), res(null, null, 0.2), res("p", "x", 1, "eur"), res("p", "y", Number.NaN)])],
          has_more: false,
          next_page: null,
        }),
    });
    const filas = await obtenerCostes({ adminKey: "k", desdeUnix: T0, fetch: fn });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ project_id: "", line_item: "" });
    expect(filas[0].usd).toBeCloseTo(0.3, 10);
  });

  it("falla con un cursor repetido en vez de entrar en bucle", async () => {
    const { fn } = fetchSimulado({
      "api.openai.com/v1/organization/costs": () => resp({ object: "page", data: [], has_more: true, next_page: "igual" }),
    });
    await expect(obtenerCostes({ adminKey: "k", desdeUnix: T0, fetch: fn })).rejects.toThrow(/cursor repetido/);
  });

  it("un error de OpenAI da el código y NO filtra la clave", async () => {
    const { fn } = fetchSimulado({
      "api.openai.com/v1/organization/costs": () => resp({ error: { message: "insufficient permissions" } }, 403),
    });
    const e = await obtenerCostes({ adminKey: "sk-admin-secreta", desdeUnix: T0, fetch: fn }).catch((x) => x as Error);
    expect(e.message).toBe("OpenAI costs 403: insufficient permissions");
    expect(e.message).not.toContain("sk-admin-secreta");
  });
});

describe("listarProyectos", () => {
  it("pagina con after=last_id e incluye archivados", async () => {
    const { fn, llamadas } = fetchSimulado({
      "api.openai.com/v1/organization/projects": (_u, n) =>
        n === 1
          ? resp({ object: "list", data: [{ id: "proj_a", name: "OCR" }], last_id: "proj_a", has_more: true })
          : resp({ object: "list", data: [{ id: "proj_b", name: "Chat" }, { name: "sin id" }], last_id: "proj_b", has_more: false }),
    });
    const ps = await listarProyectos({ adminKey: "k", fetch: fn });
    expect(ps).toEqual([{ project_id: "proj_a", nombre: "OCR" }, { project_id: "proj_b", nombre: "Chat" }]);
    expect(llamadas[0].url.searchParams.get("include_archived")).toBe("true");
    expect(llamadas[1].url.searchParams.get("after")).toBe("proj_a");
  });
});

describe("obtenerTipoCambio", () => {
  it("convierte USD por EUR del BCE a EUR por USD", async () => {
    const { fn } = fetchSimulado({ [RUTA_ECB]: () => resp(ECB) });
    expect(await obtenerTipoCambio(fn)).toEqual({ fecha: "2026-10-08", eur_por_usd: 0.8, fuente: "bce" });
  });
  it("si el BCE falla usa frankfurter", async () => {
    const { fn } = fetchSimulado({
      [RUTA_ECB]: () => resp({}, 500),
      "api.frankfurter.dev/v1/latest": () => resp({ date: "2026-10-07", rates: { EUR: 0.86 } }),
    });
    expect(await obtenerTipoCambio(fn)).toEqual({ fecha: "2026-10-07", eur_por_usd: 0.86, fuente: "frankfurter" });
  });
  it("si nadie responde con algo creíble devuelve null", async () => {
    const { fn } = fetchSimulado({
      [RUTA_ECB]: () => resp({ dataSets: [] }),
      "api.frankfurter.dev/v1/latest": () => resp({ date: "2026-10-07", rates: { EUR: 99 } }),
    });
    expect(await obtenerTipoCambio(fn)).toBeNull();
  });
});

describe("sincronizar", () => {
  const ahora = Date.UTC(2026, 9, 8, 12);
  const rutasOk = {
    "api.openai.com/v1/organization/costs": () =>
      resp({
        object: "page",
        data: [cubo(T0, [res("proj_ocr", "a", 2), res("proj_nuevo", "b", 0.5), res(null, "c", 0.1)])],
        has_more: false,
        next_page: null,
      }),
    "api.openai.com/v1/organization/projects": () =>
      resp({ object: "list", data: [{ id: "proj_ocr", name: "OCR" }, { id: "proj_chat", name: "Chat" }], last_id: "proj_chat", has_more: false }),
    [RUTA_ECB]: () => resp(ECB),
  };

  it("hace upsert de costes, proyectos (nuevos y desconocidos) y tipo de cambio", async () => {
    const { fn } = fetchSimulado(rutasOk);
    const { supabase, upserts } = supabaseSimulado({ proyectosExistentes: ["proj_ocr"], sinProceso: 2 });
    const r = await sincronizar({ supabase, adminKey: "k", fetch: fn, ahoraMs: ahora });

    const por = (t: string) => upserts.filter((u) => u.tabla === t);
    expect(por("openai_costes_diarios")).toHaveLength(1);
    expect(por("openai_costes_diarios")[0].opciones).toEqual({ onConflict: "fecha,project_id,line_item" });
    expect(por("openai_costes_diarios")[0].filas).toHaveLength(3);
    expect(por("openai_costes_diarios")[0].filas[0]).toMatchObject({
      fecha: "2026-09-05", project_id: "proj_ocr", line_item: "a", usd: 2, actualizado_en: new Date(ahora).toISOString(),
    });
    // Proyectos listados: solo project_id + nombre (no pisa 'proceso')
    const listados = por("openai_proyectos")[0];
    expect(listados.filas).toEqual([{ project_id: "proj_ocr", nombre: "OCR" }, { project_id: "proj_chat", nombre: "Chat" }]);
    expect(listados.opciones).toEqual({ onConflict: "project_id" });
    // Proyecto desconocido (solo aparece en los costes): alta sin nombre y sin sobrescribir
    const desconocidos = por("openai_proyectos")[1];
    expect(desconocidos.filas).toEqual([{ project_id: "proj_nuevo" }]);
    expect(desconocidos.opciones).toEqual({ onConflict: "project_id", ignoreDuplicates: true });
    // Tipo de cambio
    expect(por("tipo_cambio_usd_eur")[0].filas[0]).toMatchObject({ fecha: "2026-10-08", eur_por_usd: 0.8, fuente: "bce" });

    expect(r).toMatchObject({ filas: 3, dias: 1, proyectos_nuevos: 2, proyectos_sin_proceso: 2, avisos: [] });
  });

  it("si no se pueden listar proyectos sigue con los de los costes y avisa", async () => {
    const { fn } = fetchSimulado({
      ...rutasOk,
      "api.openai.com/v1/organization/projects": () => resp({ error: { message: "nope" } }, 403),
    });
    const { supabase, upserts } = supabaseSimulado();
    const r = await sincronizar({ supabase, adminKey: "k", fetch: fn, ahoraMs: ahora });
    expect(r.avisos[0]).toMatch(/No se pudo listar proyectos/);
    const alta = upserts.filter((u) => u.tabla === "openai_proyectos");
    expect(alta).toHaveLength(1);
    expect(alta[0].filas).toEqual([{ project_id: "proj_ocr" }, { project_id: "proj_nuevo" }]);
    expect(r.proyectos_nuevos).toBe(2);
  });

  it("sin tipo de cambio avisa pero guarda los costes", async () => {
    const { fn } = fetchSimulado({
      ...rutasOk,
      [RUTA_ECB]: () => resp({}, 503),
      "api.frankfurter.dev/v1/latest": () => resp({}, 503),
    });
    const { supabase, upserts } = supabaseSimulado();
    const r = await sincronizar({ supabase, adminKey: "k", fetch: fn, ahoraMs: ahora });
    expect(r.tipo_cambio).toBeNull();
    expect(r.avisos.some((a) => a.includes("tipo de cambio"))).toBe(true);
    expect(upserts.some((u) => u.tabla === "openai_costes_diarios")).toBe(true);
    expect(upserts.some((u) => u.tabla === "tipo_cambio_usd_eur")).toBe(false);
  });

  it("un error de escritura en la base de datos se propaga", async () => {
    const { fn } = fetchSimulado(rutasOk);
    const { supabase } = supabaseSimulado({ falla: "openai_costes_diarios" });
    await expect(sincronizar({ supabase, adminKey: "k", fetch: fn, ahoraMs: ahora })).rejects.toThrow(/openai_costes_diarios: boom/);
  });

  it("si OpenAI rechaza los costes no escribe nada", async () => {
    const { fn } = fetchSimulado({
      ...rutasOk,
      "api.openai.com/v1/organization/costs": () => resp({ error: { message: "bad key" } }, 401),
    });
    const { supabase, upserts } = supabaseSimulado();
    await expect(sincronizar({ supabase, adminKey: "k", fetch: fn, ahoraMs: ahora })).rejects.toThrow(/401/);
    expect(upserts).toHaveLength(0);
  });
});
