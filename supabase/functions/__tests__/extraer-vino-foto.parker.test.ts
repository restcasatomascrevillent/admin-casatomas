// extraer-vino-foto · datos para la puntuación Parker (08/11/2026): la añada
// solo si se lee (nunca futura ni adivinada), NV, ambigüedad, y las
// puntuaciones impresas con su entidad, sin dar ninguna por Parker.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  lectura: {} as Record<string, unknown>,
}));

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({ serve: (fn: (r: Request) => Promise<Response>) => { h.handler = fn; } }));
vi.mock("../_shared/audit-client.ts", () => ({ conAuditoriaDePeticion: (_n: string, _f: unknown, handler: unknown) => handler }));
vi.mock("../_shared/registrar-uso-ia.ts", () => ({
  AcumuladorUso: class { llamadas = 0; sumar() {} marcarError() {} },
  registrarUso: async () => {},
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u" } }, error: null }) },
    rpc: async () => ({ data: true, error: null }),
    from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
  }),
}));

const ENV: Record<string, string> = { SUPABASE_URL: "https://ejemplo.supabase.co", SUPABASE_ANON_KEY: "anon", OPENAI_API_KEY: "sk-prueba" };
const json = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200, headers: { "Content-Type": "application/json" } });

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (n: string) => ENV[n] } });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).endsWith("/v1/responses")) {
      return json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ficha_encontrada: false, ofertas: [] }) }] }] });
    }
    return json({ choices: [{ message: { content: JSON.stringify({ nombre: "Vino", categoria: null, recorte: null, ...h.lectura }) } }] });
  }));
  await import("../extraer-vino-foto/index.ts");
});
afterAll(() => vi.unstubAllGlobals());

const leer = async (lectura: Record<string, unknown>) => {
  h.lectura = lectura;
  const res = await h.handler!(new Request("https://ejemplo.supabase.co/functions/v1/extraer-vino-foto", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer jwt" },
    body: JSON.stringify({ imagen: "data:image/jpeg;base64,AAAA" }),
  }));
  return (await res.json()).vino;
};

describe("extraer-vino-foto · Parker", () => {
  it("devuelve bodega, cuvée, añada legible y puntuaciones clasificadas", async () => {
    const v = await leer({
      bodega: "Pago de Carraovejas", cuvee: "Cuesta de las Liebres", anada: 2021, sin_anada: false,
      identificacion_ambigua: false, motivo_ambiguedad: "x",
      puntuaciones_etiqueta: [
        { texto: "94 Guía Peñín", puntos: 94, entidad: "Guía Peñín", anada: 2021 },
        { texto: "95 pts", puntos: 95, entidad: null, anada: null },
      ],
    });
    expect(v).toMatchObject({
      bodega: "Pago de Carraovejas", cuvee: "Cuesta de las Liebres", anada: 2021, sin_anada: false,
      identificacion_ambigua: false, motivo_ambiguedad: null,
    });
    expect(v.puntuaciones_etiqueta.map((p: { entidad_tipo: string }) => p.entidad_tipo)).toEqual(["otra", "desconocida"]);
  });

  it("sin añada legible o imposible: null; NV sin año", async () => {
    expect((await leer({ anada: null })).anada).toBeNull();
    expect((await leer({ anada: 2099 })).anada).toBeNull();
    expect(await leer({ anada: 2015, sin_anada: true })).toMatchObject({ anada: null, sin_anada: true });
  });

  it("ambigua: lo dice y explica por qué", async () => {
    expect(await leer({ identificacion_ambigua: true, motivo_ambiguedad: "Solo se ve el nombre de la bodega" }))
      .toMatchObject({ identificacion_ambigua: true, motivo_ambiguedad: "Solo se ve el nombre de la bodega" });
  });

  it("una función antigua sin estos campos no rompe", async () => {
    expect(await leer({})).toMatchObject({ anada: null, sin_anada: false, identificacion_ambigua: false, puntuaciones_etiqueta: [] });
  });
});
