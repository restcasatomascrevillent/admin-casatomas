// @vitest-environment node
/**
 * Función `api/recortar-foto`: autorización (sin red: fetch simulado) y, solo
 * con RECORTE_INFERENCIA=1, una inferencia REAL con onnxruntime-node sobre una
 * botella sintética (carga el modelo de 47 MB: ~5-15 s, por eso no va en CI).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { autorizarRecorte, entornoSupabase, terminarRecorte, tokenDeCabecera } from "../autorizacion";
import { BYTES_MAXIMOS, POST } from "../../recortar-foto";

const JWT = "aaa.bbb.ccc";
const ENV = { VITE_SUPABASE_URL: "https://demo.supabase.co/", VITE_SUPABASE_PUBLISHABLE_KEY: "pk" };
const USO = { recortes_mes: 600, recortes_dia: 3, cpu_ms_mes: 1000, tope_mes: 600, tope_dia: 60, tope_cpu_min: 120 };

function respuesta(estado: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
}

/** fetch simulado de Supabase: /auth/v1/user y las RPC del cupo. */
function supabaseFalso(usuario: [number, unknown], reserva: [number, unknown] = [200, { permitido: true, id: 7, ...USO }]) {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/auth/v1/user")) return respuesta(...usuario);
    if (u.endsWith("/rest/v1/rpc/recorte_servidor_reservar")) return respuesta(...reserva);
    if (u.endsWith("/rest/v1/rpc/recorte_servidor_terminar")) return new Response(null, { status: 204 });
    throw new Error(`URL inesperada ${u}`);
  });
}

describe("autorizarRecorte", () => {
  it("lee el token Bearer con forma de JWT", () => {
    expect(tokenDeCabecera(`Bearer ${JWT}`)).toBe(JWT);
    expect(tokenDeCabecera("Bearer nada")).toBeNull();
    expect(tokenDeCabecera(null)).toBeNull();
  });

  it("usa las variables del entorno (Preview = demo, Production = producción)", () => {
    expect(entornoSupabase(ENV)).toEqual({ url: "https://demo.supabase.co", clave: "pk" });
    expect(entornoSupabase({})).toBeNull();
  });

  it("401 sin sesión, sin llamar a Supabase", async () => {
    const f = vi.fn();
    expect(await autorizarRecorte(undefined, { env: ENV, fetch: f })).toMatchObject({ ok: false, estado: 401 });
    expect(f).not.toHaveBeenCalled();
  });

  it("401 con JWT caducado o falso (y no reserva cupo)", async () => {
    const f = supabaseFalso([401, { msg: "invalid JWT" }]);
    expect(await autorizarRecorte(`Bearer ${JWT}`, { env: ENV, fetch: f })).toMatchObject({ ok: false, estado: 401 });
    expect(f.mock.calls.some(([u]) => String(u).includes("reservar"))).toBe(false);
  });

  it("403 si el usuario no puede escribir en la carta", async () => {
    const f = supabaseFalso([200, { id: "u1" }], [403, { code: "42501", message: "Sin permiso para la carta" }]);
    expect(await autorizarRecorte(`Bearer ${JWT}`, { env: ENV, fetch: f })).toMatchObject({ ok: false, estado: 403 });
  });

  it("429 con el tope mensual alcanzado (sin gastar CPU)", async () => {
    const f = supabaseFalso([200, { id: "u1" }], [200, { permitido: false, id: null, motivo: "mes", ...USO }]);
    const r = await autorizarRecorte(`Bearer ${JWT}`, { env: ENV, fetch: f });
    expect(r).toMatchObject({ ok: false, estado: 429, tope: "mes" });
    expect((r as { motivo: string }).motivo).toMatch(/tope mensual de recortes en el servidor/);
  });

  it("503 si falta la migración del cupo (no recorta sin control de gasto)", async () => {
    const f = supabaseFalso([200, { id: "u1" }], [404, { message: "Could not find the function" }]);
    expect(await autorizarRecorte(`Bearer ${JWT}`, { env: ENV, fetch: f })).toMatchObject({ ok: false, estado: 503 });
  });

  it("ok con sesión, permiso y cupo: reserva como ese usuario", async () => {
    const f = supabaseFalso([200, { id: "u1" }]);
    expect(await autorizarRecorte(`Bearer ${JWT}`, { env: ENV, fetch: f })).toMatchObject({ ok: true, usuario: "u1", reserva: 7 });
    const llamada = f.mock.calls.find(([u]) => String(u).includes("reservar"));
    expect((llamada?.[1]?.headers as Record<string, string>).Authorization).toBe(`Bearer ${JWT}`);
  });

  it("terminarRecorte anota la duración en la fila reservada", async () => {
    const f = supabaseFalso([200, { id: "u1" }]);
    await terminarRecorte(`Bearer ${JWT}`, 7, 4321.4, true, { env: ENV, fetch: f });
    const llamada = f.mock.calls.find(([u]) => String(u).includes("terminar"));
    expect(JSON.parse(String(llamada?.[1]?.body))).toEqual({ p_id: 7, p_duracion_ms: 4321, p_ok: true });
  });
});

describe("POST /api/recortar-foto", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const peticion = (cab: Record<string, string> = {}) =>
    new Request("http://x/api/recortar-foto", { method: "POST", body: new Uint8Array([1, 2, 3]), headers: { "Content-Type": "image/jpeg", ...cab } });

  it("401 sin cabecera Authorization (no toca el modelo)", async () => {
    const r = await POST(peticion());
    expect(r.status).toBe(401);
    expect((await r.json()).error).toMatch(/sesión/i);
  });

  it("403 con sesión válida pero sin permiso de carta", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", ENV.VITE_SUPABASE_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", ENV.VITE_SUPABASE_PUBLISHABLE_KEY);
    vi.stubGlobal("fetch", supabaseFalso([200, { id: "u1" }], [403, { code: "42501" }]));
    expect((await POST(peticion({ Authorization: `Bearer ${JWT}` }))).status).toBe(403);
  });

  it("429 con el tope alcanzado: el cuerpo dice cuál", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", ENV.VITE_SUPABASE_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", ENV.VITE_SUPABASE_PUBLISHABLE_KEY);
    vi.stubGlobal("fetch", supabaseFalso([200, { id: "u1" }], [200, { permitido: false, motivo: "dia", ...USO }]));
    const r = await POST(peticion({ Authorization: `Bearer ${JWT}` }));
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ tope: "dia" });
  });

  it("413 si la foto pasa de 4 MB y 415 si no es una imagen admitida (antes de reservar nada)", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await POST(new Request("http://x/api/recortar-foto", { method: "POST", headers: { "Content-Length": String(BYTES_MAXIMOS + 1), "Content-Type": "image/jpeg" } }))).status).toBe(413);
    expect((await POST(new Request("http://x/api/recortar-foto", { method: "POST", body: "x", headers: { "Content-Type": "image/heic", Authorization: `Bearer ${JWT}` } }))).status).toBe(415);
    expect(f).not.toHaveBeenCalled();
  });
});

const REAL = process.env.RECORTE_INFERENCIA === "1";

describe.skipIf(!REAL)("inferencia real (RECORTE_INFERENCIA=1)", () => {
  it(
    "devuelve una máscara PNG de 1 canal al tamaño de la foto, con la botella opaca y el fondo transparente",
    async () => {
      const sharp = (await import("sharp")).default;
      const { mascaraDeFoto } = await import("../recorteServidor");
      // Botella oscura sobre fondo claro, 900×1200.
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
        <rect width="900" height="1200" fill="#eeeae4"/>
        <rect x="390" y="150" width="120" height="300" rx="20" fill="#1f3b1a"/>
        <rect x="300" y="420" width="300" height="680" rx="60" fill="#244a1f"/>
        <rect x="320" y="620" width="260" height="220" fill="#f3e9c8"/>
      </svg>`;
      const foto = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
      const r = await mascaraDeFoto(new Uint8Array(foto));
      expect(r.ancho).toBe(900);
      expect(r.alto).toBe(1200);
      expect((await sharp(r.png).metadata()).channels).toBe(1);
      const data = await sharp(r.png).extractChannel(0).raw().toBuffer();
      expect(data[800 * 900 + 450]).toBeGreaterThan(200); // cuerpo de la botella
      expect(data[50 * 900 + 50]).toBeLessThan(30); // esquina: fondo
      console.info("[recorte-servidor] tiempos", r.tiempos, `${r.png.byteLength} B`);
    },
    120_000,
  );
});
