/**
 * Tests de `VistaHoy` (pestaña Hoy).
 *
 * ESTRATEGIA
 * ----------------------------------------------------------------------------
 * · `GestorReservasKanban` se mockea a `() => null`: es el protagonista de la
 *   pestaña, pero aquí no se prueba — y montarlo de verdad arrastraría dnd-kit
 *   y media base de datos.
 * · Los hooks de datos se mockean (ocupación, salas) y las reservas del día
 *   llegan por un doble en memoria del cliente de Supabase, porque esa consulta
 *   (la del aviso de salas privadas) vive DENTRO del componente.
 * · 04/10/2026: el dueño pidió quitar de Hoy la franja «Pendientes de mesa» (el
 *   kanban ya marca «Sin mesa» en cada tarjeta) y la línea «Cómo avanza una
 *   reserva» (ruido visual): hay tests que vigilan que no vuelvan.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Doble en memoria de `reservas` ──────────────────────────────────────────

const h = vi.hoisted(() => ({
  store: { reservas: [] as Record<string, unknown>[], error: null as unknown },
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const q: Record<string, unknown> = {};
    const seguir = () => q;
    // Como PostgREST, devuelve SOLO las columnas pedidas: si la consulta deja de pedir `marca`, las filas
    // llegan sin ella y la reserva de Touza pasaría por una de Casa Tomás (lo vigila su test, más abajo).
    let columnas: string[] = [];
    q.select = (lista = "*") => {
      columnas = String(lista)
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c && c !== "*");
      return q;
    };
    const proyectar = (fila: Record<string, unknown>) =>
      columnas.length === 0 ? fila : Object.fromEntries(columnas.map((c) => [c, fila[c] ?? null]));
    q.eq = seguir;
    q.neq = seguir;
    q.order = seguir;
    // El cliente real es "thenable": se espera con await sin llamar a nada más.
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(
        h.store.error
          ? { data: null, error: h.store.error }
          : { data: h.store.reservas.map(proyectar), error: null },
      ).then(ok, ko);
    return q;
  };
  return { supabase: { from: vi.fn(() => builder()) } };
});

vi.mock("@/components/reservas/GestorReservasKanban", () => ({
  GestorReservasKanban: () => null,
}));
vi.mock("@/hooks/useOcupacionHoy", () => ({ useResumenOcupacionHoy: vi.fn() }));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: vi.fn() }));
// Las tarjetas del desplegable del Reservado (mismas del kanban): sin asignaciones, con permiso de edición,
// sin editor, lista negra ni mapa de mesas (cada uno tiene sus propios tests).
vi.mock("@/hooks/useAsignacionesMesa", () => ({ useAsignacionesMesa: vi.fn(() => ({ data: [] })) }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }),
}));
vi.mock("@/components/reservas/BlacklistModal", () => ({ BlacklistModal: () => null }));
vi.mock("@/components/reservas/ElegirMesaDialog", () => ({ ElegirMesaDialog: () => null }));
// La suscripción realtime tiene sus tests (useReservasEnVivo.test.tsx); aquí solo se mira que la
// pestaña la monte. El resto del módulo (el refresco periódico) es el de verdad.
vi.mock("@/hooks/useReservasEnVivo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useReservasEnVivo")>()),
  useReservasEnVivo: vi.fn(),
}));
// La rejilla por cuartos se prueba aparte; aquí solo cuántas se montan, de qué día y si queda
// dentro de `ReservasEnVivoContexto` (así no abre su propio canal a `reservas`).
vi.mock("@/components/reservas/DisponibilidadCuartos", async () => {
  const { useContext } = await import("react");
  const { ReservasEnVivoContexto } = await import("@/hooks/useReservasEnVivo");
  return {
    DisponibilidadCuartos: ({ fecha, ocultarTitulo }: { fecha: string; ocultarTitulo?: boolean }) => {
      const enVivo = useContext(ReservasEnVivoContexto);
      return (
        <div data-testid="rejilla-cuartos" data-ocultar-titulo={String(!!ocultarTitulo)} data-en-vivo={String(enVivo)}>
          {fecha}
        </div>
      );
    },
  };
});

import { useResumenOcupacionHoy } from "@/hooks/useOcupacionHoy";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useReservasEnVivo } from "@/hooks/useReservasEnVivo";
import { VistaHoy } from "@/components/reservas/VistaHoy";
import { hoyLocal } from "@/components/reservas/asignacionPlano";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const COMEDOR = "esp-comedor";
const SALON = "esp-salon";
const HOY = hoyLocal();

const SALAS = [
  { id: COMEDOR, nombre: "Comedor", activa: true },
  { id: SALON, nombre: "Salón", activa: true },
];

const RESUMEN = {
  totalReservas: 3,
  totalComensales: 10,
  capacidadTotal: 60,
  porcentajeTotal: 17,
  reservasCanceladas: 0,
};

const reserva = (over: Record<string, unknown> & { id: string }) => ({
  nombre: "Cliente",
  hora: "13:00:00",
  numero_comensales: 2,
  estado: "confirmada",
  espacio_id: COMEDOR,
  ...over,
});

function montar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <VistaHoy />
    </QueryClientProvider>,
  );

  return { queryClient };
}

/** Espera a que la consulta de reservas de hoy haya terminado (bien o mal). */
async function esperarCarga(queryClient: QueryClient) {
  await waitFor(() => {
    const estado = queryClient.getQueryState(["reservas-hoy", "pendientes-mesa", HOY]);
    expect(estado?.status === "success" || estado?.status === "error").toBe(true);
  });
}

describe("VistaHoy — lo que ya NO hay (retirado el 04/10/2026 a petición del dueño)", () => {
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
    vi.mocked(useEspaciosReserva).mockReturnValue({ data: SALAS } as unknown as ReturnType<
      typeof useEspaciosReserva
    >);
  });

  it("no hay franja «Pendientes de mesa», aunque haya reservas con sala y sin mesa ni reservas sin sala", async () => {
    h.store.reservas = [
      reserva({ id: "r1", nombre: "Ana" }),
      reserva({ id: "r2", nombre: "Huerfana", espacio_id: null }),
    ];
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(screen.queryByText(/Pendientes de mesa/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Pendientes de mesa")).not.toBeInTheDocument();
    // Ni sus pastillas ni sus lápices: ahora eso vive en las tarjetas del kanban.
    expect(screen.queryByText("Ana")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar la reserva de/ })).not.toBeInTheDocument();
  });

  it("no hay línea «Cómo avanza una reserva» (cifras por estado)", async () => {
    h.store.reservas = [reserva({ id: "r1", nombre: "Ana" })];
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(screen.queryByText(/Cómo avanza una reserva/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Cómo avanza una reserva/i)).not.toBeInTheDocument();
  });

  it("si falla la carga de reservas, la pestaña sigue en pie con sus indicadores", async () => {
    h.store.error = { message: "boom" };

    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(screen.getByTestId("cifras-hoy")).toHaveTextContent("reservas");
  });
});

describe("VistaHoy — disponibilidad por cuartos de hora (reservas-sin-salas)", () => {
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
    vi.mocked(useEspaciosReserva).mockReturnValue({ data: SALAS } as unknown as ReturnType<
      typeof useEspaciosReserva
    >);
  });

  it("va plegada: no monta ninguna rejilla hasta que se despliega", () => {
    montar();
    expect(screen.getByRole("button", { name: /disponibilidad por cuartos de hora/i })).toBeInTheDocument();
    expect(screen.queryByTestId("rejilla-cuartos")).not.toBeInTheDocument();
  });

  // Touza no admite reservas (decisión del dueño 2026-10-01): antes salía una rejilla por negocio (Casa Tomás y Touza).
  it("al desplegarla enseña UNA rejilla de hoy, la de Casa Tomás", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /disponibilidad por cuartos de hora/i }));
    const rejillas = screen.getAllByTestId("rejilla-cuartos").map((r) => r.textContent);
    expect(rejillas).toEqual([HOY]);
  });

  it("el título no sale dos veces seguidas: el botón del plegable ya lo dice y la rejilla lo oculta", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /disponibilidad por cuartos de hora/i }));
    expect(screen.getByTestId("rejilla-cuartos")).toHaveAttribute("data-ocultar-titulo", "true");
  });
});

describe("VistaHoy — lo que cambia en OTRO dispositivo (realtime y su respaldo)", () => {
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
    vi.mocked(useEspaciosReserva).mockReturnValue({ data: SALAS } as unknown as ReturnType<
      typeof useEspaciosReserva
    >);
  });

  it("monta la suscripción compartida a `reservas` (`useReservasEnVivo`) para toda la pestaña", async () => {
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(vi.mocked(useReservasEnVivo)).toHaveBeenCalled();
  });

  it("la consulta de reservas de hoy (la del aviso de salas privadas) se relee cada minuto, solo con la pestaña a la vista", async () => {
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    const consulta = queryClient.getQueryCache().find({ queryKey: ["reservas-hoy", "pendientes-mesa", HOY] });
    expect(consulta?.observers[0]?.options).toMatchObject({
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    });
  });

  it("la rejilla por cuartos queda dentro de `ReservasEnVivoContexto`: no abre un segundo canal a `reservas`", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /disponibilidad por cuartos de hora/i }));
    expect(screen.getByTestId("rejilla-cuartos")).toHaveAttribute("data-en-vivo", "true");
  });
});

describe("VistaHoy — el Reservado (sala privada) está fuera de aforo pero a la vista", () => {
  const RESERVADO = "esp-reservado";
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
    vi.mocked(useEspaciosReserva).mockReturnValue({
      data: [...SALAS, { id: RESERVADO, nombre: "Reservado", activa: true, caracteristicas: { marca: "casa_tomas", privada: true } }],
    } as unknown as ReturnType<typeof useEspaciosReserva>);
  });

  it("con una reserva en el Reservado: «Reservado: ocupado — García, 8 pax (comida)», aparte de las cifras", async () => {
    h.store.reservas = [
      reserva({ id: "g", nombre: "García", numero_comensales: 8, espacio_id: RESERVADO, hora: "14:00:00" }),
    ];
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    const aviso = await screen.findByTestId("aviso-sala-privada");
    expect(aviso).toHaveTextContent("Reservado: ocupado — García, 8 pax (comida); libre en la cena");
    expect(aviso).toHaveTextContent("Fuera de aforo");
    // Las cifras de la franja son las del resumen (que ya las calcula sin el Reservado): no se tocan aquí.
    expect(screen.getByTestId("cifras-hoy")).toHaveTextContent("comensales");
  });

  // 04/10/2026 (dueño): el Reservado ya no tiene columna en el kanban; "al darle al desplegable veo quién es".
  it("el aviso es un desplegable: cerrado no hay tarjetas; abierto, una por reserva con teléfono, estado y «Ha llegado»", async () => {
    h.store.reservas = [
      reserva({
        id: "g",
        nombre: "García",
        numero_comensales: 8,
        espacio_id: RESERVADO,
        hora: "14:00:00",
        telefono: "600111222",
        estado: "confirmada",
      }),
    ];
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    const aviso = await screen.findByTestId("aviso-sala-privada");
    const disparador = await within(aviso).findByRole("button", { name: /Reservado: ocupado/ });
    expect(disparador).toHaveAttribute("aria-expanded", "false");
    expect(within(aviso).queryByText("600111222")).not.toBeInTheDocument();
    expect(within(aviso).queryByRole("button", { name: /Marcar que García ha llegado/ })).not.toBeInTheDocument();

    fireEvent.click(disparador);

    expect(disparador).toHaveAttribute("aria-expanded", "true");
    const tarjetas = within(aviso).getByRole("list", { name: "Reservas de la sala privada" });
    expect(within(tarjetas).getAllByRole("listitem")).toHaveLength(1);
    expect(within(tarjetas).getByText("García")).toBeInTheDocument();
    expect(within(tarjetas).getByText("14:00")).toBeInTheDocument();
    expect(within(tarjetas).getByText("Confirmada")).toBeInTheDocument();
    expect(within(tarjetas).getByRole("link", { name: /600111222/ })).toHaveAttribute("href", "tel:600111222");
    // Las mismas acciones que la tarjeta del kanban: llegada, estrella y el menú «⋮».
    expect(within(tarjetas).getByRole("button", { name: /Marcar que García ha llegado/ })).toBeEnabled();
    expect(within(tarjetas).getByRole("button", { name: "Marcar como importante" })).toBeInTheDocument();
    expect(within(tarjetas).getByRole("button", { name: /^Acciones de la reserva de García/ })).toBeInTheDocument();

    fireEvent.click(disparador);
    await waitFor(() => expect(within(aviso).queryByRole("list", { name: "Reservas de la sala privada" })).not.toBeInTheDocument());
  });

  it("el menú «⋮» de la tarjeta del Reservado ofrece «Mover a…» las demás salas y «Sin asignar»", async () => {
    h.store.reservas = [reserva({ id: "g", nombre: "García", espacio_id: RESERVADO, hora: "14:00:00" })];
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    fireEvent.click(await screen.findByRole("button", { name: /Reservado: ocupado/ }));
    const menuBtn = await screen.findByRole("button", { name: /^Acciones de la reserva de García/ });
    fireEvent.keyDown(menuBtn, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /^Comedor/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /^Salón/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /^Sin asignar/ })).toBeInTheDocument();
    // Ya está en el Reservado: no se ofrece como destino.
    expect(within(menu).queryByRole("menuitem", { name: /^Reservado/ })).not.toBeInTheDocument();
  });

  it("con el Reservado libre no hay desplegable ni tarjetas", async () => {
    h.store.reservas = [reserva({ id: "a", nombre: "Ana" })];
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    const aviso = await screen.findByTestId("aviso-sala-privada");
    expect(aviso).toHaveTextContent("Reservado: libre");
    expect(within(aviso).queryByRole("button")).not.toBeInTheDocument();
    expect(within(aviso).queryByRole("list")).not.toBeInTheDocument();
  });

  it("sin reservas en el Reservado: «Reservado: libre»", async () => {
    h.store.reservas = [reserva({ id: "a", nombre: "Ana" })];
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(await screen.findByTestId("aviso-sala-privada")).toHaveTextContent("Reservado: libre");
  });

  it("una reserva cancelada no lo ocupa", async () => {
    h.store.reservas = [reserva({ id: "g", nombre: "García", espacio_id: RESERVADO, estado: "cancelada" })];
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(await screen.findByTestId("aviso-sala-privada")).toHaveTextContent("Reservado: libre");
  });

  it("si no hay ninguna sala privada, no hay aviso", async () => {
    vi.mocked(useEspaciosReserva).mockReturnValue({ data: SALAS } as unknown as ReturnType<typeof useEspaciosReserva>);
    h.store.reservas = [reserva({ id: "a", nombre: "Ana" })];
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(screen.queryByTestId("aviso-sala-privada")).not.toBeInTheDocument();
  });
});
