import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { NavAutoCollapse, defaultSidebarOpen, esPantallaTactil } from "@/components/NavAutoCollapse";

// 11/11/2026, petición del dueño: «en los móviles y tablets que la barra lateral salga por defecto cerrada».

type Oyente = (e: { matches: boolean }) => void;
const oyentes: Oyente[] = [];

/** Simula el ancho de la ventana y si la pantalla es táctil sin ratón. */
function simular({ ancho, tactil }: { ancho: number; tactil: boolean }) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: ancho });
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const matches = query.includes("pointer: coarse") ? tactil : query.includes("min-width") ? ancho >= 1280 : ancho < 1024;
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_: string, fn: Oyente) => { if (query.includes("min-width")) oyentes.push(fn); },
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  oyentes.length = 0;
});

describe("Menú lateral: arranque plegado en pantallas táctiles", () => {
  it("ordenador ancho (>= 1280 px, con ratón): desplegado", () => {
    simular({ ancho: 1440, tactil: false });
    expect(esPantallaTactil()).toBe(false);
    expect(defaultSidebarOpen()).toBe(true);
  });

  it("portátil o ventana mediana (< 1280 px): plegado", () => {
    simular({ ancho: 1180, tactil: false });
    expect(defaultSidebarOpen()).toBe(false);
  });

  it("tablet ancha apaisada (iPad Pro 1366 px, táctil): plegado (antes salía desplegado)", () => {
    simular({ ancho: 1366, tactil: true });
    expect(esPantallaTactil()).toBe(true);
    expect(defaultSidebarOpen()).toBe(false);
  });

  it("al girar la tablet táctil a apaisado no se abre solo; al estrecharse sí se pliega", () => {
    simular({ ancho: 1100, tactil: true });
    function Estado() {
      return <p data-testid="estado">{useSidebar().state}</p>;
    }
    render(
      <SidebarProvider defaultOpen={defaultSidebarOpen()}>
        <NavAutoCollapse />
        <Estado />
      </SidebarProvider>,
    );
    expect(screen.getByTestId("estado")).toHaveTextContent("collapsed");
    act(() => oyentes.forEach((fn) => fn({ matches: true })));
    expect(screen.getByTestId("estado")).toHaveTextContent("collapsed");
  });

  it("con ratón, cruzar los 1280 px sigue desplegándolo y plegándolo", () => {
    simular({ ancho: 1100, tactil: false });
    function Estado() {
      return <p data-testid="estado">{useSidebar().state}</p>;
    }
    render(
      <SidebarProvider defaultOpen={defaultSidebarOpen()}>
        <NavAutoCollapse />
        <Estado />
      </SidebarProvider>,
    );
    expect(screen.getByTestId("estado")).toHaveTextContent("collapsed");
    act(() => oyentes.forEach((fn) => fn({ matches: true })));
    expect(screen.getByTestId("estado")).toHaveTextContent("expanded");
    act(() => oyentes.forEach((fn) => fn({ matches: false })));
    expect(screen.getByTestId("estado")).toHaveTextContent("collapsed");
  });
});
