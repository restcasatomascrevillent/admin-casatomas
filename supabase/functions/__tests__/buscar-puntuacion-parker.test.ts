// buscar-puntuacion-parker · handler real con Supabase, OpenAI y la página de
// la fuente simulados (08/11/2026). Cubre: permiso «Editar»; sin añada no se
// busca; caché de verificadas; verificada solo si la página lo muestra; si la
// página no abre, revisión; otra añada descartada; fallo de OpenAI = «fallida»
// sin romper (el panel deja guardar el resto).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  openai: 0,
  paginas: 0,
  respuestaIA: null as Record<string, unknown> | null,
  estadoIA: 200,
  pagina: "" as string | null,
  cache: [] as Array<Record<string, unknown>>,
}));

const PERMISOS: Record<string, boolean> = { "jwt-editar": true, "jwt-ver": false };

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({ serve: (fn: (r: Request) => Promise<Response>) => { h.handler = fn; } }));
vi.mock("../_shared/audit-client.ts", () => ({ conAuditoriaDePeticion: (_n: string, _f: unknown, handler: unknown) => handler }));
vi.mock("../_shared/registrar-uso-ia.ts", () => ({
  AcumuladorUso: class { llamadas = 0; sumar() {} marcarError() {} },
  registrarUso: async () => {},
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: (_url: string, _key: string, opciones?: { global?: { headers?: Record<string, string> } }) => {
    const token = opciones?.global?.headers?.Authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const consulta = {
      select: () => consulta,
      eq: () => consulta,
      is: () => consulta,
      limit: () => Promise.resolve({ data: h.cache, error: null }),
    };
    return {
      auth: { getUser: async () => (token in PERMISOS ? { data: { user: { id: token } }, error: null } : { data: { user: null }, error: { message: "jwt" } }) },
      rpc: async (fn: string) => ({ data: fn === "can_edit_section" ? PERMISOS[token] === true : true, error: null }),
      from: () => consulta,
    };
  },
}));

const ENV: Record<string, string> = { SUPABASE_URL: "https://ejemplo.supabase.co", SUPABASE_ANON_KEY: "anon", OPENAI_API_KEY: "sk-prueba" };
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

const IA_BUENA = {
  encontrada: true, motivo: null, vino_evaluado: "Aalto 2021", anada_evaluada: 2021, sin_anada: false,
  puntos_texto: "94", puntos_min: 94, puntos_max: 94, provisional: false, entidad: "Robert Parker Wine Advocate",
  critico: "Luis Gutiérrez", fecha_valoracion: "2024-06", fuente_nombre: "Vin Chicago",
  fuente_url: "https://www.vinchicago.com/aalto-2021", cita: "Wine Advocate 94", discrepancias: [], notas: null,
};

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (n: string) => ENV[n] } });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).endsWith("/v1/responses")) {
      h.openai++;
      if (h.estadoIA !== 200) return new Response('{"error":{"code":"insufficient_quota"}}', { status: h.estadoIA });
      return json({
        output: [
          { type: "web_search_call", action: { sources: [{ url: "https://www.vinchicago.com/aalto-2021" }] } },
          { type: "message", content: [{ type: "output_text", text: JSON.stringify(h.respuestaIA) }] },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    }
    h.paginas++;
    if (h.pagina === null) throw new Error("bloqueada");
    return new Response(h.pagina, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }));
  await import("../buscar-puntuacion-parker/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  h.openai = 0;
  h.paginas = 0;
  h.respuestaIA = IA_BUENA;
  h.estadoIA = 200;
  h.pagina = "<h1>Aalto 2021</h1><p>Robert Parker's Wine Advocate: 94 points</p>";
  h.cache = [];
});

const buscar = async (cuerpo: Record<string, unknown>, token = "jwt-editar") => {
  const res = await h.handler!(new Request("https://ejemplo.supabase.co/functions/v1/buscar-puntuacion-parker", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(cuerpo),
  }));
  return { status: res.status, body: await res.json() };
};

describe("buscar-puntuacion-parker", () => {
  it("con solo «Ver» no se gasta IA", async () => {
    const r = await buscar({ nombre: "Aalto 2021", anada: 2021 }, "jwt-ver");
    expect(r.status).toBe(403);
    expect(h.openai).toBe(0);
  });

  it("sin añada no busca: pide confirmarla", async () => {
    const r = await buscar({ nombre: "Aalto", anada: null });
    expect(r.body.resultado).toMatchObject({ estado: "no_localizada", motivo: "anada_desconocida", puntos_min: null });
    expect(h.openai).toBe(0);
  });

  it("verificada solo tras ver la nota en la página", async () => {
    const r = await buscar({ nombre: "Aalto 2021", anada: 2021 });
    expect(r.body).toMatchObject({ ok: true, desde_cache: false });
    expect(r.body.resultado).toMatchObject({ estado: "verificada", puntos_texto: "94", anada: 2021, comprobado_en_pagina: true, fuente_tipo: "secundaria" });
    expect(h.paginas).toBe(1);
  });

  it("si la página no abre, queda en revisión con la fuente", async () => {
    h.pagina = null;
    const r = await buscar({ nombre: "Aalto 2021", anada: 2021 });
    expect(r.body.resultado).toMatchObject({ estado: "revision", puntos_texto: "94", fuente_url: "https://www.vinchicago.com/aalto-2021" });
    expect(r.body.resultado.notas).toMatch(/No se pudo abrir/);
  });

  it("una nota de otra añada se descarta", async () => {
    h.respuestaIA = { ...IA_BUENA, anada_evaluada: 2020 };
    const r = await buscar({ nombre: "Aalto 2021", anada: 2021 });
    expect(r.body.resultado).toMatchObject({ estado: "no_localizada", puntos_min: null });
    expect(h.paginas).toBe(0);
  });

  it("usa la verificada guardada sin buscar, salvo «Buscar de nuevo»", async () => {
    h.cache = [{ vino_id: "otro", anada: 2021, sin_anada: false, estado: "verificada", puntos_texto: "94", puntos_min: 94, puntos_max: 94,
      provisional: false, entidad: "Robert Parker Wine Advocate", fuente_nombre: "X", fuente_url: "https://x.es/a", fecha_consulta: "2026-11-08",
      discrepancias: [], Vinos: { nombre: "Aalto (Magnum)" } }];
    const r = await buscar({ nombre: "Aalto 2021", anada: 2021 });
    expect(r.body).toMatchObject({ ok: true, desde_cache: true, resultado: { estado: "verificada", puntos_texto: "94" } });
    expect(h.openai).toBe(0);
    const forzada = await buscar({ nombre: "Aalto 2021", anada: 2021, forzar: true });
    expect(forzada.body.desde_cache).toBe(false);
    expect(h.openai).toBe(1);
  });

  it("si OpenAI falla, devuelve «fallida» con el motivo", async () => {
    h.estadoIA = 429;
    const r = await buscar({ nombre: "Aalto 2021", anada: 2021 });
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ ok: false, resultado: { estado: "fallida", motivo: "busqueda_fallida" } });
  });
});
