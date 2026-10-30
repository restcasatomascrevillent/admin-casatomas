// Autorización común (CT-REM-FN-01/02): exigirUsuario / exigirPermiso / exigirAdmin.
// Sin red: la fábrica de clientes y el entorno se simulan.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { esServiceRole, exigirAdmin, exigirPermiso, exigirUsuario, tokenBearer } from "../autorizacion";

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://ejemplo.supabase.co",
  SUPABASE_ANON_KEY: "anon-jwt-publico",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secreta",
};
const USUARIO = { id: "11111111-1111-4111-8111-111111111111", email: "staff@staff.local" };

type Permisos = Record<string, { view?: boolean; edit?: boolean }>;
let estado: { permisos: Permisos; admin: boolean; superadmin: boolean; errorRpc: boolean; authCaida: boolean; llamadas: Array<{ fn: string; args: Record<string, unknown>; key: string }> };

const crearCliente = vi.fn((_url: string, key: string) => ({
  auth: {
    getUser: async (token: string) => {
      if (estado.authCaida) throw new Error("GoTrue offline");
      return token === "jwt-usuario" ? { data: { user: USUARIO }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } };
    },
  },
  rpc: async (fn: string, args: Record<string, unknown>) => {
    estado.llamadas.push({ fn, args, key });
    if (estado.errorRpc) return { data: null, error: { message: "db offline" } };
    if (fn === "has_section_permission") {
      const p = estado.permisos[args._section as string] ?? {};
      return { data: args._permission === "edit" ? !!p.edit : !!(p.view || p.edit), error: null };
    }
    if (fn === "is_admin") return { data: estado.admin, error: null };
    if (fn === "is_super_admin") return { data: estado.superadmin, error: null };
    return { data: null, error: { message: "desconocida" } };
  },
}));
const deps = { crearCliente, env: (n: string) => ENV[n] };
const peticion = (token?: string) => new Request("https://ejemplo.test/fn", {
  method: "POST", headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
});

beforeEach(() => {
  estado = { permisos: {}, admin: false, superadmin: false, errorRpc: false, authCaida: false, llamadas: [] };
  crearCliente.mockClear();
});

describe("exigirUsuario", () => {
  it.each([
    ["sin cabecera", undefined],
    ["anon key heredada", ENV.SUPABASE_ANON_KEY],
    ["publishable key", "sb_publishable_abc123"],
    ["secret key nueva", "sb_secret_abc123"],
    ["service role", ENV.SUPABASE_SERVICE_ROLE_KEY],
    ["JWT inválido", "jwt-falso"],
  ])("%s → 401 JSON", async (_n, token) => {
    const r = await exigirUsuario(peticion(token), deps);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(401);
    expect(r.response.status).toBe(401);
    expect(r.response.headers.get("Content-Type")).toBe("application/json");
    expect(await r.response.json()).toMatchObject({ success: false, error: expect.any(String) });
  });
  it("Auth caída → 503 (nunca se degrada a permitido)", async () => {
    estado.authCaida = true;
    const r = await exigirUsuario(peticion("jwt-usuario"), deps);
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
  it("usuario real → id y email del JWT", async () => {
    expect(await exigirUsuario(peticion("jwt-usuario"), deps)).toEqual({ ok: true, userId: USUARIO.id, email: USUARIO.email });
  });
});

describe("exigirPermiso", () => {
  it("usuario sin la sección → 403", async () => {
    const r = await exigirPermiso(peticion("jwt-usuario"), "gestor_carta", "view", deps);
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
  it("view basta para view; view NO basta para edit", async () => {
    estado.permisos = { facturas: { view: true } };
    expect((await exigirPermiso(peticion("jwt-usuario"), "facturas", "view", deps)).ok).toBe(true);
    expect(await exigirPermiso(peticion("jwt-usuario"), "facturas", "edit", deps)).toMatchObject({ ok: false, status: 403 });
  });
  it("edit pasa en edit y en view", async () => {
    estado.permisos = { facturas: { view: true, edit: true } };
    expect((await exigirPermiso(peticion("jwt-usuario"), "facturas", "edit", deps)).ok).toBe(true);
    expect((await exigirPermiso(peticion("jwt-usuario"), "facturas", "view", deps)).ok).toBe(true);
  });
  it("con varias secciones basta una", async () => {
    estado.permisos = { gestion_web: { view: true } };
    expect((await exigirPermiso(peticion("jwt-usuario"), ["gestor_carta", "gestion_web"], "view", deps)).ok).toBe(true);
  });
  it("la RPC va con service role y con el id VERIFICADO, nunca con la anon", async () => {
    estado.permisos = { dashboard: { view: true } };
    await exigirPermiso(peticion("jwt-usuario"), "dashboard", "view", deps);
    expect(estado.llamadas).toEqual([{
      fn: "has_section_permission",
      args: { _user_id: USUARIO.id, _section: "dashboard", _permission: "view" },
      key: ENV.SUPABASE_SERVICE_ROLE_KEY,
    }]);
  });
  it("error de la RPC → 503 fail-closed", async () => {
    estado.errorRpc = true;
    expect(await exigirPermiso(peticion("jwt-usuario"), "dashboard", "view", deps)).toMatchObject({ ok: false, status: 503 });
  });
  it("anon / publishable / service role → 401 sin llamar a la RPC", async () => {
    for (const t of [ENV.SUPABASE_ANON_KEY, "sb_publishable_x", ENV.SUPABASE_SERVICE_ROLE_KEY, undefined]) {
      expect(await exigirPermiso(peticion(t), "dashboard", "view", deps)).toMatchObject({ ok: false, status: 401 });
    }
    expect(estado.llamadas).toEqual([]);
  });
  it("llamador mal configurado (sin sección o modo raro) → 403", async () => {
    estado.permisos = { dashboard: { view: true, edit: true } };
    expect(await exigirPermiso(peticion("jwt-usuario"), [], "view", deps)).toMatchObject({ ok: false, status: 403 });
    // @ts-expect-error modo inválido a propósito
    expect(await exigirPermiso(peticion("jwt-usuario"), "dashboard", "admin", deps)).toMatchObject({ ok: false, status: 403 });
  });
  it("respeta las cabeceras CORS de la función", async () => {
    const r = await exigirPermiso(peticion(), "dashboard", "view", { ...deps, corsHeaders: { "Access-Control-Allow-Origin": "https://panel.test" } });
    expect(r.ok ? null : r.response.headers.get("Access-Control-Allow-Origin")).toBe("https://panel.test");
  });
});

describe("exigirAdmin", () => {
  it("staff → 403; admin → ok; super admin → ok; error → 503", async () => {
    expect(await exigirAdmin(peticion("jwt-usuario"), deps)).toMatchObject({ ok: false, status: 403 });
    estado.admin = true;
    expect((await exigirAdmin(peticion("jwt-usuario"), deps)).ok).toBe(true);
    estado.admin = false; estado.superadmin = true;
    expect((await exigirAdmin(peticion("jwt-usuario"), deps)).ok).toBe(true);
    estado.errorRpc = true;
    expect(await exigirAdmin(peticion("jwt-usuario"), deps)).toMatchObject({ ok: false, status: 503 });
    expect(await exigirAdmin(peticion(ENV.SUPABASE_ANON_KEY), deps)).toMatchObject({ ok: false, status: 401 });
  });
});

describe("utilidades", () => {
  it("tokenBearer y esServiceRole", () => {
    expect(tokenBearer(peticion("abc"))).toBe("abc");
    expect(tokenBearer(peticion())).toBe("");
    expect(esServiceRole(peticion(ENV.SUPABASE_SERVICE_ROLE_KEY), deps.env)).toBe(true);
    expect(esServiceRole(peticion("otra"), deps.env)).toBe(false);
    expect(esServiceRole(peticion(""), () => "")).toBe(false);
  });
});
