/**
 * Pop-up de cierre del día (pestaña Calendario, encargo del dueño 2026-10-15):
 * al pulsar un día se abre; cierra comida, cena o las dos y reabre lo cerrado,
 * con la misma mutación de siempre (`useCambiarCierre`).
 *
 * Con solo «Ver» en Reservas (06/11/2026, decisión del dueño) enseña el estado del día sin los
 * botones de abrir y cerrar: se ocultan, no se desactivan.
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
const permisos = vi.hoisted(() => ({ editar: true }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (seccion: string, tipo: string = "view") => ({
    canAccess: seccion === "reservas" && (tipo === "view" || permisos.editar),
    loading: false,
  }),
}));

import { DialogoCierreDia } from "@/components/reservas/DialogoCierreDia";
import type { ServicioCerrado } from "../../../../supabase/functions/_shared/cierres";

const MARTES = "2026-10-20";
const LUNES = "2026-10-19"; // cierra por defecto (cierre semanal)
const JUEVES = "2026-10-22"; // sin reservas web por defecto, pero el restaurante abre (tapas)

function abrir(fecha: string | null, cierres: ServicioCerrado[] = [], extra: { esPasado?: boolean } = {}) {
  const onClose = vi.fn();
  render(<DialogoCierreDia fecha={fecha} onClose={onClose} cierres={cierres} esPasado={!!extra.esPasado} />);
  return { onClose };
}

const boton = (nombre: string | RegExp) => within(screen.getByRole("dialog")).getByRole("button", { name: nombre });

beforeEach(() => {
  mutate.mockReset();
  permisos.editar = true;
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

  it("un día cerrado por la regla semanal se puede abrir entero (lunes especial)", () => {
    abrir(LUNES, [
      { fecha: LUNES, turno: "comida", origen: "semanal", motivo: null },
      { fecha: LUNES, turno: "cena", origen: "semanal", motivo: null },
    ]);
    expect(screen.getByTestId("estado-comida")).toHaveTextContent("Cerrada (cierre semanal)");
    fireEvent.click(boton(/Abrir las dos/));
    expect(mutate).toHaveBeenCalledWith({ fecha: LUNES, turnos: ["comida", "cena"], cerrar: false }, expect.anything());
  });

  it("un jueves de tapas se puede abrir a la web (excepción)", () => {
    abrir(JUEVES, [
      { fecha: JUEVES, turno: "comida", origen: "semanal", motivo: null },
      { fecha: JUEVES, turno: "cena", origen: "semanal", motivo: null },
    ]);
    fireEvent.click(boton(/Abrir las dos/));
    expect(mutate).toHaveBeenCalledWith({ fecha: JUEVES, turnos: ["comida", "cena"], cerrar: false }, expect.anything());
  });

  it("jueves de tapas: la regla semanal lo deja sin reservas web, pero se dice que el restaurante abre (sin rojo)", () => {
    abrir(JUEVES, [
      { fecha: JUEVES, turno: "comida", origen: "semanal", motivo: null },
      { fecha: JUEVES, turno: "cena", origen: "semanal", motivo: null },
    ]);
    const comida = screen.getByTestId("estado-comida");
    expect(comida).toHaveTextContent("Sin reservas web (el restaurante abre)");
    expect(comida).not.toHaveTextContent("Cerrada");
    expect(comida.className).not.toMatch(/destructive/);
  });

  it("un jueves cerrado a mano sí es un cierre", () => {
    abrir(JUEVES, [{ fecha: JUEVES, turno: "cena", origen: "manual", motivo: null }]);
    expect(screen.getByTestId("estado-cena")).toHaveTextContent("Cerrada a mano");
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

  it("con solo «Ver»: el estado se ve, pero no hay ningún botón de abrir o cerrar", () => {
    permisos.editar = false;
    abrir(MARTES, [{ fecha: MARTES, turno: "cena", origen: "manual", motivo: null }]);
    expect(screen.getByTestId("estado-cena")).toHaveTextContent("Cerrada a mano");
    const dialogo = within(screen.getByRole("dialog"));
    for (const nombre of [/Cerrar comida/, /Abrir cena/, /las dos/]) expect(dialogo.queryByRole("button", { name: nombre })).toBeNull();
    // «Listo» sí: cerrar el pop-up no escribe nada.
    expect(boton("Listo")).toBeEnabled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("«Listo» cierra el pop-up", () => {
    const { onClose } = abrir(MARTES);
    fireEvent.click(boton("Listo"));
    expect(onClose).toHaveBeenCalled();
  });
});
