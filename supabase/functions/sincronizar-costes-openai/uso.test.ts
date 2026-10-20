// Sincronización del USO por clave de OpenAI. fetch y Supabase simulados: no se
// llama a OpenAI ni a la base de datos.
import { describe, expect, it } from "vitest";
import { listarClavesProyecto, obtenerUso, procesoPorNombreClave, sincronizarUso } from "./uso.ts";

const DIA = 86400;
const T0 = Date.UTC(2026, 8, 5) / 1000; // 2026-09-05

const resp = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

const cubo = (inicio: number, results: unknown[], campo: "results" | "result" = "results") => ({
  object: "bucket",
  start_time: inicio,
  end_time: inicio + DIA,
  [campo]: results,
});
const comp = (project_id: string, api_key_id: string | null, model: string, i: number, c: number, o: number, n: number) => ({
  object: "organization.usage.completions.result",
  input_tokens: i,
  input_cached_tokens: c,
  output_tokens: o,
  num_model_requests: n,
  project_id,
  api_key_id,
  model,
});
const emb = (project_id: string, api_key_id: string, model: string, i: number, n: number) => ({
  object: "organization.usage.embeddings.result",
  input_tokens: i,
  num_model_requests: n,
  project_id,
  api_key_id,
  model,
});

type Llamada = { url: URL; auth: string | null };

function fetchSimulado(rutas: Record<string, (u: URL, n: number) => Response>) {
  const llamadas: Llamada[] = [];
  const contador: Record<string, number> = {};
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const clave = url.host + url.pathname;
    llamadas.push({ url, auth: new Headers(init?.headers).get("Authorization") });
    contador[clave] = (contador[clave] ?? 0) + 1;
    const ruta = rutas[clave];
    if (!ruta) throw new Error(`ruta no simulada: ${clave}`);
    return ruta(url, contador[clave]);
  }) as typeof fetch;
  return { fn, llamadas };
}

const USO = "api.openai.com/v1/organization/usage/completions";
const EMB = "api.openai.com/v1/organization/usage/embeddings";
const KEYS = (p: string) => `api.openai.com/v1/organization/projects/${p}/api_keys`;

describe("procesoPorNombreClave", () => {
  it("deduce el proceso del nombre de la clave nueva", () => {
    expect(procesoPorNombreClave("OPENAI_API_KEY_OCR")).toBe("ocr");
    expect(procesoPorNombreClave("OPENAI_API_KEY_CHAT")).toBe("chat");
    expect(procesoPorNombreClave("OPENAI_API_KEY")).toBe("otros");
    expect(procesoPorNombreClave("OPENAI_API_KEY_CHATWEB")).toBe("chatweb");
    expect(procesoPorNombreClave("chat web")).toBe("chatweb");
    expect(procesoPorNombreClave("OPENAI_API_KEY_VINOS")).toBe("vinos");
    expect(procesoPorNombreClave("OPENAI_API_KEY_TRADUCCIONES")).toBe("otros");
    expect(procesoPorNombreClave(null)).toBe("otros");
  });
});

describe("obtenerUso", () => {
  it("pide día/proyecto/clave/modelo en las dos rutas con la Admin key y pagina", async () => {
    const { fn, llamadas } = fetchSimulado({
      [USO]: (_u, n) =>
        n === 1
          ? resp({ object: "page", data: [cubo(T0, [comp("proj_a", "key_ocr", "gpt-5.6-luna-2026-01-01", 1000, 400, 200, 3)])], has_more: true, next_page: "pg2" })
          : resp({ object: "page", data: [cubo(T0 + DIA, [comp("proj_a", "key_chat", "gpt-4.1-mini", 500, 0, 100, 2)], "result")], has_more: false, next_page: null }),
      [EMB]: () => resp({ object: "page", data: [cubo(T0, [emb("proj_a", "key_chat", "text-embedding-3-small", 80, 1)])], has_more: false, next_page: null }),
    });
    const filas = await obtenerUso({ adminKey: "sk-admin-x", desdeUnix: T0, fetch: fn });

    expect(llamadas).toHaveLength(3);
    const p1 = llamadas[0].url.searchParams;
    expect(p1.get("start_time")).toBe(String(T0));
    expect(p1.get("bucket_width")).toBe("1d");
    expect(p1.getAll("group_by")).toEqual(["project_id", "api_key_id", "model"]);
    expect(p1.get("limit")).toBe("31");
    expect(llamadas[1].url.searchParams.get("page")).toBe("pg2");
    expect(llamadas.every((l) => l.auth === "Bearer sk-admin-x")).toBe(true);

    expect(filas).toEqual([
      { fecha: "2026-09-05", project_id: "proj_a", api_key_id: "key_ocr", modelo: "gpt-5.6-luna-2026-01-01", input_tokens: 1000, cached_tokens: 400, output_tokens: 200, peticiones: 3 },
      { fecha: "2026-09-06", project_id: "proj_a", api_key_id: "key_chat", modelo: "gpt-4.1-mini", input_tokens: 500, cached_tokens: 0, output_tokens: 100, peticiones: 2 },
      { fecha: "2026-09-05", project_id: "proj_a", api_key_id: "key_chat", modelo: "text-embedding-3-small", input_tokens: 80, cached_tokens: 0, output_tokens: 0, peticiones: 1 },
    ]);
  });

  it("suma repetidos, trata null como vacío y acota el cacheado al input", async () => {
    const { fn } = fetchSimulado({
      [USO]: () =>
        resp({
          object: "page",
          data: [cubo(T0, [comp("p", null, "m", 100, 900, 5, 1), comp("p", null, "m", 50, 0, 5, 2)])],
          has_more: false,
          next_page: null,
        }),
      [EMB]: () => resp({ object: "page", data: [], has_more: false, next_page: null }),
    });
    const filas = await obtenerUso({ adminKey: "k", desdeUnix: T0, fetch: fn });
    expect(filas).toEqual([
      { fecha: "2026-09-05", project_id: "p", api_key_id: "", modelo: "m", input_tokens: 150, cached_tokens: 100, output_tokens: 10, peticiones: 3 },
    ]);
  });

  it("un cursor repetido corta con error y un 403 no filtra la clave", async () => {
    const repetido = fetchSimulado({
      [USO]: () => resp({ object: "page", data: [], has_more: true, next_page: "igual" }),
      [EMB]: () => resp({ object: "page", data: [], has_more: false, next_page: null }),
    });
    await expect(obtenerUso({ adminKey: "k", desdeUnix: T0, fetch: repetido.fn })).rejects.toThrow(/cursor repetido/);

    const prohibido = fetchSimulado({ [USO]: () => resp({ error: { message: "Missing scopes" } }, 403) });
    const e = await obtenerUso({ adminKey: "sk-admin-secreta", desdeUnix: T0, fetch: prohibido.fn }).catch((x) => x as Error);
    expect(e.message).toBe("OpenAI usage/completions 403: Missing scopes");
    expect(e.message).not.toContain("sk-admin-secreta");
  });
});

describe("listarClavesProyecto", () => {
  it("lista id y nombre (nunca el valor) y pagina con after=last_id", async () => {
    const { fn, llamadas } = fetchSimulado({
      [KEYS("proj_a")]: (_u, n) =>
        n === 1
          ? resp({ object: "list", data: [{ id: "key_1", name: "OPENAI_API_KEY_OCR", redacted_value: "sk-...abc" }], last_id: "key_1", has_more: true })
          : resp({ object: "list", data: [{ id: "key_2", name: "OPENAI_API_KEY" }, { id: "key_3" }], last_id: "key_3", has_more: false }),
    });
    const claves = await listarClavesProyecto({ adminKey: "k", projectId: "proj_a", fetch: fn });
    expect(llamadas[0].url.searchParams.get("limit")).toBe("100");
    expect(llamadas[1].url.searchParams.get("after")).toBe("key_1");
    expect(claves).toEqual([
      { api_key_id: "key_1", project_id: "proj_a", nombre: "OPENAI_API_KEY_OCR" },
      { api_key_id: "key_2", project_id: "proj_a", nombre: "OPENAI_API_KEY" },
      { api_key_id: "key_3", project_id: "proj_a", nombre: null },
    ]);
  });
});

/** Supabase simulado: lecturas por tabla y upserts guardados. */
function supabaseSimulado(opts: {
  proyectos?: { project_id: string; proceso: string | null }[];
  claves?: { api_key_id: string; project_id: string; nombre: string | null }[];
  falla?: string;
} = {}) {
  const upserts: { tabla: string; filas: Record<string, unknown>[]; opciones: Record<string, unknown> }[] = [];
  const supabase = {
    from: (tabla: string) => ({
      select: async () => ({
        data: tabla === "openai_proyectos" ? (opts.proyectos ?? []) : (opts.claves ?? []),
        error: null,
      }),
      upsert: async (filas: Record<string, unknown>[], opciones: Record<string, unknown>) => {
        if (opts.falla === tabla) return { error: { message: "boom" } };
        upserts.push({ tabla, filas, opciones });
        return { error: null };
      },
    }),
  };
  return { supabase, upserts };
}

describe("sincronizarUso", () => {
  const ahora = Date.UTC(2026, 9, 9, 12);
  const rutas = {
    [USO]: () =>
      resp({
        object: "page",
        data: [cubo(T0, [
          comp("proj_casa", "key_ocr", "gpt-5.6-luna", 1000, 0, 100, 2),
          comp("proj_casa", "key_borrada", "gpt-4.1-mini", 10, 0, 1, 1),
          comp("proj_default", "key_ajena", "gpt-4.1", 99999, 0, 9999, 9),
        ])],
        has_more: false,
        next_page: null,
      }),
    [EMB]: () => resp({ object: "page", data: [], has_more: false, next_page: null }),
    [KEYS("proj_default")]: () =>
      resp({
        object: "list",
        data: [{ id: "key_ajena", name: "n8n" }, { id: "key_rest", name: "restaurante" }],
        last_id: "key_rest",
        has_more: false,
      }),
    [KEYS("proj_casa")]: () =>
      resp({
        object: "list",
        data: [
          { id: "key_ocr", name: "OPENAI_API_KEY_OCR" },
          { id: "key_chat", name: "OPENAI_API_KEY_CHAT" },
          { id: "key_gen", name: "OPENAI_API_KEY" },
          { id: "key_vieja", name: "nombre nuevo" },
        ],
        last_id: "key_vieja",
        has_more: false,
      }),
  };
  const proyectos = [
    { project_id: "proj_casa", proceso: "otros" },
    { project_id: "proj_default", proceso: "ajeno" },
  ];

  it("da de alta claves nuevas con su proceso (ajeno en proyectos ajenos) y no pisa el proceso de las existentes", async () => {
    const { fn, llamadas } = fetchSimulado(rutas);
    const { supabase, upserts } = supabaseSimulado({
      proyectos,
      claves: [{ api_key_id: "key_vieja", project_id: "proj_casa", nombre: "nombre viejo" }],
    });
    const r = await sincronizarUso({ supabase, adminKey: "k", fetch: fn, ahoraMs: ahora });

    // Las claves del proyecto ajeno también se listan (su proceso se decide por clave).
    expect(llamadas.some((l) => l.url.pathname.includes("proj_default"))).toBe(true);

    const claves = upserts.filter((u) => u.tabla === "openai_claves");
    expect(claves[0].opciones).toEqual({ onConflict: "api_key_id" });
    expect(claves[0].filas).toEqual([
      { api_key_id: "key_ocr", project_id: "proj_casa", nombre: "OPENAI_API_KEY_OCR", proceso: "ocr" },
      { api_key_id: "key_chat", project_id: "proj_casa", nombre: "OPENAI_API_KEY_CHAT", proceso: "chat" },
      { api_key_id: "key_gen", project_id: "proj_casa", nombre: "OPENAI_API_KEY", proceso: "otros" },
      // Claves nuevas de un proyecto ajeno entran como ajeno, sea cual sea el nombre.
      { api_key_id: "key_ajena", project_id: "proj_default", nombre: "n8n", proceso: "ajeno" },
      { api_key_id: "key_rest", project_id: "proj_default", nombre: "restaurante", proceso: "ajeno" },
    ]);
    // Cambio de nombre: solo nombre/proyecto, sin 'proceso' (no pisa lo puesto a mano).
    expect(claves[1].filas).toEqual([{ api_key_id: "key_vieja", project_id: "proj_casa", nombre: "nombre nuevo" }]);
    // Clave que solo aparece en el uso: alta sin pisar.
    expect(claves[2].opciones).toEqual({ onConflict: "api_key_id", ignoreDuplicates: true });
    expect(claves[2].filas).toEqual([{ api_key_id: "key_borrada", project_id: "proj_casa", nombre: null, proceso: "otros" }]);

    const uso = upserts.find((u) => u.tabla === "openai_uso_diario")!;
    expect(uso.opciones).toEqual({ onConflict: "fecha,project_id,api_key_id,modelo" });
    expect(uso.filas).toHaveLength(3); // también el uso del proyecto ajeno: el reparto por clave lo necesita
    expect(uso.filas.every((f) => f.actualizado_en === new Date(ahora).toISOString())).toBe(true);

    expect(r).toMatchObject({ uso_filas: 3, claves_nuevas: 6, claves_sin_nombre: 1, avisos: [] });
  });

  it("si no se pueden listar las claves avisa y sigue guardando el uso", async () => {
    const { fn } = fetchSimulado({ ...rutas, [KEYS("proj_casa")]: () => resp({ error: { message: "nope" } }, 403) });
    const { supabase, upserts } = supabaseSimulado({ proyectos });
    const r = await sincronizarUso({ supabase, adminKey: "k", fetch: fn, ahoraMs: ahora });
    expect(r.avisos[0]).toMatch(/No se pudieron listar las claves de proj_casa/);
    expect(upserts.some((u) => u.tabla === "openai_uso_diario")).toBe(true);
  });

  it("un error de escritura en la base de datos se propaga", async () => {
    const { fn } = fetchSimulado(rutas);
    const { supabase } = supabaseSimulado({ proyectos, falla: "openai_uso_diario" });
    await expect(sincronizarUso({ supabase, adminKey: "k", fetch: fn, ahoraMs: ahora })).rejects.toThrow(/openai_uso_diario: boom/);
  });
});
