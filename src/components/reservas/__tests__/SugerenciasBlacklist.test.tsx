/**
 * Tests para src/components/reservas/SugerenciasBlacklist.tsx
 *
 * Estrategia: mock completo de useSugerenciasBlacklist y useUserRole para
 * aislar el renderizado del componente, mismo patrón que
 * GestionSolicitudes.test.tsx (mock del hook de datos, sin tocar Supabase
 * ni react-query de verdad).
 *
 * Cubre además lo que pidió el dueño el 2026-09-26 sobre esta bandeja
 * ("ponlo todo para que ocupe menos espacio vertical cada cosa"):
 *   1. la bandeja pagina de 50 en 50, como la lista de reservas;
 *   2. la columna de acciones va la PRIMERA, su cabecera no lleva título y
 *      todas las filas traen las mismas dos acciones en el mismo orden;
 *   3. Aprobar y Rechazar siguen siendo distinguibles: las dos llevan texto
 *      y nombre accesible propio, no son dos iconos gemelos;
 *   4. el historial solo ocupa sitio cuando dice algo — un cliente sin
 *      antecedentes no pinta cuatro ceros, y los cuatro números completos
 *      siguen estando en el diálogo de aprobar.
 *
 * El componente pinta DOS vistas de los mismos datos (tarjetas por debajo de
 * lg, tabla a partir de lg). jsdom no aplica CSS, así que las dos existen a la
 * vez: todo lo que se mire aquí va acotado a la tabla con `within`, igual que
 * en ListaReservasAvanzada.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/hooks/useSugerenciasBlacklist");
vi.mock("@/hooks/useUserRole");
vi.mock("sonner");

import {
  useSugerenciasBlacklistPendientes,
  useAprobarSugerenciaBlacklist,
  useRechazarSugerenciaBlacklist,
  MENSAJE_MIGRACION_SUGERENCIAS_PENDIENTE,
  type SugerenciaBlacklist,
} from "@/hooks/useSugerenciasBlacklist";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { SugerenciasBlacklist } from "@/components/reservas/SugerenciasBlacklist";

const makeSugerencia = (overrides: Partial<SugerenciaBlacklist> = {}): SugerenciaBlacklist => ({
  id: "sug-1",
  reserva_id: "res-1",
  telefono: "+34 666 111 222",
  email: null,
  nombre_cliente: "Juan García",
  motivo: "no_show",
  historial: {
    total_reservas_previas: 5,
    no_shows_previos: 2,
    completadas_previas: 3,
    canceladas_previas: 0,
    es_primera_falta: false,
  },
  estado: "pendiente",
  blacklist_id: null,
  creada_at: "2026-09-20T10:00:00Z",
  revisada_por: null,
  revisada_at: null,
  nota_revision: null,
  ...overrides,
});

/** Historial de un cliente de demo: existe, pero está todo a cero. */
const HISTORIAL_VACIO = {
  total_reservas_previas: 0,
  no_shows_previos: 0,
  completadas_previas: 0,
  canceladas_previas: 0,
  es_primera_falta: true,
};

const mutacionOk = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({}),
  isPending: false,
});

const defaultQueryReturn = {
  data: [] as SugerenciaBlacklist[],
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: vi.fn(),
};

/** Renderiza y devuelve la tabla (la vista de escritorio), que es donde se mira todo. */
function renderTabla(data: SugerenciaBlacklist[]) {
  vi.mocked(useSugerenciasBlacklistPendientes).mockReturnValue({ ...defaultQueryReturn, data } as any);
  const vista = render(<SugerenciasBlacklist />);
  const tabla = vista.container.querySelector("table");
  expect(tabla).not.toBeNull();
  return { vista, tabla: tabla as HTMLTableElement };
}

describe("SugerenciasBlacklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCanAccessSection).mockReturnValue({ canAccess: true, loading: false });
    vi.mocked(useAprobarSugerenciaBlacklist).mockReturnValue(mutacionOk() as any);
    vi.mocked(useRechazarSugerenciaBlacklist).mockReturnValue(mutacionOk() as any);
  });

  it("muestra spinner mientras carga", () => {
    vi.mocked(useSugerenciasBlacklistPendientes).mockReturnValue({
      ...defaultQueryReturn,
      isLoading: true,
    } as any);

    const { container } = render(<SugerenciasBlacklist />);
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("no revienta y avisa (sin alarmar) cuando la migración no está aplicada", () => {
    vi.mocked(useSugerenciasBlacklistPendientes).mockReturnValue({
      ...defaultQueryReturn,
      isError: true,
      error: new Error(MENSAJE_MIGRACION_SUGERENCIAS_PENDIENTE),
    } as any);

    render(<SugerenciasBlacklist />);
    expect(screen.getByText(MENSAJE_MIGRACION_SUGERENCIAS_PENDIENTE)).toBeDefined();
  });

  it("muestra un error real (no de migración) con opción de reintentar", () => {
    vi.mocked(useSugerenciasBlacklistPendientes).mockReturnValue({
      ...defaultQueryReturn,
      isError: true,
      error: new Error("Fallo de red inesperado"),
    } as any);

    render(<SugerenciasBlacklist />);
    expect(screen.getByText(/no se han podido cargar/i)).toBeDefined();
  });

  it("muestra estado vacío cuando no hay sugerencias pendientes", () => {
    vi.mocked(useSugerenciasBlacklistPendientes).mockReturnValue(defaultQueryReturn as any);

    render(<SugerenciasBlacklist />);
    expect(screen.getByText(/sin sugerencias de lista negra pendientes/i)).toBeDefined();
  });

  it("renderiza una sugerencia con su historial (ausencias, completadas, canceladas)", () => {
    const { tabla } = renderTabla([makeSugerencia()]);

    expect(within(tabla).getByText("Juan García")).toBeDefined();
    expect(within(tabla).getByText("Ausencia sin avisar")).toBeDefined();
    // Historial: 2 ausencias, 3 completadas, 5 total previas.
    expect(within(tabla).getByText("2")).toBeDefined();
    expect(within(tabla).getByText("3")).toBeDefined();
    expect(within(tabla).getByText("5")).toBeDefined();
    // Reincidente porque es_primera_falta: false
    expect(within(tabla).getByText("Reincidente")).toBeDefined();
  });

  it("el detalle completo no se pierde al compactar: va entero en el title de la celda", () => {
    const { tabla } = renderTabla([makeSugerencia()]);

    const celda = within(tabla).getByTitle(/Historial previo: 2 ausencias, 3 completadas, 0 canceladas/i);
    expect(celda).toBeDefined();
  });

  it("un cliente sin antecedentes ocupa una línea, no cuatro cajas de ceros", () => {
    const { tabla } = renderTabla([makeSugerencia({ historial: HISTORIAL_VACIO })]);

    expect(within(tabla).getByText(/sin antecedentes/i)).toBeDefined();
    // Nada de cuatro ceros ni de las etiquetas de las cajas grandes.
    expect(within(tabla).queryByText("0")).toBeNull();
    expect(within(tabla).queryByText("Total previas")).toBeNull();
    expect(within(tabla).queryByText("Canceladas")).toBeNull();
  });

  it("sin historial disponible lo dice explícitamente en vez de mostrar ceros", () => {
    const { tabla } = renderTabla([makeSugerencia({ historial: null })]);

    expect(within(tabla).getByText(/^sin historial$/i)).toBeDefined();
    expect(within(tabla).getByTitle(/no trae historial previo registrado/i)).toBeDefined();
    expect(within(tabla).queryByText("0")).toBeNull();
  });

  it("con permiso de edición ofrece Aprobar y Rechazar", () => {
    const { tabla } = renderTabla([makeSugerencia()]);

    expect(within(tabla).getByText("Aprobar")).toBeDefined();
    expect(within(tabla).getByText("Rechazar")).toBeDefined();
  });

  it("Aprobar y Rechazar no se pueden confundir: las dos llevan texto y nombre accesible propio", () => {
    const { tabla } = renderTabla([makeSugerencia()]);

    const rechazar = within(tabla).getByRole("button", { name: /Rechazar la sugerencia de Juan García/i });
    const aprobar = within(tabla).getByRole("button", { name: /Añadir a Juan García a la lista negra/i });

    expect(rechazar).not.toBe(aprobar);
    expect(rechazar.textContent).toContain("Rechazar");
    expect(aprobar.textContent).toContain("Aprobar");
  });

  it("las acciones van en la primera columna, sin título de cabecera y siempre en el mismo orden", () => {
    const filas = [
      makeSugerencia({ id: "a", nombre_cliente: "Ana" }),
      makeSugerencia({ id: "b", nombre_cliente: "Berto", historial: null }),
      makeSugerencia({ id: "c", nombre_cliente: "Cris", historial: HISTORIAL_VACIO }),
    ];
    const { tabla } = renderTabla(filas);

    const primeraCabecera = tabla.querySelectorAll("thead th")[0];
    expect(primeraCabecera.textContent).toBe("");
    expect(primeraCabecera.getAttribute("aria-label")).toBe("Acciones");

    const ordenPorFila = [...tabla.querySelectorAll("tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td:first-child button")].map((b) => b.textContent?.trim()),
    );
    expect(ordenPorFila).toHaveLength(3);
    for (const orden of ordenPorFila) {
      expect(orden).toEqual(["Rechazar", "Aprobar"]);
    }
  });

  it("sin permiso de edición NO ofrece aprobar ni rechazar, ni la columna de acciones (usuario de solo lectura)", () => {
    vi.mocked(useCanAccessSection).mockReturnValue({ canAccess: false, loading: false });
    const { tabla } = renderTabla([makeSugerencia()]);

    expect(within(tabla).queryByText("Aprobar")).toBeNull();
    expect(within(tabla).queryByText("Rechazar")).toBeNull();
    expect(within(tabla).queryAllByRole("button")).toEqual([]);
    // 06/11/2026: ni columna ni aviso por fila; la etiqueta común «Solo lectura» la pone la página.
    expect(tabla.querySelector('thead th[aria-label="Acciones"]')).toBeNull();
    expect(within(tabla).queryByText(/solo lectura/i)).toBeNull();
    expect(within(tabla).getByText("Juan García")).toBeDefined();
  });

  it("abrir el diálogo de Aprobar propone una fecha de caducidad por defecto (editable)", () => {
    const { tabla } = renderTabla([makeSugerencia()]);
    fireEvent.click(within(tabla).getByText("Aprobar"));

    // El diálogo se abre con un botón de fecha ya relleno (Popover+Calendar,
    // no texto libre) y el propio diálogo de confirmación.
    expect(screen.getByText("Aprobar y añadir a lista negra")).toBeDefined();
    expect(screen.getByText(/90 días desde hoy/i)).toBeDefined();
  });

  it("el diálogo de Aprobar enseña los cuatro contadores enteros, incluidos los ceros", () => {
    const { tabla } = renderTabla([makeSugerencia()]);
    fireEvent.click(within(tabla).getByText("Aprobar"));

    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByText("Ausencias")).toBeDefined();
    expect(within(dialogo).getByText("Completadas")).toBeDefined();
    expect(within(dialogo).getByText("Canceladas")).toBeDefined();
    expect(within(dialogo).getByText("Total previas")).toBeDefined();
    // La canceladas a 0 no se pinta en la fila, pero aquí sí.
    expect(within(dialogo).getByText("0")).toBeDefined();
  });

  it("el diálogo de Aprobar habla del cliente de la fila que se pulsó, no de la primera", () => {
    const { tabla } = renderTabla([
      makeSugerencia({ id: "a", nombre_cliente: "Ana" }),
      makeSugerencia({ id: "b", nombre_cliente: "Berto" }),
    ]);

    const filaBerto = [...tabla.querySelectorAll("tbody tr")][1];
    fireEvent.click(within(filaBerto as HTMLElement).getByText("Aprobar"));

    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByText(/Berto quedará bloqueado/i)).toBeDefined();
  });

  it("pagina de 50 en 50 y no monta las 194 filas de golpe", () => {
    const muchas = Array.from({ length: 194 }, (_, i) =>
      makeSugerencia({ id: `sug-${i}`, nombre_cliente: `Cliente ${i}`, historial: HISTORIAL_VACIO }),
    );
    const { tabla } = renderTabla(muchas);

    expect(tabla.querySelectorAll("tbody tr")).toHaveLength(50);
    expect(screen.getByText(/Mostrando/)).toBeDefined();
    expect(screen.getByText("1–50")).toBeDefined();
    expect(screen.getByText(/Página 1 de 4/)).toBeDefined();

    // Al cambiar de página se vuelve arriba también DENTRO de la región con scroll propio de
    // Reservas → Blacklist (2026-10-07), donde `window.scrollTo` ya no mueve nada: la bandeja se
    // sube a sí misma. jsdom no trae `scrollIntoView` ni `scrollTo`: se ponen espías y se quitan.
    const subir = vi.fn();
    const ventana = vi.fn();
    const scrollIntoViewOriginal = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    const scrollToOriginal = window.scrollTo;
    Element.prototype.scrollIntoView = subir;
    window.scrollTo = ventana as unknown as typeof window.scrollTo;
    try {
      fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
      expect(screen.getByText("51–100")).toBeDefined();
      expect(screen.getByText(/Página 2 de 4/)).toBeDefined();
      expect(subir).toHaveBeenCalledWith({ block: "start" });
      expect((subir.mock.contexts[0] as HTMLElement).contains(screen.getByText("Sugerencias pendientes"))).toBe(true);
      expect(ventana).toHaveBeenCalledWith({ top: 0 });
    } finally {
      if (scrollIntoViewOriginal) Object.defineProperty(Element.prototype, "scrollIntoView", scrollIntoViewOriginal);
      else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      window.scrollTo = scrollToOriginal;
    }
    // Dos renders de 50 filas con jsdom: en un portátil normal pasa de los 5 s por defecto.
  }, 30_000);

  it("con una sola página no pinta el paginador", () => {
    renderTabla([makeSugerencia()]);
    expect(screen.queryByRole("button", { name: "Siguiente" })).toBeNull();
    expect(screen.queryByText(/Mostrando/)).toBeNull();
  });
});
