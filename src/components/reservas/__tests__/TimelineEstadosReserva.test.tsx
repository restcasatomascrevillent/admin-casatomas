/**
 * Tests del timeline de estados de reserva (`TimelineEstadosReserva`, pestaña "Hoy").
 *
 * QUÉ SE FIJA
 * ----------------------------------------------------------------------------
 * · Los SEIS estados del CHECK `reservas_estado_check`, en orden: cuatro pasos
 *   del camino y dos salidas. Si alguien añade o quita un estado en la base de
 *   datos y aquí no, este test lo dice.
 * · Los nombres son los de los badges de la lista y del kanban («Llegó», «No
 *   vino»), no los de la base de datos («completada», «no_show»).
 * · Cifras opcionales: sin reservas no hay cifras (nunca un 0 falso); con ellas,
 *   una por estado; los estados que no son de los seis no cuentan.
 * · Plegable, y la elección se recuerda en el navegador.
 * · Montado dentro de `VistaHoy`: recibe las cifras de las reservas de hoy que
 *   la pestaña YA carga (sin consulta propia).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Dobles para el bloque de `VistaHoy` (mismo patrón que VistaHoy.test.tsx) ──

const h = vi.hoisted(() => ({
  store: { reservas: [] as Record<string, unknown>[], error: null as unknown },
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const q: Record<string, unknown> = {};
    const seguir = () => q;
    q.select = seguir;
    q.eq = seguir;
    q.neq = seguir;
    q.order = seguir;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(
        h.store.error ? { data: null, error: h.store.error } : { data: h.store.reservas, error: null },
      ).then(ok, ko);
    return q;
  };
  return { supabase: { from: vi.fn(() => builder()) } };
});
vi.mock("@/components/reservas/GestorReservasKanban", () => ({ GestorReservasKanban: () => null }));
vi.mock("@/components/reservas/DisponibilidadCuartos", () => ({ DisponibilidadCuartos: () => null }));
vi.mock("@/hooks/useOcupacionHoy", () => ({ useResumenOcupacionHoy: vi.fn() }));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: vi.fn() }));
vi.mock("@/hooks/useAsignacionesMesa", () => ({ useAsignacionesMesa: vi.fn() }));

import { useResumenOcupacionHoy } from "@/hooks/useOcupacionHoy";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { VistaHoy } from "@/components/reservas/VistaHoy";
import { hoyLocal } from "@/components/reservas/asignacionPlano";
import { TimelineEstadosReserva } from "@/components/reservas/TimelineEstadosReserva";

// ─── Lo que se espera ────────────────────────────────────────────────────────

/** Valores de `reservas_estado_check`, en el orden del timeline. */
const ESTADOS = ["pendiente", "verificada", "confirmada", "completada", "cancelada", "no_show"];
/** Nombre visible de cada uno: el de los badges de la lista y del kanban. */
const NOMBRES = ["Pendiente", "Verificada", "Confirmada", "Llegó", "Cancelada", "No vino"];
const CLAVE_ABIERTO = "reservas:timeline-estados:abierto";

const nodos = () => screen.getAllByRole("listitem");
const cifraDe = (li: HTMLElement) => li.querySelector("[data-cifra]")?.getAttribute("data-cifra") ?? null;
const cifras = () => nodos().map(cifraDe);
const filas = (estado: string, cuantas: number) => Array.from({ length: cuantas }, () => ({ estado }));

beforeEach(() => {
  window.localStorage.clear();
});

describe("TimelineEstadosReserva — los estados y su orden", () => {
  it("pinta los seis estados del CHECK en orden, con el nombre de los badges", () => {
    render(<TimelineEstadosReserva />);

    const items = nodos();
    expect(items).toHaveLength(6);
    expect(items.map((li) => li.getAttribute("data-estado"))).toEqual(ESTADOS);
    items.forEach((li, i) => {
      expect(within(li).getByText(NOMBRES[i])).toBeInTheDocument();
    });
  });

  it("el camino son cuatro pasos numerados y las dos salidas van aparte, con su «cuándo»", () => {
    render(<TimelineEstadosReserva />);

    const items = nodos();
    items.slice(0, 4).forEach((li, i) => {
      expect(li).toHaveTextContent(`Paso ${i + 1} de 4`);
    });
    items.slice(4).forEach((li) => {
      expect(li).toHaveTextContent("Salida");
      expect(li).not.toHaveTextContent(/Paso \d de 4/);
    });
    // Cancelar solo se puede hasta que el cliente llega: «Llegó» y «No vino» ya no se cancelan.
    expect(within(items[4]).getByText("Antes de que llegue:")).toBeInTheDocument();
    expect(within(items[5]).getByText("Si no se presenta:")).toBeInTheDocument();
  });

  it("cada estado explica en una frase qué es y qué toca hacer: texto visible, no un tooltip", () => {
    render(<TimelineEstadosReserva />);

    for (const li of nodos()) {
      expect(li).not.toHaveAttribute("title");
      expect(li.querySelector("p")?.textContent?.trim().length).toBeGreaterThan(20);
    }
    // Los verbos y textos que el personal ve en los botones y en el correo.
    expect(screen.getByText(/Toca verificarla/)).toBeInTheDocument();
    expect(screen.getByText(/«Confirma tu reserva»/)).toBeInTheDocument();
    expect(screen.getByText(/«Confirmar»/)).toBeInTheDocument();
    expect(screen.getByText(/«Ha llegado»/)).toBeInTheDocument();
  });

  it("no depende solo del color: cada nodo lleva su icono (oculto a lectores) y su nombre escrito", () => {
    render(<TimelineEstadosReserva />);

    for (const li of nodos()) {
      expect(li.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    }
  });

  it("es una región con nombre y la lista lleva el mismo nombre", () => {
    render(<TimelineEstadosReserva />);

    expect(screen.getByRole("region", { name: /Cómo avanza una reserva/ })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: /Cómo avanza una reserva/ })).toBeInTheDocument();
  });
});

describe("TimelineEstadosReserva — cifras de hoy", () => {
  it("sin reservas (cargando o con error) no pinta ninguna cifra", () => {
    const { container } = render(<TimelineEstadosReserva />);

    expect(container.querySelectorAll("[data-cifra]")).toHaveLength(0);
    expect(screen.queryByText(/cifras de hoy/)).not.toBeInTheDocument();
  });

  it("solo con las canceladas, sin las demás reservas, tampoco: mejor nada que medio dato", () => {
    const { container } = render(<TimelineEstadosReserva canceladas={4} />);

    expect(container.querySelectorAll("[data-cifra]")).toHaveLength(0);
  });

  it("con las reservas de hoy pinta una cifra por estado; las canceladas vienen aparte", () => {
    render(
      <TimelineEstadosReserva
        reservas={[
          ...filas("pendiente", 2),
          ...filas("confirmada", 3),
          ...filas("completada", 1),
          ...filas("no_show", 1),
        ]}
        canceladas={4}
      />,
    );

    // pendiente, verificada, confirmada, llegó, cancelada, no vino
    expect(cifras()).toEqual(["2", "0", "3", "1", "4", "1"]);
    expect(screen.getByText(/cifras de hoy/)).toBeInTheDocument();
  });

  it("un estado que no es de los seis (p. ej. «rechazada», que no existe) no cuenta en ninguno", () => {
    render(<TimelineEstadosReserva reservas={[...filas("rechazada", 2), ...filas("confirmada", 1)]} canceladas={0} />);

    expect(cifras()).toEqual(["0", "0", "1", "0", "0", "0"]);
  });

  it("lee bien la cifra en voz alta: «1 reserva hoy», «2 reservas hoy», «0 reservas hoy»", () => {
    render(<TimelineEstadosReserva reservas={[...filas("pendiente", 2), ...filas("completada", 1)]} canceladas={0} />);

    // El número se ve; «reservas hoy» solo lo oye el lector de pantalla.
    const pastilla = (li: HTMLElement) => li.querySelector("[data-cifra]");
    const items = nodos();
    expect(pastilla(items[0])).toHaveTextContent("2 reservas hoy");
    expect(pastilla(items[3])).toHaveTextContent("1 reserva hoy");
    expect(pastilla(items[1])).toHaveTextContent("0 reservas hoy");
  });

  it("con cero reservas y cero canceladas pinta ceros (dato real, no ausencia de dato)", () => {
    render(<TimelineEstadosReserva reservas={[]} canceladas={0} />);

    expect(cifras()).toEqual(["0", "0", "0", "0", "0", "0"]);
  });
});

describe("TimelineEstadosReserva — plegado", () => {
  const disparador = () => screen.getByRole("button", { name: /Cómo avanza una reserva/ });

  it("sale abierto por defecto", () => {
    render(<TimelineEstadosReserva />);

    expect(disparador()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("se pliega, y recuerda la elección en este navegador", () => {
    const primera = render(<TimelineEstadosReserva />);

    fireEvent.click(disparador());
    expect(disparador()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(CLAVE_ABIERTO)).toBe("0");

    // Otra visita: sigue plegado.
    primera.unmount();
    render(<TimelineEstadosReserva />);
    expect(disparador()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    // Y se vuelve a abrir.
    fireEvent.click(disparador());
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(window.localStorage.getItem(CLAVE_ABIERTO)).toBe("1");
  });

  it("si el navegador no deja usar el almacenamiento, funciona igual (sin recordar nada)", () => {
    const getItem = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });

    render(<TimelineEstadosReserva />);
    expect(screen.getByRole("list")).toBeInTheDocument();
    fireEvent.click(disparador());
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe("TimelineEstadosReserva — montado en la pestaña Hoy (VistaHoy)", () => {
  const HOY = hoyLocal();
  const RESUMEN = {
    totalReservas: 6,
    totalComensales: 20,
    capacidadTotal: 170,
    porcentajeTotal: 12,
    reservasCanceladas: 3,
    porNegocio: [],
  };
  const reserva = (id: string, estado: string) => ({
    id,
    nombre: `Cliente ${id}`,
    hora: "13:00:00",
    numero_comensales: 2,
    estado,
    espacio_id: null,
  });

  function montarHoy() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={queryClient}>
        <VistaHoy onEspacioClick={vi.fn()} onAsignarMesa={vi.fn()} />
      </QueryClientProvider>,
    );
    return queryClient;
  }

  const esperarCarga = (queryClient: QueryClient) =>
    waitFor(() => {
      const estado = queryClient.getQueryState(["reservas-hoy", "pendientes-mesa", HOY])?.status;
      expect(estado === "success" || estado === "error").toBe(true);
    });

  beforeEach(() => {
    vi.clearAllMocks();
    h.store.reservas = [];
    h.store.error = null;
    vi.mocked(useResumenOcupacionHoy).mockReturnValue({
      data: RESUMEN,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useResumenOcupacionHoy>);
    vi.mocked(useEspaciosReserva).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useEspaciosReserva>);
    vi.mocked(useAsignacionesMesa).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useAsignacionesMesa>);
  });

  it("recibe las cifras de las reservas de hoy que la pestaña ya carga, y las canceladas del resumen", async () => {
    h.store.reservas = [
      reserva("a", "pendiente"),
      reserva("b", "verificada"),
      reserva("c", "confirmada"),
      reserva("d", "confirmada"),
      reserva("e", "completada"),
    ];

    const queryClient = montarHoy();
    await esperarCarga(queryClient);

    await waitFor(() => expect(cifras()).toEqual(["1", "1", "2", "1", "3", "0"]));
  });

  it("si las reservas de hoy no cargan, el timeline sigue en pie pero sin cifras", async () => {
    h.store.error = { message: "boom" };

    const queryClient = montarHoy();
    await esperarCarga(queryClient);

    expect(screen.getByRole("region", { name: /Cómo avanza una reserva/ })).toBeInTheDocument();
    expect(nodos()).toHaveLength(6);
    expect(cifras()).toEqual([null, null, null, null, null, null]);
  });
});
