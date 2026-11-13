// Tarea 2.2 · traducir-contenido redacta la descripción de un plato nuevo que
// llega sin ella SIN gastar otra llamada ni otro modelo: una sola petición a
// OpenAI, gpt-4.1-mini, y la respuesta trae descripcion_es + descripcion_en/fr.
// Envoltorio REAL (audit-client) + handler real; Supabase y OpenAI simulados
// (mismo arnés que traducir-contenido.authz.test.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const USUARIO = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "carta@staff.local" };
  const estado = {
    handler: null as ((req: Request) => Promise<Response>) | null,
    peticiones: [] as Array<{ model: string; messages: Array<{ role: string; content: string }> }>,
    contenido: "{}",
  };
  const cliente = () => ({
    auth: {
      getUser: async (token?: string) =>
        token === "jwt-carta" ? { data: { user: USUARIO }, error: null } : { data: { user: null }, error: { message: "invalid" } },
    },
    rpc: async (fn: string, args: Record<string, unknown>) =>
      fn === "has_section_permission"
        ? { data: args._section === "gestor_carta", error: null }
        : { data: null, error: null },
  });
  return { estado, cliente };
});

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({ serve: (fn: (r: Request) => Promise<Response>) => { h.estado.handler = fn; } }));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: () => h.cliente() }));
vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: () => h.cliente() }));

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://ejemplo.supabase.co",
  SUPABASE_ANON_KEY: "anon-jwt-publico",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secreta",
  OPENAI_API_KEY: "sk-prueba",
};

const RESPUESTA_CON_DESCRIPCION = {
  nombre: "Corvina salvaje",
  descripcion: null,
  descripcion_es: "Corvina salvaje, un pescado blanco de carne firme.",
  traducciones: {
    en: { name: "Wild Meagre", description: "Wild meagre, a firm white fish.", category: "Fish", allergens: ["fish"] },
    fr: { name: "Maigre sauvage", description: "Maigre sauvage, un poisson blanc à chair ferme.", category: "Poissons", allergens: ["poisson"] },
  },
};

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (n: string) => ENV[n] } });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    h.estado.peticiones.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({
      choices: [{ message: { content: h.estado.contenido } }],
      usage: { prompt_tokens: 50, completion_tokens: 5 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  await import("../traducir-contenido/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  h.estado.peticiones = [];
  h.estado.contenido = JSON.stringify(RESPUESTA_CON_DESCRIPCION);
});

const DATOS = { nombre: "Corvina salvaje", descripcion: "", ingredientes: "", categoria: "PESCADOS", alergenos: ["pescado"] };
const llamar = (body: unknown) => h.estado.handler!(new Request("https://ejemplo.supabase.co/functions/v1/traducir-contenido", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer jwt-carta" },
  body: JSON.stringify(body),
}));
const system = () => h.estado.peticiones[0].messages.find((m) => m.role === "system")!.content;

describe("plato nuevo sin descripción (redactar_descripcion: true)", () => {
  it("una sola llamada, el mismo modelo, y devuelve la descripción en los tres idiomas", async () => {
    const res = await llamar({ tipo: "plato", datos: DATOS, redactar_descripcion: true });
    expect(res.status).toBe(200);
    expect(h.estado.peticiones).toHaveLength(1);
    expect(h.estado.peticiones[0].model).toBe("gpt-4.1-mini");
    expect(system()).toContain("REDACCIÓN DE LA DESCRIPCIÓN");
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      tipo: "plato",
      translations: {
        descripcion_es: "Corvina salvaje, un pescado blanco de carne firme.",
        descripcion_en: "Wild meagre, a firm white fish.",
        descripcion_fr: "Maigre sauvage, un poisson blanc à chair ferme.",
        nombre_en: "Wild Meagre",
      },
    });
  });

  it("si el modelo no la redacta, responde como siempre (sin descripción)", async () => {
    h.estado.contenido = JSON.stringify({
      ...RESPUESTA_CON_DESCRIPCION,
      descripcion_es: null,
      traducciones: {
        en: { ...RESPUESTA_CON_DESCRIPCION.traducciones.en, description: null },
        fr: { ...RESPUESTA_CON_DESCRIPCION.traducciones.fr, description: null },
      },
    });
    const body = await (await llamar({ tipo: "plato", datos: DATOS, redactar_descripcion: true })).json();
    expect(body.ok).toBe(true);
    expect(body.translations).not.toHaveProperty("descripcion_es");
    expect(body.translations).toMatchObject({ descripcion_en: null, descripcion_fr: null, nombre_en: "Wild Meagre" });
    expect(h.estado.peticiones).toHaveLength(1);
  });
});

describe("sin la marca, o con descripción escrita, no cambia nada", () => {
  it("sin redactar_descripcion: prompt de siempre y sin descripcion_es", async () => {
    const body = await (await llamar({ tipo: "plato", datos: DATOS })).json();
    expect(system()).not.toContain("REDACCIÓN DE LA DESCRIPCIÓN");
    expect(body.translations).not.toHaveProperty("descripcion_es");
  });

  it("con descripción escrita no se pide redactar aunque venga la marca", async () => {
    await llamar({ tipo: "plato", datos: { ...DATOS, descripcion: "Pescado del día a la plancha." }, redactar_descripcion: true });
    expect(system()).not.toContain("REDACCIÓN DE LA DESCRIPCIÓN");
  });

  it("en otros tipos la marca se ignora", async () => {
    h.estado.contenido = JSON.stringify({ en: { nombre: "Draft beer" }, fr: { nombre: "Bière" } });
    await llamar({ tipo: "bebida", datos: { nombre: "Caña", descripcion: "" }, redactar_descripcion: true });
    expect(system()).not.toContain("REDACCIÓN DE LA DESCRIPCIÓN");
  });
});
