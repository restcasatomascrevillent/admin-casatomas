/**
 * Reservas › Configuración › General con permiso propio (04/11/2026, petición del dueño: «que haya un
 * permiso para esa pestaña configurable tal y como se hace en gestor web»).
 *
 * Con «Ver» en «Reservas · Configuración» se consulta todo; crear, cambiar, activar o borrar periodos de
 * servicio pide «Puede editar», igual que la RLS de configuracion_turnos (20261104111000). Sin edición se
 * explica una vez, arriba, que es solo lectura (vale también para las reglas de debajo, que apagan sus
 * campos: ConfiguracionGeneralReservas.ocupacion.test.tsx).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ puedeEditar: true }));

vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (seccion: string, tipo: string = "view") => ({
    canAccess: seccion === "reservas_configuracion" && (tipo === "view" || h.puedeEditar),
    loading: false,
  }),
}));
vi.mock("@/components/reservas/ConfiguracionGeneralReservas", () => ({
  ConfiguracionGeneralReservas: () => <div data-testid="reglas-generales" />,
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: [] }) }));
vi.mock("@/hooks/useConfiguracionTurnos", () => {
  const mutacion = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useConfiguracionTurnos: () => ({
      isLoading: false,
      data: [
        {
          id: "t-comida",
          nombre_periodo: "Comida",
          hora_inicio: "13:00",
          hora_fin: "16:00",
          intervalo_base_minutos: 30,
          umbral_apertura_secundario: 70,
          dias_semana: [0, 1, 2, 3, 4, 5, 6],
          activo: true,
          espacio_id: null,
          ocultar_primario_si_secundario: false,
          niveles_escalera: null,
          ocultar_nivel_anterior: null,
          base_umbral: null,
        },
      ],
    }),
    useCrearConfiguracionTurno: mutacion,
    useActualizarConfiguracionTurno: mutacion,
    useEliminarConfiguracionTurno: mutacion,
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ConfiguracionTurnos } from "@/components/reservas/ConfiguracionTurnos";

beforeEach(() => {
  h.puedeEditar = true;
});

describe("ConfiguracionTurnos · «Reservas · Configuración»", () => {
  it("con «Puede editar»: se crean, cambian, activan y borran periodos, sin aviso de solo lectura", () => {
    render(<ConfiguracionTurnos />);

    expect(screen.getByRole("button", { name: /Nuevo Periodo/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar el periodo Comida" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar el periodo Comida" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Periodo Comida activo" })).toBeEnabled();
    expect(screen.queryByText("Solo lectura")).not.toBeInTheDocument();
  });

  it("con solo «Ver»: se ve todo, pero sin crear, editar, activar ni borrar, y se dice por qué", () => {
    h.puedeEditar = false;
    render(<ConfiguracionTurnos />);

    expect(screen.getByTestId("reglas-generales")).toBeInTheDocument();
    expect(screen.getByText("Comida")).toBeInTheDocument();
    expect(screen.getByText("13:00 - 16:00")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nuevo Periodo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar el periodo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Eliminar el periodo/ })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Periodo Comida activo" })).toBeDisabled();
    expect(screen.getByText("Solo lectura")).toBeInTheDocument();
    expect(screen.getByText(/no tiene «Puede editar» en «Reservas · Configuración»/)).toBeInTheDocument();
  });
});
