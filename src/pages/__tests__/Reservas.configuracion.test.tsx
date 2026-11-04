/**
 * Reservas › Configuración (04/11/2026, petición del dueño: «mueve la sección de plantillas email del
 * superadmin a reservas … dentro de la subsección de configuración como otra subpestaña más»).
 *
 * Configuración tiene ahora dos subpestañas en chips (como Cheques › Configuración): «General» (lo de
 * siempre: reglas, mesas y turnos) y «Plantillas email». Se llega directo a la segunda con
 * `?tab=configuracion&sub=plantillas`, que es adonde redirige la ruta vieja /super-admin/plantillas-email.
 *
 * Y desde el mismo día («que haya un permiso para esa pestaña configurable tal y como se hace en gestor
 * web»), la pestaña se ve con «Ver» en la sección «Reservas · Configuración» (`reservas_configuracion`),
 * no por ser admin. Lo que se puede editar dentro lo prueban EditorPlantillasEmail.permisos.test.tsx y
 * ConfiguracionTurnos.permisos.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

/** Permisos del usuario, como «sección:tipo» (p. ej. «reservas_configuracion:view»). */
const h = vi.hoisted(() => ({ permisos: new Set<string>() }));

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
  // Ser admin ya no cuenta para Configuración: aunque el rol sea admin, solo manda el permiso.
  useUserRole: () => ({ role: "admin", isAdmin: true, permissions: [], loading: false }),
  useCanAccessSection: (seccion: string, tipo: string = "view") => ({
    canAccess: h.permisos.has(`${seccion}:${tipo}`),
    loading: false,
  }),
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
  h.permisos = new Set(["reservas:view", "reservas:edit", "reservas_configuracion:view"]);
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

describe("Reservas › Configuración · permiso propio «Reservas · Configuración»", () => {
  it("con «Ver» en la sección se ve la pestaña con sus dos chips, aunque no se pueda editar", () => {
    h.permisos = new Set(["reservas:view", "reservas_configuracion:view"]);
    montar("/reservas?tab=configuracion");

    expect(screen.getByRole("tab", { name: "Configuración" })).toHaveAttribute("aria-selected", "true");
    expect(chip("General")).toBeInTheDocument();
    expect(chip("Plantillas email")).toBeInTheDocument();
  });

  it("sin el permiso no hay pestaña Configuración, ni chips, ni plantillas: ni siendo admin ni editando Reservas", () => {
    h.permisos = new Set(["reservas:view", "reservas:edit"]);
    montar();

    expect(screen.queryByRole("tab", { name: "Configuración" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("chips-subnivel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("editor-plantillas")).not.toBeInTheDocument();
    // El resto de Reservas sigue igual.
    expect(screen.getByRole("tab", { name: "Blacklist" })).toBeInTheDocument();
  });

  it("«Puede editar» sin «Ver» no basta para ver la pestaña (la regla de siempre: editar implica ver)", () => {
    h.permisos = new Set(["reservas:view", "reservas_configuracion:edit"]);
    montar();

    expect(screen.queryByRole("tab", { name: "Configuración" })).not.toBeInTheDocument();
  });

  it("si llega por el enlace de las plantillas sin el permiso, cae en «Hoy» en vez de en una pestaña vacía", () => {
    h.permisos = new Set(["reservas:view"]);
    montar("/reservas?tab=configuracion&sub=plantillas");

    expect(screen.getByRole("tab", { name: "Hoy" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("vista-hoy")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-plantillas")).not.toBeInTheDocument();
  });
});
