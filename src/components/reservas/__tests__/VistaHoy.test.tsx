/**
 * Tests de la franja "Pendientes de mesa" de `VistaHoy` (pestaña Hoy).
 *
 * ESTRATEGIA
 * ----------------------------------------------------------------------------
 * · `GestorReservasKanban` se mockea a `() => null`: es el protagonista de la
 *   pestaña, pero aquí no se prueba — y montarlo de verdad arrastraría dnd-kit
 *   y media base de datos.
 * · Los hooks de datos se mockean (ocupación, salas, asignaciones) y las
 *   reservas del día llegan por un doble en memoria del cliente de Supabase,
 *   porque esa consulta vive DENTRO del componente.
 * · Lo que NO se mockea y corre de verdad: `pendientesDeMesa` (agrupado) y
 *   `saltoAsignacion` (destino y textos). El compromiso del diseño es que esta
 *   franja y la lista de reservas digan LO MISMO ante el mismo caso, así que el
 *   test compara el `title` contra el del módulo compartido en vez de contra un
 *   literal copiado aquí: si alguien cambia el texto en un sitio y no en otro,
 *   esto no se entera... pero si alguien deja de usar el módulo compartido, sí.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Doble en memoria de `reservas` ──────────────────────────────────────────

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
    // El cliente real es "thenable": se espera con await sin llamar a nada más.
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(
        h.store.error ? { data: null, error: h.store.error } : { data: h.store.reservas, error: null },
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
vi.mock("@/hooks/useAsignacionesMesa", () => ({ useAsignacionesMesa: vi.fn() }));
// La rejilla por cuartos se prueba aparte; aquí solo cuántas se montan y de qué negocio.
vi.mock("@/components/reservas/DisponibilidadCuartos", () => ({
  DisponibilidadCuartos: ({ marca, fecha }: { marca: string; fecha: string }) => (
    <div data-testid="rejilla-cuartos">
      {marca} {fecha}
    </div>
  ),
}));

import { useResumenOcupacionHoy } from "@/hooks/useOcupacionHoy";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { VistaHoy } from "@/components/reservas/VistaHoy";
import { hoyLocal } from "@/components/reservas/asignacionPlano";
import { resolverSaltoAsignacion } from "@/lib/reservas/saltoAsignacion";

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
  porNegocio: [],
};

const reserva = (over: Record<string, unknown> & { id: string }) => ({
  nombre: "Cliente",
  hora: "13:00:00",
  numero_comensales: 2,
  estado: "confirmada",
  espacio_id: COMEDOR,
  ...over,
});

function montar(props?: Partial<{ onEspacioClick: (id: string) => void; onAsignarMesa: (d: unknown) => void }>) {
  const onEspacioClick = vi.fn();
  const onAsignarMesa = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <VistaHoy
        onEspacioClick={props?.onEspacioClick ?? onEspacioClick}
        onAsignarMesa={(props?.onAsignarMesa ?? onAsignarMesa) as (d: never) => void}
      />
    </QueryClientProvider>,
  );

  return { onEspacioClick, onAsignarMesa, queryClient };
}

/** Espera a que la consulta de reservas de hoy haya terminado (bien o mal). */
async function esperarCarga(queryClient: QueryClient) {
  await waitFor(() => {
    const estado = queryClient.getQueryState(["reservas-hoy", "pendientes-mesa", HOY]);
    expect(estado?.status === "success" || estado?.status === "error").toBe(true);
  });
}

describe("VistaHoy — franja «Pendientes de mesa»", () => {
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
    vi.mocked(useAsignacionesMesa).mockReturnValue({ data: [] } as unknown as ReturnType<
      typeof useAsignacionesMesa
    >);
  });

  // ── Cuándo NO se pinta ─────────────────────────────────────────────────────

  it("no pinta la franja cuando no hay ninguna reserva", async () => {
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(screen.queryByText("Pendientes de mesa")).not.toBeInTheDocument();
  });

  it("no pinta la franja cuando todas las reservas ya tienen mesa", async () => {
    h.store.reservas = [reserva({ id: "r1", nombre: "Ana" }), reserva({ id: "r2", nombre: "Bruno" })];
    vi.mocked(useAsignacionesMesa).mockReturnValue({
      data: [{ reserva_id: "r1" }, { reserva_id: "r2" }],
    } as unknown as ReturnType<typeof useAsignacionesMesa>);

    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(screen.queryByText("Pendientes de mesa")).not.toBeInTheDocument();
    expect(screen.queryByText("Ana")).not.toBeInTheDocument();
  });

  it("si falla la carga, la franja desaparece pero la pestaña sigue en pie", async () => {
    h.store.error = { message: "boom" };

    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(screen.queryByText("Pendientes de mesa")).not.toBeInTheDocument();
    // El resto de la pestaña (indicadores + kanban) no se tapa con un error.
    expect(screen.getByText("Reservas hoy")).toBeInTheDocument();
  });

  // ── Cuándo SÍ se pinta ─────────────────────────────────────────────────────

  it("pinta las reservas sin mesa agrupadas bajo su sala", async () => {
    h.store.reservas = [
      reserva({ id: "r1", nombre: "Ana", hora: "13:00:00", numero_comensales: 4 }),
      reserva({ id: "r2", nombre: "Bruno", espacio_id: SALON, hora: "21:30:00" }),
      reserva({ id: "r3", nombre: "Carla" }),
    ];
    vi.mocked(useAsignacionesMesa).mockReturnValue({
      data: [{ reserva_id: "r3" }],
    } as unknown as ReturnType<typeof useAsignacionesMesa>);

    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(await screen.findByText("Pendientes de mesa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comedor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salón" })).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Bruno")).toBeInTheDocument();
    // La que ya tiene mesa no sale.
    expect(screen.queryByText("Carla")).not.toBeInTheDocument();
    // Hora recortada a HH:MM y comensales visibles.
    expect(screen.getByText("13:00")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("un clic en la pastilla salta al plano con el destino exacto de la reserva", async () => {
    h.store.reservas = [reserva({ id: "r1", nombre: "Ana" })];

    const { onAsignarMesa, queryClient } = montar();
    await esperarCarga(queryClient);

    fireEvent.click(await screen.findByRole("button", { name: /Ana/ }));

    expect(onAsignarMesa).toHaveBeenCalledTimes(1);
    expect(onAsignarMesa).toHaveBeenCalledWith({
      espacioId: COMEDOR,
      fecha: HOY,
      reservaId: "r1",
      // La fixture es de las 13:00: el destino lleva el turno de COMIDA, para
      // que el plano abra en el servicio donde esa reserva existe.
      turno: "comida",
    });
  });

  it("un clic en el nombre de la sala abre el plano de esa sala", async () => {
    h.store.reservas = [reserva({ id: "r1", nombre: "Ana", espacio_id: SALON })];

    const { onEspacioClick, queryClient } = montar();
    await esperarCarga(queryClient);

    fireEvent.click(await screen.findByRole("button", { name: "Salón" }));

    expect(onEspacioClick).toHaveBeenCalledTimes(1);
    expect(onEspacioClick).toHaveBeenCalledWith(SALON);
  });

  // ── El caso "sin sala" ─────────────────────────────────────────────────────

  it("la pastilla de una reserva sin sala está deshabilitada y explica qué falta", async () => {
    h.store.reservas = [reserva({ id: "r1", nombre: "Ana", espacio_id: null })];

    const { onAsignarMesa, queryClient } = montar();
    await esperarCarga(queryClient);

    const pastilla = await screen.findByRole("button", { name: /Ana/ });
    expect(pastilla).toBeDisabled();
    // Texto del módulo compartido, no uno inventado aquí.
    expect(pastilla).toHaveAttribute(
      "title",
      resolverSaltoAsignacion({ id: "r1", fecha: HOY, espacio_id: null }).titulo,
    );

    fireEvent.click(pastilla);
    expect(onAsignarMesa).not.toHaveBeenCalled();
  });

  it("el grupo «sin sala» va el último y su cabecera no es un botón", async () => {
    h.store.reservas = [
      reserva({ id: "r1", nombre: "Huerfana", espacio_id: null, hora: "12:00:00" }),
      reserva({ id: "r2", nombre: "Ana", espacio_id: COMEDOR, hora: "13:00:00" }),
    ];

    const { queryClient } = montar();
    await esperarCarga(queryClient);

    const franja = await screen.findByLabelText("Pendientes de mesa");
    const etiquetas = Array.from(franja.querySelectorAll("button, span"))
      .map((el) => el.textContent?.trim())
      .filter((t): t is string => !!t);

    expect(etiquetas.indexOf("Sin sala")).toBeGreaterThan(etiquetas.indexOf("Comedor"));
    // "Sin sala" es texto, no un botón: desde ahí no hay plano que abrir.
    expect(screen.queryByRole("button", { name: "Sin sala" })).not.toBeInTheDocument();
    expect(screen.getByText("Sin sala")).toBeInTheDocument();
  });

  // ── Tono ───────────────────────────────────────────────────────────────────

  it("no usa tono de error: nada de rojo ni de `destructive` en la franja", async () => {
    h.store.reservas = [reserva({ id: "r1", nombre: "Ana" }), reserva({ id: "r2", espacio_id: null })];

    const { queryClient } = montar();
    await esperarCarga(queryClient);

    const franja = await screen.findByLabelText("Pendientes de mesa");
    expect(franja.className).not.toMatch(/destructive|red-/);
    for (const el of Array.from(franja.querySelectorAll("*"))) {
      expect(el.className.toString()).not.toMatch(/destructive|red-/);
    }
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
    vi.mocked(useAsignacionesMesa).mockReturnValue({ data: [] } as unknown as ReturnType<
      typeof useAsignacionesMesa
    >);
  });

  it("va plegada: no monta ninguna rejilla hasta que se despliega", () => {
    montar();
    expect(screen.getByRole("button", { name: /disponibilidad por cuartos de hora/i })).toBeInTheDocument();
    expect(screen.queryByTestId("rejilla-cuartos")).not.toBeInTheDocument();
  });

  it("al desplegarla enseña una rejilla de hoy por negocio", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /disponibilidad por cuartos de hora/i }));
    const rejillas = screen.getAllByTestId("rejilla-cuartos").map((r) => r.textContent);
    expect(rejillas).toEqual([`casa_tomas ${HOY}`, `touza ${HOY}`]);
  });
});
