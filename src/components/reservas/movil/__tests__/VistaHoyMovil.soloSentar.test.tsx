/**
 * Hoy en móvil, solo para sentar (07/11/2026, petición del dueño): la lista enseña SOLO lo que está por llegar
 * («Llegan ahora» y «Por llegar», con las «Tarde»); las ya sentadas no salen (se gestionan en «Mesas»). El
 * botón de menú va al principio de la fila de controles cuando hay menú lateral (sin barra superior).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
// El botón de Avisos (con su modal y su ficha) se prueba aparte; aquí solo importa el orden de la fila.
vi.mock("@/components/avisos/BotonAvisosSeccion", () => ({ BotonAvisosSeccion: () => <button type="button">Avisos</button> }));
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

  it("sin botón «Sentar» en las filas (11/11/2026): se sienta desde la ficha", () => {
    montarColumna("", "todo");
    expect(screen.queryAllByRole("button", { name: /^Sentar a/ })).toHaveLength(0);
  });

  // 07/11/2026 («eso era para el móvil»): en escritorio, TODAS las del turno por estados, en filas de una línea.
  const montarEstados = (onSeñalar?: (id: string | null) => void) => {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const reservas = [
      res("a", "Ana Espera", "confirmada"),
      { ...res("b", "Bea Sentada", "completada"), notas_cliente: "Alérgica al marisco" },
      { ...res("i", "Íñigo Ido", "completada"), salida_at: "2026-11-07T12:50:00Z" },
      res("n", "Nora Novino", "no_show"),
    ] as never[];
    const canceladas = [res("c", "Ciro Cancela", "cancelada")] as never[];
    return render(
      <QueryClientProvider client={cliente}>
        <VistaHoyMovil reservas={reservas} fecha="2026-11-07" columna={{ busqueda: "", filtroTurno: "todo", canceladas, onSeñalar }} />
      </QueryClientProvider>,
    );
  };

  it("agrupa en «Por llegar» (con las anuladas, 13/11/2026), «Sentadas» y, plegadas al final, «Terminadas / No vino»", () => {
    montarEstados();
    const porLlegar = screen.getByRole("region", { name: "Por llegar" });
    expect(porLlegar).toHaveTextContent("Ana Espera");
    // La anulada sigue en su sitio, con «Anulada» y sin contar en la cabecera.
    expect(porLlegar).toHaveTextContent("Ciro Cancela");
    expect(within(porLlegar).getByText("Anulada")).toBeInTheDocument();
    const sentadas = screen.getByRole("region", { name: "Sentadas" });
    expect(sentadas).toHaveTextContent("Bea Sentada");
    expect(within(sentadas).getByLabelText("Alergia")).toBeInTheDocument();
    const terminadas = screen.getByRole("region", { name: "Terminadas y no vino" });
    expect(terminadas).not.toHaveTextContent("Nora Novino");
    fireEvent.click(within(terminadas).getByRole("button", { name: /Terminadas \/ No vino/ }));
    expect(terminadas).toHaveTextContent("Íñigo Ido");
    expect(terminadas).toHaveTextContent("Nora Novino");
    expect(terminadas).not.toHaveTextContent("Ciro Cancela");
  });

  it("sin «Sin mesa» ni «Tarde» (11/11/2026): el estado va junto al nombre", () => {
    montarEstados();
    const porLlegar = screen.getByRole("region", { name: "Por llegar" });
    expect(within(porLlegar).queryByTestId("mesa-fila")).toBeNull();
    expect(porLlegar).not.toHaveTextContent("Sin mesa");
    expect(porLlegar).not.toHaveTextContent("Tarde");
    const nombre = within(porLlegar).getAllByTestId("nombre-fila")[0];
    expect(nombre.parentElement).toContainElement(within(porLlegar).getAllByTestId("estado-fila")[0]);
  });

  it("se ven las observaciones, las personas llevan «px» y las sentadas no tienen «Liberar» (11/11/2026)", () => {
    montarEstados();
    const sentadas = screen.getByRole("region", { name: "Sentadas" });
    expect(within(sentadas).getByTestId("notas-fila")).toHaveTextContent("Alérgica al marisco");
    expect(within(sentadas).queryByRole("button", { name: /^Liberar/ })).toBeNull();
    expect(screen.getByRole("region", { name: "Por llegar" })).toHaveTextContent(/px/);
  });

  it("con el dedo (sin hover): tocar la fila la señala para el plano (resalta su mesa y salta de sala) y abre la ficha", () => {
    const onSeñalar = vi.fn();
    montarEstados(onSeñalar);
    fireEvent.click(screen.getByRole("button", { name: /^13:00 Ana Espera/ }));
    expect(onSeñalar).toHaveBeenLastCalledWith("a");
    expect(document.querySelector('li[data-reserva-id="a"]')).toHaveAttribute("data-señalada", "true");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("filas iguales (11/11/2026): misma altura y la línea de observaciones siempre presente", () => {
    montarEstados();
    const porLlegar = screen.getByRole("region", { name: "Por llegar" });
    const nombre = within(porLlegar).getAllByTestId("nombre-fila")[0];
    expect(nombre).toHaveTextContent("Ana Espera");
    expect(nombre).toHaveAttribute("title", "Ana Espera");
    const fila = nombre.closest("li") as HTMLElement;
    expect(fila.querySelector(".h-\\[3\\.75rem\\]")).not.toBeNull();
    expect(within(fila).getByTestId("notas-fila")).toBeInTheDocument();
  });

  it("objetivos táctiles de 44 px: la cabecera del grupo plegado", () => {
    montarEstados();
    expect(screen.getByRole("button", { name: /Terminadas \/ No vino/ })).toHaveClass("min-h-11");
  });

  it("pasar el ratón por una fila la señala para el plano; al salir, deja de señalarla", () => {
    const onSeñalar = vi.fn();
    montarEstados(onSeñalar);
    const fila = screen.getByText("Ana Espera").closest("li") as HTMLElement;
    fireEvent.mouseEnter(fila);
    expect(onSeñalar).toHaveBeenLastCalledWith("a");
    expect(fila).toHaveAttribute("data-señalada", "true");
    fireEvent.mouseLeave(fila);
    expect(onSeñalar).toHaveBeenLastCalledWith(null);
  });
});
