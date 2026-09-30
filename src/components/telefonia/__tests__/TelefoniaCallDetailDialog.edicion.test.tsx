/**
 * Detalle de una llamada del asistente telefónico: si la llamada terminó en una
 * reserva, además del enlace «Ver reserva creada» lleva «Editar reserva»
 * (2026-09-30: las reservas se editan siempre, desde cualquier vista donde
 * aparezcan). El enlace lleva a `/reservas?reserva=<id>`, pero la página de
 * reservas no abre nada con ese parámetro, así que aquí se edita en el sitio.
 *
 * El id de la reserva puede venir de tres sitios (la columna `reserva_id`, los
 * datos estructurados o el resultado de la herramienta `create_reservation`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  canEdit: true as boolean,
  editarReserva: vi.fn(),
}));

vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: h.canEdit, loading: false }),
}));
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({
    editarReserva: h.editarReserva,
    dialogoEdicion: <div data-testid="dialogo-edicion" />,
  }),
}));

import { TelefoniaCallDetailDialog } from "@/components/telefonia/TelefoniaCallDetailDialog";

const llamada = (over: Record<string, unknown> = {}) => ({
  id: "call-1",
  started_at: "2026-10-10T13:00:00",
  caller_number: "+34612345678",
  call_type: "bot" as const,
  status: "ended",
  duration_seconds: 95,
  summary: "El cliente reservó mesa para 4.",
  ...over,
});

function montar(call: ReturnType<typeof llamada> | null) {
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <TelefoniaCallDetailDialog call={call} onClose={onClose} />
    </MemoryRouter>,
  );
  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.canEdit = true;
});

describe("TelefoniaCallDetailDialog · editar la reserva de la llamada", () => {
  it("con `reserva_id` lleva «Editar reserva» junto a «Ver reserva creada» y abre el editor de esa reserva", () => {
    montar(llamada({ reserva_id: "res-1" }));

    expect(screen.getByRole("link", { name: /Ver reserva creada/ })).toHaveAttribute("href", "/reservas?reserva=res-1");
    const boton = screen.getByRole("button", { name: /Editar reserva/ });
    expect(boton).toBeEnabled();

    fireEvent.click(boton);
    expect(h.editarReserva).toHaveBeenCalledTimes(1);
    expect(h.editarReserva).toHaveBeenCalledWith("res-1");
  });

  it.each([
    ["datos estructurados", { structured_data: { reserva_id: "res-estructurada" } }, "res-estructurada"],
    [
      "resultado de create_reservation",
      { tool_calls: [{ tool: "create_reservation", result: { id: "res-herramienta" } }] },
      "res-herramienta",
    ],
  ])("el id también sale de los %s", (_origen, extra, esperado) => {
    montar(llamada(extra));

    fireEvent.click(screen.getByRole("button", { name: /Editar reserva/ }));
    expect(h.editarReserva).toHaveBeenCalledWith(esperado);
  });

  it("una llamada que no acabó en reserva no tiene enlace ni botón de editar", () => {
    montar(llamada());

    expect(screen.queryByRole("link", { name: /Ver reserva creada/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar reserva/ })).not.toBeInTheDocument();
  });

  it("sin permiso de edición sobre «reservas» el botón sale deshabilitado y lo explica", () => {
    h.canEdit = false;
    montar(llamada({ reserva_id: "res-1" }));

    const boton = screen.getByRole("button", { name: /Editar reserva/ });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute("title", expect.stringMatching(/No tienes permiso para editar reservas/));
    // Un botón deshabilitado no recibe el ratón (`pointer-events-none`): el motivo solo se ve en su envoltorio.
    expect(boton.parentElement).toHaveAttribute("title", expect.stringMatching(/No tienes permiso para editar reservas/));
    fireEvent.click(boton);
    expect(h.editarReserva).not.toHaveBeenCalled();
  });

  it("pinta el diálogo de edición que devuelve el hook (una vez)", () => {
    montar(llamada({ reserva_id: "res-1" }));

    expect(screen.getAllByTestId("dialogo-edicion")).toHaveLength(1);
  });

  it("sin llamada seleccionada el detalle no se abre y el editor tampoco estorba", () => {
    montar(null);

    expect(screen.queryByText("Detalle de llamada")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar reserva/ })).not.toBeInTheDocument();
  });
});
