/**
 * QA de salida a producción (2026-11-01): `recortar-fondo-vino` respondía 503
 * y el panel solo decía «No se pudo quitar el fondo». El cuerpo del error
 * trae un `codigo`; el aviso tiene que decir el motivo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { avisoSinFondoCarta, quitarFondoRemoto } from "../fotoCartaVino";

/** Lo que devuelve supabase-js ante un 4xx/5xx: FunctionsHttpError con la Response en `context`. */
function errorHttp(status: number, cuerpo: unknown) {
  const context = new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  return { data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context }) };
}

beforeEach(() => vi.clearAllMocks());

describe("quitarFondoRemoto ante un error de la función", () => {
  it("503 sin_token → error con codigo y mensaje del servidor, y aviso claro", async () => {
    mocks.invoke.mockResolvedValueOnce(
      errorHttp(503, { ok: false, codigo: "sin_token", error: "Quitar fondo no está configurado (falta el secreto REPLICATE_API_TOKEN)" }),
    );
    const e = await quitarFondoRemoto(new Blob(["foto"], { type: "image/jpeg" })).catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e.codigo).toBe("sin_token");
    expect(e.message).toContain("REPLICATE_API_TOKEN");
    expect(avisoSinFondoCarta(e)).toBe(
      "Quitar el fondo con Replicate no está activado (falta su clave en Supabase): se guarda la foto normal.",
    );
  });

  it("402 de Replicate (sin_saldo) y token inválido tienen su propio aviso", () => {
    expect(avisoSinFondoCarta({ codigo: "sin_saldo" })).toMatch(/^La cuenta de Replicate no tiene saldo/);
    expect(avisoSinFondoCarta({ codigo: "token_invalido" })).toMatch(/^La clave de Replicate no es válida/);
    expect(avisoSinFondoCarta({ codigo: "demasiado_grande" })).toMatch(/demasiado grande/);
  });

  it("sin cuerpo legible o código desconocido → aviso genérico", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error("Failed to send a request to the Edge Function") });
    const e = await quitarFondoRemoto(new Blob(["foto"], { type: "image/jpeg" })).catch((x) => x);
    expect(e.codigo).toBeUndefined();
    expect(avisoSinFondoCarta(e)).toBe("No se pudo poner el fondo de carta: se guarda la foto normal.");
    expect(avisoSinFondoCarta({ codigo: "otro" })).toBe("No se pudo poner el fondo de carta: se guarda la foto normal.");
  });
});
