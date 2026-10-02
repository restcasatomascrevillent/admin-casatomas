/**
 * Casos cruzados de realtime que no se ven con una sola lectura o un solo evento (nacieron como
 * sondas de la revisión de 2026-10-02; cada uno caza una mutación que la batería anterior dejaba
 * pasar):
 *   · campana: con dos lecturas cruzadas, la vieja responde, llega un INSERT y la nueva (hecha
 *     antes del INSERT) no lo trae: no se pierde;
 *   · solicitudes: un aviso que llega DURANTE la relectura apuntada deja otra relectura;
 *   · solicitudes: la carga del montaje que responde TARDE no pisa la que pidió una acción;
 *   · rejilla de salas: al cambiar de día quita el canal viejo y abre otro con el filtro nuevo;
 *   · rejilla de salas: una ráfaga de 20 cambios = 1 invalidación (antes, 20);
 *   · campana: tiene su sondeo de respaldo (antes no programaba ninguno).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", async () => {
  const { crearDobleCanales } = await import("@/hooks/__tests__/dobleCanalRealtime");
  const canales = crearDobleCanales();
  return { supabase: { from: vi.fn(), channel: canales.channel, removeChannel: canales.removeChannel, __canales: canales } };
});

import { supabase } from "@/integrations/supabase/client";
import { useNotificacionesDashboard } from "@/hooks/useNotificacionesDashboard";
import { useSolicitudesPendientes } from "@/hooks/useSolicitudesPendientes";
import { useOcupacionSalasDia } from "@/hooks/useOcupacionSalasDia";
import { ESPERA_INVALIDACION_MS, INTERVALO_SONDEO_MS, olvidarAvisosRealtime } from "@/lib/realtimeCanal";
import type { DobleCanales } from "./dobleCanalRealtime";

const canales = (supabase as unknown as { __canales: DobleCanales }).__canales;

/** Cada `from()` deja una lectura en vuelo que el test resuelve a mano. */
function lecturasControladas() {
  const pendientes: Array<(filas: unknown[]) => void> = [];
  vi.mocked(supabase.from).mockImplementation((() => {
    let resolver: (filas: unknown[]) => void = () => {};
    const respuesta = new Promise<{ data: unknown[]; error: null }>((ok) => {
      resolver = (filas) => ok({ data: filas, error: null });
    });
    pendientes.push(resolver);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "eq", "neq", "in", "gte", "lte", "range"]) b[m] = () => b;
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => respuesta.then(ok, ko);
    return b;
  }) as never);
  return { total: () => pendientes.length, resolver: (i: number, filas: unknown[]) => pendientes[i](filas) };
}

const notif = (id: string) => ({
  id,
  tipo: "solicitud_pendiente",
  titulo: id,
  mensaje: null,
  referencia_id: null,
  referencia_tipo: null,
  leida: false,
  created_at: "2026-10-02T10:00:00Z",
});
const sol = (id: string) => ({ id, nombre: id, estado: "pendiente", motivo_rechazo: "reserva_hoy", created_at: "2026-10-02T10:00:00Z" });

function conCliente() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("realtime: casos cruzados", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    canales.reiniciar();
    olvidarAvisosRealtime();
    vi.mocked(supabase.from).mockReset();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  it("campana: dos lecturas cruzadas; la vieja responde, llega un INSERT y la nueva no lo trae → no se pierde", async () => {
    const lecturas = lecturasControladas();
    const { result } = renderHook(() => useNotificacionesDashboard());
    act(() => canales.ultimo().estado("SUBSCRIBED")); // lectura 1 en vuelo, la 0 también
    expect(lecturas.total()).toBe(2);
    await act(async () => lecturas.resolver(0, [notif("n-1")])); // vieja: se descarta
    act(() => canales.ultimo().cambio({ eventType: "INSERT", new: notif("n-99") }));
    await act(async () => lecturas.resolver(1, [notif("n-1")])); // la nueva se hizo antes del INSERT
    expect(result.current.notificaciones.map((n) => n.id)).toEqual(["n-99", "n-1"]);
    expect(result.current.countNoLeidas).toBe(2);
  });

  it("solicitudes: un aviso que llega DURANTE la relectura apuntada deja otra relectura", async () => {
    const lecturas = lecturasControladas();
    renderHook(() => useSolicitudesPendientes());
    act(() => canales.ultimo().cambio({ eventType: "INSERT" })); // durante la del montaje
    await act(async () => lecturas.resolver(0, [sol("s-1")]));
    expect(lecturas.total()).toBe(2); // relectura apuntada en vuelo
    act(() => canales.ultimo().cambio({ eventType: "UPDATE" })); // llega durante ESA relectura
    await act(async () => lecturas.resolver(1, [sol("s-1")]));
    expect(lecturas.total()).toBe(3);
  });

  it("solicitudes: la carga del montaje que responde TARDE no pisa la que pidió una acción", async () => {
    const lecturas = lecturasControladas();
    const { result } = renderHook(() => useSolicitudesPendientes());
    let pedida: Promise<void> | undefined;
    act(() => {
      pedida = result.current.fetchSolicitudes();
    });
    await act(async () => {
      lecturas.resolver(1, [sol("s-2"), sol("s-1")]);
      await pedida;
    });
    await act(async () => lecturas.resolver(0, [sol("s-1")]));
    expect(result.current.solicitudes.map((s) => s.id)).toEqual(["s-2", "s-1"]);
  });

  it("rejilla de salas: al cambiar de día quita el canal viejo y abre otro con el filtro del día nuevo", () => {
    lecturasControladas();
    const { wrapper } = conCliente();
    const { rerender } = renderHook(({ f }: { f: string }) => useOcupacionSalasDia(f), {
      wrapper,
      initialProps: { f: "2026-10-01" },
    });
    const primero = canales.ultimo();
    rerender({ f: "2026-10-02" });
    expect(canales.removeChannel).toHaveBeenCalledWith(primero);
    const nuevo = canales.ultimo();
    expect(nuevo).not.toBe(primero);
    expect(nuevo.escuchas.find((e) => e.tipo === "postgres_changes")?.filtro.filter).toBe("fecha=eq.2026-10-02");
  });

  it("rejilla de salas: 20 cambios seguidos = UNA invalidación (diferida), no 20", () => {
    vi.useFakeTimers();
    lecturasControladas();
    const { queryClient, wrapper } = conCliente();
    const invalidar = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useOcupacionSalasDia("2026-10-01"), { wrapper });
    for (let i = 0; i < 20; i++) canales.ultimo().cambio({ eventType: "INSERT", new: { id: `r${i}` } });
    expect(invalidar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ESPERA_INVALIDACION_MS);
    expect(invalidar).toHaveBeenCalledTimes(1);
  });

  it("campana: programa su sondeo de respaldo (sin realtime ya no solo se pone al día al montarse/reconectar)", () => {
    vi.useFakeTimers();
    lecturasControladas();
    const { unmount } = renderHook(() => useNotificacionesDashboard());
    expect(vi.getTimerCount()).toBe(1);
    expect(INTERVALO_SONDEO_MS).toBe(60_000);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
