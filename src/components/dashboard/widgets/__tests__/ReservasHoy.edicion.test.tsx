/**
 * Widget «Reservas de Hoy» del Dashboard (12/11/2026, petición del dueño: «quita las notificaciones y el bocadillo
 * de ahí»): ya no hay insignia de notas con su popup ni campana. Las reservas se editan desde «Próximas» (su ficha);
 * sin permiso de editar, tocar una lleva al día en Reservas.
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
      b.order = () => b;
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
  hora: "23:59:00",
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

beforeEach(() => {
  vi.clearAllMocks();
  h.canEdit = true;
  h.reservas = [
    reserva("r-pendiente", "pendiente", "Ana Pendiente", "Alergia a los frutos secos"),
    reserva("r-confirmada", "confirmada", "Carlos Confirmado", "Trona para un bebé"),
    reserva("r-llego", "completada", "Elena Llegó", "Cumpleaños"),
  ];
});

describe("ReservasHoy · sin bocadillo de notas ni campana; se edita desde «Próximas»", () => {
  it("no hay insignia de notas ni campana en la tarjeta", () => {
    montar();
    expect(screen.queryByRole("button", { name: /notas y peticiones especiales/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /notificaciones/i })).toBeNull();
    expect(screen.getByText("Reservas de Hoy")).toBeInTheDocument();
  });

  it("tocar una reserva de «Próximas» abre su ficha (solo las vivas: la que ya llegó no sale)", () => {
    montar();
    const proximas = screen.getByRole("list", { name: "Próximas reservas de hoy" });
    expect(within(proximas).queryByText("Elena Llegó")).toBeNull();
    fireEvent.click(within(proximas).getByRole("button", { name: /Ana Pendiente/ }));
    expect(h.editarReserva).toHaveBeenCalledWith("r-pendiente");
  });

  it("sin permiso de edición, tocarla no abre la ficha", () => {
    h.canEdit = false;
    montar();
    fireEvent.click(within(screen.getByRole("list", { name: "Próximas reservas de hoy" })).getByRole("button", { name: /Carlos Confirmado/ }));
    expect(h.editarReserva).not.toHaveBeenCalled();
  });

  it("pinta el diálogo de edición que devuelve el hook (una vez para todo el widget)", async () => {
    montar();
    await waitFor(() => expect(screen.getAllByTestId("dialogo-edicion")).toHaveLength(1));
  });
});
