/**
 * «Sin reserva» (10/11/2026, petición del dueño): «cuando llega alguien y lo quiero sentar en una nueva mesa,
 * […] que me salga como cuando llega alguien con reserva pero sin mesa, que salen todas las mesas». El
 * diálogo enseña el MISMO selector (`SelectorMesaMovil`): todas las mesas de todas las salas donde caben, con
 * su estado (libre / prevista para otra reserva / ocupada); la mejor libre viene marcada; elegir una prevista
 * avisa y, al aceptar, le quita la mesa a esa reserva antes de sentar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ llamadas: [] as string[], asignaciones: [] as unknown[] }));

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/useHoyLocal", () => ({ useHoyLocal: () => "2026-11-07" }));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({
    data: [
      { id: "s1", nombre: "Comedor" },
      { id: "s2", nombre: "Terraza" },
    ],
  }),
}));
vi.mock("@/hooks/useMesas", () => ({
  useMesas: () => ({
    data: [
      { id: "m3", nombre: "3", espacio_id: "s1", capacidad: 4, activa: true },
      { id: "m7", nombre: "7", espacio_id: "s1", capacidad: 4, activa: true },
      { id: "m9", nombre: "9", espacio_id: "s1", capacidad: 4, activa: true },
      { id: "m2", nombre: "2", espacio_id: "s1", capacidad: 2, activa: true },
      { id: "t1", nombre: "T1", espacio_id: "s2", capacidad: 6, activa: true },
    ],
  }),
}));
vi.mock("@/hooks/useAsignacionesMesa", () => ({
  useAsignacionesMesa: () => ({ data: h.asignaciones }),
  useAsignarMesasReserva: () => ({
    mutateAsync: async ({ reserva_id, mesa_ids }: { reserva_id: string; mesa_ids: string[] }) => {
      h.llamadas.push(`asignar:${reserva_id}:[${mesa_ids.join(",")}]`);
      return [];
    },
  }),
}));
vi.mock("@/hooks/useAjustesMesaServicio", () => ({ useAjustesMesaDia: () => ({ data: [] }) }));
vi.mock("@/hooks/useConfiguracionReservas", () => ({ useConfiguracionReservas: () => ({ data: undefined }) }));
vi.mock("@/hooks/useSentarSinReserva", () => ({
  useSentarSinReserva: () => ({
    isPending: false,
    mutateAsync: async ({ personas, mesa, nombre }: { personas: number; mesa: { id: string } | null; nombre: string }) => {
      h.llamadas.push(`sinReserva:${personas}:${mesa?.id ?? "-"}:${nombre}`);
      return { id: "nueva", nombre: nombre || "Sin reserva 21:05", errorMesa: null };
    },
  }),
  deshacerSinReserva: vi.fn(),
}));

import { BotonSentarSinReserva } from "@/components/reservas/SentarSinReserva";

const asig = (mesa: string, reserva: string, nombre: string, hora: string, estado: string) => ({
  id: `${reserva}-${mesa}`,
  reserva_id: reserva,
  mesa_id: mesa,
  created_at: "x",
  reservas: { id: reserva, nombre, hora, numero_comensales: 2, estado, salida_at: null },
  mesas: { id: mesa, nombre: mesa.slice(1), capacidad: 4, espacio_id: "s1" },
});

function abrir() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <BotonSentarSinReserva />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Sin reserva/ }));
  return screen.getByRole("dialog");
}

beforeEach(() => {
  h.llamadas = [];
  // García tiene prevista la 7 a las 21:30; Pérez está sentado en la 9.
  h.asignaciones = [asig("m7", "g", "García", "21:30:00", "confirmada"), asig("m9", "p", "Pérez", "20:30:00", "completada")];
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 10, 7, 21, 5));
});
afterEach(() => vi.useRealTimers());

describe("Sin reserva: elegir entre todas las mesas", () => {
  it("con cuántos son, salen todas las mesas donde caben de todas las salas, con su estado; la mejor libre marcada", () => {
    const dialogo = abrir();
    expect(within(dialogo).queryByTestId("selector-mesa")).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: "3" }));
    const selector = within(within(dialogo).getByTestId("selector-mesa"));
    expect(selector.getByRole("region", { name: "Comedor" })).toBeInTheDocument();
    expect(selector.getByRole("region", { name: "Terraza" })).toBeInTheDocument();
    expect(selector.getByRole("button", { name: /Mesa 3, 4 plazas, Comedor: Libre/ })).toHaveAttribute("aria-pressed", "true");
    expect(selector.getByRole("button", { name: /Mesa 7, .*Prevista: García 21:30/ })).toHaveAttribute("aria-pressed", "false");
    expect(selector.getByRole("button", { name: /Mesa 9, .*Ocupada · Pérez/ })).toBeDisabled();
    expect(selector.getByRole("button", { name: /Mesa T1, 6 plazas, Terraza: Libre/ })).toBeInTheDocument();
    // La de 2 no cabe para 3.
    expect(selector.queryByRole("button", { name: /Mesa 2,/ })).toBeNull();
    expect(within(dialogo).getByRole("button", { name: "Sentar en mesa 3" })).toBeEnabled();
  });

  it("tocar otra mesa la marca y sienta ahí (nombre opcional)", async () => {
    const dialogo = abrir();
    fireEvent.change(within(dialogo).getByRole("textbox", { name: "Número de personas" }), { target: { value: "5" } });
    const selector = within(within(dialogo).getByTestId("selector-mesa"));
    // Para 5 solo cabe la T1 de la terraza.
    expect(selector.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(selector.getByRole("button", { name: /Mesa T1/ }));
    fireEvent.change(within(dialogo).getByRole("textbox", { name: "Nombre (opcional)" }), { target: { value: "Paco" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Sentar en mesa T1" }));
    await waitFor(() => expect(h.llamadas).toEqual(["sinReserva:5:t1:Paco"]));
  });

  it("una mesa prevista para otra reserva: avisa y, al aceptar, se la quita antes de sentar", async () => {
    const dialogo = abrir();
    fireEvent.click(within(dialogo).getByRole("button", { name: "2" }));
    fireEvent.click(within(dialogo).getByRole("button", { name: /Mesa 7, .*Prevista: García/ }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Sentar en mesa 7" }));
    expect(within(dialogo).getByRole("alert")).toHaveTextContent("La mesa 7 estaba prevista para García (21:30).");
    expect(h.llamadas).toEqual([]);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Sentar igualmente" }));
    await waitFor(() => expect(h.llamadas).toEqual([expect.stringMatching(/^asignar:g:/), "sinReserva:2:m7:"]));
  });

  it("si no cabe en ninguna mesa, se sientan sin mesa", async () => {
    const dialogo = abrir();
    fireEvent.change(within(dialogo).getByRole("textbox", { name: "Número de personas" }), { target: { value: "40" } });
    expect(within(dialogo).queryByTestId("selector-mesa")).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: /^(Sentar sin mesa|Hacer y sentar)/ }));
    await waitFor(() => expect(h.llamadas).toHaveLength(1));
  });
});
