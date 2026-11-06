// CT-REM-FN-01 · traducir-contenido deja de ser un proxy de OpenAI sin usuario.
// 06/11/2026 · la carta exige «Editar» (gestor_carta); el Gestor Web sigue con «Ver».
// Envoltorio REAL (audit-client) + handler real; Supabase, OpenAI y bulk simulados.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const USUARIOS: Record<string, { id: string; email: string; permisos: Record<string, "view" | "edit"> }> = {
    "jwt-carta": { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "carta@staff.local", permisos: { gestor_carta: "edit" } },
    "jwt-carta-ver": { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", email: "cartaver@staff.local", permisos: { gestor_carta: "view" } },
    "jwt-web": { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "web@staff.local", permisos: { gestion_web: "view" } },
    "jwt-sin": { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: "nada@staff.local", permisos: {} },
  };
  const estado = {
    handler: null as ((req: Request) => Promise<Response>) | null,
    rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    openai: 0,
    bulk: 0,
  };
  const cliente = () => ({
    auth: {
      getUser: async (token?: string) => {
        const u = token ? USUARIOS[token] : undefined;
        return u ? { data: { user: { id: u.id, email: u.email } }, error: null } : { data: { user: null }, error: { message: "invalid" } };
      },
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      estado.rpcs.push({ fn, args });
      if (fn === "has_section_permission") {
        const u = Object.values(USUARIOS).find((x) => x.id === args._user_id);
        const p = u?.permisos[args._section as string];
        // «Editar» implica «Ver», como has_section_permission con user_permissions.
        return { data: args._permission === "edit" ? p === "edit" : !!p, error: null };
      }
      return { data: null, error: null };
    },
  });
  return { USUARIOS, estado, cliente };
});

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({ serve: (fn: (r: Request) => Promise<Response>) => { h.estado.handler = fn; } }));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: () => h.cliente() }));
vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: () => h.cliente() }));
vi.mock("../traducir-contenido/bulk.ts", () => ({
  runBulkFill: async () => { h.estado.bulk++; return { procesadas: 3 }; },
}));

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
      choices: [{ message: { content: JSON.stringify({ en: { saludo: "Hello" } }) } }],
      usage: { prompt_tokens: 50, completion_tokens: 5 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  await import("../traducir-contenido/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { h.estado.rpcs = []; h.estado.openai = 0; h.estado.bulk = 0; });

const CAMPOS = { campos: { saludo: "Hola" }, destino: ["en"] };
const llamar = (token: string | undefined, body: unknown = CAMPOS) => h.estado.handler!(new Request("https://ejemplo.supabase.co/functions/v1/traducir-contenido", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
}));
const usoRegistrado = () => h.estado.rpcs.filter((r) => r.fn === "ia_registrar_uso");

describe("negativas", () => {
  it.each([
    ["sin cabecera", undefined],
    ["anon key", ENV.SUPABASE_ANON_KEY],
    ["publishable key", "sb_publishable_123"],
    ["JWT inválido", "jwt-falso"],
  ])("%s → 401 y no llama a OpenAI", async (_n, token) => {
    const res = await llamar(token);
    expect(res.status).toBe(401);
    expect(h.estado.openai).toBe(0);
  });
  it("usuario sin Carta ni Novedades → 403 y no llama a OpenAI", async () => {
    const res = await llamar("jwt-sin");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false });
    expect(h.estado.openai).toBe(0);
  });
  it.each([
    ["campos", CAMPOS],
    ["plato", { tipo: "plato", datos: { nombre: "Chuleta" } }],
    ["vino", { tipo: "vino", datos: { nombre: "Albariño" } }],
    ["novedad", { tipo: "novedad", datos: { titulo: "Hola" } }],
  ])("solo «Ver» en la Carta (sin Gestor Web) → 403 en %s y no gasta IA", async (_n, body) => {
    const res = await llamar("jwt-carta-ver", body);
    expect(res.status).toBe(403);
    expect(h.estado.openai).toBe(0);
    expect(usoRegistrado()).toHaveLength(0);
  });
  it.each(["plato", "bebida", "vino", "coctel"])("con «Ver» en el Gestor Web no se traduce un %s de la carta (403, sin IA)", async (tipo) => {
    const res = await llamar("jwt-web", { tipo, datos: { nombre: "X" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, error: expect.stringMatching(/Editar/) });
    expect(h.estado.openai).toBe(0);
  });
  it("la carta se pregunta con «Editar», no con «Ver»", async () => {
    await llamar("jwt-carta", { tipo: "plato", datos: { nombre: "Chuleta" } });
    expect(h.estado.rpcs.find((r) => r.fn === "has_section_permission")?.args).toMatchObject({ _section: "gestor_carta", _permission: "edit" });
  });
  it("bulk con un usuario (aunque tenga sección) → 403", async () => {
    expect((await llamar("jwt-carta", { modo: "bulk" })).status).toBe(403);
    expect(h.estado.bulk).toBe(0);
  });
  it("la service role no abre las ramas de usuario", async () => {
    expect((await llamar(ENV.SUPABASE_SERVICE_ROLE_KEY)).status).toBe(403);
    expect(h.estado.openai).toBe(0);
  });
  it("modo tipo con datos gigantes → 400 sin llamar a OpenAI", async () => {
    const res = await llamar("jwt-carta", { tipo: "plato", datos: { nombre: "x", descripcion: "a".repeat(25000) } });
    expect(res.status).toBe(400);
    expect(h.estado.openai).toBe(0);
  });
});

describe("positivas", () => {
  it.each(["jwt-carta", "jwt-web"])("%s traduce (campos) y deja fila en ia_uso", async (token) => {
    const res = await llamar(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, modo: "campos", traducciones: { en: { saludo: "Hello" } } });
    expect(h.estado.openai).toBe(1);
    const uso = usoRegistrado();
    expect(uso).toHaveLength(1);
    expect(uso[0].args).toMatchObject({ p_funcion: "traducir-contenido", p_prompt_tokens: 50, p_completion_tokens: 5 });
    expect(String(uso[0].args.p_disparador)).toBe(`usuario:${h.USUARIOS[token].id}`);
  });
  it("modo tipo con «Editar» en la carta responde 200 como hoy", async () => {
    const res = await llamar("jwt-carta", { tipo: "plato", datos: { nombre: "Chuleta" } });
    expect(res.status).toBe(200);
    expect(h.estado.openai).toBe(1);
  });
  it.each(["novedad", "menu", "tapas"])("el Gestor Web con «Ver» sigue traduciendo %s (no cambia)", async (tipo) => {
    const res = await llamar("jwt-web", { tipo, datos: { titulo: "Hola" } });
    expect(res.status).toBe(200);
    expect(h.estado.openai).toBe(1);
  });
  it("bulk con service role sigue funcionando", async () => {
    const res = await llamar(ENV.SUPABASE_SERVICE_ROLE_KEY, { modo: "bulk", dryRun: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, procesadas: 3 });
    expect(h.estado.bulk).toBe(1);
  });
});
