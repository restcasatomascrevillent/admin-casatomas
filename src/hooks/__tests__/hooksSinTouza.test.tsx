/**
 * Touza no admite reservas (decisión del dueño 2026-10-01): los hooks que LEEN `reservas` y
 * `espacios_reserva` dejan fuera lo que queda de Touza en la base de datos (sus reservas de demostración
 * y sus tres salas, todavía activas). La regla es la común (`admiteReservas` / `salaAdmiteReservas`,
 * src/lib/reservas/negocios.ts) y se prueba aparte; aquí se prueba que cada hook la APLICA a lo que lee y
 * que pide las columnas de las que depende (`marca` de la reserva, `caracteristicas` de la sala).
 *
 * El doble de Supabase (`dobleSupabaseTablas.ts`) filtra como PostgREST y devuelve SOLO las columnas
 * pedidas: si un hook deja de pedir `marca`, sus filas llegan sin ella, la reserva de Touza pasa por
 * Casa Tomás y el test cae, como caería en producción.
 *
 * Casos (mismos datos para todos): 4 salas activas de Casa Tomás (170 plazas), una suya desactivada
 * (40) y las 3 de Touza activas (80). Hoy, 5 reservas de Casa Tomás (confirmada, pendiente, «Llegó»,
 * cancelada y «No vino») y 2 de Touza (confirmada y pendiente); otro día, una de cada.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client", async () => {
  const { crearDobleTablas } = await import("@/hooks/__tests__/dobleSupabaseTablas");
  return { supabase: crearDobleTablas() };
});

import { supabase } from "@/integrations/supabase/client";
import type { DobleTablas } from "@/hooks/__tests__/dobleSupabaseTablas";
import { useOcupacionSalasDia } from "@/hooks/useOcupacionSalasDia";
import { useResumenOcupacionHoy } from "@/hooks/useOcupacionHoy";
import {
  useDashboardStats,
  useTodayConfirmedReservations,
  useTodayReservations,
} from "@/hooks/useDashboardStats";

const doble = supabase as unknown as DobleTablas;

const HOY = "2026-10-01";
const OTRO_DIA = "2026-10-05";

const sala = (id: string, capacidad: number, caracteristicas: unknown, activa = true) => ({
  id,
  nombre: id,
  descripcion: null,
  capacidad_maxima: capacidad,
  activa,
  caracteristicas,
});

const ESPACIOS = [
  sala("ct-comedor", 50, {}),
  sala("ct-salon", 50, null),
  sala("ct-terraza", 50, { marca: "casa_tomas" }),
  sala("ct-reservado", 20, { marca: "casa_tomas" }),
  sala("ct-bodega", 40, { marca: "casa_tomas" }, false),
  sala("tz-reservado", 20, { privada: true, marca: "touza" }),
  sala("tz-terraza", 30, { marca: "touza" }),
  sala("tz-interior", 30, { marca: "touza" }),
];

const reserva = (id: string, o: Record<string, unknown>) => ({
  id,
  fecha: HOY,
  hora: "21:00:00",
  nombre: `Cliente ${id}`,
  telefono: null,
  email: null,
  numero_comensales: 2,
  estado: "confirmada",
  espacio_id: null,
  marca: "casa_tomas",
  notas_cliente: null,
  en_blacklist: false,
  ...o,
});

const RESERVAS = [
  reserva("ct-confirmada", { hora: "13:30:00", numero_comensales: 4, espacio_id: "ct-salon" }),
  reserva("ct-pendiente", { estado: "pendiente", numero_comensales: 2 }),
  reserva("ct-llego", { hora: "21:30:00", estado: "completada", numero_comensales: 3, espacio_id: "ct-comedor" }),
  reserva("ct-cancelada", { hora: "22:00:00", estado: "cancelada", numero_comensales: 6 }),
  reserva("ct-no-vino", { hora: "14:00:00", estado: "no_show", numero_comensales: 5 }),
  reserva("tz-confirmada", { numero_comensales: 6, espacio_id: "tz-reservado", marca: "touza" }),
  reserva("tz-pendiente", { hora: "20:00:00", estado: "pendiente", numero_comensales: 8, marca: "touza" }),
  reserva("ct-otro-dia", { fecha: OTRO_DIA, numero_comensales: 10 }),
  reserva("tz-otro-dia", { fecha: OTRO_DIA, numero_comensales: 12, espacio_id: "tz-reservado", marca: "touza" }),
];

function envoltorio() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  doble.reiniciar();
  doble.tablas = {
    espacios_reserva: ESPACIOS,
    reservas: RESERVAS,
    configuracion_turnos: [],
  };
  // Solo se finge la fecha (los temporizadores siguen siendo reales, para `waitFor`).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${HOY}T12:00:00`));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useOcupacionSalasDia (rejillas del día: cuartos de hora, salas, formulario, solicitudes)", () => {
  it("solo salas y reservas de Casa Tomás: el aforo del turno es 170, no 250", async () => {
    const { result } = renderHook(() => useOcupacionSalasDia(HOY), { wrapper: envoltorio() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const datos = result.current.data!;
    expect(datos.espacios.map((e) => e.id)).toEqual(["ct-comedor", "ct-salon", "ct-terraza", "ct-reservado"]);
    expect(datos.espacios.reduce((s, e) => s + e.capacidad_maxima, 0)).toBe(170);
    // Las que ocupan sitio (o ya llegaron) de Casa Tomás; ni las dos de Touza ni las canceladas/«No vino».
    expect(datos.reservas.map((r) => r.id)).toEqual(["ct-confirmada", "ct-pendiente", "ct-llego"]);
  });
});

describe("useResumenOcupacionHoy (franja de cifras de la pestaña «Hoy»)", () => {
  it("reservas, comensales, capacidad y % solo de Casa Tomás", async () => {
    const { result } = renderHook(() => useResumenOcupacionHoy(), { wrapper: envoltorio() });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual({
      totalReservas: 3, // confirmada, pendiente y «Llegó»
      totalComensales: 9,
      reservasTodasEstados: 5,
      reservasCanceladas: 1,
      reservasConfirmadas: 1,
      reservasPendientes: 1,
      capacidadTotal: 170,
      porcentajeTotal: 5,
    });
  });
});

describe("useDashboardStats y las reservas de hoy del Dashboard", () => {
  it("useDashboardStats: las confirmadas del rango, solo de Casa Tomás", async () => {
    const { result } = renderHook(() => useDashboardStats(new Date(`${HOY}T00:00:00`), new Date("2026-10-07T00:00:00")), {
      wrapper: envoltorio(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.reservas.map((r: { id: string }) => r.id)).toEqual(["ct-confirmada", "ct-otro-dia"]);
  });

  it("useTodayReservations: las de hoy sin cancelar, solo de Casa Tomás", async () => {
    const { result } = renderHook(() => useTodayReservations(), { wrapper: envoltorio() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.map((r: { id: string }) => r.id)).toEqual([
      "ct-confirmada",
      "ct-pendiente",
      "ct-llego",
      "ct-no-vino",
    ]);
  });

  it("useTodayConfirmedReservations: las confirmadas de hoy, solo de Casa Tomás", async () => {
    const { result } = renderHook(() => useTodayConfirmedReservations(), { wrapper: envoltorio() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.map((r: { id: string }) => r.id)).toEqual(["ct-confirmada"]);
  });
});
