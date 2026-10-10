import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const drive = vi.fn();
const destroy = vi.fn();
const driverMock = vi.fn((_config: { steps: unknown[] }) => ({ drive, destroy }));
vi.mock("driver.js", () => ({ driver: (config: { steps: unknown[] }) => driverMock(config) }));
vi.mock("driver.js/dist/driver.css", () => ({}));
vi.mock("@/components/ayuda/tour.css", () => ({}));

let usuario: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));

import { useTourSeccion } from "../useTourSeccion";
import { TOURS, claveTourVisto } from "@/lib/ayuda/tours";

const envoltorio = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

describe("useTourSeccion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    driverMock.mockClear();
    drive.mockClear();
    localStorage.clear();
    usuario = null;
  });
  afterEach(() => vi.useRealTimers());

  it("«lanzar» arranca el tour con los pasos obligatorios (los opcionales sin elemento se saltan)", () => {
    const { result } = renderHook(() => useTourSeccion("facturas", { auto: false }), { wrapper: envoltorio });
    act(() => result.current.lanzar());
    expect(drive).toHaveBeenCalledTimes(1);
    const pasos = driverMock.mock.calls[0][0].steps;
    expect(pasos.length).toBe(TOURS.facturas.filter((p) => !p.opcional).length);
  });

  it("se lanza solo la primera vez y lo recuerda por usuario", () => {
    usuario = { id: "u1" };
    const { unmount } = renderHook(() => useTourSeccion("facturas"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(claveTourVisto("facturas", "u1"))).toBe("1");
    unmount();

    renderHook(() => useTourSeccion("facturas"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).toHaveBeenCalledTimes(1);
  });

  it("sin usuario no se lanza solo", () => {
    renderHook(() => useTourSeccion("gestor-web"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).not.toHaveBeenCalled();
  });
});
