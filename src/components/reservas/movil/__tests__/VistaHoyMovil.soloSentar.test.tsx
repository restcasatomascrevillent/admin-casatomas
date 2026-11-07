/**
 * Hoy en móvil, solo para sentar (07/11/2026, petición del dueño): la lista enseña SOLO lo que está por llegar
 * («Llegan ahora» y «Por llegar», con las «Tarde»); las ya sentadas no salen (se gestionan en «Mesas»). El
 * botón de menú va al principio de la fila de controles cuando hay menú lateral (sin barra superior).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/useAccionesServicioReserva", () => ({
  useAccionesServicioReserva: () => ({
    marcarLlegada: async () => true,
    marcarNoShow: async () => true,
    deshacerLlegadaONoShow: async () => true,
    moverEspacio: async () => true,
  }),
}));
vi.mock("@/hooks/useAccionesModoServicio", () => ({ useAccionesModoServicio: () => ({ liberarMesa: async () => true }) }));
vi.mock("@/hooks/useAsignacionesMesa", () => ({
  useAsignacionesMesa: () => ({ data: [] }),
  useAsignarMesasReserva: () => ({ mutateAsync: async () => [] }),
}));
vi.mock("@/hooks/useSentarSinReserva", () => ({
  useSentarSinReserva: () => ({ mutateAsync: async () => null }),
  deshacerSinReserva: vi.fn(),
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: [{ id: "s1", nombre: "Comedor" }] }) }));
vi.mock("@/hooks/useMesas", () => ({ useMesas: () => ({ data: [] }) }));
vi.mock("@/hooks/useConfiguracionReservas", () => ({ useConfiguracionReservas: () => ({ data: undefined }) }));
vi.mock("@/hooks/useAlDiaMovil", () => ({ useAlDiaMovil: () => undefined }));
vi.mock("@/hooks/useSalaCerradaServicio", () => ({ useSalaCerradaServicio: () => ({ cerrada: false }) }));
vi.mock("@/hooks/useAjustesMesaServicio", () => ({
  CLAVE_AJUSTES_MESA: "ajustes",
  useAjustesMesaDia: () => ({ data: [] }),
  useGuardarAjustesMesa: () => ({ mutateAsync: async () => undefined }),
}));
vi.mock("@/components/reservas/SentarSinReserva", () => ({ BotonSentarSinReserva: () => <button type="button">Sin reserva</button> }));

import { VistaHoyMovil } from "@/components/reservas/movil/VistaHoyMovil";
import { SidebarProvider } from "@/components/ui/sidebar";

const res = (id: string, nombre: string, estado: string) => ({
  id,
  nombre,
  hora: "13:00:00",
  numero_comensales: 2,
  estado,
  espacio_id: "s1",
  telefono: null,
});

function montar(envoltorio: (n: ReactNode) => ReactNode = (n) => n) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const reservas = [res("a", "Ana Espera", "confirmada"), res("b", "Bea Sentada", "completada")] as never[];
  return render(
    <QueryClientProvider client={cliente}>{envoltorio(<VistaHoyMovil reservas={reservas} fecha="2026-11-07" />)}</QueryClientProvider>,
  );
}

describe("VistaHoyMovil · solo para sentar", () => {
  // Las 13:05, en plena comida: la reserva de las 13:00 «llega ahora».
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 7, 13, 5));
  });
  afterEach(() => vi.useRealTimers());

  it("la lista no tiene la sección «Ya sentadas»: solo las que están por llegar", () => {
    montar();
    expect(screen.getByRole("region", { name: "Llegan ahora" })).toHaveTextContent("Ana Espera");
    expect(screen.queryByText("Ya sentadas")).toBeNull();
    expect(screen.queryByRole("region", { name: "Sentadas" })).toBeNull();
    expect(screen.queryByText("Bea Sentada")).toBeNull();
  });

  it("con menú lateral, su botón (44 px) va el primero de la fila de controles; sin él, no se pinta", () => {
    const { unmount } = montar((n) => <SidebarProvider>{n}</SidebarProvider>);
    const controles = screen.getByTestId("hoy-movil-controles");
    const menu = controles.firstElementChild as HTMLElement;
    expect(menu).toHaveAttribute("data-sidebar", "trigger");
    expect(menu).toHaveClass("h-11", "w-11");
    unmount();
    montar();
    expect(screen.getByTestId("hoy-movil-controles").querySelector("[data-sidebar=trigger]")).toBeNull();
  });
});

// 07/11/2026: en «Hoy» de escritorio esta MISMA lista va de columna a la izquierda del plano. El buscador y el
// turno los manda la fila de filtros de la pestaña; sin la fila de controles del móvil ni la vista «Mesas».
describe("VistaHoyMovil · como columna de escritorio", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 7, 13, 5));
  });
  afterEach(() => vi.useRealTimers());

  const montarColumna = (busqueda: string, filtroTurno: "todo" | "comida" | "cena") => {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const reservas = [res("a", "Ana Espera", "confirmada"), { ...res("c", "Carla Cena", "confirmada"), hora: "21:30:00" }] as never[];
    return render(
      <QueryClientProvider client={cliente}>
        <VistaHoyMovil reservas={reservas} fecha="2026-11-07" columna={{ busqueda, filtroTurno }} />
      </QueryClientProvider>,
    );
  };

  it("sin la fila de controles del móvil (ni «Reservas | Mesas», ni su buscador)", () => {
    montarColumna("", "todo");
    expect(screen.getByTestId("hoy-columna")).toBeInTheDocument();
    expect(screen.queryByTestId("hoy-movil-controles")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Mesas" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Buscar reservas" })).toBeNull();
  });

  it("filtra con el buscador y el turno que recibe", () => {
    const { rerender } = montarColumna("", "todo");
    expect(screen.getByText("Ana Espera")).toBeInTheDocument();
    expect(screen.getByText("Carla Cena")).toBeInTheDocument();
    const cliente = new QueryClient();
    const reservas = [res("a", "Ana Espera", "confirmada"), { ...res("c", "Carla Cena", "confirmada"), hora: "21:30:00" }] as never[];
    rerender(
      <QueryClientProvider client={cliente}>
        <VistaHoyMovil reservas={reservas} fecha="2026-11-07" columna={{ busqueda: "", filtroTurno: "cena" }} />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("Ana Espera")).toBeNull();
    expect(screen.getByText("Carla Cena")).toBeInTheDocument();
    rerender(
      <QueryClientProvider client={cliente}>
        <VistaHoyMovil reservas={reservas} fecha="2026-11-07" columna={{ busqueda: "ana", filtroTurno: "todo" }} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Ana Espera")).toBeInTheDocument();
    expect(screen.queryByText("Carla Cena")).toBeNull();
  });

  it("cada fila conserva su botón «Sentar»", () => {
    montarColumna("", "todo");
    expect(screen.getAllByRole("button", { name: /Sentar/ }).length).toBeGreaterThan(0);
  });
});
