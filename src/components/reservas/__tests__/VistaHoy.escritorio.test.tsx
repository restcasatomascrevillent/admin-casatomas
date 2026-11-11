/**
 * «Hoy» de ESCRITORIO (07/11/2026, petición del dueño): sin kanban. A la izquierda la lista del móvil (lo que
 * falta por llegar) y a la derecha el plano FIJO, una sala a la vez.
 *
 * Aquí se prueba lo que es de `VistaHoy`: que el kanban no se monta, que la lista y el plano reciben el
 * buscador, el turno y las reservas de la pestaña, la sala recordada y «Organizar» / «Sin reserva» según
 * permisos. La lista y el plano son dobles que enseñan lo que reciben (cada uno tiene sus propios tests).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  reservas: [] as Record<string, unknown>[],
  /** Cómo contesta la consulta de reservas de hoy: al momento, nunca (cargando) o con error. */
  respuesta: "ok" as "ok" | "pendiente" | "error",
  /** «Editar» en Reservas (06/11/2026: con solo «Ver», ni «Organizar» ni «Sin reserva»). */
  puedeEditar: true,
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
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (_seccion: string, tipo: string = "view") => ({ canAccess: tipo === "view" || h.puedeEditar, loading: false }),
}));
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
vi.mock("@/components/reservas/movil/VistaHoyMovil", () => ({
  VistaHoyMovil: (p: { reservas?: unknown[]; columna?: { busqueda: string; filtroTurno: string } }) => (
    <div
      data-testid="vista-lista"
      data-columna={String(!!p.columna)}
      data-busqueda={p.columna?.busqueda ?? ""}
      data-turno={p.columna?.filtroTurno ?? ""}
      data-reservas={String(p.reservas?.length ?? "")}
    />
  ),
}));
vi.mock("@/components/reservas/servicio/VistaPlanoHoy", () => ({
  VistaPlanoHoy: (p: {
    fijo?: boolean;
    organizar?: { turno: string } | null;
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
      data-fijo={String(!!p.fijo)}
      data-organizar={p.organizar?.turno ?? ""}
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

beforeEach(() => {
  window.localStorage.clear();
  h.respuesta = "ok";
  h.reservas = [
    { id: "r1", nombre: "Ana", hora: "14:00:00", numero_comensales: 2, estado: "confirmada", espacio_id: "comedor", marca: "casa_tomas" },
    { id: "r2", nombre: "Luis", hora: "21:00:00", numero_comensales: 4, estado: "confirmada", espacio_id: null, marca: "casa_tomas" },
  ];
});
afterEach(() => vi.restoreAllMocks());

describe("Hoy de escritorio · sin kanban: lista a la izquierda y plano fijo", () => {
  it("no monta el kanban ni el selector «Kanban | Plano», ni aunque se hubiera guardado «kanban»", () => {
    window.localStorage.setItem(CLAVE_VISTA_HOY, "kanban");
    montar();
    expect(screen.queryByTestId("vista-kanban")).toBeNull();
    expect(screen.queryByRole("group", { name: "Vista de Hoy" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Disponibilidad por cuartos de hora/ })).toBeNull();
  });

  it("monta la lista (en modo columna) ANTES que el plano (fijo)", () => {
    montar();
    const lista = screen.getByTestId("vista-lista");
    const plano = screen.getByTestId("vista-plano");
    expect(lista).toHaveAttribute("data-columna", "true");
    expect(plano).toHaveAttribute("data-fijo", "true");
    expect(lista.compareDocumentPosition(plano) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("buscador y turno, FUERA de las dos, mandan en las dos", () => {
    montar();
    for (const pieza of [screen.getByRole("textbox", { name: "Buscar reservas" }), screen.getByRole("group", { name: "Filtrar por turno" })]) {
      expect(screen.getByTestId("vista-lista")).not.toContainElement(pieza);
      expect(screen.getByTestId("vista-plano")).not.toContainElement(pieza);
    }
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar reservas" }), { target: { value: "ana" } });
    fireEvent.click(within(screen.getByRole("group", { name: "Filtrar por turno" })).getByRole("radio", { name: "Cena" }));
    for (const id of ["vista-lista", "vista-plano"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("data-busqueda", "ana");
      expect(screen.getByTestId(id)).toHaveAttribute("data-turno", "cena");
    }
  });

  it("la lista y el plano reciben las reservas de hoy que ya pide la pestaña (no hacen otra consulta)", async () => {
    montar();
    await waitFor(() => expect(screen.getByTestId("vista-plano")).toHaveAttribute("data-reservas", "2"));
    expect(screen.getByTestId("vista-lista")).toHaveAttribute("data-reservas", "2");
  });

  it("la sala elegida en el plano se recuerda", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));
    expect(screen.getByTestId("vista-plano")).toHaveAttribute("data-sala", "reservado");
    expect(window.localStorage.getItem(CLAVE_SALA_PLANO_HOY)).toBe("reservado");
  });

  it("Hoy no ofrece «Reparto de mesas» (10/10/2026)", () => {
    const onAbrirSala = vi.fn();
    montar({ onAbrirSala });
    fireEvent.click(screen.getByRole("button", { name: "Reparto de mesas" }));
    expect(onAbrirSala).not.toHaveBeenCalled();
  });

  it("si fallan las reservas, el plano lo sabe y la lista dice «Reintentar»", async () => {
    h.respuesta = "error";
    montar();
    await waitFor(() => expect(screen.getByTestId("vista-plano")).toHaveAttribute("data-reservas-error", "true"));
    expect(screen.queryByTestId("vista-lista")).toBeNull();
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
    h.respuesta = "ok";
  });

  it("«Organizar» con un turno elegido pasa el plano a modo propuesta de ese turno", () => {
    montar();
    fireEvent.click(within(screen.getByRole("group", { name: "Filtrar por turno" })).getByRole("radio", { name: "Comida" }));
    fireEvent.click(screen.getByRole("button", { name: /Organizar/ }));
    expect(screen.getByTestId("vista-plano")).toHaveAttribute("data-organizar", "comida");
  });
});

// 06/11/2026 (decisión del dueño): «Organizar» y «Sin reserva» escriben; con solo «Ver» no salen (ni
// desactivados) y la ayuda (ⓘ) no habla de acciones.
describe("Hoy · solo «Ver»", () => {
  afterEach(() => {
    h.puedeEditar = true;
  });

  it("con «Editar» están «Organizar» y «Sin reserva»", () => {
    montar();
    expect(screen.getByRole("button", { name: /Organizar/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sin reserva/ })).toBeInTheDocument();
  });

  it("con solo «Ver» no están, y no hay ayuda (i) (11/11/2026)", () => {
    h.puedeEditar = false;
    montar();
    expect(screen.queryByRole("button", { name: /Organizar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sin reserva/ })).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });
});
