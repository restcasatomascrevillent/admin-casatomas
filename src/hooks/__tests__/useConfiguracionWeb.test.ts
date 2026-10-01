/**
 * Tests de `useConfiguracionWeb` (interruptores «Fotos de platos» por web).
 *
 * Cubre lo que no se ve a simple vista:
 *   - Tabla sin crear (migración 20261001113700 sin aplicar): `noDisponible`,
 *     sin lanzar, y fotos visibles por defecto (lo mismo que hacen las webs).
 *   - Guardar escribe SOLO la columna de esa web y pide republicar.
 *   - UPDATE sin filas (RLS: sin la sección gestor_carta) es un error, no un
 *     «guardado»: se revierte el cambio optimista y no se republica.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));
vi.mock("@/lib/rebuild-webs", () => ({ notificarGuardadoYPublicacion: vi.fn() }));

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";
import { useConfiguracionWeb } from "@/hooks/useConfiguracionWeb";

const FILA = {
  id: true,
  mostrar_fotos_platos_casa_tomas: true,
  mostrar_fotos_platos_touza: true,
  updated_at: "2026-10-01T10:00:00Z",
  updated_by: null,
};

interface Respuesta {
  data: unknown;
  error: unknown;
}

/** Builder encadenable: `select` → lectura, `update` → escritura. */
function mockSupabase(lectura: Respuesta, escritura?: Respuesta) {
  const updates: unknown[] = [];
  vi.mocked(supabase.from).mockImplementation(() => {
    let modo: "select" | "update" = "select";
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.update = vi.fn((valores: unknown) => {
      modo = "update";
      updates.push(valores);
      return chain;
    });
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => (modo === "update" ? escritura : lectura));
    return chain as never;
  });
  return { updates };
}

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
}

describe("useConfiguracionWeb", () => {
  beforeEach(() => vi.clearAllMocks());

  it("con la tabla sin crear devuelve noDisponible y fotos visibles, sin error", async () => {
    mockSupabase({
      data: null,
      error: { code: "PGRST205", message: "Could not find the table 'public.configuracion_web' in the schema cache" },
    });
    const { result } = renderHook(() => useConfiguracionWeb(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.noDisponible).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.mostrarFotosPlatos).toEqual({ casa_tomas: true, touza: true });
  });

  it("lee los dos interruptores de la fila única", async () => {
    mockSupabase({ data: { ...FILA, mostrar_fotos_platos_touza: false }, error: null });
    const { result } = renderHook(() => useConfiguracionWeb(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.noDisponible).toBe(false);
    expect(result.current.mostrarFotosPlatos).toEqual({ casa_tomas: true, touza: false });
  });

  it("al apagar Casa Tomás escribe solo su columna y pide republicar las webs", async () => {
    const { updates } = mockSupabase(
      { data: FILA, error: null },
      { data: { ...FILA, mostrar_fotos_platos_casa_tomas: false }, error: null },
    );
    const { result } = renderHook(() => useConfiguracionWeb(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.cambiarFotosPlatos.mutateAsync({ web: "casa_tomas", mostrar: false });
    });

    expect(updates).toEqual([{ mostrar_fotos_platos_casa_tomas: false }]);
    expect(notificarGuardadoYPublicacion).toHaveBeenCalledWith(
      "plato",
      "Fotos de platos desactivadas en Casa Tomás",
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("un UPDATE sin filas (sin permiso) es un error: revierte y no republica", async () => {
    mockSupabase({ data: FILA, error: null }, { data: null, error: null });
    const { result } = renderHook(() => useConfiguracionWeb(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.cambiarFotosPlatos.mutateAsync({ web: "touza", mostrar: false }).catch(() => undefined);
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(notificarGuardadoYPublicacion).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.mostrarFotosPlatos.touza).toBe(true));
  });
});
