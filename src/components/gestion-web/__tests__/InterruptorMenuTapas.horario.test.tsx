import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InterruptorMenuTapas } from "@/components/gestion-web/InterruptorMenuTapas";

const mock = vi.hoisted(() => ({ guardar: vi.fn(), horarioMenu: null as unknown }));
vi.mock("@/hooks/useConfiguracionWeb", async () => {
  const { leerHorario } = await import("@/lib/horario-web");
  return {
    useConfiguracionWeb: () => ({
      mostrarBotonesMenuTapas: { menu: true, tapas: true },
      botonesMenuTapasDisponibles: true, isLoading: false, isError: false,
      cambiarBotonMenuTapas: { mutate: vi.fn(), isPending: false },
      horariosMenuTapas: { menu: leerHorario(mock.horarioMenu, "menu"), tapas: leerHorario(null, "tapas") },
      horariosDisponibles: true,
      cambiarHorarioMenuTapas: { mutate: mock.guardar, isPending: false },
    }),
  };
});

beforeEach(() => { mock.guardar.mockClear(); mock.horarioMenu = null; });

describe("Horario de Menú del día y Tapas en el Gestor Web", () => {
  it("enseña el horario de siempre y lo cambia por días y horas", () => {
    render(<InterruptorMenuTapas boton="menu" />);
    const plegado = screen.getByRole("button", { name: /Cuándo sale:\s*Martes a jueves · todo el día/ });
    fireEvent.click(plegado);
    fireEvent.click(screen.getByRole("button", { name: "Viernes" }));
    fireEvent.click(screen.getByRole("switch", { name: "Todo el día" }));
    fireEvent.change(screen.getByLabelText("Aparece a las"), { target: { value: "12:30" } });
    fireEvent.change(screen.getByLabelText("Desaparece a las"), { target: { value: "16:00" } });
    expect(screen.getByText("Quedará: Martes a viernes · 12:30–16:00.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar horario" }));
    expect(mock.guardar).toHaveBeenCalledWith(
      { boton: "menu", horario: { dias: [2, 3, 4, 5], desde: "12:30", hasta: "16:00" } },
      expect.anything(),
    );
  });
  it("sin días no deja guardar", () => {
    render(<InterruptorMenuTapas boton="tapas" />);
    fireEvent.click(screen.getByRole("button", { name: /Cuándo sale/ }));
    fireEvent.click(screen.getByRole("button", { name: "Jueves" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Elige al menos un día.");
    expect(screen.getByRole("button", { name: "Guardar horario" })).toBeDisabled();
  });
  it("«Volver a lo de siempre» guarda NULL", () => {
    mock.horarioMenu = { dias: [1], desde: "13:00", hasta: "16:00" };
    render(<InterruptorMenuTapas boton="menu" />);
    fireEvent.click(screen.getByRole("button", { name: /Cuándo sale:\s*Lunes · 13:00–16:00/ }));
    fireEvent.click(screen.getByRole("button", { name: "Volver a lo de siempre" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar horario" }));
    expect(mock.guardar).toHaveBeenCalledWith({ boton: "menu", horario: null }, expect.anything());
  });
});
