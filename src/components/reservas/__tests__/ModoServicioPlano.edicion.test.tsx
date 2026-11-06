/**
 * Modo servicio: la hoja de una mesa enseña la reserva que la ocupa y lleva
 * «Editar reserva» (2026-09-30: las reservas se editan siempre, desde cualquier
 * vista). Durante el servicio es lo típico: «en realidad son 6, no 4».
 *
 * La hoja solo enseña reservas que ocupan esa mesa ahora: esperando llegada
 * (pendiente, verificada, confirmada) o ya sentadas («Llegó»). Las canceladas y
 * las «No vino» no ocupan mesa y no salen aquí (se editan desde «Lista»).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  reservas: [] as Array<Record<string, unknown>>,
  asignaciones: [] as Array<Record<string, unknown>>,
  canEdit: true,
  editarReserva: vi.fn(),
}));

vi.mock("@/hooks/useMesas", () => ({
  useMesas: () => ({
    data: [
      { id: "mesa-1", nombre: "4", capacidad: 4 },
      { id: "mesa-2", nombre: "5", capacidad: 6 },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useAsignacionesMesa", () => ({
  useAsignacionesMesa: () => ({ data: h.asignaciones, isLoading: false }),
  useAsignarMesasReserva: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/useReservasServicioDia", () => ({
  useReservasServicioDia: () => ({ data: h.reservas, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useConfiguracionReservas", () => ({ useConfiguracionReservas: () => ({ data: undefined }) }));
vi.mock("@/hooks/useAccionesServicioReserva", () => ({
  useAccionesServicioReserva: () => ({ marcarLlegada: vi.fn(), estaEnCurso: () => false }),
}));
vi.mock("@/hooks/useAccionesModoServicio", () => ({
  useAccionesModoServicio: () => ({ liberarMesa: vi.fn(), deshacerLiberarMesa: vi.fn(), estaEnCurso: () => false }),
}));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: h.canEdit, loading: false }),
}));
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({ editarReserva: h.editarReserva, dialogoEdicion: <div data-testid="dialogo-edicion" /> }),
}));

import { ModoServicioPlano } from "@/components/reservas/servicio/ModoServicioPlano";

beforeAll(() => {
  // Las 14:00 de un día fijo: turno de comida, sea cuando sea que corra el test.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 10, 14, 0, 0));
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterAll(() => {
  vi.useRealTimers();
});

const reserva = (id: string, estado: string, nombre: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  hora: "13:30:00",
  numero_comensales: 4,
  estado,
  espacio_id: "salon",
  telefono: "+34612345678",
  email: null,
  importante: false,
  llegada_at: null,
  salida_at: null,
  ...extra,
});

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <ModoServicioPlano espacioId="salon" espacioNombre="Salón" />
    </QueryClientProvider>,
  );
}

/** Abre la hoja de la mesa cuyo botón empieza por «Mesa <nombre>,». */
function abrirMesa(nombre: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Mesa ${nombre},`) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.canEdit = true;
  h.reservas = [
    reserva("r-confirmada", "confirmada", "Ana Confirmada"),
    reserva("r-sentada", "completada", "Berta Sentada", { llegada_at: "2026-10-10T13:35:00" }),
  ];
  h.asignaciones = [
    { mesa_id: "mesa-1", reserva_id: "r-confirmada" },
    { mesa_id: "mesa-2", reserva_id: "r-sentada" },
  ];
});

describe("ModoServicioPlano · editar la reserva de una mesa", () => {
  it.each([
    ["4", "Ana Confirmada", "r-confirmada"],
    ["5", "Berta Sentada", "r-sentada"],
  ])("la hoja de la mesa %s (reserva de %s) lleva «Editar reserva» y abre el editor de esa reserva", async (mesa, _cliente, id) => {
    montar();

    abrirMesa(mesa);
    const boton = await screen.findByRole("button", { name: /Editar reserva/ });
    expect(boton).toBeEnabled();
    fireEvent.click(boton);

    expect(h.editarReserva).toHaveBeenCalledTimes(1);
    expect(h.editarReserva).toHaveBeenCalledWith(id);
  });

  it("al editar se cierra la hoja de la mesa, para no dejar dos capas abiertas", async () => {
    montar();

    abrirMesa("4");
    fireEvent.click(await screen.findByRole("button", { name: /Editar reserva/ }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /Editar reserva/ })).not.toBeInTheDocument());
  });

  it("una reserva sin nombre se puede editar igual", async () => {
    h.reservas = [reserva("r-anonima", "confirmada", null)];
    h.asignaciones = [{ mesa_id: "mesa-1", reserva_id: "r-anonima" }];
    montar();

    abrirMesa("4");
    fireEvent.click(await screen.findByRole("button", { name: /Editar reserva/ }));

    expect(h.editarReserva).toHaveBeenCalledWith("r-anonima");
  });

  it("sin permiso de edición sobre «reservas» no hay botón (06/11/2026: oculto, no desactivado)", async () => {
    h.canEdit = false;
    montar();

    abrirMesa("4");
    // La hoja se abre y enseña la reserva, pero sin «Editar reserva».
    expect(await screen.findByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar reserva/ })).not.toBeInTheDocument();
    expect(h.editarReserva).not.toHaveBeenCalled();
  });

  it("con permiso el botón no lleva ningún motivo: no hay nada que explicar", async () => {
    montar();

    abrirMesa("4");
    const boton = await screen.findByRole("button", { name: /Editar reserva/ });

    expect(boton.parentElement).not.toHaveAttribute("title");
  });

  it("una mesa libre no tiene reserva que editar: no hay botón", async () => {
    h.reservas = [];
    h.asignaciones = [];
    montar();

    abrirMesa("4");

    expect(await screen.findByText(/Sin reserva asignada este turno/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar reserva/ })).not.toBeInTheDocument();
  });

  it("pinta el diálogo de edición que devuelve el hook", () => {
    montar();

    expect(screen.getAllByTestId("dialogo-edicion")).toHaveLength(1);
  });
});
