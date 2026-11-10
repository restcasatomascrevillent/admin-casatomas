/**
 * Pestaña «Lista» (10/11/2026, petición del dueño: «hacer o simular como el libro»): conmutador
 * «Libro | Tabla», por defecto el libro, recordado en el dispositivo (localStorage, con try/catch). Con un
 * filtro en la URL (la campana) se abre la tabla, que es la que filtra, sin tocar lo recordado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/reservas/VistaHoy", () => ({ VistaHoy: () => null }));
vi.mock("@/components/reservas/FormularioReserva", () => ({ FormularioReserva: () => null }));
vi.mock("@/components/reservas/ListaReservasAvanzada", () => ({ ListaReservasAvanzada: () => <div data-testid="tabla-lista" /> }));
const pag = vi.hoisted(() => ({ puedeEditar: true, libro: vi.fn(), lista: vi.fn() }));
vi.mock("@/components/reservas/libro/ListaComoLibro", () => ({
  ListaComoLibro: (props: { extra?: React.ReactNode; onAnadirReserva?: (f: string) => void; resaltar?: unknown }) => {
    pag.lista(props);
    return (
      <div data-testid="libro-lista">
        {props.extra}
        {props.onAnadirReserva && (
          <button type="button" onClick={() => props.onAnadirReserva!("2026-11-20")}>
            Añadir reserva a este día
          </button>
        )}
      </div>
    );
  },
}));
vi.mock("@/components/reservas/libro/LibroReservas", async () => {
  const { useEffect } = await import("react");
  return {
  LibroReservas: (props: {
    fechaInicial?: string | null;
    soloApuntar?: boolean;
    onCambioFecha?: (f: string) => void;
    onReservaCreada?: (r: { id: string; fecha: string }) => void;
  }) => {
    pag.libro(props);
    const { onCambioFecha, fechaInicial } = props;
    useEffect(() => onCambioFecha?.(fechaInicial ?? "2026-11-10"), [onCambioFecha, fechaInicial]);
    return (
      <div data-testid="libro-nueva" data-fecha={props.fechaInicial ?? "hoy"} data-solo-apuntar={String(!!props.soloApuntar)}>
        <button type="button" onClick={() => props.onReservaCreada?.({ id: "nueva-1", fecha: "2026-11-20" })}>
          Guardar (simulado)
        </button>
      </div>
    );
  },
  };
});
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
  useCanAccessSection: (seccion: string, tipo = "view") => ({
    // Sin `puedeEditar`: ni editar ni crear (solo ver).
    canAccess: (tipo === "edit" && seccion !== "reservas_configuracion") || seccion === "reservas_crear" ? pag.puedeEditar : true,
    loading: false,
  }),
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
  pag.puedeEditar = true;
  pag.libro.mockClear();
  pag.lista.mockClear();
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

// 10/11/2026 (dueño: «que se pueda añadir la reserva ahí desde abrir reserva directamente, se abra en el día en
// el pop up»): el botón de la hoja abre el MISMO diálogo «Nueva Reserva» en el día de la hoja.
describe("Reservas › Lista · «Añadir reserva a este día» desde la hoja del libro", () => {
  it("abre «Nueva Reserva» en el día de la hoja; el botón de arriba la abre en hoy", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Añadir reserva a este día" }));
    const dialogo = await screen.findByRole("dialog");
    expect(await within(dialogo).findByTestId("libro-nueva")).toHaveAttribute("data-fecha", "2026-11-20");
    // Un solo diálogo: el de siempre.
    expect(within(dialogo).getByRole("heading", { name: /^Nueva reserva/ })).toBeInTheDocument();

    fireEvent.keyDown(dialogo, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Nueva Reserva/ }));
    expect(await screen.findByTestId("libro-nueva")).toHaveAttribute("data-fecha", "hoy");
  });

  it("al guardar, el libro de la Lista recibe la reserva nueva para ir a su día y resaltarla", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Añadir reserva a este día" }));
    fireEvent.click(await screen.findByRole("button", { name: "Guardar (simulado)" }));
    await waitFor(() => expect(pag.lista.mock.calls.at(-1)![0].resaltar).toEqual({ id: "nueva-1", fecha: "2026-11-20" }));
  });

  it("sin permiso de crear no hay botón en la hoja", async () => {
    pag.puedeEditar = false;
    montar();
    await screen.findByTestId("libro-lista");
    expect(screen.queryByRole("button", { name: "Añadir reserva a este día" })).toBeNull();
    expect(pag.lista.mock.calls.at(-1)![0].onAnadirReserva).toBeUndefined();
  });
});

// 10/11/2026 (dueño): desde la hoja, el diálogo es «solo apuntar» (sin la hoja, que ya se ve detrás) y el título
// dice el día; desde «Nueva Reserva» de la barra, el de siempre con la hoja del día.
describe("Reservas › «Nueva Reserva»: solo apuntar desde la hoja, completo desde la barra", () => {
  it("desde la hoja: solo apuntar y «Nueva reserva · viernes 20 de noviembre»", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Añadir reserva a este día" }));
    const dialogo = await screen.findByRole("dialog");
    expect(await within(dialogo).findByTestId("libro-nueva")).toHaveAttribute("data-solo-apuntar", "true");
    await waitFor(() => expect(within(dialogo).getByRole("heading")).toHaveTextContent("Nueva reserva · viernes, 20 de noviembre"));
  });

  it("desde la barra: con la hoja del día y el título de siempre", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Nueva Reserva/ }));
    const dialogo = await screen.findByRole("dialog");
    expect(await within(dialogo).findByTestId("libro-nueva")).toHaveAttribute("data-solo-apuntar", "false");
    expect(within(dialogo).getByRole("heading")).toHaveTextContent(/^Nueva reserva$/);
  });
});
