// interpretar-reserva-manuscrita · «Escribir reserva» exige poder dar de alta reservas
// (reservas_puede_crear, la de la RLS del INSERT). Handler real; Supabase y OpenAI simulados.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  rpcs: [] as string[],
  openai: 0,
  cuerpoOpenAI: null as Record<string, unknown> | null,
}));

const PUEDE_CREAR: Record<string, boolean> = { "jwt-crear": true, "jwt-ver": false };

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
      auth: { getUser: async () => (token in PUEDE_CREAR ? { data: { user: { id: token } }, error: null } : { data: { user: null }, error: { message: "jwt" } }) },
      rpc: async (fn: string) => {
        h.rpcs.push(fn);
        return { data: PUEDE_CREAR[token] === true, error: null };
      },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    };
  },
}));

const ENV: Record<string, string> = { SUPABASE_URL: "https://ejemplo.supabase.co", SUPABASE_ANON_KEY: "anon", OPENAI_API_KEY: "sk-prueba" };
const LECTURA = { texto: "Esther 2px salón 13 noviembre 14:15", nombre: "Esther", telefono: null, email: null, comensales: 2, espacio: "salón", fecha: "13 noviembre", dia: 13, mes: 11, anio: null, hora: "14:15", notas: null };

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (n: string) => ENV[n] } });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    h.openai++;
    h.cuerpoOpenAI = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(LECTURA) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  }));
  await import("../interpretar-reserva-manuscrita/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { h.rpcs = []; h.openai = 0; h.cuerpoOpenAI = null; });

const interpretar = (token: string, body: Record<string, unknown> = { imagen: "data:image/png;base64,AAAA", espacios: ["Salón"], fecha_pagina: "2026-11-10" }) =>
  h.handler!(new Request("https://ejemplo.supabase.co/functions/v1/interpretar-reserva-manuscrita", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }));

describe("interpretar-reserva-manuscrita", () => {
  it("sin permiso de alta → 403 sin llamar a OpenAI", async () => {
    const res = await interpretar("jwt-ver");
    expect(res.status).toBe(403);
    expect(h.rpcs).toEqual(["reservas_puede_crear"]);
    expect(h.openai).toBe(0);
  });

  it("sin usuario → 401", async () => {
    expect((await interpretar("jwt-falso")).status).toBe(401);
    expect(h.openai).toBe(0);
  });

  it("con permiso devuelve la lectura limpia y manda la imagen y las salas al modelo", async () => {
    const res = await interpretar("jwt-crear");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, lectura: LECTURA });
    const mensajes = h.cuerpoOpenAI?.messages as Array<{ content: unknown }>;
    expect(String(mensajes[0].content)).toContain("Salón");
    expect(JSON.stringify(mensajes[1].content)).toContain("data:image/png;base64,AAAA");
  });

  it("imagen que no es imagen → 400", async () => {
    expect((await interpretar("jwt-crear", { imagen: "data:text/plain;base64,AAAA" })).status).toBe(400);
  });
});
