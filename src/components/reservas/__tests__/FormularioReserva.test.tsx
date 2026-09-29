/**
 * Tests para src/components/reservas/FormularioReserva.tsx
 *
 * reservas-sin-salas (decisión del dueño 2026-09-29): el negocio de una
 * reserva manual se ELIGE (obligatorio) y ya no lo decide la sala, que pasa a
 * ser interna, opcional y plegada.
 *   1. Sin negocio elegido no se guarda: error de validación, sin INSERT.
 *   2. Touza sin sala se guarda como Touza (marca 'touza', espacio_id null).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays } from "date-fns";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useBlacklist", () => ({
  useVerificarBlacklist: () => ({ mutateAsync: vi.fn().mockResolvedValue(null) }),
}));
vi.mock("@/hooks/useConfiguracionReservas", () => ({
  useConfiguracionReservas: () => ({
    data: {
      min_comensales_por_reserva: 1,
      max_comensales_por_reserva: 12,
      max_reservas_por_telefono_dia: 0,
      max_reservas_por_email_dia: 0,
      dias_max_antelacion: 60,
    },
  }),
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
        negocios: [
          {
            marca: "casa_tomas",
            espacios: [{ id: "salon", nombre: "Salón", capacidad_maxima: 60, marca: "casa_tomas" }],
            reservas: [],
            horasBase: ["21:00"],
            cerrado: false,
          },
          {
            marca: "touza",
            espacios: [{ id: "reservado", nombre: "El Reservado", capacidad_maxima: 20, marca: "touza" }],
            reservas: [],
            horasBase: ["21:00"],
            cerrado: false,
          },
        ],
      },
    }),
  };
});
vi.mock("@/components/reservas/OcupacionSalas", () => ({ OcupacionSalas: () => null }));
vi.mock("@/components/reservas/DisponibilidadCuartos", () => ({
  DisponibilidadCuartos: () => null,
  useRejillaCuartos: () => ({
    rejilla: { franjas: [{ hora: "21:00", origen: "turno" }], aforo: {} },
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

/** Builder encadenable: cualquier consulta devuelve vacío; el INSERT se espía. */
function espiarInsert() {
  const insert = vi.fn();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "not", "or", "order"]) builder[m] = vi.fn(() => builder);
  builder.insert = insert.mockImplementation(() => builder);
  builder.single = vi.fn().mockResolvedValue({ data: { id: "res-nueva" }, error: null });
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(ok);
  vi.mocked(supabase.from).mockReturnValue(builder as never);
  return insert;
}

function montar(datos: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSuccess = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FormularioReserva
          onSuccess={onSuccess}
          datosPreseleccionados={{
            fecha: addDays(new Date(), 3),
            hora: "21:00",
            nombre: "Ana López",
            telefono: "612345678",
            email: "ana@ejemplo.com",
            numero_comensales: 4,
            ...datos,
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSuccess };
}

beforeEach(() => vi.clearAllMocks());

describe("FormularioReserva · negocio obligatorio y sala interna", () => {
  it("sin negocio elegido no guarda y lo pide", async () => {
    const insert = espiarInsert();
    montar({ marca: "" });

    fireEvent.click(screen.getByRole("button", { name: "Crear Reserva" }));

    expect((await screen.findAllByText("Elige el negocio")).length).toBeGreaterThan(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it("Touza sin sala se guarda como Touza y sin espacio", async () => {
    const insert = espiarInsert();
    const { onSuccess } = montar({ marca: "touza", espacio_id: null });

    // La sala va plegada: el selector no se ve hasta desplegarla.
    expect(screen.getByRole("button", { name: /asignación interna \(opcional\)/i })).toHaveTextContent("sin sala");
    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({ marca: "touza", espacio_id: null, hora: "21:00" });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("Casa Tomás por defecto si no viene negocio", async () => {
    const insert = espiarInsert();
    montar({});

    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({ marca: "casa_tomas", espacio_id: null });
  });
});
