/**
 * Interruptores de Control del Panel (14/11/2026): lectura compartida entre menú, rutas y Control del Panel,
 * y RRSS / Subir albaranes con interruptor propio que empieza con el valor de Newsletter / Facturas.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  filas: [] as Array<{ section_key: string; label: string; enabled: boolean; updated_at?: string | null }>,
  falloLectura: false,
  lecturas: 0,
  upsert: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "super-1" } } })) },
    from: vi.fn(() => ({
      select: () => ({
        order: async () => {
          h.lecturas += 1;
          return h.falloLectura ? { data: null, error: { message: "sin red" } } : { data: h.filas, error: null };
        },
      }),
      upsert: (...args: unknown[]) => h.upsert(...args),
    })),
  },
}));

import { useAdminFeatureToggles } from "@/hooks/useAdminFeatureToggles";
import { precargarFeatureToggles, reiniciarTogglesParaPruebas } from "@/lib/precargaToggles";

beforeEach(() => {
  reiniciarTogglesParaPruebas();
  h.filas = [
    { section_key: "marketing", label: "Newsletter", enabled: false },
    { section_key: "facturas", label: "Facturas", enabled: true },
  ];
  h.falloLectura = false;
  h.lecturas = 0;
  h.upsert.mockReset().mockResolvedValue({ error: null });
});

describe("useAdminFeatureToggles", () => {
  it("sin fila, activado; RRSS sin fila vale lo que Newsletter (apagado aquí: sigue oculto)", async () => {
    const { result } = renderHook(() => useAdminFeatureToggles());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isEnabled("reservas")).toBe(true);
    expect(result.current.isEnabled("peticiones")).toBe(true);
    expect(result.current.isEnabled("marketing")).toBe(false);
    expect(result.current.isEnabled("rrss")).toBe(false);
    expect(result.current.isEnabled("albaranes")).toBe(true);
  });

  it("una sola lectura para todos (menú, rutas…) y todos ven el cambio al guardar", async () => {
    const menu = renderHook(() => useAdminFeatureToggles());
    const ruta = renderHook(() => useAdminFeatureToggles());
    await waitFor(() => expect(ruta.result.current.loading).toBe(false));
    expect(h.lecturas).toBe(1);

    await act(async () => {
      await menu.result.current.setEnabled("reservas", "Reservas", false);
    });
    expect(h.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ section_key: "reservas", label: "Reservas", enabled: false, updated_by: "super-1" })],
      { onConflict: "section_key" },
    );
    expect(menu.result.current.isEnabled("reservas")).toBe(false);
    expect(ruta.result.current.isEnabled("reservas")).toBe(false);
  });

  it("al cambiar Newsletter, RRSS (sin fila) guarda antes su valor de ahora para no cambiar con él", async () => {
    const { result } = renderHook(() => useAdminFeatureToggles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.setEnabled("marketing", "Newsletter", true);
    });
    expect(h.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({ section_key: "marketing", enabled: true }),
        expect.objectContaining({ section_key: "rrss", label: "RRSS", enabled: false, updated_at: null }),
      ],
      { onConflict: "section_key" },
    );
    expect(result.current.isEnabled("marketing")).toBe(true);
    expect(result.current.isEnabled("rrss")).toBe(false);

    // Con fila propia, cambiar Newsletter ya no toca RRSS.
    h.upsert.mockClear();
    await act(async () => {
      await result.current.setEnabled("marketing", "Newsletter", false);
    });
    expect(h.upsert.mock.calls[0][0]).toHaveLength(1);
  });

  it("igual con Facturas y Subir albaranes", async () => {
    const { result } = renderHook(() => useAdminFeatureToggles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.setEnabled("facturas", "Facturas", false);
    });
    expect(h.upsert.mock.calls[0][0]).toEqual([
      expect.objectContaining({ section_key: "facturas", enabled: false }),
      expect.objectContaining({ section_key: "albaranes", label: "Subir albaranes", enabled: true }),
    ]);
    expect(result.current.isEnabled("albaranes")).toBe(true);
  });

  it("si guardar falla, no cambia nada", async () => {
    h.upsert.mockResolvedValue({ error: { message: "permission denied" } });
    const { result } = renderHook(() => useAdminFeatureToggles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok = true;
    await act(async () => {
      ok = await result.current.setEnabled("reservas", "Reservas", false);
    });
    expect(ok).toBe(false);
    expect(result.current.isEnabled("reservas")).toBe(true);
  });

  it("si la lectura falla, todo sigue activado (un corte no esconde secciones)", async () => {
    h.falloLectura = true;
    const { result } = renderHook(() => useAdminFeatureToggles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isEnabled("marketing")).toBe(true);
    expect(result.current.isEnabled("rrss")).toBe(true);
  });

  it("al entrar otro usuario (precarga) vuelve a leer, y refetch también", async () => {
    const { result } = renderHook(() => useAdminFeatureToggles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    h.filas = [{ section_key: "reservas", label: "Reservas", enabled: false }];
    act(() => precargarFeatureToggles());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.isEnabled("reservas")).toBe(false));
    expect(result.current.loading).toBe(false);
    h.filas = [];
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.isEnabled("reservas")).toBe(true);
    expect(h.lecturas).toBe(3);
  });
});
