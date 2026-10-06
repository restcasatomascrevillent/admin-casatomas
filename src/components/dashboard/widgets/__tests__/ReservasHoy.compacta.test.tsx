/**
 * «Reservas de Hoy» COMPACTA (06/10/2026): el Dashboard ocupa el alto de la pantalla sin scroll (regla del dueño
 * para todo el panel) y para que quepan las gráficas la tarjeta pasa de 446 a ≈ 235 px sin perder ni un dato:
 *   · la ocupación (59 % + «Moderada» + barra + «89/150 pax · 23 res.») va en UNA franja;
 *   · la línea larga «23 reservas activas (…) = 22 confirmadas + 1 verificadas + 0 pendientes» pasa a la ayuda «ⓘ»
 *     de esa franja: es el nombre accesible del botón (44 × 44, se pulsa con el dedo) y se lee entera al abrirla;
 *   · Comida y Cena, cada una en una fila (reservas y comensales en la misma línea);
 *   · las cuatro cifras (Activas, Confirmadas, Pendientes, Próxima) en una fila más baja, cifra y nombre juntos.
 * Datos de la captura del dueño: martes 06/10/2026 a las 20:40 (cena «Ahora»), 23 reservas activas y 89 comensales
 * sobre 150 de aforo, 12 de comida (46 pax) y 11 de cena (43 pax), 22 confirmadas + 1 verificada, próxima a las 21:00.
 * La disposición real (alturas en píxeles) se mide en el navegador con el arnés de capturas; aquí, estructura y datos.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const h = vi.hoisted(() => ({ reservas: [] as Array<Record<string, unknown>> }));

vi.mock("@/hooks/useDashboardStats", () => ({
  useTodayReservations: () => ({ data: h.reservas, isError: false, refetch: vi.fn() }),
  useTodayConfirmedReservations: () => ({
    data: h.reservas.filter((r) => r.estado === "confirmada"),
    isError: false,
    refetch: vi.fn(),
  }),
}));
// Salas activas de Casa Tomás: tres de 50 (aforo 150) y el Reservado, sala privada fuera de aforo.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({
          data: [
            { id: "comedor", nombre: "Comedor", capacidad_maxima: 50, caracteristicas: { marca: "casa_tomas" } },
            { id: "salon", nombre: "Salón", capacidad_maxima: 50, caracteristicas: { marca: "casa_tomas" } },
            { id: "terraza", nombre: "Terraza", capacidad_maxima: 50, caracteristicas: { marca: "casa_tomas" } },
            { id: "reservado", nombre: "Reservado", capacidad_maxima: 14, caracteristicas: { marca: "casa_tomas", privada: true } },
          ],
          error: null,
        }).then(ok, ko);
      return b;
    },
  },
}));
vi.mock("@/components/notificaciones/CentroNotificaciones", () => ({ CentroNotificaciones: () => null }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/useEdicionReserva", () => ({ useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }) }));

import { ReservasHoy } from "@/components/dashboard/widgets/ReservasHoy";

const HOY = "2026-10-06";
let n = 0;
const reserva = (hora: string, pax: number, estado = "confirmada") => ({
  id: `r${++n}`,
  nombre: `Cliente ${n}`,
  fecha: HOY,
  hora,
  numero_comensales: pax,
  estado,
  notas_cliente: null,
  en_blacklist: false,
  espacio_id: null,
  marca: "casa_tomas",
});
/** 12 de comida (46 pax, una verificada) y 11 de cena (43 pax): 23 activas, 89 pax; 22 confirmadas + 1 verificada. */
const datosDeLaCaptura = () => [
  ...[4, 2, 6, 3, 4, 5, 2, 4].map((pax, i) => reserva(`13:${String(i * 5).padStart(2, "0")}:00`, pax)),
  reserva("14:30:00", 3, "verificada"),
  ...[6, 4, 3].map((pax) => reserva("15:00:00", pax)),
  ...[4, 2, 5].map((pax, i) => reserva(`20:${String(i * 15).padStart(2, "0")}:00`, pax)),
  ...[6, 3, 4, 2, 6, 4, 3, 4].map((pax, i) => reserva(`21:${String(i * 5).padStart(2, "0")}:00`, pax)),
];

/** La ruta de la lista, para ver adónde lleva el mosaico «Pendientes». */
function Destino() {
  const { pathname, search } = useLocation();
  return <p data-testid="destino">{`${pathname}${search}`}</p>;
}

async function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/dashboard" element={<ReservasHoy />} />
          <Route path="/reservas" element={<Destino />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // El aforo (150) llega de la consulta de salas.
  await screen.findByText("89/150 pax · 23 res.");
}

beforeEach(() => {
  n = 0;
  h.reservas = datosDeLaCaptura();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${HOY}T20:40:00`));
});
afterEach(() => {
  vi.useRealTimers();
});

const DESGLOSE = "23 reservas activas (89 pax, sin canceladas) = 22 confirmadas + 1 verificadas + 0 pendientes";

describe("ReservasHoy compacta · mismos datos en menos alto", () => {
  it("la línea explicativa ya no ocupa una fila: va en la ayuda «ⓘ» (nombre accesible, 44 px) y se lee entera al abrirla", async () => {
    await montar();

    // Ya no hay párrafo a la vista con el desglose…
    expect(screen.queryByText(DESGLOSE)).not.toBeInTheDocument();
    // …lo dice el botón de ayuda, que se pulsa con el dedo (44 × 44)…
    const ayuda = screen.getByRole("button", { name: `Desglose: ${DESGLOSE}` });
    expect(ayuda).toHaveClass("h-11", "w-11");
    // …y está en la franja de ocupación, junto a «89/150 pax · 23 res.».
    expect(screen.getByTestId("franja-ocupacion")).toContainElement(ayuda);

    fireEvent.click(ayuda);
    expect(await screen.findByRole("dialog")).toHaveTextContent(DESGLOSE);
  });

  it("la ocupación va en UNA franja: %, nivel, barra y pax (antes, tres filas)", async () => {
    await montar();
    const franja = screen.getByTestId("franja-ocupacion");

    expect(within(franja).getByText("59%")).toBeInTheDocument();
    expect(within(franja).getByText("Moderada")).toBeInTheDocument();
    expect(within(franja).getByText("89/150 pax · 23 res.")).toBeInTheDocument();
    const barra = within(franja).getByRole("progressbar", { name: "Ocupación de hoy" });
    expect(barra).toHaveAttribute("aria-valuenow", "59");
    // Una fila que se parte (la barra baja a su línea en el móvil), no una columna.
    expect(franja).toHaveClass("flex", "flex-wrap", "items-center");
    expect(franja).not.toHaveClass("flex-col");
  });

  it("Comida y Cena: cada una en UNA fila, con las reservas y los comensales en la misma línea", async () => {
    await montar();
    const comida = screen.getByTestId("turno-comida");
    const cena = screen.getByTestId("turno-cena");

    for (const [turno, reservas, comensales] of [
      [comida, "12", "46 comensales"],
      [cena, "11", "43 comensales"],
    ] as const) {
      expect(turno).toHaveClass("flex", "items-center");
      expect(turno).not.toHaveClass("flex-col");
      const cifra = within(turno).getByText(reservas);
      // Reservas y comensales juntos, en el mismo bloque de la fila (antes, cada cosa en su línea).
      expect(within(turno).getByText(comensales).parentElement).toBe(cifra.parentElement);
      expect(cifra.parentElement?.parentElement).toBe(turno);
    }
    // A las 20:40 el turno en curso es la cena.
    expect(within(cena).getByText("Ahora")).toBeInTheDocument();
    expect(within(comida).queryByText("Ahora")).not.toBeInTheDocument();
  });

  it("los cuatro mosaicos siguen con sus datos (23 · 22 · 0 · 21:00), más bajos: cifra y nombre en una fila desde sm", async () => {
    await montar();
    const mosaicos = screen.getByTestId("mosaicos-estado");

    const esperado = [
      ["Activas", "23"],
      ["Confirmadas", "22"],
      ["Pendientes", "0"],
      ["Próxima", "21:00"],
    ] as const;
    expect([...mosaicos.children]).toHaveLength(4);
    esperado.forEach(([nombre, cifra], i) => {
      const mosaico = mosaicos.children[i] as HTMLElement;
      expect(within(mosaico).getByText(nombre)).toBeInTheDocument();
      expect(within(mosaico).getByText(cifra)).toBeInTheDocument();
      expect(mosaico).toHaveClass("flex-col", "sm:flex-row");
    });

    // «Pendientes» sigue llevando a la lista filtrada.
    fireEvent.click(within(mosaicos).getByRole("link"));
    expect(screen.getByTestId("destino")).toHaveTextContent("/reservas?tab=reservas&status=pendiente&date=today");
  });

  it("se lee: cifras principales de 20 px o más (24 en el %), y los nombres a 12 px", async () => {
    await montar();

    expect(screen.getByText("59%")).toHaveClass("text-2xl");
    for (const cifra of ["23", "22", "0", "21:00"]) {
      expect(within(screen.getByTestId("mosaicos-estado")).getByText(cifra)).toHaveClass("text-xl", "sm:text-2xl");
    }
    for (const [turno, cifra] of [["turno-comida", "12"], ["turno-cena", "11"]]) {
      expect(within(screen.getByTestId(turno)).getByText(cifra)).toHaveClass("text-xl");
    }
    for (const nombre of ["Activas", "Confirmadas", "Pendientes", "Próxima", "46 comensales", "89/150 pax · 23 res."]) {
      expect(screen.getByText(nombre)).toHaveClass("text-xs");
    }
  });
});
