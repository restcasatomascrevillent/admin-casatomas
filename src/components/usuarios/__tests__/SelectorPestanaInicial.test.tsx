/**
 * Selector «Pestaña al iniciar sesión» (11/11/2026, diálogo «Permisos»): solo ofrece las pestañas del menú que
 * ese usuario ve y una elección que ya no ve se muestra (y se guarda) como «Como siempre».
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SelectorPestanaInicial } from "@/components/usuarios/SelectorPestanaInicial";
import type { ContextoMenuPanel } from "@/components/menuPanel";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const ctx = (...secciones: string[]): ContextoMenuPanel => ({
  permisos: secciones.map((section_key) => ({ section_key, can_view: true })),
  esSuperAdmin: false,
  isEnabled: (k) => k !== "tienda",
});

function abrir() {
  const disparador = screen.getByTestId("selector-pestana-inicial");
  fireEvent.pointerDown(disparador, { button: 0, ctrlKey: false, pointerType: "mouse" });
  return screen.getAllByRole("option").map((o) => o.textContent);
}

describe("SelectorPestanaInicial", () => {
  it("ofrece «Como siempre» y solo las pestañas que ve (sin las apagadas por el Super Admin)", () => {
    render(<SelectorPestanaInicial valor={null} onCambiar={vi.fn()} contexto={ctx("reservas", "facturas", "tienda")} />);
    expect(abrir()).toEqual(["Como siempre", "Reservas", "Facturas", "Ayuda"]);
  });

  it("elegir una pestaña la devuelve; «Como siempre» devuelve null", () => {
    const onCambiar = vi.fn();
    const { unmount } = render(<SelectorPestanaInicial valor={null} onCambiar={onCambiar} contexto={ctx("reservas")} />);
    abrir();
    fireEvent.click(screen.getByRole("option", { name: "Reservas" }));
    expect(onCambiar).toHaveBeenLastCalledWith("/reservas");
    unmount();
    render(<SelectorPestanaInicial valor="/reservas" onCambiar={onCambiar} contexto={ctx("reservas")} />);
    abrir();
    fireEvent.click(screen.getByRole("option", { name: "Como siempre" }));
    expect(onCambiar).toHaveBeenLastCalledWith(null);
  });

  it("una elección que ya no ve se muestra como «Como siempre»", () => {
    render(<SelectorPestanaInicial valor="/cheques" onCambiar={vi.fn()} contexto={ctx("reservas")} />);
    expect(screen.getByTestId("selector-pestana-inicial").textContent).toContain("Como siempre");
  });

  it("deshabilitado (quien no puede cambiar permisos) no se abre", () => {
    render(<SelectorPestanaInicial valor="/reservas" onCambiar={vi.fn()} contexto={ctx("reservas")} disabled />);
    expect(screen.getByTestId("selector-pestana-inicial")).toBeDisabled();
  });
});
