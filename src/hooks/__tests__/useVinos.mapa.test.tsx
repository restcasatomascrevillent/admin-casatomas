import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const mock = vi.hoisted(() => ({ insert: vi.fn(), invoke: vi.fn(), filas: [] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: mock.invoke },
  from: () => {
    const query = {
      select: () => query, order: () => Promise.resolve({ data: mock.filas, error: null }),
      insert: (rows: unknown[]) => { mock.insert(rows); return query; },
      single: () => Promise.resolve({ data: { id: "nuevo" }, error: null }),
    };
    return query;
  },
} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/rebuild-webs", () => ({ notificarGuardadoYPublicacion: vi.fn() }));

import { useVinos } from "@/hooks/useVinos";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

describe("Alta de vino visible en carta y mapa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.invoke.mockResolvedValue({ data: { ok: true, translations: { nombre_en: "New wine" } }, error: null });
  });
  it("guarda país y región y publica el vino en el restaurante", async () => {
    const { result } = renderHook(() => useVinos(), { wrapper: wrapper() });
    await act(async () => { await result.current.crearVino.mutateAsync({ nombre: "Nuevo vino", categoria: "TINTOS", precio_eur: 20, ubicacion_pais: " España ", ubicacion_region: " La Rioja " }); });
    expect(mock.insert).toHaveBeenCalledWith([expect.objectContaining({ restaurante: true, activado: true, ubicacion_pais: "España", ubicacion_region: "La Rioja" })]);
    await waitFor(() => expect(notificarGuardadoYPublicacion).toHaveBeenCalledWith("vino", "Vino añadido"));
  });
  it("impide añadir un vino sin los datos necesarios para el mapa", async () => {
    const { result } = renderHook(() => useVinos(), { wrapper: wrapper() });
    await act(async () => { await expect(result.current.crearVino.mutateAsync({ nombre: "Nuevo vino", categoria: "TINTOS", precio_eur: 20, ubicacion_pais: "España", ubicacion_region: "  " })).rejects.toThrow("país y la región"); });
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
});
