/**
 * Vino añadido desde un iPhone sin recortar ni poner el fondo (02-11-2026):
 * en producción `recortar-fondo-vino` respondía 503 `sin_token` (falta el
 * secreto REPLICATE_API_TOKEN) y el panel solo dejaba una línea gris pequeña.
 * Aquí se prueba lo que hace el panel para que el móvil sea robusto:
 *   - la llamada a la función tiene tiempo máximo (en producción hubo 503 que
 *     tardaron 160 s en cerrarse con fotos de más de 500 KB);
 *   - un fallo de red o un tiempo agotado tienen su propio código y aviso;
 *   - si el servicio no está configurado se recuerda unos minutos, para que un
 *     lote de botellas no suba N fotos para recibir N veces el mismo 503;
 *   - el aviso dice qué hacer, según sea móvil u ordenador.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navegador: vi.fn(async () => new Blob(["sticker"], { type: "image/png" })),
  invoke: vi.fn(),
}));

vi.mock("../recorte/quitarFondoNavegador", async (original) => {
  const real = await original<typeof import("../recorte/quitarFondoNavegador")>();
  return { ...real, quitarFondoNavegador: mocks.navegador };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import {
  MS_RECUERDO_SERVICIO,
  TIMEOUT_REMOTO_MS,
  avisoSinFondoCarta,
  olvidarServicioNoDisponible,
  quitarFondo,
  quitarFondoRemoto,
} from "../fotoCartaVino";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1";
const ESCRITORIO =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const nav = (userAgent: string) => ({ userAgent, maxTouchPoints: 0 }) as unknown as Navigator;
const foto = () => new Blob(["foto"], { type: "image/jpeg" });

/** Lo que devuelve supabase-js ante un 4xx/5xx: FunctionsHttpError con la Response en `context`. */
function errorHttp(status: number, cuerpo: unknown) {
  const context = new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  return { data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context }) };
}
const sinToken = () => errorHttp(503, { ok: false, codigo: "sin_token", error: "falta el secreto REPLICATE_API_TOKEN" });
const todoBien = () => ({ data: { ok: true, png: "data:image/png;base64,AAAA" }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockReset(); // clearAllMocks no vacía las colas de mockResolvedValueOnce
  olvidarServicioNoDisponible();
  vi.stubGlobal("Worker", class {});
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ blob: async () => new Blob(["png"], { type: "image/png" }) })),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("quitarFondoRemoto: tiempo máximo y fallos de red", () => {
  it("pide a la función un tiempo máximo (más que los 60 s que espera ella a Replicate)", async () => {
    mocks.invoke.mockResolvedValueOnce(todoBien());
    await quitarFondoRemoto(foto());
    expect(TIMEOUT_REMOTO_MS).toBeGreaterThan(60_000);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "recortar-fondo-vino",
      expect.objectContaining({ timeout: TIMEOUT_REMOTO_MS, body: { imagen: expect.stringMatching(/^data:/) } }),
    );
  });

  it("si se agota el tiempo (AbortError) el error lleva codigo «timeout»", async () => {
    const abort = Object.assign(new Error("Failed to send a request to the Edge Function"), {
      name: "FunctionsFetchError",
      context: new DOMException("The operation was aborted", "AbortError"),
    });
    mocks.invoke.mockResolvedValueOnce({ data: null, error: abort });
    const e = await quitarFondoRemoto(foto()).catch((x) => x);
    expect(e.codigo).toBe("timeout");
    expect(avisoSinFondoCarta(e, true)).toMatch(/^Quitar el fondo ha tardado demasiado/);
  });

  it("sin conexión (FunctionsFetchError que no es un tiempo agotado) → codigo «sin_conexion»", async () => {
    const fetchError = Object.assign(new Error("Failed to send a request to the Edge Function"), {
      name: "FunctionsFetchError",
      context: new TypeError("Load failed"),
    });
    mocks.invoke.mockResolvedValueOnce({ data: null, error: fetchError });
    const e = await quitarFondoRemoto(foto()).catch((x) => x);
    expect(e.codigo).toBe("sin_conexion");
    expect(avisoSinFondoCarta(e, true)).toMatch(/^No se ha podido conectar/);
  });

  it("un error de otro tipo sin cuerpo sigue sin código (aviso genérico)", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error("algo raro") });
    const e = await quitarFondoRemoto(foto()).catch((x) => x);
    expect(e.codigo).toBeUndefined();
  });
});

describe("servicio no configurado: no se vuelve a subir la foto en un rato", () => {
  beforeEach(() => vi.stubGlobal("navigator", nav(IPHONE)));

  it("tras un 503 sin_token, la siguiente foto del móvil falla SIN llamar a la función", async () => {
    mocks.invoke.mockResolvedValueOnce(sinToken());
    const primero = await quitarFondo(foto()).catch((x) => x);
    expect(primero.codigo).toBe("sin_token");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    const segundo = await quitarFondo(foto()).catch((x) => x);
    expect(segundo.codigo).toBe("sin_token");
    expect(mocks.invoke).toHaveBeenCalledTimes(1); // no se ha subido nada más
  });

  it.each(["token_invalido", "sin_saldo"])("también se recuerda %s", async (codigo) => {
    mocks.invoke.mockResolvedValueOnce(errorHttp(503, { ok: false, codigo, error: "x" }));
    await quitarFondo(foto()).catch(() => undefined);
    const otra = await quitarFondo(foto()).catch((x) => x);
    expect(otra.codigo).toBe(codigo);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("pasado el tiempo de recuerdo vuelve a intentarlo", async () => {
    // Solo la fecha: con todos los temporizadores falsos el FileReader de jsdom no termina.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T18:00:00Z"));
    mocks.invoke.mockResolvedValueOnce(sinToken()).mockResolvedValueOnce(todoBien());
    await quitarFondo(foto()).catch(() => undefined);

    vi.setSystemTime(new Date(Date.now() + MS_RECUERDO_SERVICIO + 1000));
    const r = await quitarFondo(foto());
    expect(r.metodo).toBe("replicate");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("«Repetir recorte» (olvidarServicioNoDisponible) fuerza un intento real", async () => {
    mocks.invoke.mockResolvedValueOnce(sinToken()).mockResolvedValueOnce(todoBien());
    await quitarFondo(foto()).catch(() => undefined);
    olvidarServicioNoDisponible();
    const r = await quitarFondo(foto());
    expect(r.metodo).toBe("replicate");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("si una foto que iba en paralelo sí se recorta, el recuerdo de «no configurado» se borra", async () => {
    // Lote: dos fotos salen a la vez; una recibe sin_token y la otra funciona
    // (p. ej. se acaba de poner la clave).
    const respuestas: Array<(r: unknown) => void> = [];
    mocks.invoke.mockImplementation(() => new Promise((ok) => respuestas.push(ok)));
    const a = quitarFondo(foto()).catch((x) => x);
    const b = quitarFondo(foto());
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));

    respuestas[0](sinToken());
    expect((await a).codigo).toBe("sin_token");
    respuestas[1](todoBien());
    expect((await b).metodo).toBe("replicate");

    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValueOnce(todoBien());
    const c = await quitarFondo(foto());
    expect(c.metodo).toBe("replicate");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("los fallos pasajeros (timeout, Replicate caído) NO se recuerdan: la siguiente foto sí lo intenta", async () => {
    mocks.invoke
      .mockResolvedValueOnce(errorHttp(504, { ok: false, codigo: "timeout", error: "x" }))
      .mockResolvedValueOnce(errorHttp(502, { ok: false, codigo: "fallo_replicate", error: "x" }))
      .mockResolvedValueOnce(todoBien());
    await quitarFondo(foto()).catch(() => undefined);
    await quitarFondo(foto()).catch(() => undefined);
    const r = await quitarFondo(foto());
    expect(r.metodo).toBe("replicate");
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
  });

  it("en el ordenador el recorte del navegador sigue yendo primero y no consulta la función", async () => {
    vi.stubGlobal("navigator", nav(ESCRITORIO));
    const r = await quitarFondo(foto());
    expect(r.metodo).toBe("navegador");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("avisoSinFondoCarta: dice el motivo y qué hacer", () => {
  it("servicio sin configurar en el móvil: manda a un ordenador y al botón «Quitar fondo»", () => {
    const aviso = avisoSinFondoCarta({ codigo: "sin_token" }, true);
    expect(aviso).toContain("falta la clave de Replicate en Supabase");
    expect(aviso).toContain("Se guarda la foto normal.");
    expect(aviso).toContain("Desde un ordenador sí se puede");
    expect(aviso).toContain("«Quitar fondo»");
  });

  it("servicio sin configurar en el ordenador: no manda a «otro ordenador»", () => {
    const aviso = avisoSinFondoCarta({ codigo: "sin_token" }, false);
    expect(aviso).not.toContain("Desde un ordenador");
    expect(aviso).toContain("«Repetir recorte»");
  });

  it("token inválido y sin saldo tienen su motivo", () => {
    expect(avisoSinFondoCarta({ codigo: "token_invalido" }, true)).toMatch(/^El servicio de recorte no acepta su clave/);
    expect(avisoSinFondoCarta({ codigo: "sin_saldo" }, true)).toMatch(/^El servicio de recorte no tiene saldo/);
  });

  it("fallos pasajeros: «Repetir recorte» ahora o «Quitar fondo» más tarde", () => {
    for (const codigo of ["timeout", "sin_conexion", "fallo_replicate"]) {
      const aviso = avisoSinFondoCarta({ codigo }, true);
      expect(aviso).toContain("«Repetir recorte»");
      expect(aviso).toContain("«Quitar fondo»");
    }
  });

  it("foto demasiado grande o de formato raro: pide otra foto", () => {
    expect(avisoSinFondoCarta({ codigo: "demasiado_grande" }, true)).toMatch(/demasiado grande.*Prueba con otra foto\.$/);
    expect(avisoSinFondoCarta({ codigo: "imagen_invalida" }, false)).toMatch(/Prueba con otra foto\.$/);
  });

  it("error sin código o desconocido: aviso genérico con consejo", () => {
    for (const e of [undefined, null, new Error("x"), { codigo: "otro" }]) {
      const aviso = avisoSinFondoCarta(e, true);
      expect(aviso).toMatch(/^No se ha podido poner el fondo de carta\. Se guarda la foto normal\./);
      expect(aviso).toContain("«Quitar fondo»");
    }
  });

  it("sin indicar dispositivo decide por el navegador actual (iPhone → móvil)", () => {
    vi.stubGlobal("navigator", nav(IPHONE));
    expect(avisoSinFondoCarta({ codigo: "sin_token" })).toContain("Desde un ordenador sí se puede");
    vi.stubGlobal("navigator", nav(ESCRITORIO));
    expect(avisoSinFondoCarta({ codigo: "sin_token" })).not.toContain("Desde un ordenador");
  });
});
