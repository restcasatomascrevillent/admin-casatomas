/**
 * Reservas › Configuración (04/11/2026, petición del dueño: «mueve la sección de plantillas email del
 * superadmin a reservas … dentro de la subsección de configuración como otra subpestaña más»).
 *
 * Configuración tiene ahora dos subpestañas en chips (como Cheques › Configuración): «General» (lo de
 * siempre: reglas, mesas y turnos) y «Plantillas email». Se llega directo a la segunda con
 * `?tab=configuracion&sub=plantillas`, que es adonde redirige la ruta vieja /super-admin/plantillas-email.
 * Quién puede editar las plantillas lo prueba EditorPlantillasEmail.permisos.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

const h = vi.hoisted(() => ({ rol: "admin" as string | null }));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/reservas/VistaHoy", () => ({ VistaHoy: () => <div data-testid="vista-hoy" /> }));
vi.mock("@/components/reservas/FormularioReserva", () => ({ FormularioReserva: () => null }));
vi.mock("@/components/reservas/ListaReservasAvanzada", () => ({ ListaReservasAvanzada: () => null }));
vi.mock("@/components/reservas/CalendarioOcupacion", () => ({ CalendarioOcupacion: () => null }));
vi.mock("@/components/reservas/PlanoEspacio2D", () => ({ PlanoEspacio2D: () => null }));
vi.mock("@/components/reservas/servicio/ModoServicioPlano", () => ({ ModoServicioPlano: () => null }));
vi.mock("@/components/reservas/GestionBlacklist", () => ({ GestionBlacklist: () => null }));
vi.mock("@/components/reservas/ConfiguracionTurnos", () => ({
  ConfiguracionTurnos: () => <div data-testid="configuracion-general" />,
}));
vi.mock("@/components/emails/EditorPlantillasEmail", () => ({
  EditorPlantillasEmail: () => <div data-testid="editor-plantillas" />,
}));
vi.mock("@/components/reservas/PanelAsignacion", () => ({ PanelAsignacion: () => null }));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: [] }) }));
vi.mock("@/hooks/useSolicitudesPendientes", () => ({ useSolicitudesPendientes: () => ({ solicitudes: [] }) }));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: h.rol }),
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));

import Reservas from "@/pages/Reservas";

function Ubicacion() {
  const { pathname, search } = useLocation();
  return <output data-testid="ubicacion">{pathname + search}</output>;
}

function montar(ruta = "/reservas") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Reservas />
      <Ubicacion />
    </MemoryRouter>,
  );
}

/** Las pestañas son de Radix: se activan con mousedown. */
function pulsar(nombre: string | RegExp) {
  const pestana = screen.getByRole("tab", { name: nombre });
  fireEvent.mouseDown(pestana);
  fireEvent.click(pestana);
}

const chip = (nombre: string) => screen.getByRole("tab", { name: nombre });

beforeEach(() => {
  h.rol = "admin";
});

describe("Reservas › Configuración · subpestañas", () => {
  it("Configuración abre en «General» (lo de siempre) y ofrece «Plantillas email» como otro chip", () => {
    montar();
    pulsar("Configuración");

    const chips = screen.getByTestId("chips-subnivel");
    expect(chips).toBeInTheDocument();
    expect(chip("General")).toHaveAttribute("aria-selected", "true");
    expect(chip("Plantillas email")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("configuracion-general")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-plantillas")).not.toBeInTheDocument();
  });

  it("el chip «Plantillas email» enseña el editor de plantillas, y «General» vuelve a lo de siempre", () => {
    montar();
    pulsar("Configuración");
    pulsar("Plantillas email");

    expect(chip("Plantillas email")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("editor-plantillas")).toBeInTheDocument();
    expect(screen.queryByTestId("configuracion-general")).not.toBeInTheDocument();
    // Sigue en la pestaña Configuración.
    expect(screen.getByRole("tab", { name: "Configuración" })).toHaveAttribute("aria-selected", "true");

    pulsar("General");
    expect(screen.getByTestId("configuracion-general")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-plantillas")).not.toBeInTheDocument();
  });

  it("?tab=configuracion&sub=plantillas (destino de la ruta vieja del Super Admin) abre directo las plantillas", () => {
    montar("/reservas?tab=configuracion&sub=plantillas");

    expect(screen.getByRole("tab", { name: "Configuración" })).toHaveAttribute("aria-selected", "true");
    expect(chip("Plantillas email")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("editor-plantillas")).toBeInTheDocument();
  });

  it.each(["/reservas?tab=configuracion", "/reservas?tab=configuracion&sub=inventada"])(
    "%s abre «General»",
    (ruta) => {
      montar(ruta);

      expect(chip("General")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("configuracion-general")).toBeInTheDocument();
    },
  );

  it("cambiar de chip a mano limpia el enlace de la URL, como al cambiar de pestaña", () => {
    montar("/reservas?tab=configuracion&sub=plantillas");
    pulsar("General");

    expect(screen.getByTestId("ubicacion")).toHaveTextContent(/^\/reservas$/);
    // Y no vuelve a saltar a las plantillas al limpiarse la URL.
    expect(chip("General")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("configuracion-general")).toBeInTheDocument();
  });
});

describe("Reservas › Configuración · solo para admin (como hasta ahora)", () => {
  it("sin ser admin no hay pestaña Configuración, ni chips, ni plantillas", () => {
    h.rol = "manager";
    montar();

    expect(screen.queryByRole("tab", { name: "Configuración" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("chips-subnivel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("editor-plantillas")).not.toBeInTheDocument();
  });

  it("si llega por el enlace de las plantillas sin ser admin, cae en «Hoy» en vez de en una pestaña vacía", () => {
    h.rol = "manager";
    montar("/reservas?tab=configuracion&sub=plantillas");

    expect(screen.getByRole("tab", { name: "Hoy" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("vista-hoy")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-plantillas")).not.toBeInTheDocument();
  });
});
