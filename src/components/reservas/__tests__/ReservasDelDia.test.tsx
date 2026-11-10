import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const datos = vi.hoisted(() => ({
  reservas: [
    { id: "a", nombre: "Ana", hora: "21:00:00", numero_comensales: 4, estado: "confirmada", espacio_id: "s1", notas_cliente: "trona" },
    { id: "b", nombre: "Beto", hora: "13:30:00", numero_comensales: 2, estado: "pendiente", espacio_id: null },
    { id: "c", nombre: "Cris", hora: "13:00:00", numero_comensales: 6, estado: "cancelada", espacio_id: null },
    { id: "d", nombre: "Dani", hora: "14:00:00", numero_comensales: 3, estado: "no_show", espacio_id: null },
  ] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/useReservasServicioDia", () => ({
  useReservasServicioDia: () => ({ data: datos.reservas, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useOcupacionSalasDia", () => ({
  useOcupacionSalasDia: () => ({ data: { espacios: [{ id: "s1", nombre: "Comedor", capacidad_maxima: 150 }] } }),
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({ data: [{ id: "s1", nombre: "Comedor" }] }),
}));

import { ReservasDelDia, agruparReservasDelDia } from "@/components/reservas/ReservasDelDia";

describe("ReservasDelDia", () => {
  it("agrupa por turno, sin canceladas y sin contar «No vino»", () => {
    const g = agruparReservasDelDia(datos.reservas as never);
    expect(g.map((x) => [x.turno, x.reservas.map((r) => r.id), x.pax])).toEqual([
      ["comida", ["b", "d"], 2],
      ["cena", ["a"], 4],
    ]);
  });

  it("muestra totales, sala, notas y elige la hora al pulsarla", () => {
    const onSel = vi.fn();
    render(<ReservasDelDia fecha="2026-11-15" onSeleccionarHora={onSel} />);
    expect(screen.getByText(/Comida · 2 reservas · 2 pax \/ 150/)).toBeTruthy();
    expect(screen.getByText(/Cena · 1 reserva · 4 pax \/ 150/)).toBeTruthy();
    expect(screen.queryByText("Cris")).toBeNull();
    expect(screen.getByText("Comedor")).toBeTruthy();
    expect(screen.getByText(/trona/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Elegir las 13:30" }));
    expect(onSel).toHaveBeenCalledWith("13:30");
  });

  it("marca la reserva que se edita", () => {
    render(<ReservasDelDia fecha="2026-11-15" excluirReservaId="a" />);
    const fila = screen.getByText("Ana").closest("li")!;
    expect(within(fila).getByText("(esta reserva)")).toBeTruthy();
  });
});
