import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  superadmin: true, bloqueado: false, falta: false, fallo: false,
  cambios: [] as unknown[],
  actor: "11111111-1111-4111-8111-111111111111", objetivo: "22222222-2222-4222-8222-222222222222",
}));
vi.mock("../_shared/audit-client.ts", () => ({ clienteConAuditoria: (f: unknown) => f, conAuditoriaDePeticion: (_n: string, _f: unknown, handler: unknown) => handler }));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: () => ({
  auth: {
    getUser: async () => ({ data: { user: { id: h.actor } }, error: null }),
    admin: { getUserById: async () => ({ data: { user: h.falta ? null : { id: h.objetivo, email: "usuario@staff.local", banned_until: h.bloqueado ? "2126-01-01" : null } }, error: null }) },
  },
  rpc: async (fn: string, args: unknown) => {
    if (fn === "is_super_admin") return { data: h.superadmin, error: null };
    h.cambios.push(args);
    return { data: null, error: h.fallo ? { code: "23514" } : null };
  },
}) }));
beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: () => "" }, serve: (fn: typeof h.handler) => { h.handler = fn; } });
  await import("../admin-set-super-admin/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { h.superadmin = true; h.bloqueado = false; h.falta = false; h.fallo = false; h.cambios = []; });
const pedir = (makeSuperAdmin: unknown, userId = h.objetivo) => h.handler!(new Request("https://example.test/admin-set-super-admin", { method: "POST", headers: { Authorization: "Bearer valido" }, body: JSON.stringify({ userId, makeSuperAdmin }) }));
it.each([true, false])("conceder/retirar (%s) usa una sola transacción", async activo => {
  expect((await pedir(activo)).status).toBe(200);
  expect(h.cambios).toEqual([{ p_user_id: h.objetivo, p_make_super_admin: activo, p_email: "usuario@staff.local" }]);
});
it("rechaza datos inválidos y la retirada propia sin escribir", async () => {
  expect((await pedir("true")).status).toBe(400);
  expect((await pedir(true, "incorrecto")).status).toBe(400);
  expect((await pedir(false, h.actor)).status).toBe(400);
  expect(h.cambios).toEqual([]);
});
it("no permite conceder superadmin a una cuenta bloqueada o inexistente", async () => {
  h.bloqueado = true;
  expect((await pedir(true)).status).toBe(400);
  h.bloqueado = false; h.falta = true;
  expect((await pedir(true)).status).toBe(404);
  expect(h.cambios).toEqual([]);
});
it("un admin normal no puede conceder superadmin", async () => {
  h.superadmin = false;
  expect((await pedir(true)).status).toBe(403);
  expect(h.cambios).toEqual([]);
});
it("un fallo de la transacción se muestra como error y nunca como éxito", async () => {
  h.fallo = true;
  const respuesta = await pedir(true);
  expect(respuesta.status).toBe(500);
  expect((await respuesta.json()).error).toMatch(/No se ha aplicado ningún cambio/);
});
