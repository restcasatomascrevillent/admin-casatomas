/**
 * «Hoy» con DOS VISTAS: «Kanban | Plano» (petición del dueño, 06/10/2026: «montar aquí DOS VISTAS: una
 * de kanban y luego montar la vista con los planos del local»).
 *
 * Aquí se prueba lo que es de `VistaHoy`: el selector (por defecto, se recuerda, accesible), qué vista se
 * monta, que el bloque de arriba —cifras, aviso del Reservado, cuartos de hora, buscador y turno— es UNO
 * para las dos (y fuera de ellas) y que tocar el nombre de una sala en el kanban abre su plano. El kanban y
 * el plano son dobles que enseñan lo que reciben: cada uno tiene sus propios tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  reservas: [] as Record<string, unknown>[],
  /** Cómo contesta la consulta de reservas de hoy: al momento, nunca (cargando) o con error. */
  respuesta: "ok" as "ok" | "pendiente" | "error",
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "neq", "order"]) b[m] = () => b;
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        (h.respuesta === "pendiente"
          ? new Promise(() => {})
          : Promise.resolve(h.respuesta === "error" ? { data: null, error: { message: "caída" } } : { data: h.reservas, error: null })
        ).then(ok, ko);
      return b;
    },
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("@/hooks/useOcupacionHoy", () => ({
  useResumenOcupacionHoy: () => ({
    data: { totalReservas: 23, totalComensales: 89, capacidadTotal: 150, porcentajeTotal: 59, reservasCanceladas: 0 },
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
  }),
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({
    data: [
      { id: "comedor", nombre: "Comedor", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
      { id: "salon", nombre: "Salón", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
      { id: "reservado", nombre: "Reservado", capacidad_maxima: 14, activa: true, caracteristicas: { marca: "casa_tomas", privada: true } },
    ],
  }),
}));
vi.mock("@/hooks/useAsignacionesMesa", () => ({ useAsignacionesMesa: () => ({ data: [] }) }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/useEdicionReserva", () => ({ useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }) }));
vi.mock("@/components/reservas/BlacklistModal", () => ({ BlacklistModal: () => null }));
vi.mock("@/components/reservas/ElegirMesaDialog", () => ({ ElegirMesaDialog: () => null }));
vi.mock("@/hooks/useReservasEnVivo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useReservasEnVivo")>()),
  useReservasEnVivo: vi.fn(),
}));
vi.mock("@/components/reservas/DisponibilidadCuartos", () => ({ DisponibilidadCuartos: () => <div data-testid="rejilla-cuartos" /> }));
// Dobles de las dos vistas: enseñan lo que reciben del bloque de arriba.
vi.mock("@/components/reservas/GestorReservasKanban", () => ({
  GestorReservasKanban: (p: { busqueda: string; filtroTurno: string; onVerPlanoSala?: (id: string) => void }) => (
    <div data-testid="vista-kanban" data-busqueda={p.busqueda} data-turno={p.filtroTurno}>
      <button type="button" onClick={() => p.onVerPlanoSala?.("salon")}>
        Ver Salón en el plano
      </button>
    </div>
  ),
}));
vi.mock("@/components/reservas/servicio/VistaPlanoHoy", () => ({
  VistaPlanoHoy: (p: {
    busqueda: string;
    filtroTurno: string;
    salaId: string | null;
    reservas?: unknown[];
    reservasError?: boolean;
    onCambiarSala: (id: string) => void;
    onAbrirReparto?: (id: string) => void;
  }) => (
    <div
      data-testid="vista-plano"
      data-busqueda={p.busqueda}
      data-turno={p.filtroTurno}
      data-sala={p.salaId ?? ""}
      data-reservas={String(p.reservas?.length ?? "")}
      data-reservas-error={String(!!p.reservasError)}
    >
      <button type="button" onClick={() => p.onCambiarSala("reservado")}>
        Reservado
      </button>
      <button type="button" onClick={() => p.onAbrirReparto?.("comedor")}>
        Reparto de mesas
      </button>
    </div>
  ),
}));

import { VistaHoy } from "@/components/reservas/VistaHoy";
import { CLAVE_SALA_PLANO_HOY, CLAVE_VISTA_HOY } from "@/lib/reservas/vistaHoy";

function montar(props: { onAbrirSala?: (id: string) => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <VistaHoy {...props} />
    </QueryClientProvider>,
  );
}

const selector = () => screen.getByRole("group", { name: "Vista de Hoy" });
const opcion = (nombre: "Kanban" | "Plano") => within(selector()).getByRole("radio", { name: nombre });

beforeEach(() => {
  window.localStorage.clear();
  h.respuesta = "ok";
  h.reservas = [
    { id: "r1", nombre: "Ana", hora: "14:00:00", numero_comensales: 2, estado: "confirmada", espacio_id: "comedor", marca: "casa_tomas" },
    { id: "r2", nombre: "Luis", hora: "21:00:00", numero_comensales: 4, estado: "confirmada", espacio_id: null, marca: "casa_tomas" },
  ];
});
afterEach(() => vi.restoreAllMocks());

describe("Hoy · el selector «Kanban | Plano»", () => {
  it("por defecto se ve el kanban: es la opción marcada y el plano no se monta", () => {
    montar();
    expect(opcion("Kanban")).toHaveAttribute("aria-checked", "true");
    expect(opcion("Plano")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("vista-kanban")).toBeInTheDocument();
    expect(screen.queryByTestId("vista-plano")).not.toBeInTheDocument();
  });

  it("elegir «Plano» monta el plano (y desmonta el kanban), y se recuerda para la próxima vez", () => {
    const { unmount } = montar();
    fireEvent.click(opcion("Plano"));
    expect(opcion("Plano")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("vista-plano")).toBeInTheDocument();
    expect(screen.queryByTestId("vista-kanban")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(CLAVE_VISTA_HOY)).toBe("plano");

    unmount();
    montar();
    expect(screen.getByTestId("vista-plano")).toBeInTheDocument();
    expect(opcion("Plano")).toHaveAttribute("aria-checked", "true");

    // Y de vuelta al kanban.
    fireEvent.click(opcion("Kanban"));
    expect(screen.getByTestId("vista-kanban")).toBeInTheDocument();
    expect(window.localStorage.getItem(CLAVE_VISTA_HOY)).toBe("kanban");
  });

  it("volver a pulsar la vista ya elegida no la desmarca (siempre hay una)", () => {
    montar();
    fireEvent.click(opcion("Kanban"));
    expect(opcion("Kanban")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("vista-kanban")).toBeInTheDocument();
  });

  it("sin almacenamiento (modo privado) abre el kanban y cambiar de vista funciona igual", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    montar();
    expect(screen.getByTestId("vista-kanban")).toBeInTheDocument();
    fireEvent.click(opcion("Plano"));
    expect(screen.getByTestId("vista-plano")).toBeInTheDocument();
  });

  it("cada opción tiene nombre accesible, icono y texto", () => {
    montar();
    for (const nombre of ["Kanban", "Plano"] as const) {
      const boton = opcion(nombre);
      expect(boton).toHaveTextContent(nombre);
      expect(boton.querySelector("svg")).not.toBeNull();
    }
  });
});

describe("Hoy · el bloque de arriba es el mismo para las dos vistas", () => {
  const bloqueDeArriba = () => [
    screen.getByTestId("cifras-hoy"),
    screen.getByTestId("aviso-sala-privada"),
    screen.getByRole("button", { name: /Disponibilidad por cuartos de hora/ }),
    screen.getByRole("textbox", { name: "Buscar reservas" }),
    screen.getByRole("group", { name: "Filtrar por turno" }),
    selector(),
  ];

  it("en el kanban: cifras, Reservado, cuartos de hora, buscador, turno y selector, FUERA de la vista", async () => {
    montar();
    await screen.findByTestId("aviso-sala-privada");
    for (const pieza of bloqueDeArriba()) expect(screen.getByTestId("vista-kanban")).not.toContainElement(pieza);
  });

  it("en el plano el plano necesita el alto: cifras y Reservado en UNA línea, sin cuartos de hora; buscador, turno y selector siguen", async () => {
    montar();
    fireEvent.click(opcion("Plano"));
    // 10/10/2026: las cifras van en chips pequeños dentro de la fila de filtros (las dos vistas).
    const resumen = await screen.findByTestId("cifras-hoy");
    expect(resumen).toHaveTextContent("23 reservas");
    expect(resumen).toHaveTextContent("89 comensales");
    expect(resumen).toHaveTextContent("59 % de 150");
    await waitFor(() => expect(resumen).toHaveTextContent("Reservado: libre"));
    expect(screen.queryByTestId("aviso-sala-privada")).toBeNull();
    expect(screen.queryByRole("button", { name: /Disponibilidad por cuartos de hora/ })).toBeNull();
    expect(screen.queryByText("Reservas hoy")).toBeNull();
    for (const pieza of [
      resumen,
      screen.getByRole("textbox", { name: "Buscar reservas" }),
      screen.getByRole("group", { name: "Filtrar por turno" }),
      selector(),
    ]) {
      expect(screen.getByTestId("vista-plano")).not.toContainElement(pieza);
    }
  });

  it("el buscador y «Todo el día / Comida / Cena» filtran las dos vistas y se conservan al cambiar de vista", () => {
    montar();
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar reservas" }), { target: { value: "ana" } });
    fireEvent.click(within(screen.getByRole("group", { name: "Filtrar por turno" })).getByRole("radio", { name: "Cena" }));
    expect(screen.getByTestId("vista-kanban")).toHaveAttribute("data-busqueda", "ana");
    expect(screen.getByTestId("vista-kanban")).toHaveAttribute("data-turno", "cena");

    fireEvent.click(opcion("Plano"));
    expect(screen.getByTestId("vista-plano")).toHaveAttribute("data-busqueda", "ana");
    expect(screen.getByTestId("vista-plano")).toHaveAttribute("data-turno", "cena");
    expect(screen.getByRole("textbox", { name: "Buscar reservas" })).toHaveValue("ana");
  });

  it("el plano recibe las reservas de hoy que ya pide la pestaña (no hace otra consulta)", async () => {
    window.localStorage.setItem(CLAVE_VISTA_HOY, "plano");
    montar();
    await waitFor(() => expect(screen.getByTestId("vista-plano")).toHaveAttribute("data-reservas", "2"));
  });

  it("la ayuda de la fila es la de cada vista", () => {
    montar();
    // 10/10/2026: la ayuda es un ⓘ (nota con el texto como nombre accesible y título).
    expect(screen.getByRole("note", { name: /Toca una tarjeta para ver sus acciones/ })).toBeInTheDocument();
    fireEvent.click(opcion("Plano"));
    expect(screen.getByRole("note", { name: /Toca una mesa para ver su reserva/ })).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: /Toca una tarjeta para ver sus acciones/ })).not.toBeInTheDocument();
  });
});

describe("Hoy · del kanban al plano de una sala", () => {
  it("tocar el nombre de una sala en el kanban abre el plano con ESA sala, y se recuerda", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Ver Salón en el plano" }));
    expect(screen.getByTestId("vista-plano")).toHaveAttribute("data-sala", "salon");
    expect(opcion("Plano")).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem(CLAVE_SALA_PLANO_HOY)).toBe("salon");
    expect(window.localStorage.getItem(CLAVE_VISTA_HOY)).toBe("plano");

    // Volver al kanban es el propio selector.
    fireEvent.click(opcion("Kanban"));
    expect(screen.getByTestId("vista-kanban")).toBeInTheDocument();
  });

  it("la sala elegida en el plano se recuerda", () => {
    window.localStorage.setItem(CLAVE_VISTA_HOY, "plano");
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));
    expect(screen.getByTestId("vista-plano")).toHaveAttribute("data-sala", "reservado");
    expect(window.localStorage.getItem(CLAVE_SALA_PLANO_HOY)).toBe("reservado");
  });

  it("Hoy ya no ofrece «Reparto de mesas» (10/10/2026): lo esencial está en el Plano", () => {
    window.localStorage.setItem(CLAVE_VISTA_HOY, "plano");
    const onAbrirSala = vi.fn();
    montar({ onAbrirSala });
    // El plano (simulado) ya no recibe el salto: tocar su botón no abre nada.
    fireEvent.click(screen.getByRole("button", { name: "Reparto de mesas" }));
    expect(onAbrirSala).not.toHaveBeenCalled();
  });
});

describe("Hoy · nada de «Reservado: libre» sin haber leído las reservas (revisión 07/10/2026)", () => {
  it("mientras cargan las reservas de hoy no sale el aviso del Reservado (ni en el kanban ni en la línea del plano)", async () => {
    h.respuesta = "pendiente";
    montar();
    await screen.findByTestId("vista-kanban");
    expect(screen.queryByTestId("aviso-sala-privada")).toBeNull();
    fireEvent.click(opcion("Plano"));
    expect(screen.getByTestId("cifras-hoy")).not.toHaveTextContent("Reservado");
    h.respuesta = "ok";
  });

  it("si fallan, el plano lo sabe (para decirlo con «Reintentar») en vez de esperar para siempre", async () => {
    h.respuesta = "error";
    window.localStorage.setItem(CLAVE_VISTA_HOY, "plano");
    montar();
    await waitFor(() => expect(screen.getByTestId("vista-plano")).toHaveAttribute("data-reservas-error", "true"));
    expect(screen.queryByTestId("aviso-sala-privada")).toBeNull();
    h.respuesta = "ok";
  });
});
