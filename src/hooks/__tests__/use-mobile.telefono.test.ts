import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { esTelefonoTactil, useIsMobile } from "../use-mobile";

/** Simula el aparato: ancho de ventana (CSS px), pantalla y puntero principal. */
function aparato({ ventana, pantalla, dedo }: { ventana: number; pantalla: [number, number]; dedo: boolean }) {
  vi.stubGlobal("innerWidth", ventana);
  vi.spyOn(window.screen, "width", "get").mockReturnValue(pantalla[0]);
  vi.spyOn(window.screen, "height", "get").mockReturnValue(pantalla[1]);
  const original = window.matchMedia;
  vi.spyOn(window, "matchMedia").mockImplementation((q: string) => ({
    ...original(q),
    matches: q === "(pointer: coarse)" ? dedo : false,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useIsMobile: teléfono aunque la página se maquete ancha", () => {
  it("Android con «Sitio de escritorio» (ventana 980, pantalla 412×915, dedo) → móvil", () => {
    aparato({ ventana: 980, pantalla: [412, 915], dedo: true });
    expect(esTelefonoTactil()).toBe(true);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
  });

  it("teléfono normal (ventana 412) → móvil", () => {
    aparato({ ventana: 412, pantalla: [412, 915], dedo: true });
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
  });

  it("iPad mini apaisado (pantalla 744×1133, ventana 1133, dedo) → no es móvil", () => {
    aparato({ ventana: 1133, pantalla: [744, 1133], dedo: true });
    expect(esTelefonoTactil()).toBe(false);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it("tablet Android 800×1280 vertical → no es móvil", () => {
    aparato({ ventana: 800, pantalla: [800, 1280], dedo: true });
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it("escritorio con ratón, aunque la pantalla diga pequeña → no es móvil", () => {
    aparato({ ventana: 1280, pantalla: [500, 800], dedo: false });
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });
});
