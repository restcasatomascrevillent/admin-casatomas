/**
 * Tests para src/components/reservas/DisponibilidadCuartos.tsx
 *
 * La cuenta está probada en lib/reservas/__tests__/rejillaCuartos.test.ts;
 * aquí solo se fija que la vista enseña TODAS las horas del turno, que cada
 * hora se puede elegir y que no aparece ninguna sala.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/hooks/useOcupacionSalasDia", () => ({
  useOcupacionSalasDia: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    negocio: {
      marca: "casa_tomas",
      espacios: [
        { id: "comedor", nombre: "Comedor", capacidad_maxima: 100, marca: "casa_tomas" },
        { id: "salon", nombre: "Salón", capacidad_maxima: 70, marca: "casa_tomas" },
      ],
      reservas: [{ id: "r1", hora: "13:00:00", numero_comensales: 4, estado: "confirmada", espacio_id: "salon", marca: "casa_tomas" }],
      horasBase: ["13:00"],
      cerrado: false,
    },
  }),
}));
vi.mock("@/hooks/useConfiguracionTurnos", () => ({
  useConfiguracionTurnos: () => ({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    data: [{ hora_inicio: "13:00:00", hora_fin: "16:00:00", activo: true, espacio_id: null, dias_semana: [] }],
  }),
}));
vi.mock("@/hooks/useConfiguracionReservas", () => ({
  useConfiguracionReservas: () => ({ data: { estancia_comida_minutos: 105, estancia_cena_minutos: 120 } }),
}));

import { DisponibilidadCuartos } from "@/components/reservas/DisponibilidadCuartos";

describe("DisponibilidadCuartos", () => {
  it("enseña los 12 cuartos de la comida, sin escalera y sin salas", () => {
    const { container } = render(<DisponibilidadCuartos fecha="2026-10-05" marca="casa_tomas" />);
    const tabla = screen.getByRole("table");
    const cabeceras = within(tabla).getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabeceras).toEqual([
      "Hora",
      "13:00", "13:15", "13:30", "13:45", "14:00", "14:15", "14:30", "14:45", "15:00", "15:15", "15:30", "15:45",
    ]);
    expect(screen.getByText(/4\/170 · quedan 166/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Salón|Comedor/);
  });

  it("cada hora es un botón que la elige, y la elegida se marca", () => {
    const onSeleccionarHora = vi.fn();
    render(
      <DisponibilidadCuartos
        fecha="2026-10-05"
        marca="casa_tomas"
        hora="14:15"
        comensales={6}
        onSeleccionarHora={onSeleccionarHora}
      />,
    );
    expect(screen.getByRole("button", { name: /Elegir las 14:15/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Elegir las 13:45/ }));
    expect(onSeleccionarHora).toHaveBeenCalledWith("13:45");
    expect(screen.getByText("Caben 6 más")).toBeInTheDocument();
  });

  it("sin fecha pide elegir un día", () => {
    render(<DisponibilidadCuartos fecha={null} marca="casa_tomas" />);
    expect(screen.getByText(/elige un día/i)).toBeInTheDocument();
  });
});
