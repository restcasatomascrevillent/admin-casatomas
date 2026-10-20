/**
 * Widget «Reservas de Hoy» del Dashboard: la barra de ocupación es la de Casa Tomás contra SU aforo.
 *
 * Touza no admite reservas (decisión del dueño 2026-10-01), pero sus tres salas siguen activas en la base
 * de datos (80 plazas) y sus reservas de demostración también. El widget suma solo las salas activas de
 * Casa Tomás (`sumarCapacidadPorMarca` con la marca de cada sala, sacada de `caracteristicas`), igual que
 * el trigger de aforo, y solo cuenta reservas de Casa Tomás (`useTodayReservations`). Aquí corre TODO de
 * verdad (los hooks del dashboard incluidos) contra el doble de Supabase de los tests de hooks, que filtra
 * y devuelve solo las columnas pedidas: si alguien sumara todas las salas, dejara de pedir
 * `caracteristicas` o dejara pasar las reservas de Touza, la cifra cambiaría y este test caería.
 *
 * El Reservado de Casa Tomás (`privada: true`) está FUERA DE AFORO (decisión del dueño, 2026-10-03): no suma
 * sus 20 plazas (el aforo es 150, no 170) y sus reservas no entran en ninguna cifra.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", async () => {
  const { crearDobleTablas } = await import("@/hooks/__tests__/dobleSupabaseTablas");
  return { supabase: crearDobleTablas() };
});
vi.mock("@/components/notificaciones/CentroNotificaciones", () => ({ CentroNotificaciones: () => null }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }),
}));

import { supabase } from "@/integrations/supabase/client";
import type { DobleTablas } from "@/hooks/__tests__/dobleSupabaseTablas";
import { ReservasHoy } from "@/components/dashboard/widgets/ReservasHoy";

const doble = supabase as unknown as DobleTablas;
const HOY = "2026-10-01";

const sala = (id: string, capacidad: number, caracteristicas: unknown, activa = true) => ({
  id,
  nombre: id,
  capacidad_maxima: capacidad,
  activa,
  caracteristicas,
});

const reserva = (id: string, o: Record<string, unknown>) => ({
  id,
  fecha: HOY,
  hora: "21:00:00",
  nombre: `Cliente ${id}`,
  numero_comensales: 2,
  estado: "confirmada",
  notas_cliente: null,
  en_blacklist: false,
  marca: "casa_tomas",
  ...o,
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
  doble.reiniciar();
  doble.tablas = {
    espacios_reserva: [
      sala("ct-comedor", 50, {}),
      sala("ct-salon", 50, null),
      sala("ct-terraza", 50, { marca: "casa_tomas" }),
      sala("ct-reservado", 20, { marca: "casa_tomas", privada: true }),
      sala("ct-bodega", 40, { marca: "casa_tomas" }, false),
      sala("tz-reservado", 20, { privada: true, marca: "touza" }),
      sala("tz-terraza", 30, { marca: "touza" }),
      sala("tz-interior", 30, { marca: "touza" }),
    ],
    reservas: [
      reserva("ct-confirmada", { numero_comensales: 4 }),
      reserva("ct-pendiente", { hora: "13:30:00", estado: "pendiente", numero_comensales: 2 }),
      reserva("ct-cancelada", { estado: "cancelada", numero_comensales: 6 }),
      reserva("tz-confirmada", { numero_comensales: 6, marca: "touza" }),
      reserva("tz-pendiente", { hora: "20:00:00", estado: "pendiente", numero_comensales: 8, marca: "touza" }),
    ],
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${HOY}T12:00:00`));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ReservasHoy · ocupación de Casa Tomás contra su aforo", () => {
  it("suma solo las salas activas de Casa Tomás SIN el Reservado (150, no 250 ni 170) y cuenta solo sus reservas", async () => {
    montar();

    // 4 + 2 comensales de Casa Tomás sobre 150: con las salas de Touza serían 250; con sus reservas, 20 y 4.
    expect(await screen.findByText("6/150 pax · 2 res.")).toBeInTheDocument();
    expect(screen.getByText("4%")).toBeInTheDocument();
  });

  it("el Reservado ocupado NO entra en las cifras (ni reservas ni comensales ni %)", async () => {
    (doble.tablas.reservas as unknown[]).push(
      reserva("ct-reservado-garcia", { hora: "14:00:00", nombre: "García", numero_comensales: 8, espacio_id: "ct-reservado" }),
    );
    montar();

    expect(await screen.findByText("6/150 pax · 2 res.")).toBeInTheDocument();
    expect(screen.getByText("4%")).toBeInTheDocument();
  });
});
