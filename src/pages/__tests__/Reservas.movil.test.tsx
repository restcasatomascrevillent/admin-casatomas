/**
 * /reservas en móvil (< 768 px, 07/11/2026, petición del dueño): el teléfono del camarero es SOLO para sentar.
 * Solo «Hoy», sin pestañas, sin «Nueva reserva» ni avisos; un `?tab=otra` cae también en «Hoy», y el layout
 * va sin la barra superior (`sinCabeceraMovil`). En tablet/escritorio siguen las pestañas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ movil: true, layout: [] as Array<boolean | undefined> }));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children, sinCabeceraMovil }: { children: React.ReactNode; sinCabeceraMovil?: boolean }) => {
    h.layout.push(sinCabeceraMovil);
    return <div>{children}</div>;
  },
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => h.movil }));
vi.mock("@/components/reservas/VistaHoy", () => ({ VistaHoy: () => <div data-testid="vista-hoy" /> }));
vi.mock("@/components/avisos/BotonAvisosSeccion", () => ({ BotonAvisosSeccion: () => <button type="button">Avisos</button> }));
vi.mock("@/components/reservas/ListaReservasAvanzada", () => ({ ListaReservasAvanzada: () => <div data-testid="lista" /> }));
vi.mock("@/components/reservas/CalendarioOcupacion", () => ({ CalendarioOcupacion: () => null }));
vi.mock("@/components/reservas/PanelAsignacion", () => ({ PanelAsignacion: () => null }));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: [] }) }));
vi.mock("@/hooks/useSolicitudesPendientes", () => ({ useSolicitudesPendientes: () => ({ solicitudes: [] }) }));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: "admin" }),
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));

import Reservas from "@/pages/Reservas";

const montar = (url = "/reservas") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Reservas />
    </MemoryRouter>,
  );

beforeEach(() => {
  h.movil = true;
  h.layout = [];
});

describe("Reservas (página) en móvil · solo «Hoy»", () => {
  it("sin pestañas, sin «Nueva Reserva» ni avisos, y sin la barra superior", () => {
    montar();
    expect(screen.getByTestId("vista-hoy")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("button", { name: /Nueva Reserva/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Avisos" })).toBeNull();
    expect(h.layout.at(-1)).toBe(true);
  });

  it("`?tab=reservas` (u otra) en móvil enseña Hoy igualmente", () => {
    montar("/reservas?tab=reservas");
    expect(screen.getByTestId("vista-hoy")).toBeInTheDocument();
    expect(screen.queryByTestId("lista")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("en tablet/escritorio no cambia: pestañas, «Nueva Reserva» y con barra", () => {
    h.movil = false;
    montar();
    expect(screen.getByRole("tab", { name: "Lista" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nueva Reserva/ })).toBeInTheDocument();
    expect(h.layout.at(-1)).toBeFalsy();
  });
});
