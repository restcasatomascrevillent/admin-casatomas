/**
 * Kanban de «Hoy» → vista «Plano» (06/10/2026): tocar el NOMBRE de una sala abre su plano.
 *
 * Y lo que el kanban recibe ahora de fuera (de `VistaHoy`, común a las dos vistas): el buscador y el
 * turno. El kanban sigue filtrando EXACTAMENTE igual que cuando eran suyos (`coincideFiltroHoy`).
 * Nada llega a Supabase: el cliente está mockeado (como en `…tarjeta.test.tsx`).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ reservas: [] as Record<string, unknown>[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "neq", "order"]) b[m] = () => b;
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: tabla === "asignaciones_mesa" ? [] : h.reservas, error: null }).then(ok, ko);
      return b;
    },
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({
    data: [
      { id: "salon", nombre: "Salón", capacidad_maxima: 60, activa: true, caracteristicas: { marca: "casa_tomas" } },
      { id: "terraza", nombre: "Terraza", capacidad_maxima: 30, activa: true, caracteristicas: { marca: "casa_tomas" } },
    ],
  }),
}));
vi.mock("@/hooks/useUserRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useUserRole")>()),
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));
vi.mock("@/components/reservas/BlacklistModal", () => ({ BlacklistModal: () => null }));
vi.mock("@/components/reservas/ElegirMesaDialog", () => ({ ElegirMesaDialog: () => null }));

import { GestorReservasKanban } from "@/components/reservas/GestorReservasKanban";
import type { FiltroTurnoHoy } from "@/lib/reservas/vistaHoy";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const reserva = (id: string, nombre: string, hora: string, espacio_id: string | null) => ({
  id,
  nombre,
  telefono: null,
  email: null,
  hora,
  numero_comensales: 2,
  estado: "confirmada",
  espacio_id,
  marca: "casa_tomas",
  importante: false,
  en_blacklist: false,
});

function montar(props: { busqueda?: string; filtroTurno?: FiltroTurnoHoy; onVerPlanoSala?: (id: string) => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <GestorReservasKanban {...props} />
    </QueryClientProvider>,
  );
}

const columna = (nombre: string) => screen.getByRole("region", { name: `Columna ${nombre}` });

beforeEach(() => {
  h.reservas = [
    reserva("r1", "Ana Comida", "14:00:00", "salon"),
    reserva("r2", "Luis Cena", "21:00:00", "salon"),
    reserva("r3", "Sin Sala", "13:00:00", null),
  ];
});

describe("Kanban · el nombre de una sala abre su plano", () => {
  it("con `onVerPlanoSala`, el nombre de cada sala es un botón que abre ESA sala (y «Sin asignar» no, no tiene plano)", async () => {
    const onVerPlanoSala = vi.fn();
    montar({ onVerPlanoSala });
    await screen.findByRole("button", { name: /^Ana Comida,/ });

    const boton = within(columna("Salón")).getByRole("button", { name: "Ver Salón en el plano" });
    fireEvent.click(boton);
    expect(onVerPlanoSala).toHaveBeenCalledWith("salon");
    fireEvent.click(within(columna("Terraza")).getByRole("button", { name: "Ver Terraza en el plano" }));
    expect(onVerPlanoSala).toHaveBeenLastCalledWith("terraza");
    expect(within(columna("Sin asignar")).queryByRole("button", { name: /en el plano/ })).toBeNull();
    // Se ve igual que antes: el nombre, dentro del título de la columna.
    const titulo = within(columna("Salón")).getByRole("heading");
    expect(titulo).toContainElement(boton);
    expect(titulo).toHaveTextContent(/^Salón$/);
  });

  it("sin `onVerPlanoSala` el nombre es solo texto, como siempre", async () => {
    montar();
    await screen.findByRole("button", { name: /^Ana Comida,/ });
    expect(screen.queryByRole("button", { name: /en el plano/ })).toBeNull();
    expect(within(columna("Salón")).getByRole("heading", { name: "Salón" })).toBeInTheDocument();
  });
});

describe("Kanban · el buscador y el turno llegan de fuera y filtran igual que antes", () => {
  it("«Cena» deja solo las de la cena", async () => {
    montar({ filtroTurno: "cena" });
    await screen.findByRole("button", { name: /^Luis Cena,/ });
    expect(screen.queryByRole("button", { name: /^Ana Comida,/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Sin Sala,/ })).toBeNull();
  });

  it("el texto busca en el nombre sin mayúsculas", async () => {
    montar({ busqueda: "ANA" });
    await screen.findByRole("button", { name: /^Ana Comida,/ });
    expect(screen.queryByRole("button", { name: /^Luis Cena,/ })).toBeNull();
  });

  it("sin nada (montado suelto), lo enseña todo: no hay buscador dentro del kanban", async () => {
    montar();
    await screen.findByRole("button", { name: /^Ana Comida,/ });
    expect(screen.getByRole("button", { name: /^Luis Cena,/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Sin Sala,/ })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Buscar reservas" })).toBeNull();
  });
});
