import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  superadmin: false,
  errorPermisos: false,
  objetivoSuperadmin: false,
  mutaciones: [] as string[],
}));
vi.mock("../_shared/audit-client.ts", () => ({
  clienteConAuditoria: (factory: unknown) => factory,
  conAuditoriaDePeticion: (_name: string, _factory: unknown, handler: unknown) => handler,
}));
vi.mock("../_shared/audit-auth.ts", () => ({
  ejecutarOperacionAuthAuditada: (_client: unknown, _actor: string, _operation: string, _subject: unknown, run: () => unknown) => run(),
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: (_url: string, _key: string, options?: { global?: { headers?: Record<string, string> } }) => ({
    auth: {
      getUser: async () => ({ data: { user: options?.global?.headers?.Authorization === "Bearer valido" ? { id: "actor", email: "admin@example.test" } : null }, error: null }),
      admin: {
        deleteUser: async () => { h.mutaciones.push("eliminar"); return { error: null }; },
        updateUserById: async () => { h.mutaciones.push("contraseña"); return { error: null }; },
      },
    },
    rpc: async (name: string) => ({ data: name === "is_super_admin" ? h.superadmin : true, error: h.errorPermisos ? { message: "sin conexión" } : null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.objetivoSuperadmin ? { id: "super-objetivo" } : null, error: null }) }) }) }),
  }),
}));

const handlers: Record<string, (req: Request) => Promise<Response>> = {};
const env: Record<string, string> = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", SUPER_ADMIN_EMAILS: "" };
beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (key: string) => env[key] }, serve: (fn: typeof h.handler) => { h.handler = fn; } });
  await import("../admin-delete-user/index.ts");
  handlers.eliminar = h.handler!;
  await import("../admin-update-user-password/index.ts");
  handlers.contraseña = h.handler!;
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { h.superadmin = false; h.errorPermisos = false; h.objetivoSuperadmin = false; h.mutaciones = []; });

async function llamar(accion: string, token = "valido", userId = "objetivo") {
  return handlers[accion](new Request("https://example.supabase.co/functions/v1/prueba", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ userId, password: "prueba-segura" }),
  }));
}
describe.each(["eliminar", "contraseña"])("%s: solo desde superadmin", (accion) => {
  it("un admin normal recibe 403 sin modificar usuarios", async () => {
    expect((await llamar(accion)).status).toBe(403);
    expect(h.mutaciones).toEqual([]);
  });
  it("un superadmin puede gestionar otro usuario", async () => {
    h.superadmin = true;
    expect((await llamar(accion)).status).toBe(200);
    expect(h.mutaciones).toEqual([accion]);
  });
  it("deniega si no se puede verificar el permiso", async () => {
    h.superadmin = true; h.errorPermisos = true;
    expect((await llamar(accion)).status).toBe(403);
    expect(h.mutaciones).toEqual([]);
  });
  it("rechaza una sesión inválida y actuar sobre uno mismo", async () => {
    h.superadmin = true;
    expect((await llamar(accion, "invalido")).status).toBe(401);
    expect((await llamar(accion, "valido", "actor")).status).toBe(400);
    expect(h.mutaciones).toEqual([]);
  });
});
it("hay que retirar el acceso de superadmin antes de eliminarlo", async () => {
  h.superadmin = true; h.objetivoSuperadmin = true;
  expect((await llamar("eliminar")).status).toBe(400);
  expect(h.mutaciones).toEqual([]);
});
