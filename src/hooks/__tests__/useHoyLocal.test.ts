/**
 * «Hoy» cambia a medianoche (revisión 07/10/2026, M6): la tablet del servicio se queda toda la noche en
 * «Hoy» y con un `useMemo(() => hoyLocal(), [])` seguía con las reservas de ayer hasta recargar.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { INTERVALO_COMPROBAR_DIA_MS, useHoyLocal } from "@/hooks/useHoyLocal";

afterEach(() => vi.useRealTimers());

describe("useHoyLocal", () => {
  it("pasa al día siguiente pasada la medianoche, sin recargar", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 6, 23, 59, 30));
    const { result } = renderHook(() => useHoyLocal());
    expect(result.current).toBe("2026-10-06");

    act(() => {
      vi.advanceTimersByTime(INTERVALO_COMPROBAR_DIA_MS);
    });
    expect(result.current).toBe("2026-10-07");
  });

  it("y al volver a la pestaña (tablet bloqueada toda la noche)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 6, 22, 0));
    const { result } = renderHook(() => useHoyLocal());
    vi.setSystemTime(new Date(2026, 9, 7, 9, 0));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe("2026-10-07");
  });
});
