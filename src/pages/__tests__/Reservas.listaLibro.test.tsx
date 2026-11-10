/**
 * Pestaña «Lista» (10/11/2026, petición del dueño: «hacer o simular como el libro»): conmutador
 * «Libro | Tabla», por defecto el libro, recordado en el dispositivo (localStorage, con try/catch). Con un
 * filtro en la URL (la campana) se abre la tabla, que es la que filtra, sin tocar lo recordado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/reservas/VistaHoy", () => ({ VistaHoy: () => null }));
vi.mock("@/components/reservas/FormularioReserva", () => ({ FormularioReserva: () => null }));
vi.mock("@/components/reservas/ListaReservasAvanzada", () => ({ ListaReservasAvanzada: () => <div data-testid="tabla-lista" /> }));
vi.mock("@/components/reservas/libro/ListaComoLibro", () => ({
  ListaComoLibro: ({ extra }: { extra?: React.ReactNode }) => (
    <div data-testid="libro-lista">{extra}</div>
  ),
}));
vi.mock("@/components/reservas/CalendarioOcupacion", () => ({ CalendarioOcupacion: () => null }));
vi.mock("@/components/reservas/PlanoEspacio2D", () => ({ PlanoEspacio2D: () => null }));
vi.mock("@/components/reservas/servicio/ModoServicioPlano", () => ({ ModoServicioPlano: () => null }));
vi.mock("@/components/reservas/GestionBlacklist", () => ({ GestionBlacklist: () => null }));
vi.mock("@/components/reservas/ConfiguracionTurnos", () => ({ ConfiguracionTurnos: () => null }));
vi.mock("@/components/reservas/PanelAsignacion", () => ({ PanelAsignacion: () => null }));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: [] }) }));
vi.mock("@/hooks/useSolicitudesPendientes", () => ({ useSolicitudesPendientes: () => ({ solicitudes: [] }) }));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: "admin" }),
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));

import Reservas from "@/pages/Reservas";

function montar(ruta = "/reservas?tab=reservas") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Reservas />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("Reservas › Lista · conmutador «Libro | Tabla»", () => {
  it("por defecto se ve el libro", async () => {
    montar();
    expect(await screen.findByTestId("libro-lista")).toBeInTheDocument();
    expect(screen.queryByTestId("tabla-lista")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Libro/ })).toHaveAttribute("data-state", "on");
  });

  it("al elegir «Tabla» sale la tabla y se recuerda para la próxima vez", async () => {
    montar();
    fireEvent.click(await screen.findByRole("radio", { name: /Tabla/ }));
    expect(await screen.findByTestId("tabla-lista")).toBeInTheDocument();
    expect(screen.queryByTestId("libro-lista")).not.toBeInTheDocument();
    expect(localStorage.getItem("reservas.vistaLista")).toBe("tabla");

    cleanup();
    montar();
    expect(await screen.findByTestId("tabla-lista")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Libro/ }));
    expect(await screen.findByTestId("libro-lista")).toBeInTheDocument();
    expect(localStorage.getItem("reservas.vistaLista")).toBe("libro");
  });

  it("sin almacenamiento (modo privado) no rompe: libro por defecto y el conmutador funciona", async () => {
    const leer = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const escribir = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    try {
      montar();
      expect(await screen.findByTestId("libro-lista")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("radio", { name: /Tabla/ }));
      expect(await screen.findByTestId("tabla-lista")).toBeInTheDocument();
    } finally {
      leer.mockRestore();
      escribir.mockRestore();
    }
  });

  it("con un filtro en la URL (la campana) se abre la tabla sin cambiar lo recordado", async () => {
    montar("/reservas?tab=reservas&status=pendiente");
    expect(await screen.findByTestId("tabla-lista")).toBeInTheDocument();
    expect(localStorage.getItem("reservas.vistaLista")).toBeNull();
  });
});
