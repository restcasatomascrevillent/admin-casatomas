/**
 * Publicación de un vino por carta (04/11/2026): «Restaurante» y «Touza» son
 * los únicos interruptores; `activado` = restaurante OR touza. Sin origen claro
 * no se enciende ninguna carta ni se da de alta un vino.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const mock = vi.hoisted(() => ({
  filas: [] as Record<string, unknown>[],
  update: vi.fn(),
  insert: vi.fn(),
  invoke: vi.fn(),
  errorUpdate: null as null | { message: string; code?: string },
  toastError: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    from: () => {
      const query = {
        select: () => query,
        order: () => Promise.resolve({ data: mock.filas, error: null }),
        update: (cambios: unknown) => {
          mock.update(cambios);
          return { eq: (_c: string, id: string) => Promise.resolve({ error: mock.errorUpdate, id }) };
        },
        insert: (rows: unknown[]) => {
          mock.insert(rows);
          return query;
        },
        single: () => Promise.resolve({ data: { id: "nuevo" }, error: null }),
      };
      return query;
    },
  },
}));
vi.mock("sonner", () => ({ toast: { error: mock.toastError, warning: vi.fn() } }));
vi.mock("@/lib/rebuild-webs", () => ({ notificarGuardadoYPublicacion: vi.fn() }));

import { useVinos } from "@/hooks/useVinos";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useVinos(), { wrapper });
}

const fila = (p: Record<string, unknown>) => ({
  id: "v1", nombre: "Pomal", categoria: "VINOS TINTOS — RIOJA", ubicacion_pais: "España", ubicacion_region: "Haro, La Rioja",
  activado: false, restaurante: false, touza: false, orden: 1, ...p,
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.errorUpdate = null;
  mock.filas = [];
  mock.invoke.mockResolvedValue({ data: { ok: true, translations: {} }, error: null });
});

describe("Interruptores de carta", () => {
  it("ya no hay «toggleActivado»: solo Restaurante y Touza", async () => {
    const { result } = montar();
    expect("toggleActivado" in result.current).toBe(false);
    expect(result.current.toggleRestaurante).toBeDefined();
    expect(result.current.toggleTouza).toBeDefined();
  });

  it("guarda las dos cartas y activado = restaurante OR touza", async () => {
    mock.filas = [fila({})];
    const { result } = montar();
    await waitFor(() => expect(result.current.vinos).toHaveLength(1));

    await act(async () => { await result.current.toggleRestaurante.mutateAsync({ id: "v1", restaurante: true, touza: false }); });
    expect(mock.update).toHaveBeenLastCalledWith({ restaurante: true, touza: false, activado: true });
    await waitFor(() => expect(notificarGuardadoYPublicacion).toHaveBeenCalledWith("vino", "Publicado en la carta de Casa Tomás"));

    await act(async () => { await result.current.toggleTouza.mutateAsync({ id: "v1", touza: false, restaurante: false }); });
    expect(mock.update).toHaveBeenLastCalledWith({ restaurante: false, touza: false, activado: false });
    await waitFor(() => expect(notificarGuardadoYPublicacion).toHaveBeenCalledWith("vino", "Quitado de la carta de Touza"));
  });

  it("sin origen claro no enciende ninguna carta (ni llama a la BD), pero sí apaga", async () => {
    mock.filas = [
      fila({ id: "pend", nombre: "Burbujas", categoria: "VINOS ESPUMOSOS — ORIGEN PENDIENTE" }),
      fila({ id: "sinpais", nombre: "Antiguo", ubicacion_pais: null, restaurante: true, activado: true }),
    ];
    const { result } = montar();
    await waitFor(() => expect(result.current.vinos).toHaveLength(2));

    await act(async () => {
      await expect(result.current.toggleTouza.mutateAsync({ id: "pend", touza: true, restaurante: false })).rejects.toThrow(
        "«Burbujas» no se puede publicar sin origen. Falta la categoría con su denominación",
      );
    });
    await act(async () => {
      await expect(result.current.toggleRestaurante.mutateAsync({ id: "sinpais", restaurante: true, touza: true })).rejects.toThrow(/Falta el país/);
    });
    expect(mock.update).not.toHaveBeenCalled();
    // El aviso dice qué falta, no un «Error» genérico.
    await waitFor(() => expect(mock.toastError).toHaveBeenCalledWith(expect.stringMatching(/^«Burbujas» no se puede publicar sin origen/)));

    await act(async () => { await result.current.toggleRestaurante.mutateAsync({ id: "sinpais", restaurante: false, touza: false }); });
    expect(mock.update).toHaveBeenCalledWith({ restaurante: false, touza: false, activado: false });
  });

  it("el error del trigger de la BD (origen) llega tal cual al aviso", async () => {
    mock.filas = [fila({})];
    mock.errorUpdate = {
      code: "23514",
      message: "El vino «Pomal» no tiene la denominación de origen confirmada: cámbiale la categoría antes de publicarlo.",
    };
    const { result } = montar();
    await waitFor(() => expect(result.current.vinos).toHaveLength(1));
    await act(async () => {
      await result.current.toggleRestaurante.mutateAsync({ id: "v1", restaurante: true, touza: false }).catch(() => {});
    });
    expect(mock.toastError).toHaveBeenCalledWith(mock.errorUpdate.message);
  });
});

describe("Alta de vino con origen claro", () => {
  it("no da de alta un vino de categoría «ORIGEN PENDIENTE»", async () => {
    const { result } = montar();
    await act(async () => {
      await expect(
        result.current.crearVino.mutateAsync({
          nombre: "Nuevo", categoria: "VINOS TINTOS — ORIGEN PENDIENTE", precio_eur: 20, ubicacion_pais: "España", ubicacion_region: "Toro",
        }),
      ).rejects.toThrow(/una «… — ORIGEN PENDIENTE» no vale/);
    });
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("el alta sale publicada en las dos cartas", async () => {
    const { result } = montar();
    await act(async () => {
      await result.current.crearVino.mutateAsync({
        nombre: "Nuevo", categoria: "VINOS TINTOS — TORO", precio_eur: 20, ubicacion_pais: "España", ubicacion_region: "Toro, Zamora",
      });
    });
    expect(mock.insert).toHaveBeenCalledWith([expect.objectContaining({ restaurante: true, touza: true, activado: true })]);
  });
});
