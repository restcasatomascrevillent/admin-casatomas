/**
 * QA de salida a producción (2026-11-01): `recortar-fondo-vino` respondía 503
 * y el panel solo decía «No se pudo quitar el fondo». El cuerpo del error
 * trae un `codigo`; el aviso tiene que decir el motivo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { avisoSinFondoCarta, olvidarServicioNoDisponible, quitarFondoRemoto } from "../fotoCartaVino";

/** Lo que devuelve supabase-js ante un 4xx/5xx: FunctionsHttpError con la Response en `context`. */
function errorHttp(status: number, cuerpo: unknown) {
  const context = new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  return { data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  olvidarServicioNoDisponible();
});

describe("quitarFondoRemoto ante un error de la función", () => {
  it("503 sin_token → error con codigo y mensaje del servidor, y aviso claro", async () => {
    mocks.invoke.mockResolvedValueOnce(
      errorHttp(503, { ok: false, codigo: "sin_token", error: "Quitar fondo no está configurado (falta el secreto REPLICATE_API_TOKEN)" }),
    );
    const e = await quitarFondoRemoto(new Blob(["foto"], { type: "image/jpeg" })).catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e.codigo).toBe("sin_token");
    expect(e.message).toContain("REPLICATE_API_TOKEN");
    expect(avisoSinFondoCarta(e, true)).toBe(
      "El servicio de recorte no está activado (falta la clave de Replicate en Supabase). Se guarda la foto normal. " +
        "Desde un ordenador sí se puede: abre la ficha y pulsa «Quitar fondo».",
    );
  });

  it("402 de Replicate (sin_saldo) y token inválido tienen su propio aviso", () => {
    expect(avisoSinFondoCarta({ codigo: "sin_saldo" }, true)).toMatch(/^El servicio de recorte no tiene saldo/);
    expect(avisoSinFondoCarta({ codigo: "token_invalido" }, true)).toMatch(/^El servicio de recorte no acepta su clave/);
    expect(avisoSinFondoCarta({ codigo: "demasiado_grande" }, true)).toMatch(/demasiado grande/);
  });

  it("sin cuerpo legible o código desconocido → aviso genérico", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error("Failed to send a request to the Edge Function") });
    const e = await quitarFondoRemoto(new Blob(["foto"], { type: "image/jpeg" })).catch((x) => x);
    expect(e.codigo).toBeUndefined();
    const generico =
      "No se ha podido poner el fondo de carta. Se guarda la foto normal. " +
      "Pulsa «Repetir recorte» o, más tarde, abre la ficha y pulsa «Quitar fondo».";
    expect(avisoSinFondoCarta(e, true)).toBe(generico);
    expect(avisoSinFondoCarta({ codigo: "otro" }, true)).toBe(generico);
  });
});
