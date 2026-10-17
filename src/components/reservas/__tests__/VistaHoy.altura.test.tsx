/**
 * Pestaña «Hoy» a la ALTURA DE LA PANTALLA (dueño, 05/10/2026: «en Hoy antes sí que iba que no existe el
 * scroll y ahora vuelve esto»).
 *
 * Mismo mecanismo que el Calendario, «Próximas reservas» y la Newsletter (`useAlturaDisponible`): la fila de
 * columnas del kanban mide el alto visible menos su posición y el relleno inferior del <main>; lo de arriba
 * (cifras, «Disponibilidad por cuartos de hora», buscador y filtros) queda fijo y cada
 * columna desplaza sus tarjetas por dentro. Antes cada columna tenía un tope de `65dvh` que no descontaba lo de
 * encima, y con «Sin asignar» llena la página entera hacía scroll.
 *
 * Se monta `VistaHoy` con el kanban DE VERDAD (datos y diálogos, de mentira). jsdom no calcula layout: las
 * medidas se dan a mano (el kanban empieza en y = 150, o en 350 con la rejilla por cuartos desplegada), el
 * `ResizeObserver` es un doble que avisa de los elementos que se le digan y `requestAnimationFrame` va a una cola
 * que se vacía a mano. Lo demás se comprueba por estructura, como en `PanelAsignacion.altura.test.tsx`.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ reservas: [] as Record<string, unknown>[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "neq", "order"]) b[m] = () => b;
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: h.reservas, error: null }).then(ok, ko);
      return b;
    },
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useOcupacionHoy", () => ({
  useResumenOcupacionHoy: () => ({
    data: { totalReservas: 26, totalComensales: 87, capacidadTotal: 150, porcentajeTotal: 58, reservasCanceladas: 0 },
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
  }),
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({
    data: [
      { id: "comedor", nombre: "Comedor", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
      { id: "salon", nombre: "Salón", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
      { id: "terraza", nombre: "Terraza", capacidad_maxima: 50, activa: true, caracteristicas: { marca: "casa_tomas" } },
      { id: "reservado", nombre: "Reservado", capacidad_maxima: 14, activa: true, caracteristicas: { marca: "casa_tomas", privada: true } },
    ],
  }),
}));
vi.mock("@/hooks/useAsignacionesMesa", () => ({ useAsignacionesMesa: () => ({ data: [] }) }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/useEdicionReserva", () => ({ useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }) }));
vi.mock("@/components/reservas/BlacklistModal", () => ({ BlacklistModal: () => null }));
vi.mock("@/components/reservas/ElegirMesaDialog", () => ({ ElegirMesaDialog: () => null }));
vi.mock("@/hooks/useReservasEnVivo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useReservasEnVivo")>()),
  useReservasEnVivo: vi.fn(),
}));
// La rejilla por cuartos tiene sus tests: aquí solo importa que, desplegada, ocupa sitio encima del kanban.
vi.mock("@/components/reservas/DisponibilidadCuartos", () => ({
  DisponibilidadCuartos: () => <div data-testid="rejilla-cuartos" />,
}));

import { VistaHoy } from "@/components/reservas/VistaHoy";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

/** 24 reservas sin sala y 2 en el Comedor, como la captura del dueño (Salón y Terraza vacíos). */
const reserva = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `r${i}`,
  nombre: `Cliente ${i}`,
  telefono: null,
  email: null,
  hora: i % 2 ? "14:00:00" : "21:00:00",
  numero_comensales: 3,
  estado: "confirmada",
  espacio_id: null,
  marca: "casa_tomas",
  canal: "web",
  importante: false,
  en_blacklist: false,
  ...extra,
});
const datosDeLaCaptura = () => [
  ...Array.from({ length: 24 }, (_, i) => reserva(i + 1)),
  reserva(25, { espacio_id: "comedor" }),
  reserva(26, { espacio_id: "comedor" }),
];

// --- Medidas a mano (jsdom no calcula layout) -----------------------------------------------------------
const original = { innerHeight: window.innerHeight, visualViewport: Object.getOwnPropertyDescriptor(window, "visualViewport") };
function altoVentana(px: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: px });
}
/** El kanban (fila de columnas) empieza en y = 150, o 200 px más abajo con la rejilla por cuartos desplegada. */
function conLayout(alto: number) {
  altoVentana(alto);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top =
      this.dataset.testid === "kanban-columnas" ? (document.querySelector('[data-testid="rejilla-cuartos"]') ? 350 : 150) : 0;
    return { top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON: () => ({}) };
  });
}
function viewportVisual(alto: number) {
  const vv = Object.assign(new EventTarget(), { height: alto });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  return vv;
}

// ResizeObserver de mentira (avisa solo de los elementos que se le digan) y frames en cola.
const vigilados = new Map<Element, Set<ResizeObserverCallback>>();
class ResizeObserverDoble {
  constructor(private readonly aviso: ResizeObserverCallback) {}
  observe(el: Element) {
    if (!vigilados.has(el)) vigilados.set(el, new Set());
    vigilados.get(el)!.add(this.aviso);
  }
  unobserve(el: Element) {
    vigilados.get(el)?.delete(this.aviso);
  }
  disconnect() {
    for (const avisos of vigilados.values()) avisos.delete(this.aviso);
  }
}
let frames: FrameRequestCallback[] = [];
/** El navegador avisa de que `el` ha cambiado de tamaño y pinta el siguiente frame. */
function cambiaDeTamano(el: Element) {
  act(() => {
    for (const aviso of [...(vigilados.get(el) ?? [])]) aviso([{ target: el } as ResizeObserverEntry], {} as ResizeObserver);
  });
  act(() => {
    const pendientes = frames;
    frames = [];
    pendientes.forEach((f) => f(0));
  });
}

beforeEach(() => {
  h.reservas = datosDeLaCaptura();
  vigilados.clear();
  frames = [];
  vi.stubGlobal("ResizeObserver", ResizeObserverDoble);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((f) => frames.push(f));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  altoVentana(original.innerHeight);
  if (original.visualViewport) Object.defineProperty(window, "visualViewport", original.visualViewport);
  else delete (window as { visualViewport?: unknown }).visualViewport;
});

/** `VistaHoy` dentro de un <main> con el relleno inferior del layout (24 px, `sm:p-6`). */
async function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <main style={{ paddingBottom: 24 }}>
        <VistaHoy />
      </main>
    </QueryClientProvider>,
  );
  await screen.findByText("Cliente 1");
}
const bloque = () => screen.getByTestId("kanban-columnas");
const columnas = () => screen.getAllByRole("region", { name: /^Columna / });
/** La zona de tarjetas de una columna (la raíz del ScrollArea, la que se desplaza por dentro). */
const zonaTarjetas = (col: HTMLElement) => col.querySelector("[data-radix-scroll-area-viewport]")!.parentElement as HTMLElement;

// ---------------------------------------------------------------------------------------------------------

describe("Hoy · el kanban mide el alto de la pantalla", () => {
  it("la fila de columnas mide justo lo que queda de ventana: alto visible − su posición − relleno inferior del <main>", async () => {
    conLayout(800);
    await montar();

    // 800 − 150 − 24: termina en el borde inferior del <main>, sin scroll de página.
    expect(bloque()).toHaveAttribute("data-altura-fija", "626");
    expect(bloque().style.height).toBe("626px");
    // `flex-none`, no `flex-1`: el kanban va en una columna flex sin alto propio y ahí Chrome IGNORA el `height`
    // de un hijo con `flex: 1 1 0%` (mide su contenido: las 24 tarjetas enteras y vuelta al scroll de página).
    expect(bloque()).toHaveClass("flex-none");
    expect(bloque()).not.toHaveClass("flex-1");
  });

  it("lo de arriba queda FUERA de ese bloque (fijo): cifras, cuartos de hora, buscador y turnos", async () => {
    conLayout(800);
    await montar();

    const fijos = [
      screen.getByTestId("cifras-hoy"),
      screen.getByRole("button", { name: /Disponibilidad por cuartos de hora/ }),
      screen.getByRole("textbox", { name: "Buscar reservas" }),
      screen.getByRole("group", { name: "Filtrar por turno" }),
    ];
    for (const fijo of fijos) expect(bloque()).not.toContainElement(fijo);
    // Y las cuatro columnas, todas dentro.
    expect(columnas().map((c) => c.getAttribute("aria-label"))).toEqual([
      "Columna Sin asignar",
      "Columna Comedor",
      "Columna Salón",
      "Columna Terraza",
    ]);
    for (const col of columnas()) expect(bloque()).toContainElement(col);
  });

  it("cada columna (también las vacías) llega hasta abajo y desplaza sus tarjetas por dentro: sin el tope de 65dvh", async () => {
    conLayout(800);
    await montar();

    // Del bloque a la fila, cada nivel se queda con el alto que sobra y puede encoger (`flex-1 min-h-0`)…
    const salas = screen.getByRole("region", { name: "Salas de hoy" });
    const fila = salas.querySelector(".overflow-x-auto") as HTMLElement;
    expect(salas.parentElement).toBe(bloque());
    expect(salas).toHaveClass("flex", "flex-col", "flex-1", "min-h-0");
    expect(fila.parentElement).toHaveClass("flex", "flex-col", "flex-1", "min-h-0");
    expect(fila).toHaveClass("flex", "flex-1", "min-h-0");
    // …las columnas se estiran con la fila (nada de `items-start`), y la zona de tarjetas de cada una ocupa lo
    // que queda bajo su cabecera, sin tope propio: el scroll es suyo (ScrollArea), no de la página.
    expect(fila.className).not.toMatch(/items-(start|center|end)/);
    expect(columnas()).toHaveLength(4);
    for (const col of columnas()) {
      expect(zonaTarjetas(col)).toHaveClass("flex-1", "min-h-0");
      expect(zonaTarjetas(col).style.maxHeight).toBe("");
    }
    expect(within(screen.getByRole("region", { name: "Columna Salón" })).getByText("Arrastra reservas aquí")).toBeInTheDocument();
  });

  it("sin medidas de layout (jsdom) se queda como siempre: sin alto fijo y cada columna con su tope de 65dvh", async () => {
    await montar();

    expect(bloque()).not.toHaveAttribute("data-altura-fija");
    expect(bloque().style.height).toBe("");
    expect(screen.getByRole("region", { name: "Salas de hoy" })).not.toHaveClass("min-h-0");
    for (const col of columnas()) expect(zonaTarjetas(col).style.maxHeight).toBe("65dvh");
  });

  it("se recalcula al redimensionar la ventana y al girar la tablet", async () => {
    conLayout(800);
    await montar();
    expect(bloque()).toHaveAttribute("data-altura-fija", "626");

    act(() => {
      altoVentana(700);
      window.dispatchEvent(new Event("resize"));
    });
    expect(bloque()).toHaveAttribute("data-altura-fija", "526");

    act(() => {
      altoVentana(1000);
      window.dispatchEvent(new Event("orientationchange"));
    });
    expect(bloque()).toHaveAttribute("data-altura-fija", "826");
  });

  it("con poco alto (teclado en pantalla) el kanban no baja del suelo de 280 px y, solo entonces, la página hace scroll", async () => {
    const vv = viewportVisual(800);
    conLayout(1000); // la ventana no cambia con el teclado: manda el viewport visual
    await montar();
    expect(bloque()).toHaveAttribute("data-altura-fija", "626");

    act(() => {
      vv.height = 400;
      vv.dispatchEvent(new Event("resize"));
    });
    // 400 − 150 − 24 = 226 < 280: se queda en el suelo.
    expect(bloque()).toHaveAttribute("data-altura-fija", "280");

    act(() => {
      vv.height = 800;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(bloque()).toHaveAttribute("data-altura-fija", "626");
  });

  it("al desplegar «Disponibilidad por cuartos de hora» el kanban encoge, y al plegarla vuelve a crecer hasta el fondo", async () => {
    conLayout(800);
    await montar();
    const raizDeHoy = document.querySelector("main")!.firstElementChild as HTMLElement;
    const cuartos = screen.getByRole("button", { name: /Disponibilidad por cuartos de hora/ });

    // Desplegada: el kanban baja 200 px (la página crece y el navegador avisa).
    fireEvent.click(cuartos);
    expect(screen.getByTestId("rejilla-cuartos")).toBeInTheDocument();
    cambiaDeTamano(document.querySelector("main")!);
    expect(bloque()).toHaveAttribute("data-altura-fija", "426");

    // Plegada: el kanban sube. El <main> ya medía la ventana y no cambia; solo cambia de alto el contenedor de
    // la pestaña. Sin volver a medir, el kanban se quedaría en 426 con un hueco de 200 px debajo.
    fireEvent.click(cuartos);
    expect(screen.queryByTestId("rejilla-cuartos")).not.toBeInTheDocument();
    cambiaDeTamano(raizDeHoy);
    expect(bloque()).toHaveAttribute("data-altura-fija", "626");
  });

  it("el menú «⋮» de una tarjeta se pinta fuera de la columna con scroll (portal): no queda recortado", async () => {
    conLayout(800);
    await montar();
    const sinAsignar = screen.getByRole("region", { name: "Columna Sin asignar" });

    fireEvent.keyDown(within(sinAsignar).getByRole("button", { name: /^Acciones de la reserva de Cliente 24/ }), { key: "Enter" });
    const menu = await screen.findByRole("menu");

    expect(zonaTarjetas(sinAsignar)).not.toContainElement(menu);
    expect(bloque()).not.toContainElement(menu);
    expect(menu.closest("[data-radix-popper-content-wrapper]")?.parentElement).toBe(document.body);
  });
});
