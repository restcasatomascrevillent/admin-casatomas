// CT-REM-FN-03 · panel-auth manda a iniciar_intento_panel (cabecera x-audit-ip)
// la IP de la plataforma, no el primer salto de X-Forwarded-For del cliente:
// rotar XFF ya no reparte los intentos entre "IPs" distintas.
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  ips: [] as string[],
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2.117.2", () => ({
  createClient: (_u: string, _k: string, opciones?: { global?: { headers?: Record<string, string> } }) => {
    const ip = opciones?.global?.headers?.["x-audit-ip"];
    if (ip !== undefined) h.ips.push(ip);
    return {};
  },
}));
vi.mock("../panel-auth/handler.ts", () => ({
  handlePanelLogin: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
}));
beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: () => "x" }, serve: (fn: typeof h.handler) => { h.handler = fn; } });
  await import("../panel-auth/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { h.ips = []; });

const login = (headers: Record<string, string>) => h.handler!(new Request("https://e.test/panel-auth", {
  method: "POST", headers, body: JSON.stringify({ email: "a@b.c", password: "x" }),
}));

it("31 peticiones con XFF distinto y la misma cf-connecting-ip cuentan como UNA IP", async () => {
  for (let i = 0; i < 31; i++) await login({ "x-forwarded-for": `10.1.${i}.1`, "cf-connecting-ip": "203.0.113.9" });
  expect(new Set(h.ips)).toEqual(new Set(["203.0.113.9"]));
  expect(h.ips).toHaveLength(31);
});
it("sin cf-connecting-ip se usa el último salto de XFF", async () => {
  await login({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" });
  expect(h.ips).toEqual(["198.51.100.4"]);
});
