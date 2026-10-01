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
    // Touza no admite reservas (decisión del dueño 2026-10-01): el hook devuelve el día de Casa Tomás en
    // `data` (antes, el bloque del negocio pedido en `negocio`).
    data: {
      espacios: [
        { id: "comedor", nombre: "Comedor", capacidad_maxima: 100 },
        { id: "salon", nombre: "Salón", capacidad_maxima: 70 },
      ],
      reservas: [{ id: "r1", hora: "13:00:00", numero_comensales: 4, estado: "confirmada", espacio_id: "salon" }],
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
    const { container } = render(<DisponibilidadCuartos fecha="2026-10-05" />);
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
    render(<DisponibilidadCuartos fecha={null} />);
    expect(screen.getByText(/elige un día/i)).toBeInTheDocument();
  });

  // Touza no admite reservas (decisión del dueño 2026-10-01): una sola rejilla, sin «· Casa Tomás» ni otro negocio.
  it("el título no nombra ningún negocio", () => {
    render(<DisponibilidadCuartos fecha="2026-10-05" />);
    expect(screen.getByRole("heading", { name: "Disponibilidad por cuartos de hora" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Casa Tomás|Touza/);
  });

  it("compacta, sigue llevando su título (el panel del día y la verificación no tienen otro)", () => {
    render(<DisponibilidadCuartos fecha="2026-10-05" compacto />);
    expect(screen.getByRole("heading", { name: "Disponibilidad por cuartos de hora" })).toBeInTheDocument();
  });

  it.each([
    ["compacta", true],
    ["completa", false],
  ])("%s y con `ocultarTitulo` no repite el título a la vista, pero la sección conserva su nombre", (_, compacto) => {
    render(<DisponibilidadCuartos fecha="2026-10-05" compacto={compacto} ocultarTitulo />);
    expect(screen.queryByRole("heading", { name: "Disponibilidad por cuartos de hora" })).not.toBeInTheDocument();
    expect(screen.queryByText("Disponibilidad por cuartos de hora")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Disponibilidad por cuartos de hora" })).toBeInTheDocument();
    // La rejilla sigue entera.
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
