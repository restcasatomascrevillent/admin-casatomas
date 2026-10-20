/**
 * Pestaña «Próximas reservas» a la ALTURA DE LA PANTALLA (petición del dueño, 2026-10-05: «esta pestaña
 * también hay que calcular el tamaño máximo de pantalla y que sea de ese, como el resto de pantallas»).
 *
 * Mismo mecanismo que el Calendario y la Newsletter (`useAlturaDisponible`): el bloque mide el alto visible
 * menos su posición y el relleno inferior del <main>; el aviso de tope, la tira de días y la cabecera del
 * día quedan fijos y SOLO la lista del día hace scroll. jsdom no calcula layout: las medidas se dan a mano
 * (bloque en y = 150) y lo demás se comprueba por estructura, como en `CalendarioOcupacion.test.tsx`.
 *
 * Reloj fijo: jueves 2026-10-01, 10:00 en Madrid (como `PanelAsignacion.dias.test.tsx`).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  filas: [] as Array<Record<string, unknown>>,
  truncado: false,
  mutateAsync: vi.fn(),
}));

vi.mock("@/hooks/useConfiguracionReservas", () => ({ useConfiguracionReservas: () => ({ data: undefined }) }));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({
    data: [{ id: "salon", nombre: "Salón", activa: true, capacidad_maxima: 60, caracteristicas: { marca: "casa_tomas" } }],
  }),
}));
vi.mock("@/hooks/useReservasPorAsignar", () => ({
  ErrorSinPermisoSala: class ErrorSinPermisoSala extends Error {},
  useReservasPorAsignar: () => ({ data: h.filas, truncado: h.truncado, isLoading: false, isError: false, refetch: vi.fn() }),
  useCambiarSalaReserva: () => ({ mutateAsync: h.mutateAsync, isPending: false, variables: undefined }),
}));
vi.mock("@/hooks/useOcupacionSalasDia", () => ({
  useOcupacionSalasDia: () => ({ data: undefined, isLoading: false }),
  datosDeNegocio: () => null,
}));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/useEdicionReserva", () => ({ useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }) }));

import { PanelAsignacion } from "@/components/reservas/PanelAsignacion";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const HOY = "2026-10-01";
const MANANA = "2026-10-02";
const SABADO = "2026-10-03";

type Grado = "sin_sala" | "sin_mesa" | "con_mesa";
const fila = (id: string, fecha: string, hora: string, grado: Grado, over: Record<string, unknown> = {}) => ({
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

/** Mañana (el día que se abre solo) con 4 reservas; el sábado, 1. */
const datosBase = () => [
  fila("h1", HOY, "13:00:00", "con_mesa"),
  fila("m1", MANANA, "13:30:00", "sin_sala"),
  fila("m2", MANANA, "14:00:00", "sin_mesa"),
  fila("m3", MANANA, "21:00:00", "con_mesa"),
  fila("m4", MANANA, "21:30:00", "sin_sala"),
  fila("s1", SABADO, "20:00:00", "sin_mesa"),
];

const clienteDeLaApp = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Monta el panel; `conMain`: dentro de un <main> con el relleno inferior del layout (24 px, `sm:p-6`). */
function montarEn(client: QueryClient, { onAsignarMesa = vi.fn(), conMain = false } = {}) {
  const arbol = () => {
    const panel = <PanelAsignacion onAsignarMesa={onAsignarMesa} />;
    return <QueryClientProvider client={client}>{conMain ? <main style={{ paddingBottom: 24 }}>{panel}</main> : panel}</QueryClientProvider>;
  };
  const vista = render(arbol());
  return { ...vista, onAsignarMesa, repintar: () => vista.rerender(arbol()) };
}
const montar = (opciones?: Parameters<typeof montarEn>[1]) => montarEn(clienteDeLaApp(), opciones);

const raiz = () => screen.getByTestId("panel-asignacion");
const listaDelDia = () => screen.getByRole("region", { name: "Reservas del día" });
const filaDe = (id: string) => screen.getByText(`Cliente ${id}`).closest("li") as HTMLElement;
const abrirDia = (fecha: string) =>
  fireEvent.mouseDown(document.querySelector<HTMLElement>(`[role="tab"][data-fecha="${fecha}"]`)!);
const diaAbierto = () => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-fecha");

// --- Medidas a mano (jsdom no calcula layout) -----------------------------------------------------------
const original = { innerHeight: window.innerHeight, visualViewport: Object.getOwnPropertyDescriptor(window, "visualViewport") };

function altoVentana(px: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: px });
}

/** El bloque del panel está en y = 150; el resto de nodos, con tamaño pero arriba del todo. */
function conLayout(alto: number) {
  altoVentana(alto);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.dataset.testid === "panel-asignacion" ? 150 : 0;
    return { top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON: () => ({}) };
  });
}

/** Viewport visual (lo que queda sin la barra del navegador ni el teclado en pantalla). */
function viewportVisual(alto: number) {
  const vv = Object.assign(new EventTarget(), { height: alto });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  return vv;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T10:00:00+02:00"));
  h.filas = datosBase();
  h.truncado = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  altoVentana(original.innerHeight);
  if (original.visualViewport) Object.defineProperty(window, "visualViewport", original.visualViewport);
  else delete (window as { visualViewport?: unknown }).visualViewport;
});

// ---------------------------------------------------------------------------------------------------------

describe("PanelAsignacion · mide el alto de la pantalla", () => {
  it("el bloque mide justo lo que queda de ventana: alto visible − su posición − relleno inferior del <main>", () => {
    conLayout(800);
    montar({ conMain: true });

    // 800 − 150 − 24: termina en el borde inferior del <main>, sin scroll de página.
    expect(raiz()).toHaveAttribute("data-altura-fija", "626");
    expect(raiz().style.height).toBe("626px");
  });

  it("sin medidas de layout (jsdom) se queda como siempre: sin altura fija, la lista crece con su contenido", () => {
    montar();

    expect(raiz()).not.toHaveAttribute("data-altura-fija");
    expect(raiz().style.height).toBe("");
    // Con scroll de página la tira va pegada arriba: los botones conservan su margen para no quedar tapados.
    expect(listaDelDia().closest('[role="tabpanel"]')!.className).toContain("[&_button]:scroll-mt-28");
  });

  it("se recalcula al redimensionar la ventana y al girar la tablet", () => {
    conLayout(800);
    montar();
    expect(raiz()).toHaveAttribute("data-altura-fija", "650");

    act(() => {
      altoVentana(700);
      window.dispatchEvent(new Event("resize"));
    });
    expect(raiz()).toHaveAttribute("data-altura-fija", "550");

    act(() => {
      altoVentana(1000);
      window.dispatchEvent(new Event("orientationchange"));
    });
    expect(raiz()).toHaveAttribute("data-altura-fija", "850");
  });

  it("con el teclado en pantalla (viewport visual) encoge, sin bajar del suelo de 360 px, y al cerrarlo vuelve", () => {
    const vv = viewportVisual(800);
    conLayout(1000); // la ventana no cambia con el teclado: manda el viewport visual
    montar();
    expect(raiz()).toHaveAttribute("data-altura-fija", "650");

    act(() => {
      vv.height = 450;
      vv.dispatchEvent(new Event("resize"));
    });
    // 450 − 150 = 300 < 360: se queda en el suelo y, solo entonces, la página hace scroll.
    expect(raiz()).toHaveAttribute("data-altura-fija", "360");

    act(() => {
      vv.height = 800;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(raiz()).toHaveAttribute("data-altura-fija", "650");
  });
});

describe("PanelAsignacion · solo la lista del día hace scroll", () => {
  it("la tira de días, la cabecera del día y el aviso de tope quedan FUERA de la lista y no encogen", () => {
    h.truncado = true;
    conLayout(800);
    montar();
    const lista = listaDelDia();

    // La lista: scroll vertical propio, y puede encoger hasta el alto que le quede.
    expect(lista).toHaveClass("overflow-y-auto", "min-h-0", "flex-1");
    // Lo fijo no está dentro de ella.
    const tira = screen.getByRole("tablist");
    const cabecera = screen.getByRole("heading", { level: 3, name: /^Mañana/ }).closest("header") as HTMLElement;
    const aviso = screen.getByText("Puede que falten reservas.").closest('[role="status"]') as HTMLElement;
    for (const fijo of [tira, cabecera, aviso]) expect(lista).not.toContainElement(fijo);
    expect(within(cabecera).getByRole("switch", { name: "Ocultar las que ya tienen mesa" })).toBeInTheDocument();
    expect(cabecera).toHaveClass("shrink-0");
    expect(aviso).toHaveClass("shrink-0");
    expect(tira.closest(".sticky")).toHaveClass("shrink-0");
    // Las filas, todas dentro.
    expect(lista.querySelectorAll("li")).toHaveLength(document.querySelectorAll('[role="tabpanel"] li').length);
    expect(lista.querySelectorAll("li")).toHaveLength(4);

    // De la raíz (alto fijo) a la lista, columnas que reparten el alto: cada nivel puede encoger.
    const panelDia = lista.parentElement as HTMLElement;
    const pestanaDia = panelDia.parentElement as HTMLElement;
    const tabs = pestanaDia.parentElement as HTMLElement;
    expect(pestanaDia).toHaveAttribute("role", "tabpanel");
    expect(tabs.parentElement).toBe(raiz());
    for (const nivel of [panelDia, pestanaDia, tabs]) expect(nivel).toHaveClass("flex", "flex-col", "flex-1", "min-h-0");
    expect(raiz()).toHaveClass("flex", "flex-col");
    // Con altura fija la tira no tapa la lista: sin margen de scroll en los botones (devolver el foco a
    // un botón de arriba al cerrar «Dar sala» haría saltar la lista).
    expect(pestanaDia.className).not.toContain("scroll-mt-28");
  });

  it("la lista se alcanza con el teclado (región con nombre, en el orden de tabulación) y enseña el foco", () => {
    conLayout(800);
    montar();
    const lista = listaDelDia();

    expect(lista).toHaveAttribute("tabindex", "0");
    expect(lista).toHaveClass("focus-visible:ring-2");
    lista.focus();
    expect(lista).toHaveFocus();
  });

  it("los botones de cada fila bajan de línea si no caben (móvil estrecho) en vez de salirse de la lista", () => {
    montar();

    const mesas = within(filaDe("m2")).getByRole("button", { name: /mesa/i });
    expect(mesas.parentElement).toHaveClass("flex-wrap");
  });

  it("el desplegable «Dar sala» se pinta fuera de la lista con scroll (portal): no queda recortado", async () => {
    conLayout(800);
    montar();

    fireEvent.click(within(filaDe("m1")).getByRole("button", { name: /Dar sala/ }));
    const salas = await screen.findByRole("list", { name: "Salas" });

    expect(listaDelDia()).not.toContainElement(salas);
    expect(salas.closest("[data-radix-popper-content-wrapper]")?.parentElement).toBe(document.body);
  });
});

describe("PanelAsignacion · posición de la lista", () => {
  it("al dar sala y refrescarse los datos (sondeo, tiempo real) la lista conserva su posición", async () => {
    conLayout(800);
    const { repintar } = montar();
    const lista = listaDelDia();
    lista.scrollTop = 240;

    fireEvent.click(within(filaDe("m1")).getByRole("button", { name: /Dar sala/ }));
    fireEvent.click(within(await screen.findByRole("list", { name: "Salas" })).getByRole("button", { name: /Salón/ }));
    await waitFor(() => expect(h.mutateAsync).toHaveBeenCalledWith({ reservaId: "m1", espacioId: "salon" }));
    // Llega el refresco: m1 ya tiene sala (cambia de grupo) y entra una reserva nueva por tiempo real.
    h.filas = [
      ...datosBase().map((f) =>
        f.reserva_id === "m1" ? { ...f, grado: "sin_mesa", espacio_id: "salon", espacio_nombre: "Salón" } : f,
      ),
      fila("m5", MANANA, "22:00:00", "sin_sala"),
    ];
    repintar();

    expect(screen.getByText("Cliente m5")).toBeInTheDocument();
    expect(listaDelDia()).toBe(lista);
    expect(lista.scrollTop).toBe(240);
  });

  it("al cambiar de día la lista vuelve arriba", () => {
    conLayout(800);
    montar();
    const lista = listaDelDia();
    lista.scrollTop = 300;

    abrirDia(SABADO);

    expect(diaAbierto()).toBe(SABADO);
    // Es la misma región (sin volver a montarse): sin el reinicio seguiría a 300.
    expect(listaDelDia()).toBe(lista);
    expect(lista.scrollTop).toBe(0);
  });

  it("al volver del plano («Mesas») la lista se recoloca donde estaba, y solo esa vez", () => {
    conLayout(800);
    const client = clienteDeLaApp();
    const primero = montarEn(client);
    listaDelDia().scrollTop = 480;

    // «Mesas» abre el plano: `Reservas` pinta otra pantalla y el panel se desmonta.
    fireEvent.click(within(filaDe("m2")).getByRole("button", { name: /mesa/i }));
    expect(primero.onAsignarMesa).toHaveBeenCalledWith(expect.objectContaining({ reservaId: "m2", fecha: MANANA }));
    primero.unmount();

    const segundo = montarEn(client);
    expect(diaAbierto()).toBe(MANANA);
    expect(listaDelDia().scrollTop).toBe(480);
    segundo.unmount();

    // Otra visita sin pasar por «Mesas» (p. ej. desde otra pestaña): empieza arriba.
    montarEn(client);
    expect(listaDelDia().scrollTop).toBe(0);
  });

  it("si al ir al plano estaba «Ocultar las que ya tienen mesa», al volver sigue puesto y la lista en su sitio", () => {
    conLayout(800);
    const client = clienteDeLaApp();
    const primero = montarEn(client);
    fireEvent.click(screen.getByRole("switch", { name: "Ocultar las que ya tienen mesa" }));
    listaDelDia().scrollTop = 200;
    fireEvent.click(within(filaDe("m2")).getByRole("button", { name: /mesa/i }));
    primero.unmount();

    montarEn(client);

    // La misma lista que se dejó (m3 ya tiene mesa: oculta) y en el mismo punto.
    expect(screen.getByRole("switch", { name: "Ocultar las que ya tienen mesa" })).toBeChecked();
    expect(screen.queryByText("Cliente m3")).toBeNull();
    expect(listaDelDia().scrollTop).toBe(200);
  });

  it("si al volver del plano ya se abre otro día, la lista no se recoloca", () => {
    conLayout(800);
    const client = clienteDeLaApp();
    const primero = montarEn(client);
    listaDelDia().scrollTop = 480;
    fireEvent.click(within(filaDe("m2")).getByRole("button", { name: /mesa/i }));
    primero.unmount();
    // Pasan 20 días: el día recordado ya no está en el rango y se abre el de por defecto.
    vi.setSystemTime(new Date("2026-10-21T10:00:00+02:00"));
    h.filas = [fila("x1", "2026-10-21", "21:00:00", "sin_sala")];

    montarEn(client);

    expect(diaAbierto()).toBe("2026-10-21");
    expect(listaDelDia().scrollTop).toBe(0);
  });
});
