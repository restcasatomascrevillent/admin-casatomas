/**
 * FormularioReserva y los cierres de reservas (alta/edición desde el PANEL).
 *
 * Jueves de tapas (dueño, 2026-11-10: «Abierto, sin reservas web»): la regla
 * semanal deja el jueves sin reservas por la web y el teléfono, pero el local
 * ABRE. El personal apunta la reserva sin el aviso de «cerrado para reservas»;
 * solo sale una nota informativa. Un cierre de verdad (lunes, a mano) sigue
 * avisando como siempre.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import type { ComponentProps } from "react";

const mocks = vi.hoisted(() => ({
  verificarBlacklist: vi.fn(),
  verificarAforo: vi.fn(),
  cuartos: vi.fn(),
  cierres: [] as Array<{ fecha: string; turno: "comida" | "cena"; origen: "semanal" | "manual"; motivo: null }>,
  salas: vi.fn(),
  rejilla: vi.fn(),
  config: {
    min_comensales_por_reserva: 1,
    max_comensales_por_reserva: 12,
    max_reservas_por_telefono_dia: 0,
    max_reservas_por_email_dia: 0,
    dias_max_antelacion: 60,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), functions: { invoke: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/useBlacklist", () => ({
  useVerificarBlacklist: () => ({ mutateAsync: mocks.verificarBlacklist }),
}));
vi.mock("@/hooks/useConfiguracionReservas", () => ({
  useConfiguracionReservas: () => ({ data: mocks.config }),
}));
vi.mock("@/hooks/useCierresReserva", () => ({
  useCierresReserva: () => ({ data: { cierres: mocks.cierres, esquemaPendiente: false } }),
}));
vi.mock("@/hooks/useDisponibilidad", () => ({
  // Misma firma que la real: (fecha, hora, comensales, marca, reservaEditada). Al
  // EDITAR, `reservaEditada` es la reserva ANTERIOR entera (regla del UPDATE:
  // «editar no puede subir la ocupación»), no solo su id.
  verificarAforoTurno: (...args: Parameters<typeof import("@/hooks/useDisponibilidad").verificarAforoTurno>) =>
    mocks.verificarAforo(...args),
}));
vi.mock("@/hooks/useVerificacionReservas", () => ({ notificarCambioReserva: vi.fn() }));
vi.mock("@/hooks/useOcupacionSalasDia", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOcupacionSalasDia")>();
  return {
    ...real,
    // El día de Casa Tomás (las salas de Touza ya no llegan: las descarta el hook).
    useOcupacionSalasDia: () => ({
      data: {
        espacios: [
          { id: "salon", nombre: "Salón", capacidad_maxima: 60 },
          { id: "terraza", nombre: "Terraza", capacidad_maxima: 30 },
        ],
        reservas: [],
        horasBase: ["13:00", "21:00"],
        cerrado: false,
      },
    }),
  };
});
// Las dos rejillas se sustituyen por un botón que elige hora / sala: así se cambia
// la hora o la sala sin pelearse con un Select de Radix en jsdom, y se ven las props.
vi.mock("@/components/reservas/OcupacionSalas", () => ({
  OcupacionSalas: (props: { onSeleccionar?: (espacioId: string, hora: string) => void }) => {
    mocks.salas(props);
    return (
      <button type="button" onClick={() => props.onSeleccionar?.("terraza", "21:00")}>
        elegir terraza
      </button>
    );
  },
}));
vi.mock("@/components/reservas/ReservasDelDia", () => ({
  ReservasDelDia: (props: { onSeleccionarHora?: (hora: string) => void }) => {
    mocks.cuartos(props);
    return (
      <button type="button" onClick={() => props.onSeleccionarHora?.("13:00")}>
        elegir 13:00
      </button>
    );
  },
}));
vi.mock("@/components/reservas/DisponibilidadCuartos", () => ({
  DisponibilidadCuartos: () => null,
  useRejillaCuartos: (args: unknown) => {
    mocks.rejilla(args);
    return {
      rejilla: {
        franjas: [
          { hora: "13:00", origen: "turno" },
          { hora: "21:00", origen: "turno" },
        ],
        aforo: {},
      },
      isLoading: false,
      isError: false,
    };
  },
}));

import { supabase } from "@/integrations/supabase/client";
import { FormularioReserva } from "@/components/reservas/FormularioReserva";
import type { ReservaEditable } from "@/lib/reservas/edicionReserva";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const EN_DIEZ_DIAS = format(addDays(new Date(), 10), "yyyy-MM-dd");

/** Una reserva confirmada de dentro de 10 días, con email y sin nada raro. */
const reserva = (over: Partial<ReservaEditable> = {}): ReservaEditable => ({
  id: "res-1",
  nombre: "Ana López",
  telefono: "+34612345678",
  email: "ana@ejemplo.com",
  fecha: EN_DIEZ_DIAS,
  hora: "21:00:00",
  numero_comensales: 4,
  estado: "confirmada",
  notas_cliente: "Sin gluten",
  espacio_id: "salon",
  marca: "casa_tomas",
  canal: "telefono",
  importante: false,
  en_blacklist: false,
  ...over,
});

type Builder = Record<string, ReturnType<typeof vi.fn>> & { then: unknown };

/**
 * Doble de `supabase.from(...)`: un builder NUEVO por consulta (encadenable).
 * Lo que acaba en `.update(...)` responde con `filasUpdate`/`errorUpdate`; el
 * resto (límites, duplicados) responde vacío.
 */
function prepararBD(opciones: { filasUpdate?: unknown[]; errorUpdate?: unknown } = {}) {
  const update = vi.fn();
  const insert = vi.fn();
  const builders: Builder[] = [];
  vi.mocked(supabase.from).mockImplementation((() => {
    let esUpdate = false;
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "not", "or", "order"]) b[m] = vi.fn(() => b);
    b.update = vi.fn((valores: unknown) => {
      update(valores);
      esUpdate = true;
      return b;
    });
    b.insert = vi.fn((valores: unknown) => {
      insert(valores);
      return b;
    });
    b.single = vi.fn().mockResolvedValue({ data: { id: "x" }, error: null });
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(
        esUpdate
          ? { data: opciones.filasUpdate ?? [{ id: "res-1" }], error: opciones.errorUpdate ?? null }
          : { data: [], count: 0, error: null },
      ).then(ok, ko);
    builders.push(b as Builder);
    return b;
  }) as never);
  return { update, insert, builders };
}

function montar(
  over: Partial<ReservaEditable> = {},
  props: Partial<ComponentProps<typeof FormularioReserva>> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(qc, "invalidateQueries");
  const onSuccess = vi.fn();
  const vista = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FormularioReserva reservaAEditar={reserva(over)} onSuccess={onSuccess} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSuccess, invalidar, unmount: vista.unmount };
}

// Fechas fijas futuras: jueves 2027-01-14 y lunes 2027-01-11.
const JUEVES = "2027-01-14";
const LUNES = "2027-01-11";
const todoElDia = (fecha: string, origen: "semanal" | "manual" = "semanal") =>
  (["comida", "cena"] as const).map((turno) => ({ fecha, turno, origen, motivo: null }));

describe("FormularioReserva — cierres de reservas en el panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepararBD();
    mocks.cierres = [];
  });

  it("jueves de tapas: sin aviso de cierre, solo la nota de que la web no coge reservas", () => {
    mocks.cierres = todoElDia(JUEVES);
    montar({ fecha: JUEVES });
    expect(screen.queryByTestId("aviso-cierre-reservas")).toBeNull();
    expect(screen.getByTestId("nota-sin-reservas-web")).toHaveTextContent("el restaurante abre");
  });

  it("lunes (cierre semanal de verdad): avisa como siempre y sin la nota", () => {
    mocks.cierres = todoElDia(LUNES);
    montar({ fecha: LUNES });
    expect(screen.getByTestId("aviso-cierre-reservas")).toHaveTextContent("cerrado para reservas");
    expect(screen.queryByTestId("nota-sin-reservas-web")).toBeNull();
  });

  it("un jueves cerrado A MANO sí avisa", () => {
    mocks.cierres = todoElDia(JUEVES, "manual");
    montar({ fecha: JUEVES });
    expect(screen.getByTestId("aviso-cierre-reservas")).toBeInTheDocument();
  });

  it("con la columna vacía (sin días de tapas), el jueves vuelve a avisar", () => {
    const antes = mocks.config;
    mocks.config = { ...antes, dias_abiertos_sin_reserva_online: [] } as typeof antes;
    try {
      mocks.cierres = todoElDia(JUEVES);
      montar({ fecha: JUEVES });
      expect(screen.getByTestId("aviso-cierre-reservas")).toBeInTheDocument();
    } finally {
      mocks.config = antes;
    }
  });
});
