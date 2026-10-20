/**
 * Modo servicio: el botón que registra la llegada desde la hoja de una mesa.
 *
 * Se llamaba «Sentar» y hacía EXACTAMENTE lo mismo que «Ha llegado» del kanban:
 * `marcarLlegada` (estado 'completada' + `llegada_at`), sin nada más —ocupar la mesa
 * no es una escritura, el estado de la mesa se deduce de la reserva—. Con el
 * vocabulario único del dueño («Ha llegado» / «No vino») pasa a llamarse igual que en
 * el resto de pantallas, y lee `accionesDisponibles(reserva, { vista: "hoy", canEdit })`
 * como ellas: solo se ofrece a una reserva que espera al cliente, y sin permiso de
 * edición sale deshabilitado con el motivo a la vista.
 *
 * Lo que se afirma son efectos (qué acción se llama y con qué reserva, cuándo no) y
 * los nombres accesibles de los controles.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  reservas: [] as Array<Record<string, unknown>>,
  asignaciones: [] as Array<Record<string, unknown>>,
  canEdit: true,
  marcarLlegada: vi.fn(),
  liberarMesa: vi.fn(),
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
  useAsignacionesMesa: vi.fn(() => ({ data: h.asignaciones, isLoading: false })),
  useAsignarMesasReserva: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/useReservasServicioDia", () => ({
  useReservasServicioDia: () => ({ data: h.reservas, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useConfiguracionReservas", () => ({ useConfiguracionReservas: () => ({ data: undefined }) }));
vi.mock("@/hooks/useAccionesServicioReserva", () => ({
  useAccionesServicioReserva: () => ({ marcarLlegada: h.marcarLlegada, estaEnCurso: () => false }),
}));
vi.mock("@/hooks/useAccionesModoServicio", () => ({
  useAccionesModoServicio: () => ({ liberarMesa: h.liberarMesa, deshacerLiberarMesa: vi.fn(), estaEnCurso: () => false }),
}));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: h.canEdit, loading: false }),
}));
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }),
}));

import { ModoServicioPlano } from "@/components/reservas/servicio/ModoServicioPlano";
import { useAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";

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

const reserva = (id: string, estado: string, nombre: string, extra: Record<string, unknown> = {}) => ({
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

const MOTIVO_SIN_PERMISO = "No tienes permiso para editar reservas";

beforeEach(() => {
  vi.clearAllMocks();
  h.canEdit = true;
  h.marcarLlegada.mockResolvedValue(true);
  h.asignaciones = [
    { mesa_id: "mesa-1", reserva_id: "r-espera" },
    { mesa_id: "mesa-2", reserva_id: "r-sentada" },
  ];
  h.reservas = [
    reserva("r-espera", "confirmada", "Ana Espera"),
    reserva("r-sentada", "completada", "Berta Sentada", { llegada_at: "2026-10-10T13:35:00" }),
  ];
});

describe("ModoServicioPlano · respaldo sin realtime", () => {
  it("las mesas asignadas se releen cada minuto (la tablet del servicio nunca cambia de foco)", () => {
    montar();
    expect(vi.mocked(useAsignacionesMesa)).toHaveBeenCalledWith(
      expect.any(String),
      "salon",
      expect.anything(),
      REFRESCO_PERIODICO,
    );
  });
});

describe("ModoServicioPlano · «Ha llegado» (antes «Sentar»)", () => {
  it.each(["pendiente", "verificada", "confirmada"])(
    "la reserva %s de una mesa se marca con «Ha llegado»: llama a marcarLlegada con ESA reserva",
    async (estado) => {
      h.reservas = [reserva("r-espera", estado, "Ana Espera")];
      montar();

      abrirMesa("4");
      fireEvent.click(await screen.findByRole("button", { name: "Ha llegado" }));

      await waitFor(() => expect(h.marcarLlegada).toHaveBeenCalledTimes(1));
      expect(h.marcarLlegada).toHaveBeenCalledWith(expect.objectContaining({ id: "r-espera", estado }));
    },
  );

  it("ya no existe ningún botón «Sentar» en la hoja de una mesa", async () => {
    montar();

    abrirMesa("4");
    await screen.findByRole("button", { name: "Ha llegado" });

    expect(screen.queryByRole("button", { name: /sentar/i })).not.toBeInTheDocument();
  });

  it("al registrar la llegada se cierra la hoja de la mesa", async () => {
    montar();

    abrirMesa("4");
    fireEvent.click(await screen.findByRole("button", { name: "Ha llegado" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Ha llegado" })).not.toBeInTheDocument());
  });

  it("si la escritura falla (`marcarLlegada` devuelve false) la hoja se queda abierta para reintentar", async () => {
    h.marcarLlegada.mockResolvedValue(false);
    montar();

    abrirMesa("4");
    fireEvent.click(await screen.findByRole("button", { name: "Ha llegado" }));

    await waitFor(() => expect(h.marcarLlegada).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Ha llegado" })).toBeInTheDocument();
  });

  it("una reserva que YA llegó no ofrece «Ha llegado»: ofrece liberar la mesa", async () => {
    montar();

    abrirMesa("5");

    expect(await screen.findByRole("button", { name: /Liberar mesa/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ha llegado" })).not.toBeInTheDocument();
  });

  it("una mesa libre no tiene a nadie que haya llegado: no hay botón", async () => {
    h.reservas = [];
    h.asignaciones = [];
    montar();

    abrirMesa("4");

    expect(await screen.findByText(/Sin reserva asignada este turno/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ha llegado" })).not.toBeInTheDocument();
  });

  it("con permiso el botón no lleva ningún motivo: no hay nada que explicar", async () => {
    montar();

    abrirMesa("4");
    const boton = await screen.findByRole("button", { name: "Ha llegado" });

    expect(boton).toBeEnabled();
    expect(boton.parentElement).not.toHaveAttribute("title");
  });

  it("sin permiso de edición sale deshabilitado, con el motivo visible en su envoltorio, y no llama a nada", async () => {
    h.canEdit = false;
    montar();

    abrirMesa("4");
    const boton = await screen.findByRole("button", { name: "Ha llegado" });

    expect(boton).toBeDisabled();
    // Un botón deshabilitado no recibe el ratón (`pointer-events-none`): el motivo se ve en el envoltorio.
    expect(boton.parentElement).toHaveAttribute("title", MOTIVO_SIN_PERMISO);
    fireEvent.click(boton);
    expect(h.marcarLlegada).not.toHaveBeenCalled();
  });

  it("«Editar reserva» sigue diciendo lo mismo sin permiso (el texto sale de accionesDisponibles)", async () => {
    h.canEdit = false;
    montar();

    abrirMesa("4");
    const boton = await screen.findByRole("button", { name: /Editar reserva/ });

    expect(boton).toBeDisabled();
    expect(boton.parentElement).toHaveAttribute("title", MOTIVO_SIN_PERMISO);
  });
});
