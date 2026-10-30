import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  superadmin: false,
  errorPermisos: false,
  objetivoSuperadmin: false,
  mutaciones: [] as string[],
  actorId: "11111111-1111-4111-8111-111111111111",
  objetivoId: "22222222-2222-4222-8222-222222222222",
  objetivoNoExiste: false,
  errorPassword: null as { code: string; status: number } | null,
  cambioPassword: null as unknown,
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
      getUser: async () => ({ data: { user: options?.global?.headers?.Authorization === "Bearer valido" ? { id: h.actorId, email: "admin@example.test" } : null }, error: null }),
      admin: {
        deleteUser: async () => { h.mutaciones.push("eliminar"); return { error: null }; },
        getUserById: async () => ({ data: { user: h.objetivoNoExiste ? null : { id: h.objetivoId, email: "objetivo@example.test" } }, error: h.objetivoNoExiste ? { code: "user_not_found", status: 404 } : null }),
        updateUserById: async (_id: string, cambio: unknown) => { h.cambioPassword = cambio; h.mutaciones.push("contraseña"); return { error: h.errorPassword }; },
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
beforeEach(() => { h.superadmin = false; h.errorPermisos = false; h.objetivoSuperadmin = false; h.mutaciones = []; h.objetivoNoExiste = false; h.errorPassword = null; h.cambioPassword = null; });

async function llamar(accion: string, token = "valido", userId = h.objetivoId) {
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
  // CT-REM-FN-12 (30-oct-2026): admin-delete-user responde 503 (no se pudo
  // verificar) en vez de 403. T6-CIERRE: admin-update-user-password también
  // pasa de 403 a 503, para que el fallo de la RPC de rol sea uniforme.
  it("deniega si no se puede verificar el permiso", async () => {
    h.superadmin = true; h.errorPermisos = true;
    expect((await llamar(accion)).status).toBe(503);
    expect(h.mutaciones).toEqual([]);
  });
  it("rechaza una sesión inválida y actuar sobre uno mismo", async () => {
    h.superadmin = true;
    expect((await llamar(accion, "invalido")).status).toBe(401);
    expect((await llamar(accion, "valido", h.actorId)).status).toBe(400);
    expect(h.mutaciones).toEqual([]);
  });
});
it("hay que retirar el acceso de superadmin antes de eliminarlo", async () => {
  h.superadmin = true; h.objetivoSuperadmin = true;
  expect((await llamar("eliminar")).status).toBe(400);
  expect(h.mutaciones).toEqual([]);
});

describe("Cambio de contraseña · validación y errores", () => {
  const pedir = (body: unknown, method = "POST") => handlers.contraseña(new Request("https://example.test/password", {
    method, headers: { Authorization: "Bearer valido", "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  }));
  it.each([null, [], { userId: h.objetivoId, password: 123456 }, { userId: "incorrecto", password: "prueba-segura" }, { userId: h.objetivoId, password: "abc" }, { userId: h.objetivoId, password: "123456789" }])("rechaza datos inválidos sin llamar a Auth: %j", async body => {
    h.superadmin = true;
    expect((await pedir(body)).status).toBe(400);
    expect(h.mutaciones).toEqual([]);
  });
  it("contraseña de 9 caracteres → 400 con mensaje legible; con 10 sí se cambia (CT-REM-FN-03)", async () => {
    h.superadmin = true;
    const corta = await pedir({ userId: h.objetivoId, password: "abcdefghi" });
    expect(corta.status).toBe(400);
    expect((await corta.json()).error).toBe("La contraseña debe tener al menos 10 caracteres");
    expect(h.mutaciones).toEqual([]);
    expect((await pedir({ userId: h.objetivoId, password: "abcdefghij" })).status).toBe(200);
    expect(h.cambioPassword).toEqual({ password: "abcdefghij" });
  });
  it("rechaza otros métodos y JSON roto", async () => {
    h.superadmin = true;
    expect((await pedir(null, "GET")).status).toBe(405);
    const respuesta = await handlers.contraseña(new Request("https://example.test/password", { method: "POST", headers: { Authorization: "Bearer valido" }, body: "{" }));
    expect(respuesta.status).toBe(400);
    expect(h.mutaciones).toEqual([]);
  });
  it("el superadmin cambia la contraseña de un staff sin tocar el bloqueo", async () => {
    h.superadmin = true;
    expect((await llamar("contraseña")).status).toBe(200);
    expect(h.cambioPassword).toEqual({ password: "prueba-segura" });
  });
  // CT-REM-FN-05 (30-oct-2026): antes este caso daba 200 y permitía tomar la
  // cuenta de otro super admin (incluido el dueño). Ahora se rechaza siempre.
  it("un superadmin NO puede cambiar la contraseña de otro superadmin", async () => {
    h.superadmin = true; h.objetivoSuperadmin = true;
    expect((await llamar("contraseña")).status).toBe(403);
    expect(h.mutaciones).toEqual([]);
    expect(h.cambioPassword).toBeNull();
  });
  it("detecta una cuenta eliminada antes de intentar actualizarla", async () => {
    h.superadmin = true; h.objetivoNoExiste = true;
    expect((await llamar("contraseña")).status).toBe(404);
    expect(h.mutaciones).toEqual([]);
  });
  it.each(["same_password", "weak_password"])("explica %s sin convertirlo en un error interno", async code => {
    h.superadmin = true; h.errorPassword = { code, status: 422 };
    const res = await llamar("contraseña");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/contraseña/);
  });
});
