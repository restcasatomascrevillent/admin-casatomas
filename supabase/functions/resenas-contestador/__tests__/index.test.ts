// Puerta de entrada de resenas-contestador: quién puede llamar a qué.
// Sin red: Supabase, Google y OpenAI simulados.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = {
    handler: null as ((req: Request) => Promise<Response>) | null,
    fetchs: [] as string[],
    usos: [] as Array<Record<string, unknown>>,
    superAdmins: new Set(["jwt-super"]),
    updates: [] as Array<{ tabla: string; cambios: unknown }>,
  };
  const USUARIOS: Record<string, string> = { "jwt-super": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "jwt-staff": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
  const AJUSTES = {
    proponer_automatico: true, autorespuesta_activa: false, autorespuesta_estrellas: [4, 5], autorespuesta_sin_texto: true,
    firma: "El equipo de Casa Tomás", indicaciones: "", gbp_ubicacion: null,
  };
  const RESENA = { id: "11111111-1111-4111-8111-111111111111", nombre_cliente: "Ana", valoracion: 5, comentario: "Rico", fecha: "2026-11-01", respuesta: null, respuesta_estado: "pendiente" };
  const builder = (tabla: string) => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    for (const m of ["select", "eq", "is", "in", "not", "gte", "lte", "order", "limit"]) b[m] = self;
    b.single = async () => ({ data: tabla === "resenas_ajustes" ? AJUSTES : null, error: null });
    b.maybeSingle = async () => ({ data: null, error: null });
    b.update = (cambios: unknown) => { estado.updates.push({ tabla, cambios }); return { eq: async () => ({ error: null }) }; };
    b.then = (ok: (v: unknown) => unknown) => ok({ data: tabla === "resenas" ? [RESENA] : [], error: null });
    return b;
  };
  const cliente = () => ({
    auth: {
      getUser: async (token?: string) => (token && USUARIOS[token] ? { data: { user: { id: USUARIOS[token], email: "x@x" } }, error: null } : { data: { user: null }, error: { message: "invalid" } }),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "is_super_admin") return { data: [...estado.superAdmins].some((t) => USUARIOS[t] === args._user_id), error: null };
      if (fn === "ia_registrar_uso") { estado.usos.push(args); return { error: null }; }
      return { data: null, error: null };
    },
    from: (t: string) => builder(t),
  });
  return { estado, cliente };
});

vi.mock("../../_shared/audit-client.ts", () => ({
  clienteConAuditoria: (f: unknown) => f,
  conAuditoriaDePeticion: (_n: string, _f: unknown, handler: unknown) => handler,
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: () => h.cliente() }));
vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: () => h.cliente() }));

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://ejemplo.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secreta",
  RESENAS_CRON_SECRET: "secreto-cron",
  OPENAI_API_KEY: "sk-prueba",
};

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (n: string) => ENV[n] }, serve: (fn: (r: Request) => Promise<Response>) => { h.estado.handler = fn; } });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    h.estado.fetchs.push(String(url));
    if (String(url).includes("api.openai.com")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "Gracias, Ana. El equipo de Casa Tomás" } }], usage: { prompt_tokens: 300, completion_tokens: 40 } }));
    }
    if (String(url).includes("sync-google-reviews")) return new Response(JSON.stringify({ reviews_found: 0 }));
    return new Response("{}");
  }));
  await import("../index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { h.estado.fetchs = []; h.estado.usos = []; h.estado.updates = []; });

const llamar = (body: unknown, headers: Record<string, string> = {}) =>
  h.estado.handler!(new Request("https://ejemplo.supabase.co/functions/v1/resenas-contestador", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));

describe("resenas-contestador · acceso", () => {
  it.each([undefined, "anon", "jwt-falso"])("sin sesión válida (%s) → 401, sin llamar a nadie", async (token) => {
    const res = await llamar({ accion: "proponer", id: "11111111-1111-4111-8111-111111111111" }, token ? { Authorization: `Bearer ${token}` } : {});
    expect(res.status).toBe(401);
    expect(h.estado.fetchs).toEqual([]);
  });
  it("un usuario que no es super admin → 403", async () => {
    expect((await llamar({ accion: "estado" }, { Authorization: "Bearer jwt-staff" })).status).toBe(403);
  });
  it("cron con secreto equivocado → 401; con el bueno solo deja «ciclo»", async () => {
    expect((await llamar({ accion: "ciclo" }, { "x-webhook-secret": "otro" })).status).toBe(401);
    expect((await llamar({ accion: "aprobar" }, { "x-webhook-secret": "secreto-cron" })).status).toBe(400);
    const res = await llamar({ accion: "ciclo" }, { "x-webhook-secret": "secreto-cron" });
    expect(res.status).toBe(200);
    expect(h.estado.fetchs).toContain("https://ejemplo.supabase.co/functions/v1/sync-google-reviews");
  });
  it("GET sin state → 405; con state falso → página de error, sin guardar nada", async () => {
    const r1 = await h.estado.handler!(new Request("https://ejemplo.supabase.co/functions/v1/resenas-contestador"));
    expect(r1.status).toBe(405);
    const r2 = await h.estado.handler!(new Request("https://ejemplo.supabase.co/functions/v1/resenas-contestador?code=x&state=falso.firma"));
    expect(r2.status).toBe(400);
    expect(h.estado.updates).toEqual([]);
  });
});

describe("resenas-contestador · super admin", () => {
  const SA = { Authorization: "Bearer jwt-super" };
  it("estado dice qué falta (sin credenciales de Google) y la URI de vuelta", async () => {
    const j = await (await llamar({ accion: "estado" }, SA)).json();
    expect(j).toMatchObject({ ok: true, ia: true, google: { configurada: false, redirect_uri: "https://ejemplo.supabase.co/functions/v1/resenas-contestador" } });
  });
  it("proponer llama a OpenAI en el servidor y registra el gasto en Gasto IA", async () => {
    const res = await llamar({ accion: "proponer", id: "11111111-1111-4111-8111-111111111111" }, SA);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, propuesta: "Gracias, Ana. El equipo de Casa Tomás", modelo: "gpt-4.1-mini" });
    expect(h.estado.usos).toEqual([expect.objectContaining({ p_funcion: "resenas-contestador", p_modelo: "gpt-4.1-mini", p_prompt_tokens: 300, p_completion_tokens: 40, p_estado: "ok" })]);
    expect(h.estado.updates.find((u) => u.tabla === "resenas")?.cambios).toMatchObject({ respuesta_estado: "propuesta", respuesta_origen: "ia" });
  });
  it("conectar Google sin credenciales → 503 con explicación", async () => {
    const res = await llamar({ accion: "google_conectar", volver: "https://admin-casatomas.vercel.app" }, SA);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("google_sin_configurar");
  });
  it("acción desconocida → 400", async () => {
    expect((await llamar({ accion: "borrarlo-todo" }, SA)).status).toBe(400);
  });
});
