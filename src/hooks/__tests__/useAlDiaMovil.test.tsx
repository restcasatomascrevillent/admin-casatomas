// «Hoy» en el móvil con poca cobertura (07/11/2026): el sondeo de respaldo es cada 30 s, no pide nada
// sin red, no cancela la petición que ya está en vuelo y se salta lo que se acaba de leer.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client", () => {
  const canal = { on: () => canal, subscribe: () => canal };
  return { supabase: { channel: () => canal, removeChannel: vi.fn() } };
});

import { FRESCO_MS, SONDEO_MOVIL_MS, refrescarAlDiaMovil, useAlDiaMovil } from "../useAlDiaMovil";

const CLAVE = ["reservas-hoy", "pendientes-mesa", "2026-11-07"];

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pedir = vi.fn(async () => [{ id: "r1" }]);
  // Un observador activo de la clave, como el de `VistaHoy`.
  const envoltorio = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, pedir, envoltorio };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAlDiaMovil", () => {
  it("relee cada 30 s (no cada 15) lo que ya está viejo", async () => {
    const { qc, pedir, envoltorio } = montar();
    const { useQuery } = await import("@tanstack/react-query");
    renderHook(
      () => {
        useQuery({ queryKey: CLAVE, queryFn: pedir, staleTime: Infinity });
        useAlDiaMovil();
      },
      { wrapper: envoltorio },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(pedir).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(pedir).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SONDEO_MOVIL_MS - 15_000);
    expect(pedir).toHaveBeenCalledTimes(2);
    qc.clear();
  });

  it("sin red no pide nada", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { qc, pedir, envoltorio } = montar();
    const { useQuery } = await import("@tanstack/react-query");
    renderHook(
      () => {
        useQuery({ queryKey: CLAVE, queryFn: pedir, staleTime: Infinity, networkMode: "always" });
        useAlDiaMovil();
      },
      { wrapper: envoltorio },
    );
    await vi.advanceTimersByTimeAsync(0);
    const antes = pedir.mock.calls.length;
    await vi.advanceTimersByTimeAsync(SONDEO_MOVIL_MS * 3);
    expect(pedir).toHaveBeenCalledTimes(antes);
    qc.clear();
  });
});

describe("refrescarAlDiaMovil", () => {
  it("no cancela ni repite una petición en vuelo de la misma clave", async () => {
    const { qc } = montar();
    let resolver: (v: unknown) => void = () => {};
    const pedir = vi.fn(() => new Promise((r) => (resolver = r)));
    const observador = qc.getQueryCache().build(qc, { queryKey: CLAVE, queryFn: pedir });
    // Una consulta «activa» (con observador) y ya pidiendo.
    const { QueryObserver } = await import("@tanstack/react-query");
    const obs = new QueryObserver(qc, { queryKey: CLAVE, queryFn: pedir, staleTime: Infinity });
    const quitar = obs.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(pedir).toHaveBeenCalledTimes(1);

    refrescarAlDiaMovil(qc);
    await vi.advanceTimersByTimeAsync(0);
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(observador.state.fetchStatus).toBe("fetching");

    resolver([{ id: "r1" }]);
    quitar();
  });

  it("con `soloViejas` se salta lo leído hace menos de FRESCO_MS", async () => {
    const { qc } = montar();
    const pedir = vi.fn(async () => [{ id: "r1" }]);
    const { QueryObserver } = await import("@tanstack/react-query");
    const obs = new QueryObserver(qc, { queryKey: CLAVE, queryFn: pedir, staleTime: Infinity });
    const quitar = obs.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(pedir).toHaveBeenCalledTimes(1);

    refrescarAlDiaMovil(qc, { soloViejas: true, ahora: Date.now() + FRESCO_MS - 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(pedir).toHaveBeenCalledTimes(1);

    refrescarAlDiaMovil(qc, { soloViejas: true, ahora: Date.now() + FRESCO_MS });
    await vi.advanceTimersByTimeAsync(0);
    expect(pedir).toHaveBeenCalledTimes(2);
    quitar();
  });
});
