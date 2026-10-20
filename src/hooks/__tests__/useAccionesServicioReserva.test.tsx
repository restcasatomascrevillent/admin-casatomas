/**
 * Tests para src/hooks/useAccionesServicioReserva.ts
 *
 * Cubre: update optimista + rollback en todas las listas cacheadas, que
 * ninguna acción invoca `notify-reservation-change` (sin correos al
 * cliente), y el reintento sin `llegada_at` cuando la migración no está
 * aplicada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  useAccionesServicioReserva,
  __resetColumnaLlegadaParaTests,
} from "@/hooks/useAccionesServicioReserva";
import { __vaciarEstadosPreviosParaTests } from "@/lib/reservas/estadoPrevio";
import type { ReservaServicio } from "@/lib/reservas/servicioSala";

const reserva: ReservaServicio = {
  id: "r1",
  nombre: "Ana",
  hora: "21:00:00",
  numero_comensales: 4,
  estado: "confirmada",
  espacio_id: null,
};

/**
 * Builder que resuelve cada `await` con la siguiente respuesta de la cola.
 * Sin `data` explícito, una escritura sin error devuelve la fila afectada
 * (lo que da `.select("id")` cuando RLS la deja pasar).
 */
function mockUpdates(respuestas: { error: unknown; data?: unknown }[]) {
  const updates: Record<string, unknown>[] = [];
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const builder: Record<string, unknown> = {
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push({ ...payload });
        return builder;
      }),
      eq: vi.fn(() => builder),
      // La escritura va condicionada al estado de partida (`.in("estado", …)`).
      in: vi.fn(() => builder),
      select: vi.fn(() => builder),
      then: (ok: (v: unknown) => unknown) => {
        const r = respuestas.shift() ?? { error: null };
        const data = "data" in r ? r.data : r.error ? null : [{ id: reserva.id }];
        return Promise.resolve({ data, error: r.error }).then(ok);
      },
    };
    return builder;
  });
  return updates;
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["reservas-kanban", "2026-09-23"], [reserva]);
  queryClient.setQueryData(["reservas-hoy", "2026-09-23"], [reserva]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useAccionesServicioReserva(), { wrapper });
  return { result, queryClient };
}

const kanban = (qc: QueryClient) =>
  qc.getQueryData<ReservaServicio[]>(["reservas-kanban", "2026-09-23"])!;

describe("useAccionesServicioReserva", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetColumnaLlegadaParaTests();
    __vaciarEstadosPreviosParaTests();
  });

  it("mover de espacio: actualiza el Kanban y NO envía correo", async () => {
    const updates = mockUpdates([{ error: null }]);
    const { result, queryClient } = setup();
    let ok = false;
    await act(async () => {
      ok = await result.current.moverEspacio(reserva, "terraza", "Terraza");
    });
    expect(ok).toBe(true);
    expect(updates).toEqual([{ espacio_id: "terraza" }]);
    expect(kanban(queryClient)[0].espacio_id).toBe("terraza");
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it("si el UPDATE falla, restaura el estado previo en todas las cachés y avisa", async () => {
    mockUpdates([{ error: { code: "42501", message: "permission denied" } }]);
    const { result, queryClient } = setup();
    let ok = true;
    await act(async () => {
      ok = await result.current.moverEspacio(reserva, "terraza", "Terraza");
    });
    expect(ok).toBe(false);
    expect(kanban(queryClient)[0].espacio_id).toBeNull();
    expect(queryClient.getQueryData<ReservaServicio[]>(["reservas-hoy", "2026-09-23"])![0].espacio_id).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
  });

  it("si RLS deniega la escritura (0 filas, sin error) NO lo da por hecho: revierte y avisa", async () => {
    mockUpdates([{ error: null, data: [] }]);
    const { result, queryClient } = setup();
    let ok = true;
    await act(async () => {
      ok = await result.current.moverEspacio(reserva, "terraza", "Terraza");
    });
    expect(ok).toBe(false);
    expect(kanban(queryClient)[0].espacio_id).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/no tienes permiso.*o ya no existe/i));
  });

  it("lo mismo al marcar la llegada: 0 filas es un error, no un éxito", async () => {
    mockUpdates([{ error: null, data: [] }]);
    const { result, queryClient } = setup();
    let ok = true;
    await act(async () => {
      ok = await result.current.marcarLlegada(reserva);
    });
    expect(ok).toBe(false);
    expect(kanban(queryClient)[0].estado).toBe("confirmada");
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/registrar la llegada.*no tienes permiso/i));
  });

  it("no mueve reservas canceladas", async () => {
    const updates = mockUpdates([]);
    const { result } = setup();
    await act(async () => {
      await result.current.moverEspacio({ ...reserva, estado: "cancelada" }, "terraza", "Terraza");
    });
    expect(updates).toHaveLength(0);
    expect(toast.error).toHaveBeenCalled();
  });

  it("marcar llegada: estado 'completada' + llegada_at, sin correo", async () => {
    const updates = mockUpdates([{ error: null }]);
    const { result, queryClient } = setup();
    await act(async () => {
      await result.current.marcarLlegada(reserva);
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].estado).toBe("completada");
    expect(typeof updates[0].llegada_at).toBe("string");
    expect(kanban(queryClient)[0].estado).toBe("completada");
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("sin la migración aplicada, reintenta sin llegada_at y lo recuerda", async () => {
    const updates = mockUpdates([
      { error: { code: "PGRST204", message: "Could not find the 'llegada_at' column of 'reservas' in the schema cache" } },
      { error: null },
      { error: null },
    ]);
    const { result } = setup();
    let ok = false;
    await act(async () => {
      ok = await result.current.marcarLlegada(reserva);
    });
    expect(ok).toBe(true);
    expect(updates[0]).toHaveProperty("llegada_at");
    expect(updates[1]).toEqual({ estado: "completada" });

    // Siguiente acción: ya no vuelve a intentar la columna.
    await act(async () => {
      await result.current.deshacerLlegadaONoShow({ ...reserva, estado: "completada" });
    });
    expect(updates[2]).toEqual({ estado: "confirmada" });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("«No vino»: estado 'no_show' y limpia llegada", async () => {
    const updates = mockUpdates([{ error: null }]);
    const { result } = setup();
    await act(async () => {
      await result.current.marcarNoShow(reserva);
    });
    expect(updates[0]).toEqual({ estado: "no_show", llegada_at: null });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});
