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
 *   (las reservas de hoy que usan el plano y el móvil) vive DENTRO del componente.
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
  GestorReservasKanban: () => <div data-testid="vista-kanban" />,
}));
// 07/11/2026: en escritorio, la lista del móvil y el plano fijo (cada uno con sus tests): aquí, dobles.
vi.mock("@/components/reservas/movil/VistaHoyMovil", () => ({ VistaHoyMovil: () => <div data-testid="vista-lista" /> }));
vi.mock("@/components/reservas/servicio/VistaPlanoHoy", () => ({ VistaPlanoHoy: () => <div data-testid="vista-plano" /> }));
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

    expect(screen.getByLabelText("Buscar reservas")).toBeInTheDocument();
    expect(screen.getByLabelText("Filtrar por turno")).toBeInTheDocument();
  });
});

describe("VistaHoy — sin kanban ni cuartos de hora en escritorio (07/11/2026)", () => {
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

  // 07/11/2026: los cuartos de hora plegados iban con el kanban; en Hoy de escritorio ya no hay ninguno de los dos.
  it("en escritorio ya no salen ni el kanban ni los cuartos de hora", () => {
    montar();
    expect(screen.queryByRole("button", { name: /disponibilidad por cuartos de hora/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("rejilla-cuartos")).not.toBeInTheDocument();
    expect(screen.queryByTestId("vista-kanban")).not.toBeInTheDocument();
    expect(screen.getByTestId("vista-lista")).toBeInTheDocument();
    expect(screen.getByTestId("vista-plano")).toBeInTheDocument();
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
});

// 07/11/2026, «Hoy» con poca cobertura: la pestaña ya no espera al resumen de ocupación (bloqueaba todo
// con un esqueleto) y avisa con una banda fina cuando la lectura falla por red.
describe("VistaHoy — con poca cobertura", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.store.reservas = [];
    h.store.error = null;
    vi.mocked(useEspaciosReserva).mockReturnValue({ data: SALAS } as unknown as ReturnType<
      typeof useEspaciosReserva
    >);
  });

  it("no monta el resumen de ocupación (ni espera por él)", () => {
    montar();
    expect(vi.mocked(useResumenOcupacionHoy)).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Buscar reservas")).toBeInTheDocument();
  });

  it("con red no hay banda de «Sin conexión»", async () => {
    h.store.reservas = [reserva({ id: "r1", nombre: "Ana" })];
    const { queryClient } = montar();
    await esperarCarga(queryClient);
    expect(screen.queryByTestId("aviso-sin-conexion")).not.toBeInTheDocument();
  });

  it("si la lectura falla por red sale «Sin conexión»", async () => {
    h.store.error = { message: "TypeError: Failed to fetch" };
    const { queryClient } = montar();
    await esperarCarga(queryClient);
    expect(await screen.findByTestId("aviso-sin-conexion")).toHaveTextContent("Sin conexión");
  });

  it("un error que no es de red no se disfraza de «Sin conexión»", async () => {
    h.store.error = { message: "permission denied for table reservas" };
    const { queryClient } = montar();
    await esperarCarga(queryClient);
    expect(screen.queryByTestId("aviso-sin-conexion")).not.toBeInTheDocument();
  });

  it("pide columnas por nombre (`COLUMNAS_RESERVAS_HOY`), no `*`", async () => {
    h.store.reservas = [reserva({ id: "r1", nombre: "Ana", marca: "casa_tomas", notas_cliente: "trona", sobra: "x" })];
    const { queryClient } = montar();
    await esperarCarga(queryClient);
    const filas = queryClient.getQueryData<Record<string, unknown>[]>(["reservas-hoy", "pendientes-mesa", HOY])!;
    // El doble devuelve solo lo pedido: lo que no está en la lista no llega.
    expect(filas[0]).toMatchObject({ id: "r1", nombre: "Ana", notas_cliente: "trona", llegada_at: null, salida_at: null });
    expect(filas[0]).not.toHaveProperty("sobra");
  });
});
