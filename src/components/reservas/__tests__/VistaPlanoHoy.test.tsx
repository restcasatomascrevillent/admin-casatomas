/**
 * «Hoy» en vista PLANO (06/10/2026): los planos de las salas con las reservas de hoy sobre sus mesas.
 *
 * Se monta `VistaPlanoHoy` de verdad (con la tarjeta del kanban, `ReservaCard`, y el mapa); los datos y las
 * acciones son dobles. El reloj se fija a las 14:30 de un martes para que cada mesa caiga en un estado
 * conocido con los umbrales de Configuración (comida 90 min, cena 120, margen de retraso 15):
 *
 *   mesa 1 → Olga, llegó a las 14:00            → ocupada (30 min)
 *   mesa 2 → Rosa, 14:45, por llegar             → reservada
 *   mesa 3 → Raúl, 14:00, sin llegar (30 min)    → retrasada
 *   mesa 4 → Pablo, llegó a las 12:30            → por liberar (120 ≥ 90)
 *   mesa 5 → nadie                               → libre
 *   Berta (14:15) y Diana (cena, 21:00): Comedor sin mesa. Carlos: sin sala.
 */
import { useState } from "react";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  espacios: [] as Record<string, unknown>[],
  mesas: [] as Record<string, unknown>[],
  asignaciones: [] as Record<string, unknown>[],
  acciones: {} as Record<string, unknown>,
  liberar: (() => undefined) as unknown,
  deshacer: (() => undefined) as unknown,
  asignar: (() => undefined) as unknown,
  /** Lo que ha abierto el mapa de «Dar mesa» (`ElegirMesaDialog`). */
  mapa: [] as string[],
  /** Cómo está la consulta de mesas asignadas de hoy. */
  asignacionesEstado: "ok" as "ok" | "cargando" | "error",
  refetchAsignaciones: (() => undefined) as unknown,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: h.espacios }) }));
vi.mock("@/hooks/useAsignacionesMesa", () => ({
  useAsignacionesMesa: () =>
    h.asignacionesEstado === "ok"
      ? { data: h.asignaciones, isLoading: false, isError: false, refetch: h.refetchAsignaciones }
      : { data: undefined, isLoading: h.asignacionesEstado === "cargando", isError: h.asignacionesEstado === "error", refetch: h.refetchAsignaciones },
  useAsignarMesasReserva: () => ({ mutateAsync: h.asignar }),
}));
vi.mock("@/hooks/useMesas", () => ({
  useMesas: (espacioId?: string) => ({
    data: h.mesas.filter((m) => m.espacio_id === espacioId),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/usePlanosEspacio", () => ({ usePlanoEspacio: () => ({ data: null }) }));
vi.mock("@/hooks/useConfiguracionReservas", () => ({
  useConfiguracionReservas: () => ({
    data: { estancia_comida_minutos: 90, estancia_cena_minutos: 120, retraso_gracia_minutos: 15 },
  }),
}));
vi.mock("@/hooks/useAccionesServicioReserva", () => ({ useAccionesServicioReserva: () => h.acciones }));
vi.mock("@/hooks/useAccionesModoServicio", () => ({
  useAccionesModoServicio: () => ({ liberarMesa: h.liberar, deshacerLiberarMesa: h.deshacer, estaEnCurso: () => false }),
}));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/useEdicionReserva", () => ({ useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }) }));
vi.mock("@/components/reservas/BlacklistModal", () => ({ BlacklistModal: () => null }));
vi.mock("@/components/reservas/ElegirMesaDialog", () => ({
  ElegirMesaDialog: ({ reserva, espacioNombre }: { reserva: { nombre: string }; espacioNombre: string }) => {
    h.mapa.push(`${reserva.nombre} → ${espacioNombre}`);
    return <div data-testid="elegir-mesa">{`Elige la mesa de ${reserva.nombre} en ${espacioNombre}`}</div>;
  },
}));

import { VistaPlanoHoy, type ReservaPlanoHoy } from "@/components/reservas/servicio/VistaPlanoHoy";
import type { FiltroTurnoHoy } from "@/lib/reservas/vistaHoy";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const a = (hh: number, mm = 0) => new Date(2026, 9, 6, hh, mm);
const CT = { marca: "casa_tomas" };

const mesa = (id: string, nombre: string, espacio_id: string, capacidad: number, pos_x: number, pos_y: number) => ({
  id,
  nombre,
  espacio_id,
  capacidad,
  forma: "rectangular",
  ancho: 80,
  alto: 80,
  pos_x,
  pos_y,
  rotacion: 0,
  activa: true,
  is_merged: false,
  original_mesas: null,
  etiqueta: null,
  created_at: "",
  updated_at: "",
});

const reserva = (
  id: string,
  nombre: string,
  hora: string,
  estado: string,
  espacio_id: string | null,
  extra: Partial<ReservaPlanoHoy> = {},
): ReservaPlanoHoy => ({
  id,
  nombre,
  hora,
  numero_comensales: 3,
  estado,
  espacio_id,
  telefono: "600000000",
  email: null,
  importante: false,
  marca: "casa_tomas",
  llegada_at: null,
  salida_at: null,
  ...extra,
});

const asignacion = (reserva_id: string, mesa_id: string, nombreMesa: string, espacio_id: string) => ({
  id: `a-${reserva_id}`,
  reserva_id,
  mesa_id,
  created_at: "",
  reservas: { id: reserva_id, nombre: "", hora: "", numero_comensales: 3, estado: "confirmada" },
  mesas: { id: mesa_id, nombre: nombreMesa, capacidad: 4, espacio_id },
});

const RESERVAS: ReservaPlanoHoy[] = [
  reserva("r-olga", "Olga Ocupada", "13:45:00", "completada", "comedor", { llegada_at: a(14).toISOString() }),
  reserva("r-rosa", "Rosa Reservada", "14:45:00", "confirmada", "comedor"),
  reserva("r-raul", "Raúl Retrasado", "14:00:00", "confirmada", "comedor"),
  reserva("r-pablo", "Pablo Porliberar", "12:30:00", "completada", "comedor", { llegada_at: a(12, 30).toISOString() }),
  reserva("r-berta", "Berta Sinmesa", "14:15:00", "confirmada", "comedor"),
  reserva("r-diana", "Diana Cena", "21:00:00", "confirmada", "comedor"),
  reserva("r-carlos", "Carlos Sinsala", "13:30:00", "confirmada", null),
  reserva("r-elena", "Elena Reservado", "13:00:00", "confirmada", "reservado"),
  reserva("r-fran", "Fran Salon", "14:00:00", "confirmada", "salon"),
];

function Plano({
  busqueda = "",
  filtroTurno = "todo",
  salaInicial = null,
  onCambiarSala,
  onAbrirReparto,
  reservas = RESERVAS,
  reservasError,
  onReintentarReservas,
}: {
  busqueda?: string;
  filtroTurno?: FiltroTurnoHoy;
  salaInicial?: string | null;
  onCambiarSala?: (id: string) => void;
  onAbrirReparto?: (id: string) => void;
  reservas?: ReservaPlanoHoy[] | null;
  reservasError?: boolean;
  onReintentarReservas?: () => void;
}) {
  const [sala, setSala] = useState<string | null>(salaInicial);
  return (
    <VistaPlanoHoy
      reservas={reservas ?? undefined}
      reservasError={reservasError}
      onReintentarReservas={onReintentarReservas}
      busqueda={busqueda}
      filtroTurno={filtroTurno}
      salaId={sala}
      onCambiarSala={(id) => {
        onCambiarSala?.(id);
        setSala(id);
      }}
      onAbrirReparto={onAbrirReparto}
    />
  );
}

function montar(props: Parameters<typeof Plano>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <main style={{ paddingBottom: 24 }}>
        <Plano {...props} />
      </main>
    </QueryClientProvider>,
  );
}

const mesaBoton = (nombre: string) => screen.getByRole("button", { name: new RegExp(`^Mesa ${nombre},`) });
const estadoDe = (nombre: string) => mesaBoton(nombre).getAttribute("data-estado");

const anchoOriginal = window.innerWidth;
/** Ancho de la ventana: desde 1280 px la lista va al lado; por debajo, en hojas. */
function anchoVentana(px: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: px });
}

beforeEach(() => {
  anchoVentana(1440);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(a(14, 30));
  h.espacios = [
    // Como las devuelve `useEspaciosReserva` (por nombre): el Reservado NO va el último.
    { id: "comedor", nombre: "Comedor", capacidad_maxima: 50, activa: true, caracteristicas: CT },
    { id: "reservado", nombre: "Reservado", capacidad_maxima: 14, activa: true, caracteristicas: { ...CT, privada: true } },
    { id: "salon", nombre: "Salón", capacidad_maxima: 50, activa: true, caracteristicas: CT },
    { id: "terraza", nombre: "Terraza", capacidad_maxima: 50, activa: true, caracteristicas: CT },
  ];
  h.mesas = [
    mesa("m1", "1", "comedor", 2, 1, 1),
    mesa("m2", "2", "comedor", 4, 3, 1),
    mesa("m3", "3", "comedor", 4, 5, 1),
    mesa("m4", "4", "comedor", 6, 1, 4),
    mesa("m5", "5", "comedor", 4, 3, 4),
    mesa("s10", "10", "salon", 4, 2, 2),
    mesa("rv", "R", "reservado", 12, 1, 1),
  ];
  h.asignaciones = [
    asignacion("r-olga", "m1", "1", "comedor"),
    asignacion("r-rosa", "m2", "2", "comedor"),
    asignacion("r-raul", "m3", "3", "comedor"),
    asignacion("r-pablo", "m4", "4", "comedor"),
    asignacion("r-elena", "rv", "R", "reservado"),
    asignacion("r-fran", "s10", "10", "salon"),
  ];
  h.acciones = {
    estaEnCurso: () => false,
    marcarLlegada: vi.fn(async () => true),
    marcarNoShow: vi.fn(async () => true),
    deshacerLlegadaONoShow: vi.fn(async () => true),
    alternarImportante: vi.fn(async () => true),
    moverEspacio: vi.fn(async () => true),
  };
  h.liberar = vi.fn(async () => true);
  h.deshacer = vi.fn(async () => true);
  h.asignar = vi.fn(async () => []);
  h.mapa = [];
  h.asignacionesEstado = "ok";
  h.refetchAsignaciones = vi.fn();
});
afterEach(() => {
  anchoVentana(anchoOriginal);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Plano de Hoy · las salas", () => {
  it("una pestaña por sala de Casa Tomás, con sus reservas y las que siguen sin mesa; el Reservado la última y fuera de aforo", () => {
    montar();
    const pestanas = screen.getAllByRole("tab");
    expect(pestanas.map((p) => p.getAttribute("aria-label"))).toEqual([
      "Comedor: 6 reservas, 2 sin mesa",
      "Salón: 1 reserva",
      "Terraza: 0 reservas",
      "Reservado: 1 reserva, sala privada fuera de aforo",
    ]);
    expect(within(pestanas[3]).getByTestId("etiqueta-fuera-de-aforo")).toHaveTextContent("Fuera de aforo");
    for (const p of pestanas.slice(0, 3)) expect(within(p).queryByTestId("etiqueta-fuera-de-aforo")).toBeNull();
    // Sin sala elegida (o una que ya no existe): la primera.
    expect(pestanas[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Plano de Comedor" })).toBeInTheDocument();
  });

  it("tocar otra sala la elige y pinta SUS mesas", () => {
    const onCambiarSala = vi.fn();
    montar({ onCambiarSala });
    expect(mesaBoton("2")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: /^Salón/ }), { button: 0 });
    expect(onCambiarSala).toHaveBeenCalledWith("salon");
    expect(screen.getByRole("tab", { name: /^Salón/ })).toHaveAttribute("aria-selected", "true");
    expect(mesaBoton("10")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Mesa 2,/ })).toBeNull();
  });

  it("el Reservado se ve como cualquier sala: su mesa, con su reserva", () => {
    montar({ salaInicial: "reservado" });
    expect(screen.getByRole("tab", { name: /^Reservado/ })).toHaveAttribute("aria-selected", "true");
    expect(mesaBoton("R")).toHaveAccessibleName(/Elena Reservado/);
  });

  it("ya no ofrece «Reparto de mesas» (10/10/2026), aunque se le pase `onAbrirReparto`", () => {
    const onAbrirReparto = vi.fn();
    montar({ onAbrirReparto, salaInicial: "salon" });
    expect(screen.queryByRole("button", { name: /reparto de mesas/i })).toBeNull();
  });
});

describe("Plano de Hoy · las mesas, con la lógica y los umbrales del modo servicio", () => {
  it("cada mesa del color de su estado, con su número a la vista", () => {
    montar();
    expect(estadoDe("1")).toBe("ocupada");
    expect(estadoDe("2")).toBe("reservada");
    expect(estadoDe("3")).toBe("retrasada");
    expect(estadoDe("4")).toBe("por_liberar");
    expect(estadoDe("5")).toBe("libre");
    expect(mesaBoton("2")).toHaveAccessibleName("Mesa 2, 4 plazas, Reservada: Rosa Reservada a las 14:45, 3 comensales, en 15 min");
    // El número va en la rotulación de encima (derecho aunque la mesa esté girada).
    expect(mesaBoton("5").nextElementSibling).toHaveTextContent(/^5/);

    // Leyenda con el recuento de cada estado.
    const leyenda = screen.getByRole("list", { name: "Leyenda de estados de mesa" });
    expect(within(leyenda).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Libre1",
      "Reservada1",
      "Retrasada1",
      "Ocupada1",
      "Por liberar1",
    ]);
  });

  it("tocar una mesa enseña su número y la MISMA tarjeta del kanban, con sus acciones", () => {
    montar();
    fireEvent.click(mesaBoton("2"));
    expect(mesaBoton("2")).toHaveAttribute("aria-pressed", "true");
    const detalle = screen.getByTestId("detalle-mesa");
    expect(within(detalle).getByRole("heading", { name: "Mesa 2" })).toBeInTheDocument();
    expect(within(detalle).getByRole("button", { name: /^Rosa Reservada, 14:45/ })).toHaveAttribute("aria-haspopup", "menu");
    expect(within(detalle).getByRole("button", { name: "Acciones de la reserva de Rosa Reservada" })).toBeInTheDocument();

    fireEvent.click(within(detalle).getByRole("button", { name: "Marcar que Rosa Reservada ha llegado" }));
    expect(h.acciones.marcarLlegada).toHaveBeenCalledWith(expect.objectContaining({ id: "r-rosa" }));

    // Otra vez la misma mesa, o la X: se cierra y vuelve la lista por sentar.
    fireEvent.click(within(detalle).getByRole("button", { name: "Cerrar la mesa" }));
    expect(screen.queryByTestId("detalle-mesa")).toBeNull();
    expect(screen.getByRole("region", { name: "Sin mesa en Comedor" })).toBeInTheDocument();
  });

  it("mesa con gente sentada: «Liberar mesa» (lo del modo servicio)", () => {
    montar();
    fireEvent.click(mesaBoton("4"));
    fireEvent.click(within(screen.getByTestId("detalle-mesa")).getByRole("button", { name: /Liberar mesa/ }));
    expect(h.liberar).toHaveBeenCalledWith(expect.objectContaining({ id: "r-pablo" }));
  });

  it("mesa libre: «Sentar aquí» a una reserva de la sala sin mesa, del turno que se ve", async () => {
    montar();
    fireEvent.click(mesaBoton("5"));
    const detalle = screen.getByTestId("detalle-mesa");
    // Diana es de la cena: con la comida en pantalla no se ofrece aquí.
    expect(within(detalle).queryByRole("button", { name: /Diana Cena/ })).toBeNull();
    fireEvent.click(within(detalle).getByRole("button", { name: /^Sentar en la mesa 5 a Berta Sinmesa/ }));
    await waitFor(() => expect(h.asignar).toHaveBeenCalledWith({ reserva_id: "r-berta", mesa_ids: ["m5"] }));
  });
});

describe("Plano de Hoy · las reservas por sentar", () => {
  it("al lado, con la tarjeta del kanban: «Sin mesa en Comedor» y «Sin sala»", () => {
    montar();
    const sinMesa = screen.getByRole("region", { name: "Sin mesa en Comedor" });
    expect(within(sinMesa).getAllByRole("button", { name: /^(Berta|Diana|Carlos)[^,]*,/ }).map((b) => b.getAttribute("aria-label")?.split(",")[0])).toEqual([
      "Berta Sinmesa",
      "Diana Cena",
    ]);
    expect(within(sinMesa).getAllByText("Sin mesa")).toHaveLength(2);
    const sinSala = screen.getByRole("region", { name: "Sin sala" });
    expect(within(sinSala).getByRole("button", { name: /^Carlos Sinsala,/ })).toBeInTheDocument();
  });

  it("«Dar mesa» abre el mapa de siempre para elegirle la mesa en su sala", async () => {
    montar();
    const sinMesa = screen.getByRole("region", { name: "Sin mesa en Comedor" });
    fireEvent.keyDown(within(sinMesa).getByRole("button", { name: "Acciones de la reserva de Berta Sinmesa" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Dar mesa" }));
    expect(await screen.findByTestId("elegir-mesa")).toHaveTextContent("Elige la mesa de Berta Sinmesa en Comedor");
  });
});

describe("Plano de Hoy · el buscador y el turno de arriba", () => {
  it("el buscador resalta las mesas que coinciden, atenúa las demás y filtra las listas y las cifras", () => {
    montar({ busqueda: "rosa" });
    expect(mesaBoton("2")).not.toHaveAttribute("data-atenuada");
    for (const n of ["1", "3", "4", "5"]) expect(mesaBoton(n)).toHaveAttribute("data-atenuada", "true");
    expect(screen.getByRole("tab", { name: /^Comedor/ })).toHaveAccessibleName("Comedor: 1 reserva");
    expect(within(screen.getByRole("region", { name: "Sin mesa en Comedor" })).queryByRole("button", { name: /^Berta/ })).toBeNull();
  });

  it("sin búsqueda no se atenúa nada", () => {
    montar();
    for (const n of ["1", "2", "3", "4", "5"]) expect(mesaBoton(n)).not.toHaveAttribute("data-atenuada");
  });

  it("con «Todo el día» se pinta el turno EN CURSO; con «Cena», la cena (y las listas, solo la cena)", () => {
    const { unmount } = montar();
    expect(screen.getByRole("region", { name: "Plano de Comedor" })).toHaveTextContent("Comida · turno en curso");
    unmount();

    montar({ filtroTurno: "cena" });
    const plano = screen.getByRole("region", { name: "Plano de Comedor" });
    expect(plano).toHaveTextContent("Cena");
    expect(plano).not.toHaveTextContent("turno en curso");
    // Nadie de la comida ocupa mesa en la cena.
    for (const n of ["1", "2", "3", "4", "5"]) expect(estadoDe(n)).toBe("libre");
    const sinMesa = screen.getByRole("region", { name: "Sin mesa en Comedor" });
    expect(within(sinMesa).getByRole("button", { name: /^Diana Cena,/ })).toBeInTheDocument();
    expect(within(sinMesa).queryByRole("button", { name: /^Berta/ })).toBeNull();
  });
});

describe("Plano de Hoy · el alto de la pantalla", () => {
  const original = { innerHeight: window.innerHeight };
  afterEach(() => Object.defineProperty(window, "innerHeight", { configurable: true, value: original.innerHeight }));

  /** El bloque empieza en y = 400 (lo de arriba de «Hoy») en una ventana de `alto` px. */
  function conLayout(alto: number) {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: alto });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = this.dataset.testid === "plano-hoy" ? 400 : 0;
      return { top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON: () => ({}) };
    });
  }

  it("mide justo lo que queda de ventana (alto visible − su posición − relleno del <main>): sin scroll de página", () => {
    conLayout(900);
    montar();
    const bloque = screen.getByTestId("plano-hoy");
    expect(bloque).toHaveAttribute("data-altura-fija", "476");
    expect(bloque.style.height).toBe("476px");
    expect(bloque).toHaveClass("flex-none");
    expect(bloque).not.toHaveClass("flex-1");
  });

  it("y nunca menos del suelo del kanban (280 px): solo entonces la página haría scroll", () => {
    conLayout(600);
    montar();
    expect(screen.getByTestId("plano-hoy")).toHaveAttribute("data-altura-fija", "280");
  });

  it("sin scroll doble: el plano no se desplaza (se ajusta) y lo ÚNICO con scroll propio es la lista de al lado", () => {
    conLayout(900);
    montar();
    const bloque = screen.getByTestId("plano-hoy");
    const plano = screen.getByRole("region", { name: "Plano de Comedor" });
    expect(plano).toHaveClass("overflow-hidden", "min-h-0");
    expect(screen.getByTestId("mapa-sala")).toHaveClass("overflow-hidden");
    const desplazables = bloque.querySelectorAll("[data-radix-scroll-area-viewport]");
    expect(desplazables).toHaveLength(1);
    expect(screen.getByRole("complementary", { name: "Reservas por sentar" })).toContainElement(desplazables[0] as HTMLElement);
  });

  it("sin medidas (jsdom) no fija ningún alto", () => {
    montar();
    expect(screen.getByTestId("plano-hoy")).not.toHaveAttribute("data-altura-fija");
    expect(screen.getByTestId("plano-hoy").style.height).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Revisión del 07/10/2026
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe("Plano de Hoy · carga y errores veraces (nunca «Libre» sin saberlo)", () => {
  it("con las mesas asignadas aún cargando: esqueleto, ni una mesa «Libre», sin «Todas tienen mesa» y sin cifras en las salas", () => {
    h.asignacionesEstado = "cargando";
    montar();
    expect(screen.getByTestId("plano-cargando")).toHaveTextContent("Cargando el plano…");
    expect(document.querySelectorAll('[data-estado="libre"]')).toHaveLength(0);
    expect(screen.queryByText(/tienen mesa/)).toBeNull();
    expect(screen.getByRole("status", { name: "Cargando las reservas…" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Comedor" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /reservas?/ })).toBeNull();
  });

  it("si fallan las mesas asignadas: aviso con «Reintentar» (que vuelve a pedirlas) y ningún dato inventado", () => {
    h.asignacionesEstado = "error";
    montar();
    const avisos = screen.getAllByRole("alert");
    expect(avisos[0]).toHaveTextContent("No se pudieron cargar las mesas asignadas de hoy.");
    expect(document.querySelectorAll("[data-mesa-id]")).toHaveLength(0);
    expect(screen.queryByText(/tienen mesa/)).toBeNull();
    fireEvent.click(within(avisos[0]).getByRole("button", { name: "Reintentar" }));
    expect(h.refetchAsignaciones).toHaveBeenCalled();
  });

  it("con las reservas de hoy aún cargando: «Cargando el plano…»", () => {
    montar({ reservas: null });
    expect(screen.getByTestId("plano-cargando")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-mesa-id]")).toHaveLength(0);
  });

  it("si fallan las reservas de hoy: aviso con «Reintentar», no «Cargando…» para siempre", () => {
    const onReintentarReservas = vi.fn();
    montar({ reservas: null, reservasError: true, onReintentarReservas });
    expect(screen.queryByTestId("plano-cargando")).toBeNull();
    const aviso = screen.getAllByRole("alert")[0];
    expect(aviso).toHaveTextContent("No se pudieron cargar las reservas de hoy.");
    fireEvent.click(within(aviso).getByRole("button", { name: "Reintentar" }));
    expect(onReintentarReservas).toHaveBeenCalled();
  });
});

describe("Plano de Hoy · «Sentar aquí» marca también la llegada", () => {
  const conTardia = () => [...RESERVAS, reserva("r-hugo", "Hugo Tarde", "15:30:00", "confirmada", "comedor")];

  it("da la mesa Y marca «Ha llegado» (como el kanban): no se queda «Reservada» camino de un «No vino» falso", async () => {
    montar();
    fireEvent.click(mesaBoton("5"));
    const detalle = screen.getByTestId("detalle-mesa");
    fireEvent.click(within(detalle).getByRole("button", { name: /^Sentar en la mesa 5 a Berta Sinmesa.*marca que ha llegado/ }));
    await waitFor(() => expect(h.acciones.marcarLlegada).toHaveBeenCalledWith(expect.objectContaining({ id: "r-berta" })));
    expect(h.asignar).toHaveBeenCalledWith({ reserva_id: "r-berta", mesa_ids: ["m5"] });
    // Berta es a las 14:15 (ya es su hora): no se ofrece «Solo dar la mesa».
    expect(within(detalle).queryByRole("button", { name: /^Solo dar la mesa 5 a Berta/ })).toBeNull();
  });

  it("si falta más de media hora se ofrece además «Solo dar la mesa», que NO marca la llegada", async () => {
    montar({ reservas: conTardia() });
    fireEvent.click(mesaBoton("5"));
    const detalle = screen.getByTestId("detalle-mesa");
    fireEvent.click(within(detalle).getByRole("button", { name: /^Solo dar la mesa 5 a Hugo Tarde/ }));
    await waitFor(() => expect(h.asignar).toHaveBeenCalledWith({ reserva_id: "r-hugo", mesa_ids: ["m5"] }));
    expect(h.acciones.marcarLlegada).not.toHaveBeenCalled();
  });

  it("si la mesa no se guarda, tampoco se marca la llegada", async () => {
    h.asignar = vi.fn(async () => {
      throw new Error("MESA_OCUPADA");
    });
    montar();
    fireEvent.click(mesaBoton("5"));
    fireEvent.click(within(screen.getByTestId("detalle-mesa")).getByRole("button", { name: /^Sentar en la mesa 5 a Berta/ }));
    await waitFor(() => expect(h.asignar).toHaveBeenCalled());
    expect(h.acciones.marcarLlegada).not.toHaveBeenCalled();
  });
});

describe("Plano de Hoy · un toque en una mesa abre ESA mesa", () => {
  it("el área táctil ampliada va en una capa por DEBAJO de todas las mesas, y la mesa mide su tamaño exacto", () => {
    montar();
    const halos = [...document.querySelectorAll<HTMLElement>("[data-halo-mesa]")];
    const botones = [...document.querySelectorAll<HTMLElement>("button[data-mesa-id]")];
    expect(halos).toHaveLength(5);
    const zMinBoton = Math.min(...botones.map((b) => Number(b.style.zIndex)));
    for (const halo of halos) {
      expect(Number(halo.style.zIndex)).toBeLessThan(zMinBoton);
      expect(halo.querySelector("button")).toBeNull();
    }
    // Sin medidas (jsdom) la escala es 1: una mesa de 80 cm a 50 px/m mide 40 px; su halo, 48.
    expect(mesaBoton("2").style.width).toBe("40px");
    expect(document.querySelector<HTMLElement>('[data-halo-mesa="m2"]')!.style.width).toBe("48px");
  });

  it("tocar el halo (fuera de cualquier mesa) también abre su mesa", () => {
    montar();
    fireEvent.click(document.querySelector('[data-halo-mesa="m2"]')!);
    expect(screen.getByTestId("detalle-mesa")).toHaveTextContent("Mesa 2");
  });
});

describe("Plano de Hoy · el estado no se dice solo con color", () => {
  it("cada mesa lleva el icono de su estado en la esquina", () => {
    montar();
    for (const [n, estado] of [
      ["1", "ocupada"],
      ["2", "reservada"],
      ["3", "retrasada"],
      ["4", "por_liberar"],
      ["5", "libre"],
    ]) {
      expect(mesaBoton(n).nextElementSibling!.querySelector(`[data-glifo-estado="${estado}"] svg`)).not.toBeNull();
    }
  });

  it("y cada estado tiene su forma de pintar la mesa (contorno discontinuo, doble, relleno…), distinta de las demás", async () => {
    const { CONFIG_ESTADO_MESA } = await import("@/components/reservas/servicio/estadosMesa");
    const patron = (clases: string) =>
      [
        /border-dashed/.test(clases) ? "discontinuo" : /border-double/.test(clases) ? "doble" : "continuo",
        /bg-white/.test(clases) ? "hueca" : "rellena",
        /border-\[3px\]|border-4/.test(clases) ? "gruesa" : "fina",
      ].join("+");
    const patrones = Object.values(CONFIG_ESTADO_MESA).map((c) => patron(c.clases));
    expect(new Set(patrones).size).toBe(patrones.length);
  });

  it("«en N min» solo si aún no es la hora; si ya ha pasado (dentro del margen), «N min tarde»", async () => {
    const { textoMinutosMesa } = await import("@/components/reservas/servicio/estadosMesa");
    expect(textoMinutosMesa("reservada", -15)).toBe("en 15 min");
    expect(textoMinutosMesa("reservada", 0)).toBe("es su hora");
    expect(textoMinutosMesa("reservada", 5)).toBe("5 min tarde");
    expect(textoMinutosMesa("retrasada", 20)).toBe("retraso 20 min");
  });
});

describe("Plano de Hoy · notas del cliente e «importante», a la vista", () => {
  const conNota = () =>
    RESERVAS.map((r) => (r.id === "r-rosa" ? { ...r, importante: true, notas_cliente: "Celíaca, trae tarta" } : r));

  it("en la mesa (icono y nombre accesible) y en su panel, con la nota entera", () => {
    montar({ reservas: conNota() });
    expect(mesaBoton("2")).toHaveAccessibleName(/, importante, nota del cliente: Celíaca, trae tarta$/);
    const rotulo = mesaBoton("2").nextElementSibling!;
    expect(rotulo.querySelector('[data-marca="importante"]')).not.toBeNull();
    expect(rotulo.querySelector('[data-marca="nota"]')).not.toBeNull();
    fireEvent.click(mesaBoton("2"));
    const detalle = screen.getByTestId("detalle-mesa");
    const aviso = within(detalle).getByTestId("aviso-reserva-mesa");
    expect(aviso).toHaveTextContent("Reserva importante");
    expect(aviso).toHaveTextContent("Nota: Celíaca, trae tarta");
    // Y en la tarjeta de siempre (la del kanban).
    expect(within(detalle).getByTestId("nota-cliente")).toHaveTextContent("Celíaca, trae tarta");
  });
});

describe("Plano de Hoy · por debajo de 1280 px la lista va en hojas (el plano, a todo lo ancho)", () => {
  it("sin panel al lado: «Por sentar» abre la lista en una hoja y tocar una mesa la abre en otra", async () => {
    anchoVentana(1024);
    montar();
    expect(screen.queryByRole("complementary")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Por sentar: 2 sin mesa en Comedor y 1 sin sala/ }));
    const hoja = await screen.findByRole("dialog", { name: "Por sentar" });
    expect(within(hoja).getByRole("region", { name: "Sin mesa en Comedor" })).toBeInTheDocument();
    fireEvent.keyDown(hoja, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(mesaBoton("4"));
    const hojaMesa = await screen.findByRole("dialog", { name: "Mesa 4" });
    expect(within(hojaMesa).getByRole("button", { name: /Liberar mesa/ })).toBeInTheDocument();
  });
});
