// extraer-vino-foto · la región propuesta al formulario sitúa el vino en el mapa.
// Caso real (2-11-2026): la etiqueta de «Terras Vellas Albariño Crianza sobre Lías»
// solo dio «Galicia» y el vino salió en «sin ubicación» en la web. Handler real;
// Supabase, OpenAI y el registro de uso simulados.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  lectura: {} as Record<string, unknown>,
  ficha: {} as Record<string, unknown>,
  sistema: "",
}));

const CARTA = [
  { nombre: "Albariño Cambados 2024", categoria: "BLANCOS", denominacion_origen: "D.O. Rías Baixas", precio_eur: 30, descripcion: null, ubicacion_region: "Cambados, Pontevedra, Galicia", ubicacion_pais: "España" },
  { nombre: "Rioja Crianza", categoria: "TINTOS", denominacion_origen: "D.O.Ca. Rioja", precio_eur: 25, descripcion: null, ubicacion_region: "Rioja", ubicacion_pais: "España" },
];

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({ serve: (fn: (r: Request) => Promise<Response>) => { h.handler = fn; } }));
vi.mock("../_shared/audit-client.ts", () => ({ conAuditoriaDePeticion: (_n: string, _f: unknown, handler: unknown) => handler }));
vi.mock("../_shared/registrar-uso-ia.ts", () => ({
  AcumuladorUso: class { llamadas = 0; sumar() {} marcarError() {} },
  registrarUso: async () => {},
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "usuario" } }, error: null }) },
    rpc: async () => ({ data: true, error: null }),
    from: () => ({ select: () => ({ limit: async () => ({ data: CARTA, error: null }) }) }),
  }),
}));

const ENV: Record<string, string> = { SUPABASE_URL: "https://ejemplo.supabase.co", SUPABASE_ANON_KEY: "anon", OPENAI_API_KEY: "sk-prueba" };
const json = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200, headers: { "Content-Type": "application/json" } });

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (n: string) => ENV[n] } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
    const cuerpo = JSON.parse(init.body);
    if (String(url).endsWith("/v1/responses")) {
      return json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(h.ficha) }] }], usage: { input_tokens: 1, output_tokens: 1 } });
    }
    const nombre = cuerpo.response_format?.json_schema?.name;
    if (nombre === "vino_etiqueta") {
      h.sistema = cuerpo.messages[0].content;
      return json({ choices: [{ message: { content: JSON.stringify(h.lectura) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }
    return json({ choices: [{ message: { content: JSON.stringify({ precio_sugerido: null, precio_razon: null }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  }));
  await import("../extraer-vino-foto/index.ts");
});
afterAll(() => vi.unstubAllGlobals());

const LECTURA = {
  nombre: "Terras Vellas Albariño Crianza sobre Lías", categoria: "BLANCOS", descripcion: null, ingredientes: "Albariño",
  denominacion_origen: "D.O. Rías Baixas", ubicacion_region: "Galicia", ubicacion_pais: "España", contiene_sulfitos: true, recorte: null,
};
const FICHA = { ficha_encontrada: false, descripcion: null, ingredientes: null, denominacion_origen: null, ubicacion_region: null, ofertas: [] };

beforeEach(() => { h.lectura = { ...LECTURA }; h.ficha = { ...FICHA }; h.sistema = ""; });

const leer = async () => {
  const res = await h.handler!(new Request("https://ejemplo.supabase.co/functions/v1/extraer-vino-foto", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer jwt" },
    body: JSON.stringify({ imagen: "AAAA" }),
  }));
  expect(res.status).toBe(200);
  return (await res.json()).vino as Record<string, unknown>;
};

describe("extraer-vino-foto · ubicacion_region", () => {
  it("si la etiqueta solo da «Galicia» y la ficha da el Val do Salnés, propone el Val do Salnés", async () => {
    h.ficha = { ...FICHA, ficha_encontrada: true, ubicacion_region: "Val do Salnés, Pontevedra" };
    const vino = await leer();
    expect(vino.ubicacion_region).toBe("Val do Salnés, Pontevedra");
    expect(vino.ubicacion_pais).toBe("España");
  });

  it("si nadie da algo más concreto, conserva «Galicia» (la web usa entonces el centro de la D.O.)", async () => {
    expect((await leer()).ubicacion_region).toBe("Galicia");
  });

  it("una región concreta leída de la etiqueta no se sustituye por la de la ficha", async () => {
    h.lectura = { ...LECTURA, ubicacion_region: "Cambados, Pontevedra" };
    h.ficha = { ...FICHA, ubicacion_region: "O Rosal, Pontevedra" };
    expect((await leer()).ubicacion_region).toBe("Cambados, Pontevedra");
  });

  it("el prompt pide el formato de la carta e incluye ejemplos reales de la carta", async () => {
    await leer();
    expect(h.sistema).toContain("Localidad o subzona, Provincia");
    expect(h.sistema).toContain("NO adivines un municipio");
    expect(h.sistema).toContain("Cambados, Pontevedra, Galicia [D.O. Rías Baixas]");
    expect(h.sistema).not.toContain("San Vicente de la Sonsierra");
  });
});
