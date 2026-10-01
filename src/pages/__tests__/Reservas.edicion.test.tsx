/**
 * Página /reservas: el editor de reservas (2026-09-30) llega a la pestaña «Hoy»
 * (las pastillas de «Pendientes de mesa») desde aquí, igual que `onAsignarMesa` y
 * `onEspacioClick`: la página tiene el diálogo y el permiso de edición de la
 * sección «reservas», y se los pasa a `VistaHoy` por props.
 *
 * También se comprueba que el alta manual no ha cambiado: `datosNuevaReserva` se
 * memoiza con `useMemo([openDialog])` para que el formulario no reescriba la
 * fecha en cada render, y eso NO se puede romper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  canEdit: true as boolean,
  editarReserva: vi.fn(),
  vistaHoy: vi.fn(),
  formulario: vi.fn(),
  solicitudes: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/reservas/VistaHoy", () => ({
  VistaHoy: (props: { onEditarReserva?: (id: string) => void }) => {
    h.vistaHoy(props);
    return (
      <button type="button" onClick={() => props.onEditarReserva?.("res-1")}>
        lápiz de una pastilla
      </button>
    );
  },
}));
vi.mock("@/components/reservas/FormularioReserva", () => ({
  FormularioReserva: (props: unknown) => {
    h.formulario(props);
    return <div data-testid="formulario-alta" />;
  },
}));
vi.mock("@/components/reservas/ListaReservasAvanzada", () => ({ ListaReservasAvanzada: () => null }));
vi.mock("@/components/reservas/CalendarioOcupacion", () => ({ CalendarioOcupacion: () => null }));
vi.mock("@/components/reservas/PlanoEspacio2D", () => ({ PlanoEspacio2D: () => null }));
vi.mock("@/components/reservas/servicio/ModoServicioPlano", () => ({ ModoServicioPlano: () => null }));
vi.mock("@/components/reservas/GestionBlacklist", () => ({ GestionBlacklist: () => null }));
vi.mock("@/components/reservas/ConfiguracionTurnos", () => ({ ConfiguracionTurnos: () => null }));
vi.mock("@/components/reservas/PanelAsignacion", () => ({ PanelAsignacion: () => null }));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: [] }) }));
vi.mock("@/hooks/useSolicitudesPendientes", () => ({
  useSolicitudesPendientes: () => ({ solicitudes: h.solicitudes }),
}));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: "admin" }),
  useCanAccessSection: () => ({ canAccess: h.canEdit, loading: false }),
}));
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({
    editarReserva: h.editarReserva,
    dialogoEdicion: <div data-testid="dialogo-edicion" />,
  }),
}));

import Reservas from "@/pages/Reservas";

function montar() {
  return render(
    <MemoryRouter>
      <Reservas />
    </MemoryRouter>,
  );
}

const ultimasProps = () => h.vistaHoy.mock.calls.at(-1)![0] as { onEditarReserva?: (id: string) => void; puedeEditar?: boolean };

beforeEach(() => {
  vi.clearAllMocks();
  h.canEdit = true;
  h.solicitudes = [];
});

// Touza no admite reservas (decisión del dueño 2026-10-01): la insignia de la pestaña Lista cuenta lo mismo
// que enseña la lista, las solicitudes pendientes de Casa Tomás (`contarSolicitudesPendientes`).
describe("Reservas (página) · insignia de solicitudes sin resolver", () => {
  it("cuenta solo las pendientes de Casa Tomás: ni las de Touza ni las ya contactadas", () => {
    h.solicitudes = [
      { id: "s-ct", estado: "pendiente", marca: "casa_tomas" },
      { id: "s-sin-marca", estado: "pendiente", marca: null },
      { id: "s-contactado", estado: "contactado", marca: "casa_tomas" },
      { id: "s-tz", estado: "pendiente", marca: "touza" },
    ];
    montar();

    expect(screen.getByLabelText("2 solicitudes sin resolver")).toHaveTextContent("2");
  });

  it("sin pendientes de Casa Tomás no hay insignia, aunque quede una de Touza", () => {
    h.solicitudes = [{ id: "s-tz", estado: "pendiente", marca: "touza" }];
    montar();

    expect(screen.queryByLabelText(/sin resolver/)).not.toBeInTheDocument();
  });
});

describe("Reservas (página) · el editor llega a «Hoy»", () => {
  it("VistaHoy recibe el callback de editar y el permiso, y al llamarlo abre el editor de esa reserva", () => {
    montar();

    expect(typeof ultimasProps().onEditarReserva).toBe("function");
    expect(ultimasProps().puedeEditar).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "lápiz de una pastilla" }));
    expect(h.editarReserva).toHaveBeenCalledTimes(1);
    expect(h.editarReserva).toHaveBeenCalledWith("res-1");
  });

  it("sin permiso de edición sobre «reservas» se lo dice a VistaHoy (los lápices salen deshabilitados)", () => {
    h.canEdit = false;
    montar();

    expect(ultimasProps().puedeEditar).toBe(false);
  });

  it("pinta el diálogo de edición que devuelve el hook (una vez)", () => {
    montar();

    expect(screen.getAllByTestId("dialogo-edicion")).toHaveLength(1);
  });
});

describe("Reservas (página) · el alta manual sigue igual", () => {
  it("`datosPreseleccionados` del formulario de alta conserva su identidad mientras el diálogo está abierto", async () => {
    montar();

    fireEvent.click(screen.getByRole("button", { name: /Nueva Reserva/ }));
    await screen.findByTestId("formulario-alta");
    const alAbrir = h.formulario.mock.calls.at(-1)![0] as { datosPreseleccionados: { fecha: Date } };

    // Cualquier render de la página mientras el diálogo sigue abierto (aquí, cambiar de
    // pestaña). Con el diálogo abierto Radix marca el resto como `aria-hidden`, de ahí `hidden: true`.
    const pestana = screen.getByRole("tab", { name: "Calendario", hidden: true });
    fireEvent.mouseDown(pestana);
    fireEvent.click(pestana);
    await waitFor(() => expect(h.formulario.mock.calls.length).toBeGreaterThan(0));

    for (const [props] of h.formulario.mock.calls as Array<[{ datosPreseleccionados: { fecha: Date } }]>) {
      expect(props.datosPreseleccionados).toBe(alAbrir.datosPreseleccionados);
    }
  });
});
