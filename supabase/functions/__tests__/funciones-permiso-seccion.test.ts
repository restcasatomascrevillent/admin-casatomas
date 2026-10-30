// CT-REM-FN-02 · Funciones que solo exigían "estar logueado".
//   leer-metricas        → admin / super admin, limite ≤ 500
//   registrar-metrica    → cualquier usuario, pero usuario_id/email SALEN DEL JWT
//   vapi-analytics       → sección dashboard (view), solo presets
//   sync-google-reviews  → gestion_web (edit) o service role
//   buscar-precios-mercado → facturas (view), query ≤ 200, uso registrado
// Sin red: Supabase, VAPI, Google y Perplexity simulados.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const USUARIOS: Record<string, { id: string; email: string; admin?: boolean; permisos: Record<string, "view" | "edit"> }> = {
    "jwt-staff": { id: "11111111-1111-4111-8111-111111111111", email: "staff@staff.local", permisos: {} },
    "jwt-admin": { id: "22222222-2222-4222-8222-222222222222", email: "admin@staff.local", admin: true, permisos: {} },
    "jwt-dash": { id: "33333333-3333-4333-8333-333333333333", email: "dash@staff.local", permisos: { dashboard: "view" } },
    "jwt-webver": { id: "44444444-4444-4444-8444-444444444444", email: "webver@staff.local", permisos: { gestion_web: "view" } },
    "jwt-webedit": { id: "55555555-5555-4555-8555-555555555555", email: "webedit@staff.local", permisos: { gestion_web: "edit" } },
    "jwt-fact": { id: "66666666-6666-4666-8666-666666666666", email: "fact@staff.local", permisos: { facturas: "view" } },
  };
  const estado = {
    handlers: {} as Record<string, (req: Request) => Promise<Response>>,
    ultimo: null as ((req: Request) => Promise<Response>) | null,
    inserts: [] as unknown[],
    limites: [] as number[],
    fetchs: [] as Array<{ url: string; body: unknown }>,
    rpcs: [] as string[],
  };
  const builder = (tabla: string) => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    for (const m of ["select", "order", "eq", "gte", "lte"]) b[m] = self;
    b.limit = (n: number) => { estado.limites.push(n); return b; };
    b.single = async () => ({ data: tabla === "config_google_places" ? { id: 1, place_id: "PLACE" } : null, error: null });
    b.update = () => ({ eq: async () => ({ error: null }) });
    b.insert = async (fila: unknown) => { estado.inserts.push(fila); return { error: null }; };
    b.then = (ok: (v: unknown) => unknown) => ok({ data: [{ id: 1 }], error: null });
    return b;
  };
  const cliente = () => ({
    auth: {
      getUser: async (token?: string) => {
        const u = token ? USUARIOS[token] : undefined;
        return u ? { data: { user: { id: u.id, email: u.email } }, error: null } : { data: { user: null }, error: { message: "invalid" } };
      },
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      estado.rpcs.push(fn);
      const u = Object.values(USUARIOS).find((x) => x.id === args._user_id);
      if (fn === "has_section_permission") {
        const p = u?.permisos[args._section as string];
        return { data: args._permission === "edit" ? p === "edit" : !!p, error: null };
      }
      if (fn === "is_admin") return { data: !!u?.admin, error: null };
      if (fn === "is_super_admin") return { data: false, error: null };
      return { data: null, error: null };
    },
    from: (t: string) => builder(t),
  });
  return { USUARIOS, estado, cliente };
});

vi.mock("../_shared/audit-client.ts", () => ({
  clienteConAuditoria: (f: unknown) => f,
  conAuditoriaDePeticion: (_n: string, _f: unknown, handler: unknown) => handler,
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: () => h.cliente() }));
vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: () => h.cliente() }));
vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({ serve: (fn: (r: Request) => Promise<Response>) => { h.estado.ultimo = fn; } }));

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://ejemplo.supabase.co",
  SUPABASE_ANON_KEY: "anon-jwt-publico",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secreta",
  METRICS_SUPABASE_SERVICE_ROLE_KEY: "metricas",
  VAPI_API_KEY: "vapi",
  GOOGLE_PLACES_API_KEY: "google",
  PERPLEXITY_API_KEY: "pplx",
};

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (n: string) => ENV[n] }, serve: (fn: (r: Request) => Promise<Response>) => { h.estado.ultimo = fn; } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    h.estado.fetchs.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).includes("places.googleapis.com")) return new Response(JSON.stringify({ reviews: [], rating: 4.5, userRatingCount: 10 }));
    if (String(url).includes("perplexity")) return new Response(JSON.stringify({ choices: [{ message: { content: "1 €/kg" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
    return new Response(JSON.stringify([{ name: "calls_over_time", result: [] }]));
  }));
  for (const fn of ["leer-metricas", "registrar-metrica", "vapi-analytics", "sync-google-reviews", "buscar-precios-mercado"]) {
    await import(`../${fn}/index.ts`);
    h.estado.handlers[fn] = h.estado.ultimo!;
  }
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { h.estado.inserts = []; h.estado.limites = []; h.estado.fetchs = []; h.estado.rpcs = []; });

function llamar(fn: string, token: string | undefined, body: unknown = {}, query = "") {
  return h.estado.handlers[fn](new Request(`https://ejemplo.supabase.co/functions/v1/${fn}${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));
}

const CUERPOS: Record<string, unknown> = {
  "leer-metricas": {},
  "vapi-analytics": { presetName: "calls_over_time", dateFrom: "2026-10-01", dateTo: "2026-10-30" },
  "sync-google-reviews": {},
  "buscar-precios-mercado": { query: "merluza" },
};

describe.each(Object.keys(CUERPOS))("%s · negativas", (fn) => {
  it.each([undefined, ENV.SUPABASE_ANON_KEY, "sb_publishable_x", "jwt-falso"])("token %s → 401 sin efectos", async (token) => {
    expect((await llamar(fn, token, CUERPOS[fn])).status).toBe(401);
    expect(h.estado.fetchs).toEqual([]);
  });
  it("usuario autenticado sin la sección → 403 sin efectos", async () => {
    const res = await llamar(fn, "jwt-staff", CUERPOS[fn]);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false });
    expect(h.estado.fetchs).toEqual([]);
    expect(h.estado.limites).toEqual([]);
  });
});

describe("leer-metricas", () => {
  it("admin lee y el límite se recorta a 500", async () => {
    const res = await llamar("leer-metricas", "jwt-admin", {}, "?limite=100000");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [{ id: 1 }], count: 1 });
    expect(h.estado.limites).toEqual([500]);
  });
  it("límite por defecto 100 y valores raros saneados", async () => {
    await llamar("leer-metricas", "jwt-admin");
    await llamar("leer-metricas", "jwt-admin", {}, "?limite=abc");
    await llamar("leer-metricas", "jwt-admin", {}, "?limite=-5");
    expect(h.estado.limites).toEqual([100, 100, 1]);
  });
  it("una sección cualquiera no basta (dashboard)", async () => {
    expect((await llamar("leer-metricas", "jwt-dash")).status).toBe(403);
  });
});

describe("registrar-metrica", () => {
  it("ignora usuario_id y usuario_email del body: usa los del JWT", async () => {
    const res = await llamar("registrar-metrica", "jwt-staff", {
      evento: "inicio_sesion", usuario_id: "99999999-9999-4999-8999-999999999999", usuario_email: "dueno@casatomas.es", metadata: { user_agent: "x" },
    });
    expect(res.status).toBe(200);
    expect(h.estado.inserts).toHaveLength(1);
    expect(h.estado.inserts[0]).toMatchObject({ tipo: "inicio_sesion", usuario_id: h.USUARIOS["jwt-staff"].id, entidad_id: "staff@staff.local", metadata: { user_agent: "x" } });
  });
  it("sin usuario → 401; evento desconocido → 400; sin insertar", async () => {
    expect((await llamar("registrar-metrica", ENV.SUPABASE_ANON_KEY, { evento: "inicio_sesion" })).status).toBe(401);
    expect((await llamar("registrar-metrica", "jwt-staff", { evento: "login_falso_de_otro" })).status).toBe(400);
    expect(h.estado.inserts).toEqual([]);
  });
  it("metadata enorme o no objeto se descarta", async () => {
    await llamar("registrar-metrica", "jwt-staff", { evento: "inicio_sesion", metadata: { x: "a".repeat(5000) } });
    await llamar("registrar-metrica", "jwt-staff", { evento: "inicio_sesion", metadata: ["a"] });
    expect(h.estado.inserts.map((f) => (f as { metadata: unknown }).metadata)).toEqual([{}, {}]);
  });
});

describe("vapi-analytics", () => {
  it("con dashboard:view → preset reenviado a VAPI y respuesta tal cual", async () => {
    const res = await llamar("vapi-analytics", "jwt-dash", CUERPOS["vapi-analytics"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ name: "calls_over_time", result: [] }]);
    expect(h.estado.fetchs).toHaveLength(1);
    expect((h.estado.fetchs[0].body as { queries: Array<{ name: string }> }).queries[0].name).toBe("calls_over_time");
  });
  it("las queries arbitrarias del cliente ya no se reenvían (400)", async () => {
    const res = await llamar("vapi-analytics", "jwt-dash", { queries: [{ table: "call", operations: [{ operation: "count", column: "id" }] }] });
    expect(res.status).toBe(400);
    expect(h.estado.fetchs).toEqual([]);
  });
  it("preset desconocido o fechas/asistente mal formados → 400", async () => {
    for (const body of [{ presetName: "otro" }, { presetName: "calls_over_time", dateFrom: "ayer" }, { presetName: "calls_over_time", assistantId: "x" }]) {
      expect((await llamar("vapi-analytics", "jwt-dash", body)).status).toBe(400);
    }
    expect(h.estado.fetchs).toEqual([]);
  });
});

describe("sync-google-reviews", () => {
  it("gestion_web solo con «Ver» no basta: hace falta edición", async () => {
    expect((await llamar("sync-google-reviews", "jwt-webver")).status).toBe(403);
    expect(h.estado.fetchs).toEqual([]);
  });
  it("gestion_web:edit sincroniza como hoy", async () => {
    const res = await llamar("sync-google-reviews", "jwt-webedit");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, reviews_found: 0, overall_rating: 4.5, total_count: 10 });
  });
  it("la service role (dueño por CLI) sigue pudiendo", async () => {
    expect((await llamar("sync-google-reviews", ENV.SUPABASE_SERVICE_ROLE_KEY)).status).toBe(200);
  });
});

describe("buscar-precios-mercado", () => {
  it("facturas:view busca y registra el uso", async () => {
    const res = await llamar("buscar-precios-mercado", "jwt-fact", { query: "merluza" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ content: "1 €/kg", query: "merluza" });
    expect(h.estado.rpcs).toContain("ia_registrar_uso");
  });
  it("consulta demasiado larga → 400 sin llamar a Perplexity", async () => {
    expect((await llamar("buscar-precios-mercado", "jwt-fact", { query: "a".repeat(201) })).status).toBe(400);
    expect(h.estado.fetchs).toEqual([]);
  });
});
