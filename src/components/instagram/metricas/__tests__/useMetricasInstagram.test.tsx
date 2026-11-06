import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt-de-prueba" } } }) } },
}));

import { capturarMetricas, ErrorMetricas, leerMetricas, URL_METRICAS } from "../api";
import { debeReintentar, useMetricasInstagram, type ApiMetricas } from "../useMetricasInstagram";
import type { DatosMetricas } from "../tipos";

const VACIO: DatosMetricas = {
  igUserId: "1",
  hoy: "2026-11-05",
  ultimoDia: null,
  resumen: null,
  serie: [],
  publicaciones: [],
  ultimaCaptura: null,
  ultimaCorrecta: null,
};

function envoltorio() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const json = (estado: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

describe("api de métricas", () => {
  it("leer: GET con apikey y el JWT; capturar: POST {accion:'capturar'}", async () => {
    const f = vi.fn(async () => json(200, { ok: true, ...VACIO }));
    await leerMetricas({ fetch: f as unknown as typeof fetch });
    await capturarMetricas({ fetch: f as unknown as typeof fetch });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_METRICAS);
    expect(url).toMatch(/\/functions\/v1\/instagram-metricas$/);
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-de-prueba");
    expect((init.headers as Record<string, string>).apikey).toBeTruthy();
    const [, init2] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(init2.method).toBe("POST");
    expect(JSON.parse(String(init2.body))).toEqual({ accion: "capturar" });
  });

  it("traduce los errores: permiso de Meta, secretos, 429, 403 y función sin desplegar", async () => {
    const con = (estado: number, cuerpo: unknown) => capturarMetricas({ fetch: (async () => json(estado, cuerpo)) as typeof fetch }).catch((e) => e);
    const permiso = await con(502, { ok: false, tipo: "permiso_insights", error: "Falta instagram_manage_insights", comoArreglarlo: "Usuarios del sistema…" });
    expect(permiso).toBeInstanceOf(ErrorMetricas);
    expect(permiso).toMatchObject({ tipo: "permiso_insights", comoArreglarlo: ["Usuarios del sistema…"] });
    expect(await con(503, { tipo: "configuracion", error: "x", comoArreglarlo: ["a", "b"] })).toMatchObject({ tipo: "configuracion", comoArreglarlo: ["a", "b"] });
    expect(await con(429, { tipo: "demasiado_pronto", error: "espera", reintentarEn: 120 })).toMatchObject({ tipo: "demasiado_pronto", reintentarEn: 120 });
    expect(await con(403, { error: "Sin permiso para editar Marketing" })).toMatchObject({ tipo: "sin_permiso" });
    expect(await con(404, { message: "Requested function was not found" })).toMatchObject({ tipo: "no_desplegada" });
    const red = await leerMetricas({ fetch: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch }).catch((e) => e);
    expect(red).toMatchObject({ tipo: "red" });
    expect(await leerMetricas({ token: null }).catch((e) => e)).toMatchObject({ tipo: "sesion" });
  });
});

describe("useMetricasInstagram", () => {
  it("no reintenta errores que no se arreglan solos", () => {
    expect(debeReintentar(0, new ErrorMetricas("x", "permiso_insights"))).toBe(false);
    expect(debeReintentar(0, new ErrorMetricas("x", "sin_permiso"))).toBe(false);
    expect(debeReintentar(0, new ErrorMetricas("x", "servidor"))).toBe(true);
    expect(debeReintentar(2, new Error("x"))).toBe(false);
  });

  it("lee, captura y vuelve a leer al terminar (también si la captura falla)", async () => {
    const api: ApiMetricas = {
      leer: vi.fn(async () => VACIO),
      capturar: vi.fn(async () => ({ fechaCaptura: "2026-11-05", dias: ["2026-11-04"], publicaciones: 2, avisos: [] })),
    };
    const { result } = renderHook(() => useMetricasInstagram(api), { wrapper: envoltorio() });
    await waitFor(() => expect(result.current.datos).toEqual(VACIO));
    expect(api.leer).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.capturarAsync();
    });
    await waitFor(() => expect(result.current.resultadoCaptura).toMatchObject({ publicaciones: 2 }));
    await waitFor(() => expect(api.leer).toHaveBeenCalledTimes(2));

    (api.capturar as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ErrorMetricas("Falta el permiso", "permiso_insights", 502));
    await act(async () => {
      await result.current.capturarAsync().catch(() => {});
    });
    await waitFor(() => expect(result.current.errorCaptura).toBeInstanceOf(ErrorMetricas));
    await waitFor(() => expect(api.leer).toHaveBeenCalledTimes(3));
  });

  it("expone el error de lectura", async () => {
    const api: ApiMetricas = { leer: vi.fn(async () => { throw new ErrorMetricas("Sin permiso de Marketing", "sin_permiso", 403); }), capturar: vi.fn() };
    const { result } = renderHook(() => useMetricasInstagram(api), { wrapper: envoltorio() });
    await waitFor(() => expect(result.current.error?.message).toBe("Sin permiso de Marketing"));
    expect(result.current.cargando).toBe(false);
  });
});
