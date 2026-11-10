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
const JUEVES = "2026-10-22"; // abre por defecto desde el 2026-11-10

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

  it("un lunes abierto a mano lo dice: es una excepción", () => {
    abrir(LUNES, []);
    expect(screen.getByTestId("estado-comida")).toHaveTextContent("excepción");
  });

  it("un jueves sin cierres está abierto sin más (ya no cierra por defecto)", () => {
    abrir(JUEVES, []);
    expect(screen.getByTestId("estado-comida")).toHaveTextContent("Abierta");
    expect(screen.getByTestId("estado-comida")).not.toHaveTextContent("excepción");
    expect(screen.getByTestId("estado-cena")).not.toHaveTextContent("excepción");
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
