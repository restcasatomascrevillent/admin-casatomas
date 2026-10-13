import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  admin: true,
  falloPagina: 0,
  paginas: [] as number[],
  usuarios: [] as Array<{ id: string; email: string; created_at: string; banned_until?: string; user_metadata: { display_name: string } }>,
}));
vi.mock("../_shared/audit-client.ts", () => ({ clienteConAuditoria: (f: unknown) => f, conAuditoriaDePeticion: (_n: string, _f: unknown, handler: unknown) => handler }));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "actor" } }, error: null }),
      admin: { listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
        h.paginas.push(page);
        return { data: { users: h.usuarios.slice((page - 1) * perPage, page * perPage) }, error: page === h.falloPagina ? new Error("fallo Auth") : null };
      } },
    },
    rpc: async () => ({ data: h.admin, error: null }),
  }),
}));
beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: () => "" }, serve: (handler: typeof h.handler) => { h.handler = handler; } });
  await import("../list-users/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { h.admin = true; h.falloPagina = 0; h.paginas = []; h.usuarios = []; });
const pedir = () => h.handler!(new Request("https://example.test/list-users", { method: "POST", headers: { Authorization: "Bearer valido" } }));
it("recorre todas las páginas y devuelve nombres y bloqueo para cada usuario", async () => {
  h.usuarios = Array.from({ length: 1001 }, (_, i) => ({ id: String(i), email: `usuario${i}@staff.local`, created_at: "2026-01-01", user_metadata: { display_name: `Usuario ${i}` }, ...(i === 1000 ? { banned_until: "2126-01-01" } : {}) }));
  const respuesta = await pedir();
  expect(respuesta.status).toBe(200);
  const { users } = await respuesta.json();
  expect(users).toHaveLength(1001);
  expect(users[1000]).toMatchObject({ display_name: "Usuario 1000", access_blocked: true });
  expect(h.paginas).toEqual([1, 2]);
});
it("si falla una página no devuelve una lista incompleta como éxito", async () => {
  h.usuarios = Array.from({ length: 1001 }, (_, i) => ({ id: String(i), email: "usuario@staff.local", created_at: "2026-01-01", user_metadata: { display_name: "Usuario" } }));
  h.falloPagina = 2;
  expect((await pedir()).status).toBe(500);
});
it("no consulta Auth si el visitante no puede ver usuarios", async () => {
  h.admin = false;
  expect((await pedir()).status).toBe(403);
  expect(h.paginas).toEqual([]);
});
