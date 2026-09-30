/**
 * Widget «Reservas de Hoy» del Dashboard: el popup «Notas y peticiones
 * especiales» lista las reservas de hoy que llevan nota (nombre, comensales,
 * hora y la nota). Desde ahí se puede EDITAR la reserva (2026-09-30: las
 * reservas se editan siempre, desde cualquier vista donde aparezcan), p. ej.
 * para corregir una alergia mal apuntada.
 *
 * El widget lee las reservas de hoy NO canceladas, de cualquier estado; el
 * popup solo enseña las que tienen nota.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  reservas: [] as Array<Record<string, unknown>>,
  canEdit: true as boolean,
  editarReserva: vi.fn(),
}));

vi.mock("@/hooks/useDashboardStats", () => ({
  useTodayReservations: () => ({ data: h.reservas, isError: false, refetch: vi.fn() }),
  useTodayConfirmedReservations: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({
          data: [{ capacidad_maxima: 60, caracteristicas: { marca: "casa_tomas" } }],
          error: null,
        }).then(ok, ko);
      return b;
    },
  },
}));
vi.mock("@/components/notificaciones/CentroNotificaciones", () => ({ CentroNotificaciones: () => null }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: h.canEdit, loading: false }),
}));
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({
    editarReserva: h.editarReserva,
    dialogoEdicion: <div data-testid="dialogo-edicion" />,
  }),
}));

import { ReservasHoy } from "@/components/dashboard/widgets/ReservasHoy";

const reserva = (id: string, estado: string, nombre: string | null, notas: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  hora: "21:00:00",
  numero_comensales: 4,
  estado,
  notas_cliente: notas,
  en_blacklist: false,
  marca: "casa_tomas",
  ...extra,
});

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReservasHoy />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** La insignia de las notas (un `div` con `aria-haspopup="dialog"` que abre el popup). */
const insigniaDeNotas = (contenedor: HTMLElement) => contenedor.querySelector('[aria-haspopup="dialog"]') as HTMLElement;

async function abrirNotas() {
  const { container } = montar();
  fireEvent.click(insigniaDeNotas(container));
  return await screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.canEdit = true;
  h.reservas = [
    reserva("r-pendiente", "pendiente", "Ana Pendiente", "Alergia a los frutos secos"),
    reserva("r-confirmada", "confirmada", "Carlos Confirmado", "Trona para un bebé"),
    reserva("r-llego", "completada", "Elena Llegó", "Cumpleaños"),
    reserva("r-sin-notas", "confirmada", "Sin Notas", null),
  ];
});

describe("ReservasHoy · editar desde el popup de notas", () => {
  it.each([
    ["Ana Pendiente", "r-pendiente"],
    ["Carlos Confirmado", "r-confirmada"],
    ["Elena Llegó", "r-llego"],
  ])("la nota de %s lleva «Editar» y abre el editor de esa reserva", async (cliente, id) => {
    const popup = await abrirNotas();

    fireEvent.click(within(popup).getByRole("button", { name: `Editar la reserva de ${cliente}` }));

    expect(h.editarReserva).toHaveBeenCalledTimes(1);
    expect(h.editarReserva).toHaveBeenCalledWith(id);
  });

  it("al editar se cierra el popup de notas, para no dejar dos diálogos uno sobre otro", async () => {
    const popup = await abrirNotas();

    fireEvent.click(within(popup).getByRole("button", { name: "Editar la reserva de Ana Pendiente" }));

    await waitFor(() => expect(screen.queryByText("Notas y peticiones especiales")).not.toBeInTheDocument());
  });

  it("solo salen (y se editan desde aquí) las reservas con nota: el resto no entra en el popup", async () => {
    const popup = await abrirNotas();

    expect(within(popup).queryByText("Sin Notas")).not.toBeInTheDocument();
    expect(within(popup).getAllByRole("button", { name: /^Editar la reserva de/ })).toHaveLength(3);
  });

  it("una reserva sin nombre (la BD lo permite) se puede editar igual", async () => {
    h.reservas = [reserva("r-anonima", "confirmada", null, "Silla de ruedas")];
    const popup = await abrirNotas();

    fireEvent.click(within(popup).getByRole("button", { name: "Editar la reserva de este cliente" }));
    expect(h.editarReserva).toHaveBeenCalledWith("r-anonima");
  });

  it("sin permiso de edición sobre «reservas» el botón sale deshabilitado y lo explica", async () => {
    h.canEdit = false;
    const popup = await abrirNotas();

    const boton = within(popup).getByRole("button", { name: "Editar la reserva de Ana Pendiente" });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute("title", expect.stringMatching(/No tienes permiso para editar reservas/));
    // Un botón deshabilitado no recibe el ratón (`pointer-events-none`): el motivo solo se ve en su envoltorio.
    expect(boton.parentElement).toHaveAttribute("title", expect.stringMatching(/No tienes permiso para editar reservas/));
    fireEvent.click(boton);
    expect(h.editarReserva).not.toHaveBeenCalled();
  });

  it("pinta el diálogo de edición que devuelve el hook (una vez para todo el widget)", () => {
    montar();

    expect(screen.getAllByTestId("dialogo-edicion")).toHaveLength(1);
  });

  it("sin reservas con nota no hay insignia de notas ni popup: el widget sigue igual", () => {
    h.reservas = [reserva("r1", "confirmada", "Ana", null)];
    const { container } = montar();

    expect(insigniaDeNotas(container)).toBeNull();
    expect(screen.getByText("Reservas de Hoy")).toBeInTheDocument();
  });
});
