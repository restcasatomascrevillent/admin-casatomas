/**
 * Newsletter › Estadísticas a pantalla completa sin scroll (petición del dueño, 2026-10-06): la pestaña
 * recibe el alto exacto de la ventana (`useAlturaDisponible`, como las otras dos) y su contenido lo llena
 * justo, con el historial de envíos JUNTO a la gráfica en vez de debajo de todo. jsdom no calcula layout:
 * se prueba la estructura (las medidas reales están en las capturas de Playwright).
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/useAlturaDisponible", () => ({ useAlturaDisponible: () => 640 }));
vi.mock("@/components/marketing/CreadorNewsletter", () => ({ CreadorNewsletter: () => <p>Creador de prueba</p> }));
vi.mock("@/components/marketing/GestionCorreos", () => ({ GestionCorreos: () => <p>Suscriptores de prueba</p> }));
vi.mock("@/components/marketing/HistorialEnvios", () => ({ HistorialEnvios: () => <section>Historial de prueba</section> }));
vi.mock("@/hooks/useEmailEventos", () => ({
  useEstadisticasCorreos: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    data: {
      cifras: { enviados: 34, entregados: 34, abiertos: 6, clics: 4, noEntregados: 0, spam: 0 },
      tasas: { entrega: 100, apertura: 18, clics: 12 },
      porDia: [
        { fecha: "2026-09-30", enviados: 0, entregados: 0, abiertos: 0, clics: 0 },
        { fecha: "2026-10-01", enviados: 1, entregados: 1, abiertos: 0, clics: 0 },
        { fecha: "2026-10-02", enviados: 3, entregados: 3, abiertos: 0, clics: 0 },
        { fecha: "2026-10-03", enviados: 5, entregados: 5, abiertos: 0, clics: 0 },
        { fecha: "2026-10-04", enviados: 2, entregados: 2, abiertos: 0, clics: 0 },
        { fecha: "2026-10-05", enviados: 5, entregados: 5, abiertos: 0, clics: 0 },
        { fecha: "2026-10-06", enviados: 0, entregados: 0, abiertos: 0, clics: 0 },
      ],
      truncado: false,
    },
  }),
}));
// Recharts no mide nada en jsdom.
vi.mock("recharts", () => {
  const Nada = () => null;
  return { LineChart: Nada, Line: Nada, XAxis: Nada, YAxis: Nada, CartesianGrid: Nada, Tooltip: Nada, ResponsiveContainer: Nada, Legend: Nada };
});

import Marketing from "../Marketing";

describe("Marketing › Estadísticas · todo cabe sin scroll", () => {
  it("la pestaña tiene el alto de la ventana y un solo bloque que la llena; el historial va junto a la gráfica, no debajo", () => {
    render(<Marketing />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Estadísticas" }), { button: 0, ctrlKey: false });
    const panel = screen.getByRole("tabpanel", { name: "Estadísticas" });

    // El mecanismo de altura de las pestañas sigue igual: alto fijo arriba y scroll interno solo de respaldo
    // (ventanas por debajo del suelo y móvil).
    const raizPagina = screen.getByRole("tablist").closest("main")?.firstElementChild as HTMLElement;
    expect(raizPagina).toHaveStyle({ height: "640px" });
    expect(panel).toHaveClass("flex-1", "min-h-0", "overflow-y-auto", "data-[state=inactive]:hidden");
    expect(panel.className).not.toMatch(/space-y-/);

    // Un único hijo, que mide justo el alto de la pestaña (md:h-full): si cabe, no queda nada que desplazar.
    const estadisticas = within(panel).getByTestId("estadisticas-correos");
    expect(estadisticas.parentElement).toBe(panel);
    expect(panel.children).toHaveLength(1);
    expect(estadisticas).toHaveClass("md:h-full");

    // El historial, dentro del bloque y en la misma columna que el desglose, al lado de la gráfica.
    const historial = within(estadisticas).getByText("Historial de prueba");
    const zona = within(estadisticas).getByTestId("zona-grafica");
    expect(zona).toContainElement(within(estadisticas).getByRole("figure", { name: "Últimos 7 días" }));
    const columna = (within(zona).getByText("Desglose").closest(".rounded-lg") as HTMLElement).parentElement as HTMLElement;
    expect(columna).toContainElement(historial);
  });

  it("las otras pestañas no cambian: «Enviar Newsletter» sigue a dos columnas desde lg y «Suscriptores» con su scroll", () => {
    render(<Marketing />);
    const crear = screen.getByRole("tabpanel", { name: "Enviar Newsletter" });
    expect(crear).toHaveClass("flex-1", "min-h-0", "overflow-y-auto", "lg:flex", "lg:flex-col", "lg:overflow-hidden");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Suscriptores" }), { button: 0, ctrlKey: false });
    const suscriptores = screen.getByRole("tabpanel", { name: "Suscriptores" });
    expect(suscriptores).toHaveClass("flex-1", "min-h-0", "overflow-y-auto", "overscroll-contain");
    expect(within(suscriptores).getByText("Suscriptores de prueba")).toBeInTheDocument();
  });
});
