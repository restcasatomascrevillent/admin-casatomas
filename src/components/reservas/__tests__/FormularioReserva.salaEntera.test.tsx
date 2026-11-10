/**
 * «Ocupa la sala entera (evento)» en el formulario de reserva (09/11/2026,
 * migración 20261119100000). La casilla:
 *   - solo se puede marcar con una sala elegida;
 *   - al guardar, pone (upsert) la fila de `salas_cerradas_servicio` con
 *     `reserva_id`, `motivo` = nombre y el turno de la hora;
 *   - al desmarcarla, borra la de esa reserva;
 *   - al editar, arranca marcada si la reserva ya tiene el cierre.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays, format } from "date-fns";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), functions: { invoke: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
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
        espacios: [
          { id: "salon", nombre: "Salón", capacidad_maxima: 50 },
          { id: "terraza", nombre: "Terraza", capacidad_maxima: 50 },
        ],
        reservas: [],
        horasBase: ["13:00", "21:00"],
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
    rejilla: { franjas: [{ hora: "13:00", origen: "turno" }, { hora: "21:00", origen: "turno" }], aforo: {} },
    isLoading: false,
    isError: false,
  }),
}));

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FormularioReserva } from "@/components/reservas/FormularioReserva";
import type { ReservaEditable } from "@/lib/reservas/edicionReserva";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const FECHA = format(addDays(new Date(), 10), "yyyy-MM-dd");

const reserva = (over: Partial<ReservaEditable> = {}): ReservaEditable => ({
  id: "res-1",
  nombre: "Boda García",
  telefono: "+34612345678",
  email: "ana@ejemplo.com",
  fecha: FECHA,
  hora: "14:00:00",
  numero_comensales: 40,
  estado: "confirmada",
  notas_cliente: null,
  espacio_id: "salon",
  marca: "casa_tomas",
  canal: "manual",
  importante: false,
  en_blacklist: false,
  ...over,
});

interface Llamada {
  tabla: string;
  metodo: string;
  args: unknown[];
}

/** Doble de `supabase.from`: anota cada llamada; `cierreGuardado` es lo que hay en salas_cerradas_servicio. */
function prepararBD(cierreGuardado: unknown[] = []) {
  const llamadas: Llamada[] = [];
  vi.mocked(supabase.from).mockImplementation(((tabla: string) => {
    let escritura = false;
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "not", "or", "order", "gte", "lte"]) {
      b[m] = vi.fn((...args: unknown[]) => {
        llamadas.push({ tabla, metodo: m, args });
        return b;
      });
    }
    for (const m of ["update", "insert", "upsert", "delete"]) {
      b[m] = vi.fn((...args: unknown[]) => {
        llamadas.push({ tabla, metodo: m, args });
        escritura = true;
        return b;
      });
    }
    b.single = vi.fn().mockResolvedValue({ data: { id: "res-1" }, error: null });
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(
        escritura
          ? { data: tabla === "reservas" ? [{ id: "res-1" }] : [{ reserva_id: "res-1" }], error: null }
          : { data: tabla === "salas_cerradas_servicio" ? cierreGuardado : [], count: 0, error: null },
      ).then(ok, ko);
    return b;
  }) as never);
  return llamadas;
}

function montar(over: Partial<ReservaEditable> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSuccess = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FormularioReserva reservaAEditar={reserva(over)} onSuccess={onSuccess} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /asignación interna \(opcional\)/i }));
  return { onSuccess };
}

const casilla = () => screen.findByRole("checkbox", { name: /Ocupa la sala entera \(evento\)/ });
const guardar = () => screen.findByRole("button", { name: "Guardar cambios" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FormularioReserva · «Ocupa la sala entera (evento)»", () => {
  it("sin sala, la casilla está desactivada y lo explica", async () => {
    prepararBD();
    montar({ espacio_id: null });
    expect(await casilla()).toBeDisabled();
    expect(screen.getByText("Elige antes una sala.")).toBeInTheDocument();
  });

  it("marcarla y guardar pone el cierre de esa sala, día y turno, con el nombre como motivo", async () => {
    const llamadas = prepararBD();
    const { onSuccess } = montar();
    const c = await casilla();
    expect(c).not.toBeDisabled();
    expect(c).not.toBeChecked();
    // La caja de toque es la fila entera (≥ 44 px), no solo el cuadradito.
    expect(screen.getByTestId("casilla-sala-entera").className).toMatch(/min-h-11/);

    fireEvent.click(c);
    fireEvent.click(await guardar());

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const upsert = llamadas.find((l) => l.tabla === "salas_cerradas_servicio" && l.metodo === "upsert");
    expect(upsert?.args[0]).toEqual({
      espacio_id: "salon",
      fecha: FECHA,
      turno: "comida",
      reserva_id: "res-1",
      motivo: "Boda García",
    });
    expect(upsert?.args[1]).toEqual({ onConflict: "espacio_id,fecha,turno" });
    // Solo cambia el evento: la reserva no se toca.
    expect(llamadas.some((l) => l.tabla === "reservas" && l.metodo === "update")).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Sala cerrada para el evento");
  });

  it("si ya tiene el cierre arranca marcada; desmarcarla lo borra", async () => {
    const llamadas = prepararBD([
      { espacio_id: "salon", fecha: FECHA, turno: "comida", reserva_id: "res-1", motivo: "Boda García" },
    ]);
    const { onSuccess } = montar();
    await waitFor(async () => expect(await casilla()).toBeChecked());

    fireEvent.click(await casilla());
    fireEvent.click(await guardar());

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const borrado = llamadas.findIndex((l) => l.tabla === "salas_cerradas_servicio" && l.metodo === "delete");
    expect(borrado).toBeGreaterThanOrEqual(0);
    expect(llamadas[borrado + 1]).toMatchObject({ metodo: "eq", args: ["reserva_id", "res-1"] });
  });

  it("si la BD rechaza el cierre, se dice por qué y no se cierra el formulario", async () => {
    prepararBD();
    const { onSuccess } = montar();
    // El upsert responde con el error del trigger.
    const from = vi.mocked(supabase.from).getMockImplementation()!;
    vi.mocked(supabase.from).mockImplementation(((tabla: string) => {
      const b = from(tabla as never) as unknown as Record<string, unknown>;
      if (tabla !== "salas_cerradas_servicio") return b;
      const upsert = b.upsert as (...a: unknown[]) => Record<string, unknown>;
      b.upsert = (...a: unknown[]) => {
        upsert(...a);
        b.then = (ok: (v: unknown) => unknown) =>
          Promise.resolve({
            data: null,
            error: { code: "23514", message: "La sala Salón tiene 1 reserva(s) más ese turno: muévelas a otra sala antes de cerrarla para el evento." },
          }).then(ok);
        return b;
      };
      return b;
    }) as never);

    fireEvent.click(await casilla());
    fireEvent.click(await guardar());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(/La sala Salón tiene 1 reserva/);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
