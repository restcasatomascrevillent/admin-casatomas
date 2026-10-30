// CT-REM-FN-05 / CT-REM-FN-12 · con SUPER_ADMIN_EMAILS configurado:
//   · un email del allowlist SIN fila en super_admins no actúa como super admin
//     (ni cuando is_super_admin devuelve false ni cuando falla);
//   · la contraseña de una cuenta del allowlist no se cambia desde el panel.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  handlers: {} as Record<string, (req: Request) => Promise<Response>>,
  actorEmail: "dueno@casatomas.test",
  superadmin: false,
  errorRpc: false,
  objetivoEmail: "staff@staff.local",
  mutaciones: [] as string[],
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
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: h.actorId, email: h.actorEmail } }, error: null }),
      admin: {
        getUserById: async () => ({ data: { user: { id: h.objetivoId, email: h.objetivoEmail, banned_until: null } }, error: null }),
        updateUserById: async () => { h.mutaciones.push("contraseña"); return { error: null }; },
      },
    },
    rpc: async (fn: string) => {
      if (fn === "is_super_admin") return h.errorRpc ? { data: null, error: { message: "db offline" } } : { data: h.superadmin, error: null };
      h.mutaciones.push(fn);
      return { data: null, error: null };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  }),
}));

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://e.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
  SUPER_ADMIN_EMAILS: "Dueno@CasaTomas.test, otro@casatomas.test",
};
beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (k: string) => ENV[k] }, serve: (fn: typeof h.handler) => { h.handler = fn; } });
  await import("../admin-update-user-password/index.ts");
  h.handlers.contraseña = h.handler!;
  await import("../admin-set-super-admin/index.ts");
  h.handlers.superadmin = h.handler!;
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  h.actorEmail = "dueno@casatomas.test"; h.superadmin = false; h.errorRpc = false;
  h.objetivoEmail = "staff@staff.local"; h.mutaciones = [];
});

const pedir = (accion: "contraseña" | "superadmin") => h.handlers[accion](new Request("https://e.test/x", {
  method: "POST", headers: { Authorization: "Bearer valido", "Content-Type": "application/json" },
  body: JSON.stringify(accion === "contraseña" ? { userId: h.objetivoId, password: "prueba-segura" } : { userId: h.objetivoId, makeSuperAdmin: true }),
}));

describe.each(["contraseña", "superadmin"] as const)("%s · el email del allowlist ya no sustituye a la BD", (accion) => {
  it("email del allowlist sin fila en super_admins → 403", async () => {
    expect((await pedir(accion)).status).toBe(403);
    expect(h.mutaciones).toEqual([]);
  });
  it("si is_super_admin falla, tampoco basta el email (fail-closed)", async () => {
    h.errorRpc = true;
    expect((await pedir(accion)).status).not.toBe(200);
    expect(h.mutaciones).toEqual([]);
  });
  it("con fila en super_admins sí puede (staff como objetivo)", async () => {
    h.superadmin = true;
    expect((await pedir(accion)).status).toBe(200);
  });
});

it("la contraseña de una cuenta del allowlist no se cambia desde el panel (CT-REM-FN-05)", async () => {
  h.superadmin = true; h.actorEmail = "segundo@staff.local"; h.objetivoEmail = "OTRO@casatomas.test";
  expect((await pedir("contraseña")).status).toBe(403);
  expect(h.mutaciones).toEqual([]);
});
