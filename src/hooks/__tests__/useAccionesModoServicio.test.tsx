/**
 * Tests para src/hooks/useAccionesModoServicio.ts — liberar/deshacer del
 * modo servicio (Fase 4).
 *
 * Cubre: el UPDATE condicionado (`.is`/`.not`), y que 0 filas afectadas
 * (otra persona ya actualizó la mesa) se trata como aviso, no como error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAccionesModoServicio } from "@/hooks/useAccionesModoServicio";

const reserva = { id: "r1", nombre: "Ana" };

/** Builder encadenable que registra las llamadas de condición y resuelve `select()`. */
function mockUpdate(filas: Array<{ id: string }> | null, error: unknown = null) {
  const llamadas: { payload: Record<string, unknown>; condiciones: unknown[][] } = {
    payload: {},
    condiciones: [],
  };
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const builder: Record<string, unknown> = {
      update: vi.fn((payload: Record<string, unknown>) => {
        llamadas.payload = payload;
        return builder;
      }),
      eq: vi.fn((...args: unknown[]) => {
        llamadas.condiciones.push(["eq", ...args]);
        return builder;
      }),
      is: vi.fn((...args: unknown[]) => {
        llamadas.condiciones.push(["is", ...args]);
        return builder;
      }),
      not: vi.fn((...args: unknown[]) => {
        llamadas.condiciones.push(["not", ...args]);
        return builder;
      }),
      select: vi.fn(() => Promise.resolve({ data: filas, error })),
    };
    return builder;
  });
  return llamadas;
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useAccionesModoServicio(), { wrapper });
  return { result, queryClient };
}

describe("useAccionesModoServicio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("liberarMesa: pone salida_at condicionado a que esté a null, y avisa de éxito", async () => {
    const llamadas = mockUpdate([{ id: "r1" }]);
    const { result } = setup();
    let ok = false;
    await act(async () => {
      ok = await result.current.liberarMesa(reserva);
    });
    expect(ok).toBe(true);
    expect(typeof llamadas.payload.salida_at).toBe("string");
    expect(llamadas.condiciones).toContainEqual(["is", "salida_at", null]);
    expect(toast.success).toHaveBeenCalled();
  });

  it("liberarMesa: 0 filas afectadas (otra persona ya actualizó) -> aviso, no error", async () => {
    mockUpdate([]);
    const { result } = setup();
    let ok = true;
    await act(async () => {
      ok = await result.current.liberarMesa(reserva);
    });
    expect(ok).toBe(false);
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("Otra persona"));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("liberarMesa: error real de Supabase -> toast.error, no warning", async () => {
    mockUpdate(null, { code: "42501", message: "permission denied" });
    const { result } = setup();
    let ok = true;
    await act(async () => {
      ok = await result.current.liberarMesa(reserva);
    });
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("deshacerLiberarMesa: pone salida_at a null condicionado a que NO sea null", async () => {
    const llamadas = mockUpdate([{ id: "r1" }]);
    const { result } = setup();
    let ok = false;
    await act(async () => {
      ok = await result.current.deshacerLiberarMesa(reserva);
    });
    expect(ok).toBe(true);
    expect(llamadas.payload.salida_at).toBeNull();
    expect(llamadas.condiciones).toContainEqual(["not", "salida_at", "is", null]);
  });

  it("deshacerLiberarMesa: 0 filas afectadas -> aviso, no error", async () => {
    mockUpdate([]);
    const { result } = setup();
    let ok = true;
    await act(async () => {
      ok = await result.current.deshacerLiberarMesa(reserva);
    });
    expect(ok).toBe(false);
    expect(toast.warning).toHaveBeenCalled();
  });

  it("liberar y deshacer refrescan el modo servicio, las mesas asignadas, la rejilla de salas y las reservas de «Hoy» (la lista de «salida» de clavesCache), y nada más", async () => {
    mockUpdate([{ id: "r1" }]);
    const { result, queryClient } = setup();
    const invalidadas: string[] = [];
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filtros) => {
      invalidadas.push(String((filtros as { queryKey: unknown[] }).queryKey[0]));
      return Promise.resolve();
    });
    // «reservas-hoy»: la vista «Plano» de «Hoy» pinta la mesa liberada con esa lista (06/10/2026).
    const esperadas = ["reservas-servicio-dia", "asignaciones_mesa", "ocupacion-salas-dia", "reservas-hoy"];

    await act(async () => {
      await result.current.liberarMesa(reserva);
    });
    expect(invalidadas).toEqual(esperadas);

    invalidadas.length = 0;
    await act(async () => {
      await result.current.deshacerLiberarMesa(reserva);
    });
    expect(invalidadas).toEqual(esperadas);
  });

  it("columna salida_at sin migrar: mensaje específico, no el genérico", async () => {
    mockUpdate(null, { code: "PGRST204", message: "Could not find the 'salida_at' column of 'reservas' in the schema cache" });
    const { result } = setup();
    await act(async () => {
      await result.current.liberarMesa(reserva);
    });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("falta aplicar la migración"));
  });
});
