// CT-REM-FN-12 · admin-create-user, admin-delete-user y list-users con
// SUPER_ADMIN_EMAILS configurado:
//   · un email del allowlist SIN fila en super_admins (ni rol admin) → 403;
//   · si la RPC de rol falla → 503 y no se toca Auth;
//   · un super admin real (fila en super_admins) obtiene lo mismo que antes.
// CT-REM-FN-03 · contraseña de 9 caracteres al crear → 400 con mensaje legible.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  handlers: {} as Record<string, (req: Request) => Promise<Response>>,
  actorEmail: "dueno@casatomas.test",
  superadmin: false,
  admin: false,
  rpcCaida: "" as "" | "has_section_permission" | "is_super_admin",
  llamadasAuth: [] as string[],
  actorId: "11111111-1111-4111-8111-111111111111",
  objetivoId: "22222222-2222-4222-8222-222222222222",
}));
vi.mock("../_shared/audit-client.ts", () => ({
  clienteConAuditoria: (f: unknown) => f,
  conAuditoriaDePeticion: (_n: string, _f: unknown, handler: unknown) => handler,
}));
vi.mock("../_shared/audit-auth.ts", () => ({
  ejecutarOperacionAuthAuditada: (_c: unknown, _a: string, _o: string, _s: unknown, run: () => unknown) => run(),
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => {
  const consulta = () => {
    const q: Record<string, unknown> = {};
    q.select = () => q; q.eq = () => q; q.delete = () => q;
    q.upsert = async () => ({ error: null }); q.insert = async () => ({ error: null });
    q.maybeSingle = async () => ({ data: null, error: null });
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok);
    return q;
  };
  return {
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: h.actorId, email: h.actorEmail } }, error: null }),
        admin: {
          createUser: async () => { h.llamadasAuth.push("createUser"); return { data: { user: { id: "nuevo", email: "nuevo@staff.local" } }, error: null }; },
          deleteUser: async () => { h.llamadasAuth.push("deleteUser"); return { error: null }; },
          getUserById: async () => { h.llamadasAuth.push("getUserById"); return { data: { user: { id: h.objetivoId, email: "staff@staff.local" } }, error: null }; },
          listUsers: async () => { h.llamadasAuth.push("listUsers"); return { data: { users: [{ id: "u1", email: "a@staff.local", created_at: "2026-01-01", user_metadata: {} }] }, error: null }; },
        },
      },
      rpc: async (fn: string) => {
        if (fn === h.rpcCaida) return { data: null, error: { message: "db offline" } };
        if (fn === "is_super_admin") return { data: h.superadmin, error: null };
        // «Ver» en la sección usuarios (06/11/2026; antes, el rol admin con is_admin).
        if (fn === "has_section_permission") return { data: h.admin, error: null };
        return { data: null, error: { message: `rpc inesperada ${fn}` } };
      },
      from: () => consulta(),
    }),
  };
});

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://e.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
  SUPER_ADMIN_EMAILS: "Dueno@CasaTomas.test, otro@casatomas.test",
};
type Accion = "crear" | "eliminar" | "listar";
beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (k: string) => ENV[k] }, serve: (fn: typeof h.handler) => { h.handler = fn; } });
  await import("../admin-create-user/index.ts");
  h.handlers.crear = h.handler!;
  await import("../admin-delete-user/index.ts");
  h.handlers.eliminar = h.handler!;
  await import("../list-users/index.ts");
  h.handlers.listar = h.handler!;
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  h.actorEmail = "dueno@casatomas.test"; h.superadmin = false; h.admin = false; h.rpcCaida = ""; h.llamadasAuth = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const CUERPOS: Record<Accion, unknown> = {
  crear: { username: "camarero9", password: "prueba-segura", role: "staff", permissions: [] },
  eliminar: { userId: "22222222-2222-4222-8222-222222222222" },
  listar: {},
};
const pedir = (accion: Accion, cuerpo: unknown = CUERPOS[accion]) => h.handlers[accion](new Request("https://e.test/x", {
  method: "POST", headers: { Authorization: "Bearer valido", "Content-Type": "application/json" },
  body: JSON.stringify(cuerpo),
}));

describe.each(["crear", "eliminar", "listar"] as const)("%s · el email del allowlist ya no sustituye a la BD", (accion) => {
  it("email del allowlist sin fila en super_admins ni rol → 403 sin tocar Auth", async () => {
    const r = await pedir(accion);
    expect(r.status).toBe(403);
    expect(h.llamadasAuth).toEqual([]);
  });
  it.each(["is_super_admin", "has_section_permission"] as const)("si %s falla → 503 sin tocar Auth (fail-closed)", async (rpc) => {
    // crear y eliminar solo consultan is_super_admin; list-users consulta las dos.
    if (accion !== "listar" && rpc === "has_section_permission") return;
    h.rpcCaida = rpc;
    const r = await pedir(accion);
    expect(r.status).toBe(503);
    expect(typeof (await r.json()).error).toBe("string");
    expect(h.llamadasAuth).toEqual([]);
  });
  it("super admin real (fila en super_admins) → 200 como antes", async () => {
    h.superadmin = true; h.actorEmail = "segundo@staff.local";
    const r = await pedir(accion);
    expect(r.status).toBe(200);
    expect(h.llamadasAuth.length).toBeGreaterThan(0);
  });
});

describe("list-users · «Ver» en la sección Usuarios (06/11/2026)", () => {
  it("con «Ver» en Usuarios y sin super_admins → 200 (sin depender del email)", async () => {
    h.admin = true; h.actorEmail = "encargado@staff.local";
    expect((await pedir("listar")).status).toBe(200);
  });
  it("si has_section_permission falla no se pasa a is_super_admin: 503 aunque sea super admin", async () => {
    h.superadmin = true; h.rpcCaida = "has_section_permission";
    expect((await pedir("listar")).status).toBe(503);
  });
});

describe("admin-create-user · contraseña mínima (CT-REM-FN-03)", () => {
  it("9 caracteres → 400 con mensaje legible y sin crear", async () => {
    h.superadmin = true;
    const r = await pedir("crear", { username: "camarero9", password: "abcdefghi", role: "staff", permissions: [] });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("La contraseña debe tener al menos 10 caracteres");
    expect(h.llamadasAuth).toEqual([]);
  });
  it("10 caracteres → se crea", async () => {
    h.superadmin = true;
    const r = await pedir("crear", { username: "camarero9", password: "abcdefghij", role: "staff", permissions: [] });
    expect(r.status).toBe(200);
    expect(h.llamadasAuth).toEqual(["createUser"]);
  });
});
