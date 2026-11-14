// analizar-peticion · handler real con Supabase y OpenAI simulados: quién puede pedir el análisis, que se
// hace UNA vez (sin forzar no se repite), «Volver a analizar» solo super admin, los fallos de la IA quedan
// guardados con un motivo legible y a la IA no va nada de quién la envió.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ID = "11111111-2222-4333-8444-555555555555";
const AUTOR = "aaaaaaaa-0000-4000-8000-000000000001";
const OTRO = "aaaaaaaa-0000-4000-8000-000000000002";
const SUPER = "aaaaaaaa-0000-4000-8000-000000000003";
const TOKENS: Record<string, string> = { "jwt-autor": AUTOR, "jwt-otro": OTRO, "jwt-super": SUPER };

const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  fila: null as Record<string, unknown> | null,
  openai: [] as Array<Record<string, unknown>>,
  respuestaOpenAI: null as (() => Response) | null,
  registros: [] as Array<{ disparador?: string }>,
}));

vi.mock("../../_shared/audit-client.ts", () => ({
  conAuditoriaDePeticion: (_n: string, _f: unknown, handler: unknown) => handler,
  clienteConAuditoria: (f: unknown) => f,
}));
vi.mock("../../_shared/registrar-uso-ia.ts", () => ({
  AcumuladorUso: class { llamadas = 0; sumar() { this.llamadas++; } marcarError() {} },
  registrarUso: async (_a: unknown, o: { disparador?: string }) => { h.registros.push(o); },
}));

/** Constructor de consultas mínimo: select/update + eq + maybeSingle o await. */
function consulta(tabla: string) {
  let cambios: Record<string, unknown> | null = null;
  const filtros: Record<string, unknown> = {};
  const resultado = () => {
    if (tabla !== "peticiones" || !h.fila || filtros.id !== h.fila.id) return null;
    return h.fila;
  };
  const b = {
    select: () => b,
    update: (v: Record<string, unknown>) => { cambios = v; return b; },
    eq: (c: string, v: unknown) => { filtros[c] = v; return b; },
    maybeSingle: async () => ({ data: resultado() ? { ...resultado() } : null, error: null }),
    then: (ok: (r: unknown) => unknown) => {
      if (cambios && resultado()) Object.assign(h.fila!, cambios);
      return Promise.resolve({ data: null, error: null }).then(ok);
    },
  };
  return b;
}

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => (TOKENS[token] ? { data: { user: { id: TOKENS[token], email: `${token}@t` } }, error: null } : { data: { user: null }, error: { message: "jwt" } }),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "is_super_admin") return { data: args._user_id === SUPER, error: null };
      if (fn === "peticion_reservar_analisis") {
        const f = h.fila;
        if (!f || f.id !== args.p_id) return { data: [], error: null };
        const puede = (f.analisis_intentos as number) < 10 && (args.p_forzar === true || f.analisis_estado === "pendiente");
        if (!puede) return { data: [], error: null };
        Object.assign(f, { analisis_estado: "analizando", analisis_intentos: (f.analisis_intentos as number) + 1 });
        return { data: [{ ...f }], error: null };
      }
      return { data: null, error: { message: `rpc desconocida ${fn}` } };
    },
    from: (tabla: string) => consulta(tabla),
  }),
}));

const ENV: Record<string, string> = { SUPABASE_URL: "https://ejemplo.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", OPENAI_API_KEY: "sk-prueba" };
const ANALISIS = {
  resumen: "Que al guardar una reserva se guarde.",
  tipo: "error",
  tarea_propuesta: "Revisar el guardado de reservas.",
  pasos: ["Reproducir", "Corregir"],
  modulos_afectados: ["Reservas"],
  repo: "panel",
  riesgo: { nivel: "medio", motivo: "Reservas de clientes." },
  toca_bd: false,
  criterios_aceptacion: ["Se guarda"],
  preguntas: [],
  prompt_ia: "## Contexto\nPanel.\n\n## Petición\nNo se guarda.",
};
const respuestaBuena = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANALISIS) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (n: string) => ENV[n] }, serve: (fn: (r: Request) => Promise<Response>) => { h.handler = fn; } });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    h.openai.push(JSON.parse(String(init?.body ?? "{}")));
    return (h.respuestaOpenAI ?? respuestaBuena)();
  }));
  await import("../index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  h.openai = [];
  h.registros = [];
  h.respuestaOpenAI = null;
  h.fila = {
    id: ID, creado_por: AUTOR, creado_por_email: "ana@restaurante.es", creado_por_nombre: "Ana Sala",
    titulo: "No se guarda la reserva", prioridad: "alta", modulo: "reservas",
    descripcion: "Al pulsar Guardar no pasa nada y se queda la pantalla igual.", ruta: "/reservas?tab=hoy", dispositivo: "Mozilla/5.0 (iPad)",
    captura_path: null, analisis_estado: "pendiente", analisis: null, analisis_error: null, analisis_intentos: 0,
  };
});

const pedir = (token: string | null, body: Record<string, unknown> = { peticion_id: ID }) =>
  h.handler!(new Request("https://ejemplo.supabase.co/functions/v1/analizar-peticion", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));

describe("analizar-peticion", () => {
  it("sin usuario → 401 sin llamar a la IA", async () => {
    expect((await pedir(null)).status).toBe(401);
    expect((await pedir("jwt-falso")).status).toBe(401);
    expect(h.openai).toHaveLength(0);
  });

  it("sin petición válida → 400", async () => {
    expect((await pedir("jwt-autor", { peticion_id: "1; drop" })).status).toBe(400);
  });

  it("quien la envió la analiza una vez: guarda el análisis con las reglas del repo y registra el gasto", async () => {
    const res = await pedir("jwt-autor");
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo).toMatchObject({ ok: true, analisis_estado: "hecho" });
    expect(h.openai).toHaveLength(1);
    expect(h.openai[0]).toMatchObject({ model: "gpt-4.1-mini", response_format: { type: "json_schema" } });
    expect(h.fila).toMatchObject({ analisis_estado: "hecho", analisis_error: null, analisis_modelo: "gpt-4.1-mini" });
    const guardado = h.fila!.analisis as { resumen: string; prompt_ia: string };
    expect(guardado.resumen).toBe(ANALISIS.resumen);
    expect(guardado.prompt_ia).toMatch(/## Reglas del repositorio/);
    expect(h.registros).toEqual([expect.objectContaining({ disparador: `peticion:${ID}` })]);
  });

  it("a la IA no va nada de quién la envió", async () => {
    await pedir("jwt-autor");
    const enviado = JSON.stringify(h.openai[0]);
    expect(enviado).toContain("No se guarda la reserva");
    expect(enviado).not.toContain(AUTOR);
    expect(enviado).not.toContain("ana@restaurante.es");
    expect(enviado).not.toContain("Ana Sala");
    expect(enviado).not.toContain("Mozilla");
  });

  it("sin forzar no se repite: la segunda vez devuelve lo guardado sin llamar a la IA", async () => {
    await pedir("jwt-autor");
    const res = await pedir("jwt-autor");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, repetido: true, analisis_estado: "hecho" });
    expect(h.openai).toHaveLength(1);
  });

  it("otro usuario no puede pedir el análisis de una petición ajena (ni sabe si existe)", async () => {
    expect((await pedir("jwt-otro")).status).toBe(404);
    expect(h.openai).toHaveLength(0);
  });

  it("«Volver a analizar» (forzar) solo el super admin", async () => {
    await pedir("jwt-autor");
    expect((await pedir("jwt-autor", { peticion_id: ID, forzar: true })).status).toBe(403);
    expect(h.openai).toHaveLength(1);
    const res = await pedir("jwt-super", { peticion_id: ID, forzar: true });
    expect(res.status).toBe(200);
    expect(h.openai).toHaveLength(2);
    expect(h.fila!.analisis_intentos).toBe(2);
  });

  it("el super admin puede lanzar el análisis de una pendiente (p. ej. si se cortó al guardar)", async () => {
    expect((await pedir("jwt-super")).status).toBe(200);
    expect(h.fila!.analisis_estado).toBe("hecho");
  });

  it("si la IA falla, la petición queda con el motivo legible y se puede volver a analizar", async () => {
    h.respuestaOpenAI = () => new Response(JSON.stringify({ error: { message: "You exceeded your current quota", code: "insufficient_quota" } }), { status: 429 });
    const res = await pedir("jwt-autor");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/sin saldo/);
    expect(h.fila).toMatchObject({ analisis_estado: "error" });
    expect(String(h.fila!.analisis_error)).toMatch(/sin saldo/);
    expect(h.registros).toHaveLength(1); // el gasto se registra también si falla

    // Sin forzar no se reintenta sola…
    h.respuestaOpenAI = null;
    expect(await (await pedir("jwt-autor")).json()).toMatchObject({ repetido: true, analisis_estado: "error" });
    // …y el super admin sí.
    expect((await pedir("jwt-super", { peticion_id: ID, forzar: true })).status).toBe(200);
    expect(h.fila).toMatchObject({ analisis_estado: "hecho", analisis_error: null });
  });

  it("una respuesta que no es un análisis queda como error legible", async () => {
    h.respuestaOpenAI = () => new Response(JSON.stringify({ choices: [{ message: { content: "lo siento, no puedo" } }] }), { status: 200 });
    const res = await pedir("jwt-autor");
    expect(res.status).toBe(502);
    expect(String(h.fila!.analisis_error)).toMatch(/no devolvió un análisis legible/);
  });

  it("tope de intentos al forzar → 429", async () => {
    h.fila!.analisis_intentos = 10;
    h.fila!.analisis_estado = "error";
    expect((await pedir("jwt-super", { peticion_id: ID, forzar: true })).status).toBe(429);
    expect(h.openai).toHaveLength(0);
  });
});
