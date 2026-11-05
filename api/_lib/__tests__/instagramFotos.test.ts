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

describe("POST /api/instagram-render con una foto de Google Drive (fotoPreparada)", () => {
  const DRIVE = "1FotoDeDrive0000000000001";
  const TMP = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const URL_TMP = `${SB}/storage/v1/object/public/instagram/tmp/${TMP}.jpg`;
  const piezaDrive = { ...PIEZA, foto: `drive:${DRIVE}` };
  const preparada = (extra: Record<string, unknown> = {}) => ({ id: `drive:${DRIVE}`, url: URL_TMP, ancho: 1708, alto: 2560, tipo: "plato", marca: "casa-tomas", ...extra });

  it("pinta la copia tmp/ de NUESTRO bucket, sin consultar instagram_fotos", async () => {
    const f = falso([]);
    const renderizar = vi.fn(jpgFalso);
    const r = await manejarRender(peticion({ pieza: piezaDrive, fotoPreparada: preparada() }), { env: ENV_SB, fetch: f, renderizar });
    expect(r.status).toBe(200);
    expect(renderizar.mock.calls[0][0].html).toContain(URL_TMP);
    expect(f.mock.calls.some(([u]) => String(u).includes("instagram_fotos"))).toBe(false);
  });

  it("una foto de Drive sin clasificar (tipo null) vale para cualquier plantilla; si es pequeña, 422", async () => {
    expect((await manejarRender(peticion({ pieza: piezaDrive, fotoPreparada: preparada({ tipo: null }) }), { env: ENV_SB, fetch: falso([]), renderizar: jpgFalso })).status).toBe(200);
    const r = await manejarRender(peticion({ pieza: piezaDrive, fotoPreparada: preparada({ ancho: 500, alto: 500 }) }), { env: ENV_SB, fetch: falso([]), renderizar: jpgFalso });
    expect(r.status).toBe(422);
  });

  it("sin fotoPreparada, la foto de Drive no está en el catálogo (422)", async () => {
    const r = await manejarRender(peticion({ pieza: piezaDrive }), { env: ENV_SB, fetch: falso([]), renderizar: jpgFalso });
    expect(r.status).toBe(422);
    expect((await r.json()).problemas).toContain(`La foto «drive:${DRIVE}» no está en el catálogo de fotos`);
  });

  it("SSRF: rechaza (400, sin renderizar) cualquier URL que no sea tmp/ del bucket «instagram» de este Supabase", async () => {
    const malas = [
      "https://evil.example.com/storage/v1/object/public/instagram/tmp/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:3000/admin",
      "file:///etc/passwd",
      `${SB.replace("https:", "http:")}/storage/v1/object/public/instagram/tmp/${TMP}.jpg`,
      `${SB}:8443/storage/v1/object/public/instagram/tmp/${TMP}.jpg`,
      `https://user:pw@sfonaclosuafvlhutkon.supabase.co/storage/v1/object/public/instagram/tmp/${TMP}.jpg`,
      `https://haqmmdfdzzatdnrrcgez.supabase.co/storage/v1/object/public/instagram/tmp/${TMP}.jpg`,
      `https://sfonaclosuafvlhutkon.supabase.co.evil.com/storage/v1/object/public/instagram/tmp/${TMP}.jpg`,
      `${SB}/storage/v1/object/public/platos/tmp/${TMP}.jpg`,
      `${SB}/storage/v1/object/public/instagram/piezas/2026-11/${TMP}.jpg`,
      `${SB}/storage/v1/object/public/instagram/tmp/../piezas/${TMP}.jpg`,
      `${SB}/storage/v1/object/public/instagram/tmp/%2e%2e/${TMP}.jpg`,
      `${SB}/storage/v1/object/public/instagram/tmp/${TMP}.svg`,
      `${SB}/storage/v1/object/sign/instagram/tmp/${TMP}.jpg`,
      `${SB}/rest/v1/instagram_piezas?select=*`,
      42,
    ];
    for (const url of malas) {
      const renderizar = vi.fn(jpgFalso);
      const r = await manejarRender(peticion({ pieza: piezaDrive, fotoPreparada: preparada({ url }) }), { env: ENV_SB, fetch: falso([]), renderizar });
      expect(r.status, String(url)).toBe(400);
      expect(renderizar).not.toHaveBeenCalled();
    }
  });

  it("rechaza (400) una fotoPreparada que no es la foto de la pieza o con datos raros", async () => {
    for (const extra of [{ id: "drive:1OtraFoto000000000000002" }, { marca: "otra" }, { ancho: 0 }, { alto: 1.5 }, { tipo: "postre" }]) {
      const r = await manejarRender(peticion({ pieza: piezaDrive, fotoPreparada: preparada(extra) }), { env: ENV_SB, fetch: falso([]), renderizar: jpgFalso });
      expect(r.status, JSON.stringify(extra)).toBe(400);
    }
  });
});

describe("POST /api/instagram-render con una foto de la carta (fotoPreparada «carta:<id>»)", () => {
  const PLATO = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const TMP = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const URL_TMP = `${SB}/storage/v1/object/public/instagram/tmp/${TMP}.webp`;
  const piezaCarta = { ...PIEZA, foto: `carta:${PLATO}` };
  const preparada = (extra: Record<string, unknown> = {}) => ({ id: `carta:${PLATO}`, url: URL_TMP, ancho: 1080, alto: 1440, tipo: "plato", marca: "casa-tomas", ...extra });

  it("pinta la copia tmp/ (webp) de NUESTRO bucket; el tipo es siempre «plato»", async () => {
    const renderizar = vi.fn(jpgFalso);
    const r = await manejarRender(peticion({ pieza: piezaCarta, fotoPreparada: preparada({ tipo: null }) }), { env: ENV_SB, fetch: falso([]), renderizar });
    expect(r.status).toBe(200);
    expect(renderizar.mock.calls[0][0].html).toContain(URL_TMP);
  });

  it("la URL tiene que ser tmp/ del bucket «instagram»: la de la carta (bucket «platos») u otra → 400", async () => {
    for (const url of [`${SB}/storage/v1/object/public/platos/platos/chuleta.webp`, "https://evil.example.com/x.webp"]) {
      const renderizar = vi.fn(jpgFalso);
      const r = await manejarRender(peticion({ pieza: piezaCarta, fotoPreparada: preparada({ url }) }), { env: ENV_SB, fetch: falso([]), renderizar });
      expect(r.status, url).toBe(400);
      expect(renderizar).not.toHaveBeenCalled();
    }
  });

  it("fotoPreparada de otra foto → 400; sin fotoPreparada → 422", async () => {
    expect((await manejarRender(peticion({ pieza: piezaCarta, fotoPreparada: preparada({ id: "carta:otro" }) }), { env: ENV_SB, fetch: falso([]), renderizar: jpgFalso })).status).toBe(400);
    expect((await manejarRender(peticion({ pieza: piezaCarta }), { env: ENV_SB, fetch: falso([]), renderizar: jpgFalso })).status).toBe(422);
  });
});
