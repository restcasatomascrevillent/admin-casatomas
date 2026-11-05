/**
 * Reservas › Configuración › Turnos con permiso propio (04/11/2026, petición del dueño: «que haya un
 * permiso para esa pestaña configurable tal y como se hace en gestor web»).
 *
 * Con «Ver» en «Reservas · Configuración» se consulta todo; crear, cambiar, activar o borrar periodos de
 * servicio pide «Puede editar», igual que la RLS de configuracion_turnos (20261104111000).
 *
 * Desde el mismo día esto es solo el chip «Turnos» («pon subpestañas porque el scroll es eterno»): las
 * reglas ya no van encima, y el aviso de «Solo lectura» lo pone la página en cada chip
 * (Reservas.configuracion.test.tsx).
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
  it("con «Puede editar»: se crean, cambian, activan y borran periodos", () => {
    render(<ConfiguracionTurnos />);

    expect(screen.getByRole("button", { name: /Nuevo Periodo/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar el periodo Comida" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar el periodo Comida" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Periodo Comida activo" })).toBeEnabled();
    expect(screen.queryByText("Solo lectura")).not.toBeInTheDocument();
  });

  it("con solo «Ver»: se ve todo, pero sin crear, editar, activar ni borrar", () => {
    h.puedeEditar = false;
    render(<ConfiguracionTurnos />);

    expect(screen.getByText("Comida")).toBeInTheDocument();
    expect(screen.getByText("13:00 - 16:00")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nuevo Periodo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar el periodo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Eliminar el periodo/ })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Periodo Comida activo" })).toBeDisabled();
    // El aviso lo pone la página, encima de cada chip: aquí no se repite.
    expect(screen.queryByText("Solo lectura")).not.toBeInTheDocument();
  });

  it("es solo el chip «Turnos»: las reglas de reservas ya no van encima", () => {
    render(<ConfiguracionTurnos />);

    expect(screen.getByRole("heading", { name: "Configuración de Turnos" })).toBeInTheDocument();
    expect(screen.queryByText(/Reglas/)).not.toBeInTheDocument();
    expect(screen.queryByText("Mesas y aforo por espacio")).not.toBeInTheDocument();
  });
});
