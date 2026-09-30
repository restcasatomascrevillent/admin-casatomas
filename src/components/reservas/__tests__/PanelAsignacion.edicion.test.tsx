/**
 * Pestaña «Asignación»: cada fila de reserva lleva «Editar» junto a «Sala» y
 * «Mesas» (2026-09-30: las reservas se editan siempre, desde cualquier vista).
 *
 * La vista que alimenta este panel (`vista_asignacion_dia`) solo trae reservas
 * vivas (pendiente, verificada, confirmada) de hoy en adelante, así que aquí no
 * salen canceladas ni pasadas; para esas está la pestaña «Lista». Lo que sí sale
 * se puede editar sea cual sea su estado, su sala o su mesa.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays, format } from "date-fns";

const h = vi.hoisted(() => ({
  filas: [] as Array<Record<string, unknown>>,
  canEdit: true,
  editarReserva: vi.fn(),
}));

vi.mock("@/hooks/useConfiguracionReservas", () => ({ useConfiguracionReservas: () => ({ data: undefined }) }));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({
    data: [
      { id: "salon", nombre: "Salón", activa: true, capacidad_maxima: 60, caracteristicas: { marca: "casa_tomas" } },
      { id: "terraza", nombre: "Terraza", activa: true, capacidad_maxima: 30, caracteristicas: { marca: "casa_tomas" } },
    ],
  }),
}));
vi.mock("@/hooks/useReservasPorAsignar", () => ({
  ErrorSinPermisoSala: class ErrorSinPermisoSala extends Error {},
  useReservasPorAsignar: () => ({ data: h.filas, isLoading: false, isError: false, refetch: vi.fn() }),
  useCambiarSalaReserva: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
}));
vi.mock("@/hooks/useOcupacionSalasDia", () => ({
  useOcupacionSalasDia: () => ({ data: undefined, isLoading: false }),
  datosDeNegocio: () => null,
}));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: h.canEdit, loading: false }),
}));
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({ editarReserva: h.editarReserva, dialogoEdicion: <div data-testid="dialogo-edicion" /> }),
}));

import { PanelAsignacion } from "@/components/reservas/PanelAsignacion";

// Ninguna fila es de HOY a propósito: el panel oculta lo que ya ha pasado, así que una reserva
// «de hoy a las 21:00» desaparecería al ejecutar el test pasadas las 21:00. Mañana y pasado
// mañana valen a cualquier hora del día (una dentro de la ventana de 48 h y otra fuera).
const MANANA = format(addDays(new Date(), 1), "yyyy-MM-dd");
const EN_TRES_DIAS = format(addDays(new Date(), 3), "yyyy-MM-dd");

const fila = (id: string, estado: string, nombre: string | null, over: Record<string, unknown> = {}) => ({
  reserva_id: id,
  fecha: MANANA,
  hora: "21:00:00",
  turno: "cena",
  nombre,
  numero_comensales: 4,
  estado,
  marca: "casa_tomas",
  espacio_id: null,
  espacio_nombre: null,
  mesas_asignadas: 0,
  plazas_asignadas: 0,
  mesas_nombres: [],
  grado: "sin_sala",
  ...over,
});

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onAsignarMesa = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <PanelAsignacion onAsignarMesa={onAsignarMesa} />
    </QueryClientProvider>,
  );
  return { onAsignarMesa };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.canEdit = true;
  h.filas = [
    fila("r-pendiente", "pendiente", "Ana Pendiente"),
    fila("r-verificada", "verificada", "Berta Verificada", { fecha: EN_TRES_DIAS }),
    fila("r-confirmada", "confirmada", "Carlos Confirmado", {
      espacio_id: "salon",
      espacio_nombre: "Salón",
      mesas_asignadas: 1,
      mesas_nombres: ["Mesa 4"],
      grado: "con_mesa",
    }),
  ];
});

describe("PanelAsignacion · editar desde la fila", () => {
  it.each([
    ["Ana Pendiente", "r-pendiente"],
    ["Berta Verificada", "r-verificada"],
    ["Carlos Confirmado", "r-confirmada"],
  ])("la fila de %s lleva «Editar» y abre el editor de esa reserva", (cliente, id) => {
    montar();

    const boton = screen.getByRole("button", { name: `Editar la reserva de ${cliente}` });
    expect(boton).toBeEnabled();
    fireEvent.click(boton);

    expect(h.editarReserva).toHaveBeenCalledTimes(1);
    expect(h.editarReserva).toHaveBeenCalledWith(id);
  });

  it("junto a los botones de siempre: «Sala»/«Dar sala» y «Mesas» siguen en su fila", () => {
    montar();

    const fila = screen.getByText("Carlos Confirmado").closest("li")!;
    expect(within(fila).getByRole("button", { name: /^Sala/ })).toBeInTheDocument();
    expect(within(fila).getByRole("button", { name: /Mesas|Cambiar mesas|mesa/i })).toBeInTheDocument();
    expect(within(fila).getByRole("button", { name: /Editar la reserva de Carlos Confirmado/ })).toBeInTheDocument();
  });

  it("una reserva sin nombre (la BD lo permite) se puede editar igual", () => {
    h.filas = [fila("r-sin-nombre", "confirmada", null)];
    montar();

    fireEvent.click(screen.getByRole("button", { name: "Editar la reserva de este cliente" }));
    expect(h.editarReserva).toHaveBeenCalledWith("r-sin-nombre");
  });

  it("sin permiso de edición sobre «reservas» el botón sale deshabilitado y lo explica", () => {
    h.canEdit = false;
    montar();

    const boton = screen.getByRole("button", { name: /Editar la reserva de Ana Pendiente/ });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute("title", expect.stringMatching(/No tienes permiso para editar reservas/));
    // Un botón deshabilitado no recibe el ratón (`pointer-events-none`): el motivo solo se ve en su envoltorio.
    expect(boton.parentElement).toHaveAttribute("title", expect.stringMatching(/No tienes permiso para editar reservas/));
    fireEvent.click(boton);
    expect(h.editarReserva).not.toHaveBeenCalled();
  });

  it("pinta el diálogo de edición que devuelve el hook (una vez para todo el panel)", () => {
    montar();

    expect(screen.getAllByTestId("dialogo-edicion")).toHaveLength(1);
  });
});
