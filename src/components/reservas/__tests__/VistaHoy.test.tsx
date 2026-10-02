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
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Doble en memoria de `reservas` ──────────────────────────────────────────

const h = vi.hoisted(() => ({
  store: { reservas: [] as Record<string, unknown>[], error: null as unknown },
  // Editar una reserva desde su pastilla (2026-09-30): el callback y el permiso
  // de la sección «reservas» que `Reservas.tsx` le pasa a `VistaHoy` por props.
  canEdit: true as boolean,
  editarReserva: vi.fn(),
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
vi.mock("@/hooks/useAsignacionesMesa", () => ({ useAsignacionesMesa: vi.fn() }));
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
import { useAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { useReservasEnVivo } from "@/hooks/useReservasEnVivo";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
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
};

const reserva = (over: Record<string, unknown> & { id: string }) => ({
  nombre: "Cliente",
  hora: "13:00:00",
  numero_comensales: 2,
  estado: "confirmada",
  espacio_id: COMEDOR,
  ...over,
});

function montar(
  props?: Partial<{
    onEspacioClick: (id: string) => void;
    onAsignarMesa: (d: unknown) => void;
    /** Montar la vista SIN editor (como la monta, p. ej., el test del timeline de estados). */
    sinEditor: boolean;
  }>,
) {
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
        onEditarReserva={props?.sinEditor ? undefined : h.editarReserva}
        puedeEditar={h.canEdit}
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

/**
 * La pastilla de una reserva (el botón que salta al plano): su nombre accesible
 * empieza por la hora. Se busca así y no por `/Ana/` a secas porque cada
 * pastilla lleva además su lápiz de editar, «Editar la reserva de Ana», que
 * también contiene el nombre.
 */
const pastillaDe = (nombre: string) => screen.findByRole("button", { name: new RegExp(`^\\d{2}:\\d{2}.*${nombre}`) });

describe("VistaHoy — franja «Pendientes de mesa»", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.canEdit = true;
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

  // Touza no admite reservas (decisión del dueño 2026-10-01): una reserva antigua de Touza que quede hoy en la
  // base de datos no sale en la franja (ni su sala), aunque no tenga mesa. Vigila también que la consulta
  // pida `marca`: el doble solo devuelve las columnas pedidas.
  it("no pinta las reservas de Touza (ni su sala), solo las de Casa Tomás", async () => {
    h.store.reservas = [
      reserva({ id: "r1", nombre: "Ana", marca: "casa_tomas" }),
      reserva({ id: "tz", nombre: "Touza Demo", espacio_id: "tz-reservado", marca: "touza", hora: "21:00:00" }),
    ];
    vi.mocked(useEspaciosReserva).mockReturnValue({
      data: [...SALAS, { id: "tz-reservado", nombre: "El Reservado", activa: true, caracteristicas: { marca: "touza" } }],
    } as unknown as ReturnType<typeof useEspaciosReserva>);

    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.queryByText("Touza Demo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "El Reservado" })).not.toBeInTheDocument();
    // La franja cuenta 1 pendiente, no 2.
    expect(within(screen.getByRole("region", { name: "Pendientes de mesa" })).getByText("1")).toBeInTheDocument();
  });

  it("un clic en la pastilla salta al plano con el destino exacto de la reserva", async () => {
    h.store.reservas = [reserva({ id: "r1", nombre: "Ana" })];

    const { onAsignarMesa, queryClient } = montar();
    await esperarCarga(queryClient);

    fireEvent.click(await pastillaDe("Ana"));

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

    const pastilla = await pastillaDe("Ana");
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

// Editar una reserva desde su pastilla (2026-09-30: las reservas se editan
// siempre, desde cualquier vista). La franja solo enseña lo que sigue SIN mesa
// y cuenta (pendiente, verificada, confirmada y «Llegó»: canceladas y «No vino»
// no ocupan sitio y no salen), y cada pastilla lleva su lápiz. El lápiz no
// sienta a nadie y NO depende de que la reserva tenga sala: una pastilla «sin
// sala» está deshabilitada para saltar al plano, pero se puede editar, y
// editarla es justo cómo se le da sala.
describe("VistaHoy — editar desde la pastilla", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.canEdit = true;
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

  const lapizDe = (nombre: string) => screen.findByRole("button", { name: `Editar la reserva de ${nombre}` });

  it.each(["pendiente", "verificada", "confirmada", "completada"])(
    "la pastilla de una reserva «%s» lleva su lápiz y abre el editor de esa reserva",
    async (estado) => {
      h.store.reservas = [reserva({ id: "r1", nombre: "Ana", estado })];

      const { onAsignarMesa, queryClient } = montar();
      await esperarCarga(queryClient);

      fireEvent.click(await lapizDe("Ana"));

      expect(h.editarReserva).toHaveBeenCalledTimes(1);
      expect(h.editarReserva).toHaveBeenCalledWith("r1");
      // Editar no es sentar: no salta al plano.
      expect(onAsignarMesa).not.toHaveBeenCalled();
    },
  );

  it("cada pastilla tiene el suyo: dos reservas, dos lápices, cada uno con su id", async () => {
    h.store.reservas = [
      reserva({ id: "r1", nombre: "Ana", hora: "13:00:00" }),
      reserva({ id: "r2", nombre: "Bruno", espacio_id: SALON, hora: "21:30:00" }),
    ];

    const { queryClient } = montar();
    await esperarCarga(queryClient);

    fireEvent.click(await lapizDe("Bruno"));
    expect(h.editarReserva).toHaveBeenLastCalledWith("r2");
    fireEvent.click(await lapizDe("Ana"));
    expect(h.editarReserva).toHaveBeenLastCalledWith("r1");
  });

  it("una reserva SIN SALA (pastilla deshabilitada para saltar al plano) se puede editar igual", async () => {
    h.store.reservas = [reserva({ id: "r1", nombre: "Huerfana", espacio_id: null })];

    const { onAsignarMesa, queryClient } = montar();
    await esperarCarga(queryClient);

    expect(await pastillaDe("Huerfana")).toBeDisabled();
    const lapiz = await lapizDe("Huerfana");
    expect(lapiz).toBeEnabled();

    fireEvent.click(lapiz);
    expect(h.editarReserva).toHaveBeenCalledWith("r1");
    expect(onAsignarMesa).not.toHaveBeenCalled();
  });

  it("una reserva sin nombre (la BD lo permite) se puede editar igual", async () => {
    h.store.reservas = [reserva({ id: "r1", nombre: null })];

    const { queryClient } = montar();
    await esperarCarga(queryClient);

    fireEvent.click(await screen.findByRole("button", { name: "Editar la reserva de este cliente" }));
    expect(h.editarReserva).toHaveBeenCalledWith("r1");
  });

  it("sin permiso de edición sobre «reservas» el lápiz sale deshabilitado y lo explica", async () => {
    h.canEdit = false;
    h.store.reservas = [reserva({ id: "r1", nombre: "Ana" })];

    const { queryClient } = montar();
    await esperarCarga(queryClient);

    const lapiz = await lapizDe("Ana");
    expect(lapiz).toBeDisabled();
    expect(lapiz).toHaveAttribute("title", expect.stringMatching(/No tienes permiso para editar reservas/));
    fireEvent.click(lapiz);
    expect(h.editarReserva).not.toHaveBeenCalled();
  });

  it("el lápiz no cambia el tono de la franja (sin rojo ni `destructive`) y la pastilla sigue igual", async () => {
    h.store.reservas = [reserva({ id: "r1", nombre: "Ana" })];

    const { onAsignarMesa, queryClient } = montar();
    await esperarCarga(queryClient);

    const lapiz = await lapizDe("Ana");
    expect(lapiz.className).not.toMatch(/destructive|red-/);
    // La pastilla sigue saltando al plano con su destino de siempre.
    fireEvent.click(await pastillaDe("Ana"));
    expect(onAsignarMesa).toHaveBeenCalledTimes(1);
  });

  it("sin editor (`onEditarReserva` no llega) las pastillas salen sin lápiz y la vista se monta igual, sin proveedor de permisos", async () => {
    h.store.reservas = [reserva({ id: "r1", nombre: "Ana" })];

    const { onAsignarMesa, queryClient } = montar({ sinEditor: true });
    await esperarCarga(queryClient);

    expect(screen.queryByRole("button", { name: /^Editar la reserva de/ })).not.toBeInTheDocument();
    // Lo de siempre sigue en pie: la pastilla salta al plano.
    fireEvent.click(await pastillaDe("Ana"));
    expect(onAsignarMesa).toHaveBeenCalledTimes(1);
  });

  it("si no hay nada pendiente no hay franja ni lápices", async () => {
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(screen.queryByText("Pendientes de mesa")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar la reserva de/ })).not.toBeInTheDocument();
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
    vi.mocked(useAsignacionesMesa).mockReturnValue({ data: [] } as unknown as ReturnType<
      typeof useAsignacionesMesa
    >);
  });

  it("monta la suscripción compartida a `reservas` (`useReservasEnVivo`) para toda la pestaña", async () => {
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(vi.mocked(useReservasEnVivo)).toHaveBeenCalled();
  });

  it("«Pendientes de mesa» (y la línea de estados, que come de ella) se relee cada minuto, solo con la pestaña a la vista", async () => {
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    const consulta = queryClient.getQueryCache().find({ queryKey: ["reservas-hoy", "pendientes-mesa", HOY] });
    expect(consulta?.observers[0]?.options).toMatchObject({
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    });
  });

  it("las mesas de hoy también se releen cada minuto: una mesa dada en otro dispositivo saca la reserva de la franja", async () => {
    const { queryClient } = montar();
    await esperarCarga(queryClient);

    expect(vi.mocked(useAsignacionesMesa)).toHaveBeenCalledWith(HOY, undefined, undefined, REFRESCO_PERIODICO);
  });

  it("la rejilla por cuartos queda dentro de `ReservasEnVivoContexto`: no abre un segundo canal a `reservas`", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /disponibilidad por cuartos de hora/i }));
    expect(screen.getByTestId("rejilla-cuartos")).toHaveAttribute("data-en-vivo", "true");
  });
});
