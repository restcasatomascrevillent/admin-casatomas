/**
 * «¿Dentro o fuera?» del formulario de reserva (dueño, 10/11/2026): «Dentro» | «Fuera», nada por defecto
 * (= no se dice nada; tocar la marcada la quita). Dentro → Comedor | Salón (y el Reservado); Fuera → Terraza
 * (se pone sola). Con menú del día, dentro solo el Comedor. Se guarda en `reservas.zona_preferida`.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays } from "date-fns";

const mocks = vi.hoisted(() => ({
  verificarBlacklist: vi.fn(),
  config: {
    min_comensales_por_reserva: 1,
    max_comensales_por_reserva: 12,
    max_reservas_por_telefono_dia: 0,
    max_reservas_por_email_dia: 0,
    dias_max_antelacion: 60,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/useBlacklist", () => ({
  useVerificarBlacklist: () => ({ mutateAsync: mocks.verificarBlacklist }),
}));
vi.mock("@/hooks/useConfiguracionReservas", () => ({
  useConfiguracionReservas: () => ({ data: mocks.config }),
}));
vi.mock("@/hooks/useDisponibilidad", () => ({
  verificarAforoTurno: vi.fn().mockResolvedValue({ disponible: true, mensaje: "Hay aforo en el turno." }),
}));
vi.mock("@/hooks/useVerificacionReservas", () => ({ notificarCambioReserva: vi.fn() }));
vi.mock("@/hooks/useOcupacionSalasDia", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOcupacionSalasDia")>();
  return {
    ...real,
    useOcupacionSalasDia: () => ({
      data: {
        espacios: [
          { id: "salon", nombre: "Salón", capacidad_maxima: 60 },
          { id: "comedor", nombre: "Comedor", capacidad_maxima: 40 },
          { id: "terraza", nombre: "Terraza", capacidad_maxima: 30, exterior: true },
          { id: "reservado", nombre: "Reservado", capacidad_maxima: 14, privada: true },
        ],
        reservas: [],
        horasBase: ["14:00", "21:00"],
        cerrado: false,
      },
    }),
  };
});
vi.mock("@/components/reservas/OcupacionSalas", () => ({ OcupacionSalas: () => null }));
vi.mock("@/components/reservas/ReservasDelDia", () => ({ ReservasDelDia: () => null }));
vi.mock("@/components/reservas/DisponibilidadCuartos", () => ({
  DisponibilidadCuartos: () => null,
  useRejillaCuartos: () => ({
    rejilla: { franjas: [{ hora: "14:00", origen: "turno" }, { hora: "21:00", origen: "turno" }], aforo: {} },
    isLoading: false,
    isError: false,
  }),
}));

import { supabase } from "@/integrations/supabase/client";
import { FormularioReserva } from "@/components/reservas/FormularioReserva";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

function espiarInsert() {
  const insert = vi.fn();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "not", "or", "order"]) builder[m] = vi.fn(() => builder);
  builder.insert = insert.mockImplementation(() => builder);
  builder.single = vi.fn().mockResolvedValue({ data: { id: "res-nueva" }, error: null });
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(ok);
  vi.mocked(supabase.from).mockReturnValue(builder as never);
  return insert;
}

function montar(datos: Record<string, unknown>, confirmar = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FormularioReserva
          onSuccess={vi.fn()}
          confirmarAntesDeGuardar={confirmar}
          datosPreseleccionados={{
            fecha: addDays(new Date(), 3),
            hora: "21:00",
            nombre: "Ana López",
            telefono: "612345678",
            email: "ana@ejemplo.com",
            numero_comensales: 4,
            espacio_id: null,
            ...datos,
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const proximo = (dia: number) => {
  const d = addDays(new Date(), 7);
  while (d.getDay() !== dia) d.setDate(d.getDate() + 1);
  return d;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verificarBlacklist.mockResolvedValue(null);
});

describe("FormularioReserva · ¿Dentro o fuera?", () => {
  it("sale antes de la asignación interna, con «Dentro» y «Fuera» y ninguna marcada (sin «Indiferente»)", () => {
    espiarInsert();
    montar({});
    const selector = screen.getByTestId("selector-zona");
    const asignacion = screen.getByRole("button", { name: /asignación interna \(opcional\)/i });
    expect(selector.compareDocumentPosition(asignacion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("zona-dentro")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("zona-fuera")).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("Indiferente")).not.toBeInTheDocument();
  });

  it("sin tocar nada, el alta no manda zona_preferida", async () => {
    const insert = espiarInsert();
    montar({});
    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).not.toHaveProperty("zona_preferida");
  });

  it("«Fuera» pone sola la Terraza y guarda zona_preferida 'fuera'", async () => {
    const insert = espiarInsert();
    montar({});
    fireEvent.click(screen.getByTestId("zona-fuera"));
    expect(screen.getByTestId("zona-fuera")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("zona-sala-Terraza")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("zona-sala-Comedor")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({ zona_preferida: "fuera", espacio_id: "terraza" });
  });

  it("«Dentro» ofrece Comedor y Salón (y el Reservado), sin la Terraza; elegir Salón rellena la sala", async () => {
    const insert = espiarInsert();
    montar({});
    fireEvent.click(screen.getByTestId("zona-dentro"));
    expect(screen.getByTestId("zona-sala-Comedor")).toBeEnabled();
    expect(screen.getByTestId("zona-sala-Salón")).toBeEnabled();
    expect(screen.getByTestId("zona-sala-Reservado")).toBeInTheDocument();
    expect(screen.queryByTestId("zona-sala-Terraza")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("zona-sala-Salón"));
    expect(screen.getByTestId("zona-sala-Salón")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({ zona_preferida: "dentro", espacio_id: "salon" });
  });

  it("volver a tocar la marcada la quita (no se dice nada)", async () => {
    const insert = espiarInsert();
    montar({});
    fireEvent.click(screen.getByTestId("zona-dentro"));
    fireEvent.click(screen.getByTestId("zona-dentro"));
    expect(screen.getByTestId("zona-dentro")).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByTestId("zona-sala-Comedor")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).not.toHaveProperty("zona_preferida");
  });

  it("menú del día + Dentro: solo el Comedor (Salón deshabilitado con el motivo) y se pone solo", async () => {
    const insert = espiarInsert();
    montar({ fecha: proximo(2), hora: "14:00" });
    fireEvent.click(screen.getByTestId("servicio-menu_del_dia"));
    fireEvent.click(screen.getByTestId("zona-dentro"));
    expect(screen.getByTestId("zona-sala-Salón")).toBeDisabled();
    expect(screen.getByTestId("zona-sala-Salón")).toHaveTextContent("El menú del día es en Comedor o Terraza");
    expect(screen.getByTestId("zona-sala-Comedor")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({ zona_preferida: "dentro", espacio_id: "comedor", menu_del_dia: true });
  });

  it("carta + Dentro: Comedor y Salón se pueden elegir", () => {
    espiarInsert();
    montar({ fecha: proximo(3), hora: "14:00" });
    fireEvent.click(screen.getByTestId("servicio-carta"));
    fireEvent.click(screen.getByTestId("zona-dentro"));
    expect(screen.getByTestId("zona-sala-Comedor")).toBeEnabled();
    expect(screen.getByTestId("zona-sala-Salón")).toBeEnabled();
  });

  it("con el Comedor puesto, «Fuera» lo cambia a la Terraza", () => {
    espiarInsert();
    montar({ espacio_id: "comedor" });
    fireEvent.click(screen.getByTestId("zona-fuera"));
    expect(screen.getByTestId("zona-sala-Terraza")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("aviso-zona-sala")).not.toBeInTheDocument();
  });

  it("con la Terraza puesta, «Dentro» la quita y deja elegir Comedor o Salón", () => {
    espiarInsert();
    montar({ espacio_id: "terraza" });
    fireEvent.click(screen.getByTestId("zona-dentro"));
    // Al elegir Dentro la Terraza no casa: se quita y queda a elegir entre Comedor y Salón.
    expect(screen.queryByTestId("zona-sala-Terraza")).not.toBeInTheDocument();
    expect(screen.getByTestId("zona-sala-Comedor")).toHaveAttribute("aria-checked", "false");
  });

  it("el resumen «¿Guardamos esta reserva?» dice «Dentro o fuera: Fuera»", async () => {
    espiarInsert();
    montar({}, true);
    fireEvent.click(screen.getByTestId("zona-fuera"));
    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));
    expect(await screen.findByTestId("resumen-zona")).toHaveTextContent("Fuera");
  });
});
