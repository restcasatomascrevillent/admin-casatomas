/**
 * Página /reservas: el permiso de edición de la sección «reservas» gobierna «Nueva Reserva»
 * (2026-10-01), la insignia de solicitudes cuenta lo mismo que la lista, y el alta manual no cambia:
 * (desde el 10/11/2026 el alta va dentro de LibroReservas, que memoiza la fecha del formulario).
 *
 * (04/10/2026: «Hoy» ya no recibe callbacks de edición ni de asignación —se retiró la franja
 * «Pendientes de mesa»; el kanban lleva su propio editor—, así que `VistaHoy` se monta sin props.)
 *
 * (06/10/2026: la pestaña Lista ya no lleva título ni subtítulo; su región conserva nombre y descripción.)
 *
 * (06/11/2026, decisión del dueño: con solo «Ver», «Nueva Reserva» no existe —se oculta, no se desactiva— y en
 * su sitio, junto a las pestañas, sale la etiqueta común «Solo lectura»; también en el plano de una sala.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  canEdit: true as boolean,
  formulario: vi.fn(),
  solicitudes: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/reservas/VistaHoy", () => ({ VistaHoy: () => null }));
vi.mock("@/components/reservas/FormularioReserva", () => ({
  FormularioReserva: (props: unknown) => {
    h.formulario(props);
    return <div data-testid="formulario-alta" />;
  },
}));
// «Nueva reserva» única (10/11/2026): el diálogo monta LibroReservas, que lleva dentro el formulario.
vi.mock("@/components/reservas/libro/LibroReservas", () => ({
  LibroReservas: () => <div data-testid="formulario-alta" />,
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
  // Solo el permiso de EDICIÓN de «reservas» sigue a `h.canEdit`; cualquier otro, false: así
  // la página no puede apoyarse sin querer en «Ver» (o en otra sección) para crear o editar.
  useCanAccessSection: (seccion: string, tipo: string = "view") => ({
    canAccess: seccion === "reservas" && tipo === "edit" ? h.canEdit : false,
    loading: false,
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

beforeEach(() => {
  vi.clearAllMocks();
  h.canEdit = true;
  h.solicitudes = [];
});

// Crear una reserva exige permiso de EDICIÓN en «reservas» (2026-10-01), como las demás acciones que
// escriben: con la RLS de 20261001170000 el INSERT de quien solo puede VER falla.
describe("Reservas (página) · «Nueva Reserva» pide permiso de edición", () => {
  const botonAlta = () => screen.getByRole("button", { name: /Nueva Reserva/ });

  it("sin permiso de edición (solo «Ver») no hay botón: en su sitio, la etiqueta «Solo lectura»", () => {
    h.canEdit = false;
    montar();

    expect(screen.queryByRole("button", { name: /Nueva Reserva/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("etiqueta-solo-lectura")).toHaveTextContent("Solo lectura");
    expect(screen.queryByTestId("formulario-alta")).not.toBeInTheDocument();
    expect(h.formulario).not.toHaveBeenCalled();
    // Las pestañas de consulta siguen.
    for (const nombre of ["Hoy", "Lista", "Calendario", "Próximas reservas", "Blacklist"]) {
      expect(screen.getByRole("tab", { name: nombre })).toBeInTheDocument();
    }
  });

  it("con permiso de edición el botón está, sin etiqueta «Solo lectura», y abre el alta", async () => {
    montar();

    expect(botonAlta()).toBeEnabled();
    expect(screen.queryByTestId("etiqueta-solo-lectura")).not.toBeInTheDocument();
    fireEvent.click(botonAlta());
    expect(await screen.findByTestId("formulario-alta")).toBeInTheDocument();
  });
});

// (10/11/2026) La identidad estable de `datosPreseleccionados` vive ahora en LibroReservas
// (`useMemo` por la fecha de la hoja); la página ya no monta el formulario directamente.

// 2026-10-06, petición del dueño («Perdemos mucho espacio vertical… quita el título de "Todas las reservas" y la
// parte de "Historial completo"»): la pestaña Lista ya no lleva título ni subtítulo encima de la lista. La región
// conserva su nombre para el lector de pantalla y la explicación, como descripción que no ocupa alto.
describe("Reservas (página) · la pestaña Lista sin título ni subtítulo", () => {
  async function abrirLista() {
    montar();
    const pestana = screen.getByRole("tab", { name: /^Lista/ });
    fireEvent.mouseDown(pestana);
    fireEvent.click(pestana);
    return screen.findByRole("region", { name: "Todas las reservas y solicitudes" });
  }

  it("no hay título «Todas las reservas y solicitudes» ni subtítulo «Historial completo…» a la vista", async () => {
    const region = await abrirLista();

    expect(screen.queryByRole("heading", { name: /Todas las reservas/ })).not.toBeInTheDocument();
    expect(region.querySelector("h1, h2, h3, h4")).toBeNull();
    // La explicación solo existe para el lector de pantalla: `sr-only`, sin alto.
    const explicacion = screen.getByText(/^Historial completo, de cualquier fecha/);
    expect(explicacion).toHaveClass("sr-only");
  });

  it("la región sigue teniendo nombre y descripción para el lector de pantalla", async () => {
    const region = await abrirLista();

    expect(region).toHaveAccessibleName("Todas las reservas y solicitudes");
    expect(region).toHaveAccessibleDescription(
      "Historial completo, de cualquier fecha. Las solicitudes que el asistente telefónico no pudo cerrar aparecen marcadas como «Solicitud» con su motivo.",
    );
  });
});
