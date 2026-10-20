/**
 * Kanban de la pestaña «Hoy» SIN Touza (decisión del dueño, 2026-10-01: «toda la
 * lógica de reservas de Touza va fuera, no se reserva»).
 *
 * En la base de datos siguen las salas de Touza (activas: El Reservado, Terraza e
 * Interior) y alguna reserva de demostración de hoy. El kanban:
 *   · tiene UNA sola fila de columnas: «Sin asignar» + las salas de Casa Tomás,
 *     sin cabecera de negocio ni aforo por negocio;
 *   · no pinta ninguna sala de Touza — y hay DOS «Terraza»: la de Casa Tomás sí;
 *   · no pinta ni cuenta las reservas de Touza (ni en «Sin asignar»);
 *   · «Mover a…» solo ofrece salas de Casa Tomás.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ reservas: [] as Record<string, unknown>[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.neq = () => b;
      b.order = () => b;
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: h.reservas, error: null }).then(ok, ko);
      return b;
    },
  },
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({
    data: [
      { id: "ct-comedor", nombre: "Comedor", capacidad_maxima: 50, activa: true, caracteristicas: {} },
      { id: "ct-reservado", nombre: "Reservado", capacidad_maxima: 20, activa: true, caracteristicas: { marca: "casa_tomas" } },
      { id: "ct-terraza", nombre: "Terraza", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
      { id: "tz-reservado", nombre: "El Reservado", capacidad_maxima: 20, activa: true, caracteristicas: { marca: "touza" } },
      { id: "tz-terraza", nombre: "Terraza", capacidad_maxima: 30, activa: true, caracteristicas: { marca: "touza" } },
      { id: "tz-interior", nombre: "Interior", capacidad_maxima: 30, activa: true, caracteristicas: { marca: "touza" } },
    ],
  }),
}));
vi.mock("@/hooks/useAsignacionesMesa", () => ({ useAsignacionesMesa: () => ({ data: [] }) }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/useEdicionReserva", () => ({ useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }) }));
vi.mock("@/components/reservas/BlacklistModal", () => ({ BlacklistModal: () => null }));
vi.mock("@/components/reservas/ControlLlegada", () => ({ ControlLlegada: () => null }));
vi.mock("@/components/reservas/ElegirMesaDialog", () => ({ ElegirMesaDialog: () => null }));

import { GestorReservasKanban } from "@/components/reservas/GestorReservasKanban";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const reserva = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  telefono: null,
  email: null,
  hora: "21:00:00",
  numero_comensales: 4,
  estado: "confirmada",
  espacio_id: null,
  marca: "casa_tomas",
  canal: "web",
  importante: false,
  en_blacklist: false,
  ...extra,
});

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <GestorReservasKanban />
    </QueryClientProvider>,
  );
}

const columnas = () =>
  screen.getAllByRole("region", { name: /^Columna / }).map((c) => c.getAttribute("aria-label")?.replace("Columna ", ""));

describe("GestorReservasKanban · sin Touza", () => {
  it("una sola fila: «Sin asignar» + las salas de Casa Tomás; ninguna de Touza (por id, no por nombre)", async () => {
    h.reservas = [reserva("ct1", "Ana Casa", { espacio_id: "ct-terraza" })];
    montar();
    await screen.findByText("Ana Casa");

    expect(columnas()).toEqual(["Sin asignar", "Comedor", "Reservado", "Terraza"]);
    expect(screen.queryByText("El Reservado")).not.toBeInTheDocument();
    expect(screen.queryByText("Interior")).not.toBeInTheDocument();
    expect(screen.queryByText(/Sin asignar \(/)).not.toBeInTheDocument();
    // Sin cabecera de negocio ni «aforo comida X/Y · cena X/Y» por negocio.
    expect(screen.queryByText(/Casa Tomás|Touza/)).not.toBeInTheDocument();
    expect(screen.queryByText(/aforo comida/)).not.toBeInTheDocument();
    // La reserva en la Terraza de Casa Tomás sale en SU columna.
    expect(within(screen.getByRole("region", { name: "Columna Terraza" })).getByText("Ana Casa")).toBeInTheDocument();
  });

  it("las reservas de Touza de hoy ni se pintan ni cuentan (tampoco en «Sin asignar» ni en las barras de aforo)", async () => {
    h.reservas = [
      reserva("ct1", "Ana Casa"),
      reserva("tz1", "Touza Demo Hoy", { marca: "touza", espacio_id: "tz-reservado", numero_comensales: 6 }),
      reserva("tz2", "Touza Sin Sala", { marca: "touza", espacio_id: null }),
      // Una de Touza con la sala de Casa Tomás apuntada: tampoco (manda su marca).
      reserva("tz3", "Touza Cruzada", { marca: "touza", espacio_id: "ct-terraza", numero_comensales: 9 }),
    ];
    montar();
    await screen.findByText("Ana Casa");

    expect(screen.queryByText(/^Touza /)).not.toBeInTheDocument();
    const sinAsignar = screen.getByRole("region", { name: "Columna Sin asignar" });
    expect(within(sinAsignar).getByText("1")).toBeInTheDocument();
    // La Terraza de Casa Tomás no suma los 9 de «Touza Cruzada»: comida y cena siguen a 0.
    expect(within(screen.getByRole("region", { name: "Columna Terraza" })).getAllByText("0/50 pax")).toHaveLength(2);
  });

  it("«Mover a…» solo ofrece salas de Casa Tomás", async () => {
    h.reservas = [reserva("ct1", "Ana Casa")];
    montar();
    const trigger = await screen.findByRole("button", { name: /^Acciones de la reserva de Ana Casa/ });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");

    const destinos = within(menu)
      .getAllByRole("menuitem")
      .map((i) => i.textContent ?? "")
      .filter((t) => !/Editar reserva|Añadir a blacklist|Llamar/.test(t));
    expect(destinos.map((t) => t.replace(/\d+ pax$/, "").trim())).toEqual(["Comedor", "Reservado", "Terraza"]);
  });
});
