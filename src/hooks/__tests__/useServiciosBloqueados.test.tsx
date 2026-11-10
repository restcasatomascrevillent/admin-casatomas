/**
 * `useServiciosBloqueados`: lee, bloquea (INSERT) y desbloquea (DELETE) comida/cena de un día.
 * Nada llega a Supabase: el cliente y `sonner` están mockeados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const llamadas: Array<{ op: string; payload?: unknown; eq?: Array<[string, unknown]> }> = [];
let filas: Array<{ turno: string }> = [];
let errorLectura: unknown = null;
let errorEscritura: { code?: string } | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      expect(tabla).toBe("servicios_bloqueados");
      return {
        select: () => ({
          eq: async () => ({ data: errorLectura ? null : filas, error: errorLectura }),
        }),
        insert: async (payload: unknown) => {
          llamadas.push({ op: "insert", payload });
          return { error: errorEscritura };
        },
        delete: () => {
          const eq: Array<[string, unknown]> = [];
          const cadena = {
            eq: (c: string, v: unknown) => {
              eq.push([c, v]);
              if (eq.length === 2) {
                llamadas.push({ op: "delete", eq });
                return Promise.resolve({ error: errorEscritura });
              }
              return cadena;
            },
          };
          return cadena;
        },
      };
    },
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useUsuarioIdOpcional: () => "usuario-1" }));

import { toast } from "sonner";
import { useServiciosBloqueados } from "@/hooks/useServiciosBloqueados";

function envoltorio() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  llamadas.length = 0;
  filas = [];
  errorLectura = null;
  errorEscritura = null;
  vi.clearAllMocks();
});

describe("useServiciosBloqueados", () => {
  it("lee los turnos bloqueados del día", async () => {
    filas = [{ turno: "cena" }];
    const { result } = renderHook(() => useServiciosBloqueados("2026-11-10"), { wrapper: envoltorio() });
    await waitFor(() => expect(result.current.disponible).toBe(true));
    expect(result.current.estaBloqueado("cena")).toBe(true);
    expect(result.current.estaBloqueado("comida")).toBe(false);
  });

  it("bloquear inserta (fecha, turno, created_by)", async () => {
    const { result } = renderHook(() => useServiciosBloqueados("2026-11-10"), { wrapper: envoltorio() });
    await waitFor(() => expect(result.current.disponible).toBe(true));
    act(() => result.current.cambiar("comida", true));
    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]).toEqual({ op: "insert", payload: { fecha: "2026-11-10", turno: "comida", created_by: "usuario-1" } });
  });

  it("desbloquear borra la fila de ese día y turno", async () => {
    filas = [{ turno: "cena" }];
    const { result } = renderHook(() => useServiciosBloqueados("2026-11-10"), { wrapper: envoltorio() });
    await waitFor(() => expect(result.current.estaBloqueado("cena")).toBe(true));
    act(() => result.current.cambiar("cena", false));
    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]).toEqual({ op: "delete", eq: [["fecha", "2026-11-10"], ["turno", "cena"]] });
  });

  it("si falla el guardado, avisa y deja el interruptor como estaba", async () => {
    errorEscritura = { code: "42501" };
    const { result } = renderHook(() => useServiciosBloqueados("2026-11-10"), { wrapper: envoltorio() });
    await waitFor(() => expect(result.current.disponible).toBe(true));
    act(() => result.current.cambiar("comida", true));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(result.current.estaBloqueado("comida")).toBe(false));
  });

  it("sin la tabla (migración sin aplicar) no rompe: disponible = false", async () => {
    errorLectura = { code: "42P01" };
    const { result } = renderHook(() => useServiciosBloqueados("2026-11-10"), { wrapper: envoltorio() });
    await waitFor(() => expect(result.current.disponible).toBe(false));
    await act(async () => {});
    expect(result.current.estaBloqueado("comida")).toBe(false);
  });
});
