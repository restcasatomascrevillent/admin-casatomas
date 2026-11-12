import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InterruptorMenuTapas } from "../InterruptorMenuTapas";

const mock = vi.hoisted(() => ({ mutate: vi.fn(), disponible: true }));
vi.mock("@/hooks/useConfiguracionWeb", () => ({ useConfiguracionWeb: () => ({
  mostrarBotonesMenuTapas: { menu: true, tapas: false },
  botonesMenuTapasDisponibles: mock.disponible, isLoading: false, isError: false,
  cambiarBotonMenuTapas: { mutate: mock.mutate, isPending: false },
}) }));

beforeEach(() => { mock.mutate.mockClear(); mock.disponible = true; });
describe("Interruptores de Menú del día y Tapas", () => {
  it.each(["menu", "tapas"] as const)("guarda solo el ajuste de %s", (boton) => {
    render(<InterruptorMenuTapas boton={boton} />);
    const interruptor = screen.getByRole("switch");
    fireEvent.click(interruptor);
    // El 2.º argumento lleva el onSuccess de la story automática del jueves de tapas.
    expect(mock.mutate).toHaveBeenCalledWith({ boton, mostrar: boton === "tapas" }, expect.anything());
  });
  it("no permite cambios si la migración no está aplicada", () => {
    mock.disponible = false;
    render(<InterruptorMenuTapas boton="menu" />);
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
