/**
 * Kanban de la pestaña «Hoy»: editar una reserva desde el menú «⋮» de su
 * tarjeta (2026-09-30: las reservas se editan siempre, desde cualquier vista).
 *
 * El Kanban enseña las reservas de HOY que no están canceladas (la consulta
 * lleva `neq("estado","cancelada")`: las canceladas de hoy solo cuentan en el
 * resumen y se editan desde la pestaña «Lista»). Para todo lo que sí enseña, en
 * cualquier estado —pendiente, verificada, confirmada, «Llegó», «No vino»— el
 * menú lleva «Editar reserva», esté la tarjeta movible o no.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  reservas: [] as Record<string, unknown>[],
  consultas: [] as Array<{ filtros: Array<[string, string, unknown]> }>,
  canEdit: true,
  editarReserva: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const consulta: { filtros: Array<[string, string, unknown]> } = { filtros: [] };
      h.consultas.push(consulta);
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (c: string, v: unknown) => (consulta.filtros.push(["eq", c, v]), b);
      b.neq = (c: string, v: unknown) => (consulta.filtros.push(["neq", c, v]), b);
      b.order = () => b;
      b.update = () => b;
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: h.reservas, error: null }).then(ok, ko);
      return b;
    },
  },
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({
    data: [
      { id: "salon", nombre: "Salón", capacidad_maxima: 60, activa: true, caracteristicas: { marca: "casa_tomas" } },
      { id: "terraza", nombre: "Terraza", capacidad_maxima: 30, activa: true, caracteristicas: { marca: "casa_tomas" } },
    ],
  }),
}));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: h.canEdit, loading: false }),
}));
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({ editarReserva: h.editarReserva, dialogoEdicion: null }),
}));
vi.mock("@/components/reservas/BlacklistModal", () => ({ BlacklistModal: () => null }));
vi.mock("@/components/reservas/ControlLlegada", () => ({ ControlLlegada: () => null }));

import { GestorReservasKanban } from "@/components/reservas/GestorReservasKanban";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const reserva = (id: string, estado: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  telefono: "+34612345678",
  email: null,
  hora: "21:00:00",
  numero_comensales: 4,
  estado,
  espacio_id: "salon",
  marca: "casa_tomas",
  canal: "telefono",
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

/** Abre el menú «⋮» de la tarjeta de ese cliente (Radix abre con el teclado en jsdom). */
async function abrirMenu(cliente: string) {
  const trigger = await screen.findByRole("button", { name: new RegExp(`^Acciones de la reserva de ${cliente}`) });
  fireEvent.keyDown(trigger, { key: "Enter" });
  return await screen.findByRole("menu");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.canEdit = true;
  h.consultas = [];
  h.reservas = [
    reserva("r-pendiente", "pendiente", "Ana Pendiente"),
    reserva("r-verificada", "verificada", "Berta Verificada"),
    reserva("r-confirmada", "confirmada", "Carlos Confirmado"),
    reserva("r-llego", "completada", "Elena Llego"),
    reserva("r-no-vino", "no_show", "Fede NoVino"),
  ];
});

describe("GestorReservasKanban · editar desde la tarjeta", () => {
  it.each([
    ["Ana Pendiente", "r-pendiente"],
    ["Berta Verificada", "r-verificada"],
    ["Carlos Confirmado", "r-confirmada"],
    ["Elena Llego", "r-llego"],
    ["Fede NoVino", "r-no-vino"],
  ])("el menú de la tarjeta de %s lleva «Editar reserva» y abre el editor de esa reserva", async (cliente, id) => {
    montar();

    const menu = await abrirMenu(cliente);
    const editar = within(menu).getByRole("menuitem", { name: /Editar reserva/ });
    expect(editar).not.toHaveAttribute("aria-disabled", "true");
    expect(editar).not.toHaveAttribute("data-disabled");

    fireEvent.click(editar);
    await waitFor(() => expect(h.editarReserva).toHaveBeenCalledWith(id));
    expect(h.editarReserva).toHaveBeenCalledTimes(1);
  });

  it("una reserva que no se puede mover («No vino») se puede editar igual", async () => {
    montar();

    const menu = await abrirMenu("Fede NoVino");

    expect(within(menu).getByText("No se puede mover en este estado")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Editar reserva/ })).not.toHaveAttribute("data-disabled");
  });

  it("sin permiso de edición sobre «reservas» el ítem sale deshabilitado y no abre nada", async () => {
    h.canEdit = false;
    montar();

    const menu = await abrirMenu("Ana Pendiente");
    const editar = within(menu).getByRole("menuitem", { name: /Editar reserva/ });

    expect(editar).toHaveAttribute("data-disabled");
    // Un ítem deshabilitado no recibe el ratón (`pointer-events-none`): el motivo solo se ve en su envoltorio.
    expect(editar.parentElement).toHaveAttribute("title", expect.stringMatching(/No tienes permiso para editar reservas/));
    fireEvent.click(editar);
    expect(h.editarReserva).not.toHaveBeenCalled();
  });

  it("con permiso el ítem no lleva ningún motivo: no hay nada que explicar", async () => {
    montar();

    const menu = await abrirMenu("Ana Pendiente");
    const editar = within(menu).getByRole("menuitem", { name: /Editar reserva/ });

    expect(editar.parentElement).not.toHaveAttribute("title");
  });

  it("no toca lo de siempre: «Mover a…», «Llamar» y «Añadir a blacklist» siguen en el menú", async () => {
    montar();

    const menu = await abrirMenu("Ana Pendiente");

    expect(within(menu).getByText("Mover a…")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Llamar/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Añadir a blacklist/ })).toBeInTheDocument();
  });

  it("las canceladas de hoy no salen en el Kanban (por diseño): se editan desde «Lista»", async () => {
    montar();

    await screen.findByRole("button", { name: /^Acciones de la reserva de Ana Pendiente/ });
    const consulta = h.consultas.find((c) => c.filtros.some(([, columna]) => columna === "fecha"))!;
    expect(consulta.filtros).toContainEqual(["neq", "estado", "cancelada"]);
  });
});
