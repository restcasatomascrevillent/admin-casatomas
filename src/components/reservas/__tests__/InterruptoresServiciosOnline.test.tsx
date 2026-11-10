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

describe("Cerrar comida / Cerrar noche", () => {
  beforeEach(() => {
    cambiar.mockClear();
    bloqueados = [];
    puedeEditar = true;
  });

  it("pregunta antes de cerrar y solo cierra al confirmar", () => {
    pintar();
    fireEvent.click(screen.getByRole("button", { name: /Cerrar noche/ }));
    expect(screen.getByText(/¿Cerrar las reservas online de la noche de hoy \(martes 10\/11\)\?/)).toBeTruthy();
    expect(cambiar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sí, cerrar" }));
    expect(cambiar).toHaveBeenCalledWith("cena", true);
  });

  it("compacta (móvil): botones y ayuda (i) en una sola fila, sin saltar de línea", () => {
    render(
      <TooltipProvider>
        <InterruptoresServiciosOnline fecha="2026-11-10" compacta />
      </TooltipProvider>,
    );
    const fila = screen.getByTestId("interruptores-servicios-online");
    expect(fila).toHaveClass("flex-nowrap");
    expect(fila).not.toHaveClass("flex-wrap");
    expect(screen.getByRole("button", { name: /Cerrar comida/ })).toHaveClass("min-h-11", "min-w-0");
    expect(screen.getByRole("button", { name: "Qué hace cerrar un servicio" })).toHaveClass("h-11", "shrink-0");
  });

  it("cancelar no cambia nada", () => {
    pintar();
    fireEvent.click(screen.getByRole("button", { name: /Cerrar comida/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(cambiar).not.toHaveBeenCalled();
  });

  it("cerrado: botón «Comida cerrada» y pregunta por volver a abrir", () => {
    bloqueados = ["comida"];
    pintar();
    fireEvent.click(screen.getByRole("button", { name: /Comida cerrada/ }));
    expect(screen.getByText(/¿Volver a abrir las reservas online de la comida/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sí, abrir" }));
    expect(cambiar).toHaveBeenCalledWith("comida", false);
  });

  it("sin permiso de editar los botones están deshabilitados", () => {
    puedeEditar = false;
    pintar();
    expect((screen.getByRole("button", { name: /Cerrar comida/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
