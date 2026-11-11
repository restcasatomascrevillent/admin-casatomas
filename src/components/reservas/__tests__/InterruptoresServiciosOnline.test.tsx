import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InterruptoresServiciosOnline } from "../InterruptoresServiciosOnline";

const cambiar = vi.fn();
let bloqueados: string[] = [];
let puedeEditar = true;
vi.mock("@/hooks/useServiciosBloqueados", () => ({
  useServiciosBloqueados: () => ({
    estaBloqueado: (t: string) => bloqueados.includes(t),
    cambiar,
    disponible: true,
    guardando: false,
  }),
}));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: puedeEditar }) }));

const pintar = () =>
  render(
    <TooltipProvider>
      <InterruptoresServiciosOnline fecha="2026-11-10" />
    </TooltipProvider>,
  );

describe("Cerrar comida / Cerrar cena", () => {
  beforeEach(() => {
    cambiar.mockClear();
    bloqueados = [];
    puedeEditar = true;
  });

  it("un toque cierra, sin ventana de confirmación (11/11/2026)", () => {
    pintar();
    fireEvent.click(screen.getByRole("button", { name: /Cerrar cena/ }));
    expect(cambiar).toHaveBeenCalledWith("cena", true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("compacta (móvil): los dos botones en una sola fila y sin ayuda (i)", () => {
    render(
      <TooltipProvider>
        <InterruptoresServiciosOnline fecha="2026-11-10" compacta />
      </TooltipProvider>,
    );
    const fila = screen.getByTestId("interruptores-servicios-online");
    expect(fila).toHaveClass("flex-nowrap");
    expect(fila).not.toHaveClass("flex-wrap");
    expect(screen.getByRole("button", { name: /Cerrar comida/ })).toHaveClass("min-h-11", "min-w-0");
    expect(screen.queryByRole("button", { name: "Qué hace cerrar un servicio" })).toBeNull();
  });

  it("cerrado: botón «Comida cerrada» y un toque la vuelve a abrir", () => {
    bloqueados = ["comida"];
    pintar();
    fireEvent.click(screen.getByRole("button", { name: /Comida cerrada/ }));
    expect(cambiar).toHaveBeenCalledWith("comida", false);
  });

  it("sin permiso de editar los botones están deshabilitados", () => {
    puedeEditar = false;
    pintar();
    expect((screen.getByRole("button", { name: /Cerrar comida/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
