/**
 * Pestaña «Asignación» organizada en PESTAÑAS POR DÍA (petición del dueño, 2026-10-01: «en
 * asignación de mesas ponlo por pestañas por días»).
 *
 * Se comprueba lo que ve y hace la persona: una pestaña por cada día del rango de «Mostrar»,
 * qué cuenta la insignia de cada una, qué día se abre solo y que se conserve al cambiar los
 * filtros, el resumen del día, los estados «Sin reservas este día» y «Todo asignado», que solo
 * se pinte el día abierto (con 60-100 reservas al día) y que las acciones de cada fila (Editar,
 * Sala, Mesas) sigan donde estaban. La lógica pura está en `asignacionPorDias.test.ts`.
 *
 * El reloj se fija a mano: jueves 2026-10-01, 10:00 en Madrid (verano, UTC+2). Con la ventana
 * por defecto de 48 h, caen dentro hoy, mañana y el sábado 3.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  filas: [] as Array<Record<string, unknown>>,
  cargando: false,
  error: false,
  /** Lo que dice el hook cuando el rango pasa del tope de seguridad de la lectura por lotes. */
  truncado: false,
  refetch: vi.fn(),
  canEdit: true,
  editarReserva: vi.fn(),
}));

vi.mock("@/hooks/useConfiguracionReservas", () => ({ useConfiguracionReservas: () => ({ data: undefined }) }));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({
    data: [
      { id: "salon", nombre: "Salón", activa: true, capacidad_maxima: 60, caracteristicas: { marca: "casa_tomas" } },
    ],
  }),
}));
vi.mock("@/hooks/useReservasPorAsignar", () => ({
  ErrorSinPermisoSala: class ErrorSinPermisoSala extends Error {},
  useReservasPorAsignar: () => ({
    data: h.cargando ? undefined : h.filas,
    truncado: h.truncado,
    isLoading: h.cargando,
    isError: h.error,
    refetch: h.refetch,
  }),
  useCambiarSalaReserva: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
}));
vi.mock("@/hooks/useOcupacionSalasDia", () => ({
  useOcupacionSalasDia: () => ({ data: undefined, isLoading: false }),
  datosDeNegocio: () => null,
}));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: h.canEdit, loading: false }),
}));
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({ editarReserva: h.editarReserva, dialogoEdicion: null }),
}));

import { PanelAsignacion } from "@/components/reservas/PanelAsignacion";

// Radix Select necesita estos métodos, que jsdom no implementa.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const HOY = "2026-10-01";
const MANANA = "2026-10-02";
const SABADO = "2026-10-03";
const MARTES = "2026-10-06";

type Grado = "sin_sala" | "sin_mesa" | "con_mesa";

const fila = (
  id: string,
  fecha: string,
  hora: string,
  grado: Grado,
  over: Record<string, unknown> = {},
) => ({
  reserva_id: id,
  fecha,
  hora,
  turno: hora < "17:00:00" ? "comida" : "cena",
  nombre: `Cliente ${id}`,
  numero_comensales: 4,
  estado: "confirmada",
  marca: "casa_tomas",
  espacio_id: grado === "sin_sala" ? null : "salon",
  espacio_nombre: grado === "sin_sala" ? null : "Salón",
  mesas_asignadas: grado === "con_mesa" ? 1 : 0,
  plazas_asignadas: grado === "con_mesa" ? 4 : 0,
  mesas_nombres: grado === "con_mesa" ? ["Mesa 1"] : [],
  grado,
  ...over,
});

/** Datos base: hoy todo con mesa; mañana 3 sin mesa de 4; sábado 1; domingo vacío; martes 6: 1. */
const datosBase = () => [
  fila("h1", HOY, "13:00:00", "con_mesa"),
  fila("h2", HOY, "21:00:00", "con_mesa"),
  fila("m1", MANANA, "13:30:00", "sin_sala", { numero_comensales: 3 }),
  fila("m2", MANANA, "14:00:00", "sin_mesa", { numero_comensales: 4 }),
  fila("m3", MANANA, "21:00:00", "con_mesa", { numero_comensales: 2 }),
  fila("m4", MANANA, "21:30:00", "sin_sala", { numero_comensales: 6 }),
  fila("s1", SABADO, "20:00:00", "sin_mesa"),
  fila("l1", MARTES, "13:00:00", "sin_sala"),
];

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onAsignarMesa = vi.fn();
  const vista = render(
    <QueryClientProvider client={client}>
      <PanelAsignacion onAsignarMesa={onAsignarMesa} />
    </QueryClientProvider>,
  );
  return { onAsignarMesa, ...vista, repintar: () => vista.rerender(
    <QueryClientProvider client={client}>
      <PanelAsignacion onAsignarMesa={onAsignarMesa} />
    </QueryClientProvider>,
  ) };
}

const pestana = (nombre: string | RegExp) => screen.getByRole("tab", { name: nombre });
const pestanaDe = (fecha: string) => {
  const el = document.querySelector<HTMLElement>(`[role="tab"][data-fecha="${fecha}"]`);
  expect(el).not.toBeNull();
  return el!;
};
const abrirDia = (fecha: string) => fireEvent.mouseDown(pestanaDe(fecha));
const diaAbierto = () => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-fecha");
/** Resumen del día: una línea pequeña junto al título (ya no hay tarjetas de contadores). */
const resumenDia = () => screen.getByTestId("resumen-dia");
/** Sección de un turno («Comida» / «Cena»): su cabecera lleva el resumen del turno. */
const seccionTurno = (titulo: "Comida" | "Cena") =>
  screen.getByText(titulo, { selector: "h3, span" }).closest(".rounded-lg.border") as HTMLElement;
/** Filas de reserva del panel abierto. Con 100 filas, las consultas por rol de Testing Library tardan segundos. */
const filasDelPanel = () => document.querySelectorAll('[role="tabpanel"] li');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T10:00:00+02:00"));
  h.cargando = false;
  h.error = false;
  h.truncado = false;
  h.canEdit = true;
  h.filas = datosBase();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PanelAsignacion · la tira de días", () => {
  it("una pestaña por cada día del rango de «Mostrar»: Hoy, Mañana y luego día y fecha corta", () => {
    montar();

    const pestanas = screen.getAllByRole("tab");
    // «Próximos 14 días» = hoy más 14: los mismos 15 días que pide la consulta.
    expect(pestanas).toHaveLength(15);
    expect(pestanas.map((p) => p.getAttribute("data-fecha"))).toEqual(
      Array.from({ length: 15 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`),
    );
    expect(within(pestanas[0]).getByText("Hoy")).toBeInTheDocument();
    expect(within(pestanas[1]).getByText("Mañana")).toBeInTheDocument();
    expect(within(pestanas[2]).getByText("Sáb 3")).toBeInTheDocument();
    expect(within(pestanas[3]).getByText("Dom 4")).toBeInTheDocument();
  });

  it("es una única lista de pestañas con un único panel, el del día abierto", () => {
    montar();

    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(document.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(1);
    const paneles = screen.getAllByRole("tabpanel");
    expect(paneles).toHaveLength(1);
    expect(paneles[0]).toHaveAttribute("aria-labelledby", pestanaDe(MANANA).id);
  });

  it("la insignia cuenta las reservas SIN mesa; ✓ si todo está asignado; nada si no hay reservas", () => {
    montar();

    // Mañana: sin sala (m1, m4) + con sala sin mesa (m2) = 3; la que tiene mesa (m3) no cuenta.
    expect(pestana(/^Mañana, 3 reservas sin mesa/)).toBeInTheDocument();
    expect(pestana(/^Sáb 3, 1 reserva sin mesa/)).toBeInTheDocument();
    // Hoy tiene reservas y todas con mesa: «todo asignado», no «sin reservas».
    expect(pestana(/^Hoy, todo asignado/)).toBeInTheDocument();
    expect(pestana(/^Dom 4, sin reservas/)).toBeInTheDocument();
    // El número se ve en la pestaña; el ✓ y el vacío también (forma, no solo color).
    expect(within(pestanaDe(MANANA)).getByText("3")).toBeInTheDocument();
    expect(pestanaDe(HOY).querySelector("svg.lucide-check")).not.toBeNull();
    expect(pestanaDe("2026-10-04").querySelector("svg.lucide-check")).toBeNull();
  });

  it("marca los días de la ventana de 48 h (reloj) frente a los posteriores", () => {
    montar();

    for (const fecha of [HOY, MANANA, SABADO]) {
      expect(pestanaDe(fecha).getAttribute("aria-label")).toMatch(/dentro de las próximas 48 h$/);
      expect(pestanaDe(fecha).querySelector("svg.lucide-clock")).not.toBeNull();
    }
    for (const fecha of ["2026-10-04", MARTES, "2026-10-15"]) {
      expect(pestanaDe(fecha).getAttribute("aria-label")).not.toMatch(/próximas/);
      expect(pestanaDe(fecha).querySelector("svg.lucide-clock")).toBeNull();
    }
  });

  it("las reservas de hoy que ya han empezado no cuentan (se atienden en «Hoy»)", () => {
    h.filas = [...datosBase(), fila("pasada", HOY, "09:00:00", "sin_sala")];
    montar();

    expect(pestana(/^Hoy, todo asignado/)).toBeInTheDocument();
  });

  it("ya no hay bloques «Próximas 48 horas» / «Más adelante», ni título, ni explicación, ni «Mostrar»", () => {
    montar();

    expect(screen.queryByText(/Próximas 48 horas/)).toBeNull();
    expect(screen.queryByText("Más adelante")).toBeNull();
    // 04/10/2026, a petición del dueño: arriba solo queda el interruptor.
    expect(screen.queryByText("Asignación de salas y mesas")).toBeNull();
    expect(screen.queryByText(/Elige un día/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Mostrar" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Ocultar las que ya tienen mesa" })).toBeInTheDocument();
  });

  it("el rango es fijo: 14 días desde hoy (15 pestañas)", () => {
    montar();

    expect(screen.getAllByRole("tab")).toHaveLength(15);
    expect(pestanaDe("2026-10-15")).toBeInTheDocument();
    expect(document.querySelector('[role="tab"][data-fecha="2026-10-16"]')).toBeNull();
  });
});

describe("PanelAsignacion · qué día se abre", () => {
  it("por defecto, el primer día con reservas sin mesa (no tiene por qué ser hoy)", () => {
    montar();

    expect(diaAbierto()).toBe(MANANA);
    expect(screen.getByRole("heading", { name: "Mañana · viernes 2 de octubre" })).toBeInTheDocument();
  });

  it("si hoy tiene reservas sin mesa, abre hoy", () => {
    h.filas = [...datosBase(), fila("h3", HOY, "21:30:00", "sin_sala")];
    montar();

    expect(diaAbierto()).toBe(HOY);
  });

  it("si no hay ninguna sin mesa, abre hoy", () => {
    h.filas = [fila("h1", HOY, "13:00:00", "con_mesa"), fila("m3", MANANA, "21:00:00", "con_mesa")];
    montar();

    expect(diaAbierto()).toBe(HOY);
  });

  it("sin reservas en todo el rango, abre hoy y lo dice", () => {
    h.filas = [];
    montar();

    expect(diaAbierto()).toBe(HOY);
    expect(screen.getByText("Sin reservas este día")).toBeInTheDocument();
  });

  it("al pulsar otra pestaña se ven las reservas de ESE día y solo esas", () => {
    montar();
    expect(screen.getByText("Cliente m1")).toBeInTheDocument();
    expect(screen.queryByText("Cliente s1")).toBeNull();

    abrirDia(SABADO);

    expect(diaAbierto()).toBe(SABADO);
    expect(screen.getByRole("heading", { name: "Sábado 3 de octubre" })).toBeInTheDocument();
    expect(screen.getByText("Cliente s1")).toBeInTheDocument();
    expect(screen.queryByText("Cliente m1")).toBeNull();
  });

  it("con el teclado: la flecha derecha pasa al día siguiente", async () => {
    montar();
    const manana = pestanaDe(MANANA);
    manana.focus();

    // Radix mueve el foco en el siguiente turno del reloj; al recibirlo, la pestaña se activa.
    await act(async () => {
      fireEvent.keyDown(manana, { key: "ArrowRight" });
      await new Promise((resolver) => setTimeout(resolver, 0));
    });

    expect(diaAbierto()).toBe(SABADO);
    expect(screen.getByText("Cliente s1")).toBeInTheDocument();
  });

  it("el día elegido se conserva al ocultar las que ya tienen mesa", () => {
    montar();
    abrirDia(SABADO);

    fireEvent.click(screen.getByRole("switch", { name: "Ocultar las que ya tienen mesa" }));

    expect(diaAbierto()).toBe(SABADO);
  });

  it("no se mueve solo cuando se asignan las últimas mesas del día abierto", () => {
    const { repintar } = montar();
    expect(diaAbierto()).toBe(MANANA);

    // Llega un refresco: mañana ya no tiene nada sin mesa. Lo que se estaba mirando no cambia.
    h.filas = [
      fila("h1", HOY, "13:00:00", "con_mesa"),
      fila("m1", MANANA, "13:30:00", "con_mesa"),
      fila("m2", MANANA, "14:00:00", "con_mesa"),
      fila("s1", SABADO, "20:00:00", "sin_mesa"),
    ];
    repintar();

    expect(diaAbierto()).toBe(MANANA);
    expect(pestana(/^Mañana, todo asignado/)).toBeInTheDocument();
    expect(screen.getByText("Todo asignado.")).toBeInTheDocument();
  });
});

describe("PanelAsignacion · el día se recuerda al volver del plano", () => {
  // «Mesas» abre el plano de una sala y `Reservas` pinta otra pantalla: el panel se desmonta y, al
  // volver, se monta de nuevo. Los dos montajes comparten la caché de consultas, como en la app.
  const montarEn = (client: QueryClient) =>
    render(
      <QueryClientProvider client={client}>
        <PanelAsignacion onAsignarMesa={vi.fn()} />
      </QueryClientProvider>,
    );
  const clienteDeLaApp = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

  it("al volver se abre el día en el que se estaba, no el de por defecto", () => {
    const client = clienteDeLaApp();
    const primero = montarEn(client);
    expect(diaAbierto()).toBe(MANANA);
    abrirDia(SABADO);
    expect(diaAbierto()).toBe(SABADO);
    primero.unmount();

    montarEn(client);

    expect(diaAbierto()).toBe(SABADO);
    expect(screen.getByText("Cliente s1")).toBeInTheDocument();
  });

  it("también se recuerda el día que se abrió solo (el primero con reservas sin mesa)", () => {
    const client = clienteDeLaApp();
    montarEn(client).unmount();
    // Entre una visita y otra cambian los datos: ahora el primero con pendientes sería hoy.
    h.filas = [...datosBase(), fila("h3", HOY, "21:30:00", "sin_sala")];

    montarEn(client);

    expect(diaAbierto()).toBe(MANANA);
  });

  it("si el día recordado ya no está en el rango, se abre el de por defecto", () => {
    const client = clienteDeLaApp();
    const primero = montarEn(client);
    abrirDia(SABADO);
    primero.unmount();
    // Pasan 20 días: el sábado 3 de octubre ya no está entre los días que se muestran.
    vi.setSystemTime(new Date("2026-10-21T10:00:00+02:00"));
    h.filas = [];

    montarEn(client);

    expect(diaAbierto()).toBe("2026-10-21");
  });

  it("sin nada recordado (otra caché, o una recarga de la página) se abre el de por defecto", () => {
    const primero = montarEn(clienteDeLaApp());
    abrirDia(SABADO);
    primero.unmount();

    montarEn(clienteDeLaApp());

    expect(diaAbierto()).toBe(MANANA);
  });
});

describe("PanelAsignacion · lo que lleva un día", () => {
  it("resumen del día, de la comida y de la cena: reservas, comensales y sin mesa", () => {
    montar();

    const dia = resumenDia();
    expect(dia).toHaveTextContent("4 reservas");
    expect(dia).toHaveTextContent("15 comensales");
    expect(dia).toHaveTextContent("3 sin mesa");

    const comida = seccionTurno("Comida");
    expect(comida).toHaveTextContent("2 reservas");
    expect(comida).toHaveTextContent("7 comensales");
    expect(comida).toHaveTextContent("2 sin mesa");

    const cena = seccionTurno("Cena");
    expect(cena).toHaveTextContent("2 reservas");
    expect(cena).toHaveTextContent("8 comensales");
    expect(cena).toHaveTextContent("1 sin mesa");
  });

  it("ya no hay tarjetas de contadores: el resumen del día es una línea junto al título", () => {
    montar();

    // Ni la lista de definiciones de las tres tarjetas (Todo el día / Comida / Cena) ni sus títulos.
    expect(document.querySelector("dl")).toBeNull();
    expect(document.querySelector("dt")).toBeNull();
    expect(screen.queryByText("Todo el día")).toBeNull();
    // El resumen del día va en la fila del título, en una sola línea de texto.
    const titulo = screen.getByRole("heading", { level: 3, name: /^Mañana/ });
    const resumen = resumenDia();
    expect(resumen).toHaveTextContent("4 reservas · 15 comensales · 3 sin mesa");
    expect(titulo.parentElement).toContainElement(resumen);
    // Comida y cena lo llevan solo en la cabecera de su sección.
    expect(screen.getAllByText(/\d+ reservas? · \d+ comensales/)).toHaveLength(3);
  });

  it("el interruptor «Ocultar las que ya tienen mesa» está en la misma fila que el título del día", () => {
    montar();

    const titulo = screen.getByRole("heading", { level: 3, name: /^Mañana/ });
    const cabecera = titulo.closest("header") as HTMLElement;
    expect(cabecera).not.toBeNull();
    expect(within(cabecera).getByRole("switch", { name: "Ocultar las que ya tienen mesa" })).toBeInTheDocument();
    // El día de la ventana de asignación lo dice un chip pequeño en esa misma fila.
    expect(within(cabecera).getByText("Próximas 48 h")).toBeInTheDocument();
    // Y no hay otro interruptor suelto fuera de la cabecera del día.
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  it("los turnos van con sus subgrupos por grado y sus filas", () => {
    montar();

    const cena = screen.getByText("Cena", { selector: "h3, div" }).closest(".rounded-lg.border") as HTMLElement;
    // La tarjeta de la cena de mañana: m4 sin sala y m3 con mesa.
    expect(within(cena).getByText("Sin sala · 1")).toBeInTheDocument();
    expect(within(cena).getByText("Con mesa · 1")).toBeInTheDocument();
    expect(within(cena).queryByText(/Con sala, sin mesa/)).toBeNull();
    expect(within(cena).getByText("Cliente m4")).toBeInTheDocument();
    expect(within(cena).getByText("Cliente m3")).toBeInTheDocument();
    expect(within(cena).queryByText("Cliente m1")).toBeNull();
  });

  it("un día todo con mesa dice «Todo asignado» y sigue enseñando sus reservas", () => {
    montar();
    abrirDia(HOY);

    const aviso = screen.getByRole("status");
    expect(aviso).toHaveTextContent("Todo asignado. Las 2 reservas de este día ya tienen mesa.");
    expect(screen.getByText("Cliente h1")).toBeInTheDocument();
    expect(resumenDia()).toHaveTextContent("todo asignado");
    // Es hoy: se avisa de que solo salen las que aún no han empezado (texto oculto, sin línea propia).
    expect(screen.getByText(/Solo salen las reservas de hoy que aún no han empezado/)).toHaveClass("sr-only");
  });

  it("un día sin reservas dice «Sin reservas este día»", () => {
    montar();
    abrirDia("2026-10-04");

    expect(screen.getByText("Sin reservas este día")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(filasDelPanel()).toHaveLength(0);
  });

  it("el día abierto dice si cae en la ventana de asignación", () => {
    montar();
    expect(screen.getByText("Próximas 48 h")).toHaveAttribute("title", "Dentro de las próximas 48 h");

    abrirDia(MARTES);
    expect(screen.queryByText("Próximas 48 h")).toBeNull();
  });
});

describe("PanelAsignacion · «Ocultar las que ya tienen mesa»", () => {
  const ocultar = () => fireEvent.click(screen.getByRole("switch", { name: "Ocultar las que ya tienen mesa" }));

  it("quita las que tienen mesa de las listas y de los totales y dice cuántas oculta", () => {
    montar();
    expect(screen.getByText("Cliente m3")).toBeInTheDocument();

    ocultar();

    expect(screen.queryByText("Cliente m3")).toBeNull();
    expect(screen.queryByText(/Con mesa · /)).toBeNull();
    const dia = resumenDia();
    expect(dia).toHaveTextContent("3 reservas");
    expect(dia).toHaveTextContent("13 comensales");
    expect(dia).toHaveTextContent("3 sin mesa");
    expect(dia).toHaveTextContent("1 con mesa oculta");
    // La que tiene mesa es de la cena: la comida no esconde nada.
    expect(seccionTurno("Cena")).toHaveTextContent("1 con mesa oculta");
    expect(seccionTurno("Comida")).not.toHaveTextContent("oculta");
  });

  it("la insignia de cada pestaña (reservas sin mesa) no cambia con el interruptor", () => {
    montar();
    const antes = screen.getAllByRole("tab").map((p) => p.getAttribute("aria-label"));

    ocultar();

    expect(screen.getAllByRole("tab").map((p) => p.getAttribute("aria-label"))).toEqual(antes);
  });

  it("un día con todo asignado no queda «vacío»: dice que están ocultas", () => {
    montar();
    abrirDia(HOY);

    ocultar();

    expect(screen.getByRole("status")).toHaveTextContent("Todo asignado. Las 2 reservas de este día ya tienen mesa (ocultas por el filtro).");
    expect(screen.queryByText("Sin reservas este día")).toBeNull();
    expect(screen.queryByText("Cliente h1")).toBeNull();
    expect(pestana(/^Hoy, todo asignado/)).toBeInTheDocument();
  });

  it("un turno con todo asignado no sale como «Sin reservas»", () => {
    h.filas = [
      fila("a", MANANA, "13:00:00", "con_mesa"),
      fila("b", MANANA, "21:00:00", "sin_sala"),
    ];
    montar();

    ocultar();

    const comida = seccionTurno("Comida");
    expect(comida).toHaveTextContent("todo asignado");
    expect(comida).not.toHaveTextContent("Sin reservas");
    expect(comida).toHaveTextContent("1 con mesa oculta");
  });
});

describe("PanelAsignacion · sin Touza", () => {
  it("no hay filtro «Negocio» ni insignia de negocio en las filas", () => {
    montar();

    expect(screen.queryByRole("combobox", { name: "Negocio" })).toBeNull();
    expect(screen.queryByText("Negocio")).toBeNull();
    // Ya no queda ningún desplegable (tampoco «Mostrar», retirado el 04/10/2026).
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    // La insignia de negocio (`NegocioBadge`) llevaba este título.
    expect(document.querySelector('[title^="Negocio:"]')).toBeNull();
    expect(screen.queryByText("Casa Tomás")).toBeNull();
  });

  it("las reservas de Touza de datos antiguos ni se muestran ni se cuentan", () => {
    h.filas = [
      ...datosBase(),
      fila("t1", MANANA, "21:15:00", "sin_sala", { marca: "touza", numero_comensales: 10 }),
      fila("t2", SABADO, "20:00:00", "sin_mesa", { marca: "touza" }),
      fila("t3", "2026-10-04", "20:00:00", "sin_sala", { marca: "touza" }),
    ];
    montar();

    // Mismas cuentas que sin ellas: mañana 3 sin mesa, sábado 1 y el domingo sigue sin reservas.
    expect(pestana(/^Mañana, 3 reservas sin mesa/)).toBeInTheDocument();
    expect(pestana(/^Sáb 3, 1 reserva sin mesa/)).toBeInTheDocument();
    expect(pestana(/^Dom 4, sin reservas/)).toBeInTheDocument();
    // Ni en las listas ni en el resumen del día.
    expect(screen.queryByText("Cliente t1")).toBeNull();
    expect(resumenDia()).toHaveTextContent("4 reservas");
    expect(resumenDia()).toHaveTextContent("15 comensales");
    abrirDia(SABADO);
    expect(screen.queryByText("Cliente t2")).toBeNull();
    expect(screen.getByText("Cliente s1")).toBeInTheDocument();
  });

  it("si lo único que hay en el rango es de Touza, el día sale como «Sin reservas este día» y se abre hoy", () => {
    h.filas = [fila("t1", MANANA, "21:15:00", "sin_sala", { marca: "touza" })];
    montar();

    expect(diaAbierto()).toBe(HOY);
    expect(pestana(/^Mañana, sin reservas/)).toBeInTheDocument();
    expect(screen.getByText("Sin reservas este día")).toBeInTheDocument();
  });
});

describe("PanelAsignacion · muchas reservas", () => {
  const dia = (fecha: string, n: number, prefijo: string) =>
    Array.from({ length: n }, (_, i) =>
      fila(`${prefijo}${i}`, fecha, i % 2 ? "21:00:00" : "13:30:00", (["sin_sala", "sin_mesa", "con_mesa"] as const)[i % 3]),
    );

  it("con 100 reservas en cada día solo se pinta el día abierto", () => {
    h.filas = [...dia(MANANA, 100, "a"), ...dia(SABADO, 100, "b")];
    montar();

    expect(diaAbierto()).toBe(MANANA);
    expect(filasDelPanel()).toHaveLength(100);
    expect(document.querySelectorAll('button[aria-label^="Editar la reserva de Cliente a"]')).toHaveLength(100);
    expect(document.querySelectorAll('button[aria-label^="Editar la reserva de Cliente b"]')).toHaveLength(0);

    abrirDia(SABADO);

    expect(filasDelPanel()).toHaveLength(100);
    expect(document.querySelectorAll('button[aria-label^="Editar la reserva de Cliente a"]')).toHaveLength(0);
    expect(document.querySelectorAll('button[aria-label^="Editar la reserva de Cliente b"]')).toHaveLength(100);
  });

  it("el resumen cuadra con la lista en un día grande", () => {
    h.filas = dia(MANANA, 70, "a");
    montar();

    // 70 reservas: reparto i % 3 → 24 sin sala, 23 con sala sin mesa, 23 con mesa → 47 sin mesa.
    const total = resumenDia();
    expect(total).toHaveTextContent("70 reservas");
    expect(total).toHaveTextContent("280 comensales");
    expect(total).toHaveTextContent("47 sin mesa");
    expect(filasDelPanel()).toHaveLength(70);
    expect(pestana(/^Mañana, 47 reservas sin mesa/)).toBeInTheDocument();
  });
});

describe("PanelAsignacion · las acciones de cada fila siguen donde estaban", () => {
  it("«Editar», «Sala» y «Mesas» en las filas del día abierto, con su comportamiento de siempre", () => {
    const { onAsignarMesa } = montar();

    const m2 = screen.getByText("Cliente m2").closest("li")!;
    expect(within(m2).getByRole("button", { name: /^Sala/ })).toBeEnabled();
    const mesas = within(m2).getByRole("button", { name: /mesa/i });
    expect(mesas).toBeEnabled();
    fireEvent.click(mesas);
    expect(onAsignarMesa).toHaveBeenCalledWith(
      expect.objectContaining({ espacioId: "salon", fecha: MANANA, reservaId: "m2", turno: "comida" }),
    );

    fireEvent.click(within(m2).getByRole("button", { name: "Editar la reserva de Cliente m2" }));
    expect(h.editarReserva).toHaveBeenCalledWith("m2");
  });

  it("una reserva sin sala sigue ofreciendo «Dar sala» y «Mesas» deshabilitado con su motivo", () => {
    montar();

    const m1 = screen.getByText("Cliente m1").closest("li")!;
    expect(within(m1).getByRole("button", { name: /Dar sala/ })).toBeEnabled();
    const mesas = within(m1).getByRole("button", { name: "Primero dale sala con el botón «Sala»" });
    expect(mesas).toBeDisabled();
  });

  it("sin permiso de edición, «Editar» sale deshabilitado en todas las filas y lo explica", () => {
    h.canEdit = false;
    montar();

    const botones = screen.getAllByRole("button", { name: /^Editar la reserva de/ });
    expect(botones).toHaveLength(4);
    for (const boton of botones) {
      expect(boton).toBeDisabled();
      expect(boton).toHaveAttribute("title", expect.stringMatching(/No tienes permiso para editar reservas/));
    }
  });

  it("también en el resto de días: las filas de otro día llevan las mismas tres acciones", () => {
    montar();
    abrirDia(SABADO);

    const s1 = screen.getByText("Cliente s1").closest("li")!;
    expect(within(s1).getByRole("button", { name: "Editar la reserva de Cliente s1" })).toBeEnabled();
    expect(within(s1).getByRole("button", { name: /^Sala/ })).toBeInTheDocument();
    expect(within(s1).getByRole("button", { name: /mesa/i })).toBeInTheDocument();
  });
});

describe("PanelAsignacion · la tira se desplaza", () => {
  const elementoPrototipo = Element.prototype as unknown as { scrollBy?: unknown };
  let scrollBy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom no calcula diseño: se simula una tira de 1200 px dentro de un hueco de 600 px.
    vi.spyOn(Element.prototype, "scrollWidth", "get").mockReturnValue(1200);
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(600);
    scrollBy = vi.fn();
    elementoPrototipo.scrollBy = scrollBy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete elementoPrototipo.scrollBy;
  });

  it("si no cabe, ofrece desplazarla con botones y dice por qué lado hay más días", () => {
    montar();
    const anteriores = screen.getByRole("button", { name: "Ver días anteriores" });
    const siguientes = screen.getByRole("button", { name: "Ver días siguientes" });

    // Al principio solo hay más días a la derecha.
    expect(anteriores).toBeDisabled();
    expect(siguientes).toBeEnabled();
    fireEvent.click(siguientes);
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ left: 420 }));

    // Al llegar al final solo hay más días a la izquierda.
    const tira = document.querySelector(".no-scrollbar") as HTMLElement;
    Object.defineProperty(tira, "scrollLeft", { configurable: true, value: 600 });
    fireEvent.scroll(tira);
    expect(anteriores).toBeEnabled();
    expect(siguientes).toBeDisabled();
    fireEvent.click(anteriores);
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ left: -420 }));
  });

  it("los botones no quitan las pestañas del teclado: no se tabulan, las flechas ya recorren los días", () => {
    montar();

    expect(screen.getByRole("button", { name: "Ver días siguientes" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "Ver días anteriores" })).toHaveAttribute("tabindex", "-1");
  });
});

describe("PanelAsignacion · tope de la consulta", () => {
  // Todo con mesa y en un día que no es el que se abre: solo se pinta la fila sin mesa de mañana.
  const relleno = (n: number) =>
    Array.from({ length: n }, (_, i) => fila(`r${i}`, "2026-10-14", i % 2 ? "21:00:00" : "13:30:00", "con_mesa"));

  // `useReservasPorAsignar` lee el rango ENTERO por lotes (`paginarConsulta`; sus tests están en
  // `useReservasPorAsignar.test.tsx`): llegar justo a 1000 filas ya no quiere decir que falte el final,
  // así que el aviso de antes («puede que falten reservas» con 1000 filas) desapareció. Solo sale
  // si el hook dice `truncado`, o sea, si el rango pasa del tope de seguridad de esa lectura.
  it("con justo 1000 filas NO avisa: la lectura por lotes trae el rango entero", () => {
    h.filas = [...relleno(999), fila("p", MANANA, "21:00:00", "sin_sala")];
    montar();

    expect(screen.queryByText("Puede que falten reservas.")).toBeNull();
    expect(screen.queryByText(/Elige menos días en «Mostrar»/)).toBeNull();
    expect(diaAbierto()).toBe(MANANA);
  });

  it("con más de 1000 filas tampoco avisa y las cuentas de los últimos días son las reales", () => {
    // 2.500 reservas sin mesa un día lejano (no se pintan: solo se pinta el día abierto) y una mañana.
    h.filas = [
      fila("p", MANANA, "21:00:00", "sin_sala"),
      ...Array.from({ length: 2500 }, (_, i) => fila(`r${i}`, "2026-10-14", i % 2 ? "21:00:00" : "13:30:00", "sin_sala")),
    ];
    montar();

    expect(screen.queryByText("Puede que falten reservas.")).toBeNull();
    expect(diaAbierto()).toBe(MANANA);
    expect(pestanaDe("2026-10-14").getAttribute("aria-label")).toMatch(/^Mié 14, 2500 reservas sin mesa/);
  });

  it("avisa solo si el hook dice `truncado` (pasó del tope de seguridad) y dice cuál es el tope", () => {
    h.filas = [...relleno(999), fila("p", MANANA, "21:00:00", "sin_sala")];
    h.truncado = true;
    montar();

    expect(screen.getByText("Puede que falten reservas.")).toBeInTheDocument();
    expect(screen.getByText(/más de 10\.000 reservas y solo se han cargado las primeras 10\.000/)).toBeInTheDocument();
    expect(diaAbierto()).toBe(MANANA);
  });

  it("el aviso de tope no sale mientras carga ni si la carga falla", () => {
    h.truncado = true;

    h.cargando = true;
    const cargando = montar();
    expect(screen.queryByText("Puede que falten reservas.")).toBeNull();
    cargando.unmount();

    h.cargando = false;
    h.error = true;
    montar();
    expect(screen.queryByText("Puede que falten reservas.")).toBeNull();
  });

  it("no avisa con una carga normal", () => {
    h.filas = [...relleno(998), fila("p", MANANA, "21:00:00", "sin_sala")];
    montar();

    expect(screen.queryByText("Puede que falten reservas.")).toBeNull();
  });
});

describe("PanelAsignacion · carga y error", () => {
  it("mientras carga no hay pestañas, solo el indicador", () => {
    h.cargando = true;
    montar();

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByLabelText("Cargando")).toBeInTheDocument();
  });

  it("si falla la carga, lo dice y permite reintentar", () => {
    h.error = true;
    montar();

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });
});
