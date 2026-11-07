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
