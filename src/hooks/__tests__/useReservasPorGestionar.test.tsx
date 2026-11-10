import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const llamadas: string[] = [];
const datos: Record<string, unknown[]> = {
  reservas: [{ id: "r1", nombre: "Ana", fecha: "2999-01-01", hora: "21:00:00", numero_comensales: 4, estado: "pendiente", marca: "casa_tomas" }],
  solicitudes_pendientes: [{ id: "s1", nombre: "Luis", fecha_solicitada: null, hora_solicitada: null, numero_comensales: 9, motivo_rechazo: "grupo_grande", estado: "pendiente", marca: "casa_tomas" }],
};
const canalDoble = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn(() => canalDoble),
    removeChannel: vi.fn(),
    from: vi.fn((tabla: string) => {
      llamadas.push(tabla);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "in", "gte", "order"]) q[m] = vi.fn(() => q);
      q.limit = vi.fn(() => Promise.resolve({ data: datos[tabla], error: null }));
      return q;
    }),
  },
}));

import { useReservasPorGestionar } from "@/hooks/useReservasPorGestionar";
import { supabase } from "@/integrations/supabase/client";

const envoltorio = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  llamadas.length = 0;
  vi.clearAllMocks();
});

describe("useReservasPorGestionar", () => {
  it("con permiso junta reservas y solicitudes y abre canales realtime", async () => {
    const { result } = renderHook(() => useReservasPorGestionar(true), { wrapper: envoltorio });
    await waitFor(() => expect(result.current.count).toBe(2));
    expect(llamadas.sort()).toEqual(["reservas", "solicitudes_pendientes"]);
    expect(supabase.channel).toHaveBeenCalled();
  });

  it("sin permiso no pide nada ni abre canales", async () => {
    const { result } = renderHook(() => useReservasPorGestionar(false), { wrapper: envoltorio });
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.count).toBe(0);
    expect(llamadas).toEqual([]);
    expect(supabase.channel).not.toHaveBeenCalled();
  });
});
