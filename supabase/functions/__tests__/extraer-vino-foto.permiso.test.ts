// extraer-vino-foto · «Añadir vino» con IA exige «Editar» en la carta (06/11/2026,
// decisión del dueño: con solo «Ver» la carta se consulta y no gasta IA). Handler
// real; Supabase y OpenAI simulados. can_edit_section resuelve auth.uid() del JWT:
// aquí, el token dice qué permiso tiene cada uno.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  openai: 0,
  token: "",
}));

// Lo que devuelve cada RPC de permiso según el usuario (super admin: true en todas).
const PERMISOS: Record<string, Record<string, boolean>> = {
  "jwt-editar": { can_read_section: true, can_write_section: true, can_edit_section: true },
  "jwt-ver": { can_read_section: true, can_write_section: true, can_edit_section: false },
  "jwt-super": { can_read_section: true, can_write_section: true, can_edit_section: true },
};

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({ serve: (fn: (r: Request) => Promise<Response>) => { h.handler = fn; } }));
vi.mock("../_shared/audit-client.ts", () => ({ conAuditoriaDePeticion: (_n: string, _f: unknown, handler: unknown) => handler }));
vi.mock("../_shared/registrar-uso-ia.ts", () => ({
  AcumuladorUso: class { llamadas = 0; sumar() {} marcarError() {} },
  registrarUso: async () => {},
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: (_url: string, _key: string, opciones?: { global?: { headers?: Record<string, string> } }) => {
    const token = opciones?.global?.headers?.Authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return {
      auth: { getUser: async () => (PERMISOS[token] ? { data: { user: { id: token } }, error: null } : { data: { user: null }, error: { message: "jwt" } }) },
      rpc: async (fn: string, args: Record<string, unknown>) => {
        h.rpcs.push({ fn, args });
        return { data: PERMISOS[token]?.[fn] === true, error: null };
      },
      from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    };
  },
}));

const ENV: Record<string, string> = { SUPABASE_URL: "https://ejemplo.supabase.co", SUPABASE_ANON_KEY: "anon", OPENAI_API_KEY: "sk-prueba" };
const json = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200, headers: { "Content-Type": "application/json" } });

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (n: string) => ENV[n] } });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    h.openai++;
    if (String(url).endsWith("/v1/responses")) {
      return json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ficha_encontrada: false, ofertas: [] }) }] }], usage: { input_tokens: 1, output_tokens: 1 } });
    }
    return json({ choices: [{ message: { content: JSON.stringify({ nombre: "Vino", categoria: null, recorte: null }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  }));
  await import("../extraer-vino-foto/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { h.rpcs = []; h.openai = 0; });

const leer = (token: string) => h.handler!(new Request("https://ejemplo.supabase.co/functions/v1/extraer-vino-foto", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ imagen: "AAAA" }),
}));

describe("extraer-vino-foto · «Editar» en la carta", () => {
  it("solo «Ver» → 403 sin llamar a OpenAI (aunque can_write_section diga que sí)", async () => {
    const res = await leer("jwt-ver");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringMatching(/Editar/) });
    expect(h.openai).toBe(0);
  });

  it("pregunta can_edit_section('gestor_carta'), nunca can_write_section", async () => {
    await leer("jwt-ver");
    expect(h.rpcs).toEqual([{ fn: "can_edit_section", args: { _section: "gestor_carta" } }]);
  });

  it.each(["jwt-editar", "jwt-super"])("%s lee la etiqueta (200)", async (token) => {
    const res = await leer(token);
    expect(res.status).toBe(200);
    expect(h.openai).toBeGreaterThan(0);
  });

  it("sin usuario → 401", async () => {
    expect((await leer("jwt-falso")).status).toBe(401);
    expect(h.openai).toBe(0);
  });
});
