/**
 * CAS-9 (17/11/2026, petición del dueño: «tenemos que darle a los dos botones para que se quite»): responder a una
 * reserva nueva (verificarla o rechazarla) desde cualquier sitio da por revisado su aviso «Reserva nueva». Otras
 * acciones (confirmar, llegada…) no tocan los avisos.
 */
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
const avisos = vi.hoisted(() => ({ marcar: vi.fn(async (_id: string) => 1) }));
vi.mock("@/lib/avisosRevisados", async (original) => ({
  ...(await original<typeof import("@/lib/avisosRevisados")>()),
  marcarAvisosDeReserva: avisos.marcar,
}));
const atendida = vi.hoisted(() => ({ avisar: vi.fn() }));
vi.mock("@/hooks/useAvisosSeccion", async (original) => ({
  ...(await original<typeof import("@/hooks/useAvisosSeccion")>()),
  avisarReservaAtendida: atendida.avisar,
}));

import { supabase } from "@/integrations/supabase/client";
import * as clienteMock from "@/integrations/supabase/client";
import { useAccionesServicioReserva, __resetColumnaLlegadaParaTests } from "@/hooks/useAccionesServicioReserva";
import { __vaciarEstadosPreviosParaTests } from "@/lib/reservas/estadoPrevio";
import type { ReservaParaVerificar } from "@/lib/reservas/verificacion";

const { resetSupabaseMocks } = clienteMock as unknown as { resetSupabaseMocks: () => void };

const reserva = (extra: Partial<ReservaParaVerificar> = {}): ReservaParaVerificar => ({
  id: "res-1", nombre: "Ana", telefono: null, email: "ana@x.test", fecha: "2026-12-01", hora: "21:00:00",
  numero_comensales: 2, estado: "pendiente", notas_cliente: null, espacio_id: null, ...extra,
});

/** Toda escritura sale bien y devuelve la fila de esa reserva. */
function escriturasOk() {
  vi.mocked(supabase.from).mockImplementation((() => {
    let id: unknown = null;
    const b: Record<string, unknown> = {
      update: vi.fn(() => b), select: vi.fn(() => b), in: vi.fn(() => b),
      eq: vi.fn((_c: string, v: unknown) => { id = v; return b; }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [{ id }], error: null }).then(ok),
    };
    return b;
  }) as never);
}

function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(() => useAccionesServicioReserva(), { wrapper }).result;
}

beforeEach(() => {
  resetSupabaseMocks();
  vi.mocked(supabase.functions.invoke).mockReset().mockResolvedValue({ data: null, error: null } as never);
  __resetColumnaLlegadaParaTests();
  __vaciarEstadosPreviosParaTests();
  avisos.marcar.mockClear().mockResolvedValue(1);
  atendida.avisar.mockClear();
  escriturasOk();
});

describe("el aviso «Reserva nueva» se atiende al responder a la reserva", () => {
  it("verificar (un clic) marca su aviso como revisado y avisa a la lista de avisos abierta", async () => {
    const result = montar();
    await act(async () => { await result.current.aceptar(reserva()); });
    expect(avisos.marcar).toHaveBeenCalledWith("res-1");
    await waitFor(() => expect(atendida.avisar).toHaveBeenCalledWith("res-1"));
  });

  it("rechazar también lo da por atendido", async () => {
    const result = montar();
    await act(async () => { await result.current.rechazar(reserva()); });
    expect(avisos.marcar).toHaveBeenCalledWith("res-1");
  });

  it("si no había aviso sin revisar, no avisa a nadie", async () => {
    avisos.marcar.mockResolvedValue(0);
    const result = montar();
    await act(async () => { await result.current.aceptar(reserva()); });
    expect(avisos.marcar).toHaveBeenCalled();
    expect(atendida.avisar).not.toHaveBeenCalled();
  });

  it("confirmar una reserva ya verificada no toca los avisos", async () => {
    const result = montar();
    await act(async () => { await result.current.confirmar(reserva({ estado: "verificada" })); });
    expect(avisos.marcar).not.toHaveBeenCalled();
  });

  it("si la verificación no se guarda, el aviso no se toca", async () => {
    vi.mocked(supabase.from).mockImplementation((() => {
      const b: Record<string, unknown> = {
        update: vi.fn(() => b), select: vi.fn(() => b), in: vi.fn(() => b), eq: vi.fn(() => b),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "42501", message: "permiso" } }).then(ok),
      };
      return b;
    }) as never);
    const result = montar();
    await act(async () => { await result.current.aceptar(reserva()); });
    expect(avisos.marcar).not.toHaveBeenCalled();
  });
});
