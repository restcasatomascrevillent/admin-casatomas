// analizar-peticion · { accion: "enviar_linear" } con el handler real, Supabase en memoria y un Linear simulado:
// solo el super admin, qué se guarda en la petición (identificador, enlace y «Aceptada»), que repetir no
// duplica, el modo prueba (destino de pruebas, nunca Linear) y los mensajes de desactivado y sin equipo.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ID = "11111111-2222-4333-8444-555555555555";
const AUTOR = "aaaaaaaa-0000-4000-8000-000000000001";
const SUPER = "aaaaaaaa-0000-4000-8000-000000000003";
const TOKENS: Record<string, string> = { "jwt-autor": AUTOR, "jwt-super": SUPER };

type Fila = Record<string, unknown>;
const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  tablas: {} as Record<string, Array<Record<string, unknown>>>,
  linear: [] as Array<{ query: string; variables: Record<string, unknown> }>,
  issues: new Map<string, Record<string, unknown>>(),
  otrasLlamadas: 0,
  env: {} as Record<string, string>,
}));

vi.mock("../../_shared/audit-client.ts", () => ({
  conAuditoriaDePeticion: (_n: string, _f: unknown, handler: unknown) => handler,
  clienteConAuditoria: (f: unknown) => f,
}));
vi.mock("../../_shared/registrar-uso-ia.ts", () => ({
  AcumuladorUso: class { sumar() {} marcarError() {} },
  registrarUso: async () => {},
}));

/** Constructor de consultas en memoria: select/update/insert + eq/in/limit + single/maybeSingle o await. */
function consulta(tabla: string) {
  let cambios: Fila | null = null;
  let nueva: Fila | null = null;
  let limite = Infinity;
  const filtros: Array<(f: Fila) => boolean> = [];
  const filas = () => (h.tablas[tabla] ?? []).filter((f) => filtros.every((ok) => ok(f))).slice(0, limite);
  const ejecutar = () => {
    if (nueva) {
      const lista = (h.tablas[tabla] ??= []);
      const fila = { id: lista.length + 1, ...nueva };
      lista.push(fila);
      return [fila];
    }
    const sel = filas();
    if (cambios) sel.forEach((f) => Object.assign(f, cambios));
    return sel.map((f) => ({ ...f }));
  };
  const b = {
    select: () => b,
    update: (v: Fila) => { cambios = v; return b; },
    insert: (v: Fila) => { nueva = v; return b; },
    eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return b; },
    in: (c: string, v: unknown[]) => { filtros.push((f) => v.includes(f[c])); return b; },
    limit: (n: number) => { limite = n; return b; },
    maybeSingle: async () => ({ data: ejecutar()[0] ?? null, error: null }),
    single: async () => ({ data: ejecutar()[0] ?? null, error: null }),
    then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: ejecutar(), error: null }).then(ok),
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
      return { data: null, error: { message: `rpc inesperada ${fn}` } };
    },
    from: (tabla: string) => consulta(tabla),
  }),
}));

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
  prompt_ia: "## Contexto\nPanel.",
};

/** Linear simulado (solo lo que usa «Enviar a Linear»). */
async function linearFalso(init?: RequestInit): Promise<Response> {
  const { query, variables } = JSON.parse(String(init?.body ?? "{}"));
  h.linear.push({ query, variables });
  const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
  if (new Headers(init?.headers).get("authorization") !== "lin_api_prueba") {
    return new Response(JSON.stringify({ errors: [{ message: "Authentication required", extensions: { code: "AUTHENTICATION_ERROR" } }] }), { status: 400 });
  }
  if (query.includes("EtiquetasTicketPanel")) return json({ issueLabels: { nodes: [{ id: "et-bug", name: "Bug", isGroup: false, team: null }] } });
  if (query.includes("issueCreate")) {
    const id = String(variables.input.id);
    if (h.issues.has(id)) return new Response(JSON.stringify({ errors: [{ message: "Entity already exists" }] }), { status: 400 });
    const issue = { id, identifier: `CAS-${12 + h.issues.size}`, url: `https://linear.app/casa-tomas/issue/CAS-${12 + h.issues.size}/x`, state: { name: "Todo", type: "unstarted" } };
    h.issues.set(id, issue);
    return json({ issueCreate: { success: true, issue } });
  }
  if (query.includes("issue(id")) {
    const i = h.issues.get(String(variables.id));
    return i ? json({ issue: i }) : new Response(JSON.stringify({ errors: [{ message: "Entity not found" }] }), { status: 400 });
  }
  return new Response(JSON.stringify({ errors: [{ message: "no simulada" }] }), { status: 400 });
}

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (n: string) => h.env[n] }, serve: (fn: (r: Request) => Promise<Response>) => { h.handler = fn; } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("https://api.linear.app/")) return linearFalso(init);
    h.otrasLlamadas++;
    return new Response("{}", { status: 500 });
  }));
  await import("../index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  h.env = { SUPABASE_URL: "https://sfonaclosuafvlhutkon.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", OPENAI_API_KEY: "sk-prueba", LINEAR_API_KEY: "lin_api_prueba" };
  h.linear = [];
  h.issues = new Map();
  h.otrasLlamadas = 0;
  h.tablas = {
    peticiones: [{
      id: ID, creado_por: AUTOR, creado_por_nombre: "Ana Sala", creado_por_email: "ana@restaurante.es",
      titulo: "No se guarda la reserva", prioridad: "urgente", modulo: "reservas",
      descripcion: "Al pulsar Guardar no pasa nada.", ruta: "/reservas?tab=hoy", dispositivo: "Mozilla/5.0 (iPad)", captura_path: null,
      created_at: "2026-11-13T10:00:00Z", estado: "en_analisis", analisis: ANALISIS, analisis_estado: "hecho", linear_id: null, linear_url: null,
    }],
    web_logs_config: [{ id: true, linear_modo: "real", linear_equipo_id: "eq-cas", linear_proyecto_id: null, linear_etiquetas: [] }],
    web_linear_prueba: [],
  };
});

const pedir = (token: string | null, body: Record<string, unknown> = { accion: "enviar_linear", peticion_id: ID }) =>
  h.handler!(new Request("https://ejemplo.supabase.co/functions/v1/analizar-peticion", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));
const peticion = () => h.tablas.peticiones[0];

describe("analizar-peticion · enviar_linear", () => {
  it("sin usuario → 401; quien la envió (no super admin) → 403; nada llega a Linear", async () => {
    expect((await pedir(null)).status).toBe(401);
    const r = await pedir("jwt-autor");
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("Solo el super admin puede enviar tickets a Linear");
    expect(h.linear).toHaveLength(0);
    expect(peticion().linear_url).toBeNull();
  });

  it("acción desconocida o sin ticket → 400; ticket que no existe → 404", async () => {
    expect((await pedir("jwt-super", { accion: "borrar", peticion_id: ID })).status).toBe(400);
    expect((await pedir("jwt-super", { accion: "enviar_linear" })).status).toBe(400);
    expect((await pedir("jwt-super", { accion: "enviar_linear", peticion_id: "11111111-2222-4333-8444-000000000000" })).status).toBe(404);
  });

  it("super admin: crea la incidencia, guarda CAS-12 y el enlace, y pasa a «Aceptada» (sin llamar a la IA)", async () => {
    const r = await pedir("jwt-super");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, destino: "real", identificador: "CAS-12", url: "https://linear.app/casa-tomas/issue/CAS-12/x", repetido: false, aceptada: true });
    expect(peticion()).toMatchObject({ linear_id: "CAS-12", linear_url: "https://linear.app/casa-tomas/issue/CAS-12/x", estado: "aceptada", analisis_estado: "hecho" });
    const crear = h.linear.find((l) => l.query.includes("issueCreate"))!;
    expect(crear.variables.input).toMatchObject({ teamId: "eq-cas", title: "No se guarda la reserva", priority: 1, labelIds: ["et-bug"] });
    const descripcion = String((crear.variables.input as Fila).description);
    expect(descripcion).toContain("https://admin-casatomas-git-staging-casa-tomas.vercel.app/super-admin/tickets?ticket=" + ID);
    expect(descripcion).not.toContain("ana@restaurante.es");
    expect(h.otrasLlamadas).toBe(0);
  });

  it("pulsar otra vez: devuelve lo mismo y no vuelve a llamar a Linear", async () => {
    await pedir("jwt-super");
    const llamadas = h.linear.length;
    const r = await (await pedir("jwt-super")).json();
    expect(r).toMatchObject({ ok: true, repetido: true, identificador: "CAS-12" });
    expect(h.linear).toHaveLength(llamadas);
    expect(h.issues.size).toBe(1);
  });

  it("si se perdió lo guardado (la incidencia ya existe), la recupera en vez de crear otra", async () => {
    await pedir("jwt-super");
    Object.assign(peticion(), { linear_id: null, linear_url: null });
    const r = await (await pedir("jwt-super")).json();
    expect(r).toMatchObject({ ok: true, identificador: "CAS-12", repetido: false });
    expect(h.issues.size).toBe(1);
  });

  it("modo prueba: al destino de pruebas (sin incidencia de Logs), nunca a Linear, y el ticket no cambia", async () => {
    h.tablas.web_logs_config[0].linear_modo = "prueba";
    const r = await pedir("jwt-super");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, destino: "prueba", identificador: "PRUEBA-1", url: null });
    expect(h.tablas.web_linear_prueba).toHaveLength(1);
    expect(h.tablas.web_linear_prueba[0]).toMatchObject({ incidencia_id: null, operacion: "crear", titulo: "No se guarda la reserva", prioridad: 1 });
    expect(h.linear).toHaveLength(0);
    expect(peticion()).toMatchObject({ linear_id: null, linear_url: null, estado: "en_analisis" });
    await pedir("jwt-super");
    expect(h.tablas.web_linear_prueba).toHaveLength(1);
  });

  it("desactivado o sin equipo → 409 con el mensaje que dice qué hacer", async () => {
    h.tablas.web_logs_config[0].linear_modo = "desactivado";
    let r = await pedir("jwt-super");
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/Linear está desactivado.*Logs › Configuración › Linear/);
    Object.assign(h.tablas.web_logs_config[0], { linear_modo: "real", linear_equipo_id: null });
    r = await pedir("jwt-super");
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("Elige el equipo en Logs › Configuración › Linear.");
    expect(h.linear).toHaveLength(0);
  });

  it("sin LINEAR_API_KEY en modo real → 503 con los pasos para crearla", async () => {
    delete h.env.LINEAR_API_KEY;
    const r = await pedir("jwt-super");
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/LINEAR_API_KEY/);
  });

  it("en producción, el enlace de vuelta es el del panel de producción", async () => {
    h.env.SUPABASE_URL = "https://haqmmdfdzzatdnrrcgez.supabase.co";
    await pedir("jwt-super");
    const crear = h.linear.find((l) => l.query.includes("issueCreate"))!;
    expect(String((crear.variables.input as Fila).description)).toContain("https://admin-casatomas.vercel.app/super-admin/tickets?ticket=" + ID);
  });
});
