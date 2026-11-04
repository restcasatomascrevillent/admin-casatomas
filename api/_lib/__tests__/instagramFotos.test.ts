// @vitest-environment node
/**
 * api/instagram-render con fotos subidas desde el panel: si «pieza.foto» no
 * está en el catálogo estático, se busca en instagram_fotos (PostgREST con el
 * JWT del usuario) y la URL de la foto sale de su ruta. fetch y renderizador
 * simulados: sin red ni Chromium.
 */
import { describe, expect, it, vi } from "vitest";
import { manejarRender } from "../../instagram-render";
import type { Renderizador } from "../instagram/render";
import { EJEMPLOS } from "../../../src/lib/instagram/ejemplos";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.firmaDelUsuarioParaFotos";
const SB = "https://sfonaclosuafvlhutkon.supabase.co";
const ENV_SB = { VITE_SUPABASE_URL: SB, VITE_SUPABASE_PUBLISHABLE_KEY: "clave-publica" };
const FOTO = "5b1d2c3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const RUTA = `fotos/casa-tomas/subidas/${FOTO}.jpg`;
const PIEZA = { ...EJEMPLOS.find((e) => e.id === "ct-foto-titular-post")!.json, foto: FOTO };

const resp = (estado: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

function falso(filasFoto: unknown[] | [number, unknown]) {
  return vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    const metodo = (init.method ?? "GET").toUpperCase();
    if (url === `${SB}/auth/v1/user`) return resp(200, { id: "usuario-1" });
    if (url === `${SB}/rest/v1/rpc/can_write_section`) return resp(200, true);
    if (url.startsWith(`${SB}/rest/v1/instagram_fotos`)) {
      return typeof filasFoto[0] === "number" ? resp(filasFoto[0] as number, filasFoto[1]) : resp(200, filasFoto);
    }
    if (url.startsWith(`${SB}/rest/v1/instagram_piezas`) && metodo === "POST") return resp(201, [{ ...JSON.parse(String(init.body)) }]);
    if (url.startsWith(`${SB}/storage/v1/object/instagram/`)) return resp(200, { Key: "instagram/x" });
    throw new Error(`URL inesperada en el test: ${metodo} ${url}`);
  });
}

const jpgFalso: Renderizador = async (p) => ({
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  ancho: p.ancho,
  alto: p.alto,
  calidad: 92,
  avisos: [],
  tiempos: { msArranque: 1, msPagina: 1, msCarga: 1, msCaptura: 1, msJpeg: 1 },
});

const peticion = (cuerpo: unknown) =>
  new Request("https://panel/api/instagram-render", {
    method: "POST",
    headers: { Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });

describe("POST /api/instagram-render con una foto subida", () => {
  it("busca la foto desconocida en instagram_fotos con el JWT y la pinta por su ruta", async () => {
    const f = falso([{ id: FOTO, marca: "casa-tomas", ruta: RUTA, ancho: 1708, alto: 2560, tipo: "plato", descripcion: "Chuleta" }]);
    const renderizar = vi.fn(jpgFalso);
    const r = await manejarRender(peticion({ pieza: PIEZA }), { env: ENV_SB, fetch: f, renderizar, nuevoId: () => "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f" });
    expect(r.status).toBe(200);

    const consulta = f.mock.calls.find(([u]) => String(u).startsWith(`${SB}/rest/v1/instagram_fotos`))!;
    expect(String(consulta[0])).toBe(`${SB}/rest/v1/instagram_fotos?id=eq.${FOTO}&select=id,marca,ruta,ancho,alto,tipo,descripcion`);
    const cabeceras = new Headers(consulta[1]!.headers as HeadersInit);
    expect(cabeceras.get("authorization")).toBe(`Bearer ${JWT}`);
    expect(cabeceras.get("apikey")).toBe("clave-publica");

    expect(renderizar.mock.calls[0][0].html).toContain(`${SB}/storage/v1/object/public/instagram/${RUTA}`);
  });

  it("no consulta instagram_fotos si la foto es del catálogo estático", async () => {
    const f = falso([]);
    const pieza = EJEMPLOS.find((e) => e.id === "ct-foto-titular-post")!.json;
    expect((await manejarRender(peticion({ pieza }), { env: ENV_SB, fetch: f, renderizar: jpgFalso })).status).toBe(200);
    expect(f.mock.calls.some(([u]) => String(u).includes("instagram_fotos"))).toBe(false);
  });

  it("422 si la foto no existe (o la RLS la oculta), sin renderizar", async () => {
    const renderizar = vi.fn(jpgFalso);
    const r = await manejarRender(peticion({ pieza: PIEZA }), { env: ENV_SB, fetch: falso([]), renderizar });
    expect(r.status).toBe(422);
    expect((await r.json()).problemas).toContain(`La foto «${FOTO}» no está en el catálogo de fotos`);
    expect(renderizar).not.toHaveBeenCalled();
  });

  it("422 si la foto subida no sirve para el formato (misma regla que el panel)", async () => {
    const f = falso([{ id: FOTO, marca: "casa-tomas", ruta: RUTA, ancho: 500, alto: 500, tipo: "plato", descripcion: "" }]);
    const r = await manejarRender(peticion({ pieza: PIEZA }), { env: ENV_SB, fetch: f, renderizar: jpgFalso });
    expect(r.status).toBe(422);
    expect((await r.json()).problemas.join(" ")).toMatch(/tendría que ampliarse/);
  });

  it("502 si PostgREST falla al buscar la foto", async () => {
    const renderizar = vi.fn(jpgFalso);
    const r = await manejarRender(peticion({ pieza: PIEZA }), { env: ENV_SB, fetch: falso([500, { message: "caído" }]), renderizar });
    expect(r.status).toBe(502);
    expect(renderizar).not.toHaveBeenCalled();
  });

  it("un id que no es UUID ni del catálogo no llega a PostgREST", async () => {
    const f = falso([]);
    const r = await manejarRender(peticion({ pieza: { ...PIEZA, foto: "x&select=*" } }), { env: ENV_SB, fetch: f, renderizar: jpgFalso });
    expect(r.status).toBe(422);
    expect(f.mock.calls.some(([u]) => String(u).includes("instagram_fotos"))).toBe(false);
  });
});
