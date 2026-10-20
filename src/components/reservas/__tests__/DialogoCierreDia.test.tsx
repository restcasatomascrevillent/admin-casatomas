/**
 * Pop-up de cierre del día (pestaña Calendario, encargo del dueño 2026-10-15):
 * al pulsar un día se abre; cierra comida, cena o las dos y reabre lo cerrado,
 * con la misma mutación de siempre (`useCambiarCierre`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const mutate = vi.fn();
vi.mock("@/hooks/useCierresReserva", () => ({
  useCambiarCierre: () => ({ mutate, isPending: false }),
}));
vi.mock("@/hooks/useConfiguracionReservas", () => ({
  useConfiguracionReservas: () => ({ data: undefined }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DialogoCierreDia } from "@/components/reservas/DialogoCierreDia";
import type { ServicioCerrado } from "../../../../supabase/functions/_shared/cierres";

const MARTES = "2026-10-20";
const JUEVES = "2026-10-22"; // cierra por defecto (cierre semanal)

function abrir(fecha: string | null, cierres: ServicioCerrado[] = [], extra: { esPasado?: boolean } = {}) {
  const onClose = vi.fn();
  render(<DialogoCierreDia fecha={fecha} onClose={onClose} cierres={cierres} esPasado={!!extra.esPasado} />);
  return { onClose };
}

const boton = (nombre: string | RegExp) => within(screen.getByRole("dialog")).getByRole("button", { name: nombre });

beforeEach(() => {
  mutate.mockReset();
});

describe("DialogoCierreDia", () => {
  it("sin día no se ve", () => {
    abrir(null);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("enseña el día y el estado de cada servicio (abierto)", () => {
    abrir(MARTES);
    expect(screen.getByRole("heading", { name: "Martes, 20 de octubre" })).toBeInTheDocument();
    expect(screen.getByTestId("estado-comida")).toHaveTextContent("Comida:Abierta");
    expect(screen.getByTestId("estado-cena")).toHaveTextContent("Cena:Abierta");
  });

  it("cierra solo la comida", () => {
    abrir(MARTES);
    fireEvent.click(boton("Cerrar comida"));
    expect(mutate).toHaveBeenCalledWith({ fecha: MARTES, turnos: ["comida"], cerrar: true }, expect.anything());
  });

  it("cierra solo la cena", () => {
    abrir(MARTES);
    fireEvent.click(boton("Cerrar cena"));
    expect(mutate).toHaveBeenCalledWith({ fecha: MARTES, turnos: ["cena"], cerrar: true }, expect.anything());
  });

  it("cierra las dos (todo el día)", () => {
    abrir(MARTES);
    fireEvent.click(boton(/Cerrar las dos/));
    expect(mutate).toHaveBeenCalledWith({ fecha: MARTES, turnos: ["comida", "cena"], cerrar: true }, expect.anything());
  });

  it("un servicio cerrado a mano se reabre", () => {
    abrir(MARTES, [{ fecha: MARTES, turno: "cena", origen: "manual", motivo: null }]);
    expect(screen.getByTestId("estado-cena")).toHaveTextContent("Cerrada a mano");
    fireEvent.click(boton("Abrir cena"));
    expect(mutate).toHaveBeenCalledWith({ fecha: MARTES, turnos: ["cena"], cerrar: false }, expect.anything());
  });

  it("un día cerrado por la regla semanal se puede abrir entero (jueves especial)", () => {
    abrir(JUEVES, [
      { fecha: JUEVES, turno: "comida", origen: "semanal", motivo: null },
      { fecha: JUEVES, turno: "cena", origen: "semanal", motivo: null },
    ]);
    expect(screen.getByTestId("estado-comida")).toHaveTextContent("Cerrada (cierre semanal)");
    fireEvent.click(boton(/Abrir las dos/));
    expect(mutate).toHaveBeenCalledWith({ fecha: JUEVES, turnos: ["comida", "cena"], cerrar: false }, expect.anything());
  });

  it("un jueves abierto a mano lo dice: es una excepción", () => {
    abrir(JUEVES, []);
    expect(screen.getByTestId("estado-comida")).toHaveTextContent("excepción");
  });

  it("un día pasado no se puede cambiar", () => {
    abrir(MARTES, [], { esPasado: true });
    expect(boton("Cerrar comida")).toBeDisabled();
    expect(boton(/Cerrar las dos/)).toBeDisabled();
  });

  it("«Listo» cierra el pop-up", () => {
    const { onClose } = abrir(MARTES);
    fireEvent.click(boton("Listo"));
    expect(onClose).toHaveBeenCalled();
  });
});
