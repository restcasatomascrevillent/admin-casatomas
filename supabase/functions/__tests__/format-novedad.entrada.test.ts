// VAL-05 (QA-T-05) · format-novedad responde 400 con mensaje a un cuerpo roto.
// Handler real; Supabase y OpenAI simulados.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = {
    handler: null as ((req: Request) => Promise<Response>) | null,
    openai: 0,
  };
  const cliente = (_url?: string, _key?: string, opts?: { global?: { headers?: Record<string, string> } }) => ({
    auth: {
      getUser: async (token?: string) => {
        const auth = token ? `Bearer ${token}` : opts?.global?.headers?.Authorization;
        return auth === "Bearer jwt-web"
          ? { data: { user: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "web@staff.local" } }, error: null }
          : { data: { user: null }, error: { message: "invalid" } };
      },
    },
    rpc: async (fn: string) => ({ data: fn === "has_section_permission" ? true : null, error: null }),
    from: () => ({ insert: async () => ({ error: null }) }),
  });
  return { estado, cliente };
});

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({ serve: (fn: (r: Request) => Promise<Response>) => { h.estado.handler = fn; } }));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: h.cliente }));
vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: h.cliente }));

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://ejemplo.supabase.co",
  SUPABASE_ANON_KEY: "anon-jwt-publico",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secreta",
  OPENAI_API_KEY: "sk-prueba",
};

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (n: string) => ENV[n] } });
  vi.stubGlobal("fetch", vi.fn(async () => {
    h.estado.openai++;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ tipo: "anuncio", title: "Título", body: "Cuerpo", bullets: [], tags: ["uno"] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  await import("../format-novedad/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { h.estado.openai = 0; });

const llamar = (body: string, token: string | null = "jwt-web") => h.estado.handler!(new Request("https://ejemplo.supabase.co/functions/v1/format-novedad", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body,
}));

describe("format-novedad · cuerpo de la petición", () => {
  it.each([
    ["JSON roto", "{texto: 'hola'", "JSON no válido"],
    ["cuerpo vacío", "", "JSON no válido"],
    ["un array", "[1,2]", "JSON no válido"],
    ["null", "null", "JSON no válido"],
    ["texto numérico", JSON.stringify({ texto: 42 }), "El campo texto debe ser una cadena"],
    ["texto objeto", JSON.stringify({ texto: { a: 1 } }), "El campo texto debe ser una cadena"],
    ["tono no cadena", JSON.stringify({ texto: "Hola", tono: 3 }), "El campo tono debe ser una cadena"],
    ["sin texto", JSON.stringify({ tipo: "anuncio" }), "El campo texto es obligatorio"],
    ["texto en blanco", JSON.stringify({ texto: "   " }), "El campo texto es obligatorio"],
  ])("%s → 400 con mensaje y sin llamar a OpenAI", async (_n, body, mensaje) => {
    const res = await llamar(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: mensaje });
    expect(h.estado.openai).toBe(0);
  });

  it("sin usuario sigue siendo 401 aunque el JSON esté roto", async () => {
    const res = await llamar("{roto", null);
    expect(res.status).toBe(401);
    expect(h.estado.openai).toBe(0);
  });

  it("una petición correcta sigue respondiendo 200 con el resultado", async () => {
    const res = await llamar(JSON.stringify({ tipo: "anuncio", idioma: "es", tono: "cercano", texto: "Abrimos el lunes" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: "Título", tags: ["Uno"] });
    expect(h.estado.openai).toBe(1);
  });
});
