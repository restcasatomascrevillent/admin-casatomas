/**
 * Dashboard a la ALTURA DE LA PANTALLA (06/10/2026, regla del dueño para todo el panel: «que no haya scroll
 * vertical: el alto de la página es el alto de la pantalla del dispositivo»).
 *
 * Mismo mecanismo que Hoy, Calendario, «Próximas reservas» y la Newsletter (`useAlturaDisponible`): el bloque del
 * Dashboard mide el alto visible menos su posición y el relleno inferior del <main>, y lo reparte con flex:
 * «Reservas de Hoy» arriba con su alto natural (o hasta abajo si va sola) y las dos gráficas se quedan con el resto.
 * Antes la página usaba `fixedHeight` (el <main> hacía scroll) y a 1280×711 las gráficas se salían 147 px.
 *
 * Se monta el Dashboard con sus tres widgets DE VERDAD (datos de mentira). jsdom no calcula layout: las medidas se
 * dan a mano (el bloque empieza en y = 24, el relleno superior del <main>); lo demás se comprueba por estructura,
 * como en `VistaHoy.altura.test.tsx`. Los píxeles reales, con el arnés de capturas.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  reservas: [] as Array<Record<string, unknown>>,
  layout: [] as Array<{ fixedHeight?: boolean }>,
}));

// El layout de verdad monta el menú lateral (sesión, permisos…): aquí basta un <main> con su relleno inferior
// (24 px, `sm:p-6`) y apuntar con qué props lo usa el Dashboard.
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children, fixedHeight }: { children: ReactNode; fixedHeight?: boolean }) => {
    h.layout.push({ fixedHeight });
    return <main style={{ paddingBottom: 24 }}>{children}</main>;
  },
}));
vi.mock("@/hooks/useDashboardStats", () => ({
  useDashboardStats: () => ({ data: { reservas: h.reservas }, isError: false, error: null, refetch: vi.fn() }),
  useTodayReservations: () => ({ data: h.reservas, isError: false, refetch: vi.fn() }),
  useTodayConfirmedReservations: () => ({ data: h.reservas, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useSalasPrivadas", () => ({ useIdsSalasPrivadas: () => [] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: [{ id: "comedor", capacidad_maxima: 150, caracteristicas: { marca: "casa_tomas" } }], error: null }).then(ok, ko);
      return b;
    },
  },
}));
vi.mock("@/components/notificaciones/CentroNotificaciones", () => ({ CentroNotificaciones: () => null }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/useEdicionReserva", () => ({ useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }) }));

import Dashboard from "@/pages/Dashboard";

const original = { innerHeight: window.innerHeight };
function altoVentana(px: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: px });
}
/** Layout simulado: el bloque del Dashboard empieza en y = 24 (relleno superior del <main>). */
function conLayout(alto: number) {
  altoVentana(alto);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.dataset.testid === "dashboard" ? 24 : 0;
    return { top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON: () => ({}) };
  });
}

async function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText("Reservas de Hoy");
}
const bloque = () => screen.getByTestId("dashboard");

beforeEach(() => {
  h.layout = [];
  const hoy = new Date();
  const dia = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
  h.reservas = [
    { id: "r1", nombre: "Ana", fecha: dia, hora: "14:00:00", numero_comensales: 4, estado: "confirmada", notas_cliente: null, en_blacklist: false, marca: "casa_tomas" },
    { id: "r2", nombre: "Luis", fecha: dia, hora: "21:00:00", numero_comensales: 2, estado: "confirmada", notas_cliente: null, en_blacklist: false, marca: "casa_tomas" },
  ];
});
afterEach(() => {
  vi.restoreAllMocks();
  altoVentana(original.innerHeight);
});

describe("Dashboard · ocupa el alto de la pantalla, sin scroll", () => {
  it("el bloque mide justo lo que queda de ventana: alto visible − su posición − relleno inferior del <main>", async () => {
    conLayout(800);
    await montar();

    // 800 − 24 − 24: termina en el borde inferior del <main>, sin scroll de página.
    expect(bloque()).toHaveAttribute("data-altura-fija", "752");
    expect(bloque().style.height).toBe("752px");
    expect(bloque()).toHaveClass("flex", "flex-col");
    // Sin scroll propio: lo que hay dentro se reparte el alto, no se desplaza.
    expect(bloque().className).not.toMatch(/overflow-(y-)?(auto|scroll)/);
  });

  it("lo reparte: «Reservas de Hoy» arriba con su alto natural (hasta abajo si va sola) y las gráficas con el resto", async () => {
    conLayout(800);
    await montar();
    const reservas = screen.getByTestId("dashboard-reservas");
    const graficas = screen.getByTestId("dashboard-graficas");

    expect([...bloque().children]).toEqual([reservas, graficas]);
    expect(within(reservas).getByText("Reservas de Hoy")).toBeInTheDocument();
    // Su alto natural (`flex-none`); si fuera el único widget, ocuparía todo (`only:flex-1`).
    expect(reservas).toHaveClass("flex-none", "only:flex-1", "min-h-0");
    // Las gráficas se quedan con lo que sobra y pueden encoger: una encima de otra y, desde `lg`, lado a lado.
    expect(graficas).toHaveClass("flex", "flex-1", "min-h-0", "flex-col", "lg:flex-row");
    const huecos = [...graficas.children] as HTMLElement[];
    expect(huecos).toHaveLength(2);
    ["Reservas por Día", "Curva de Reservas por Hora"].forEach((titulo, i) => {
      // Cada gráfica en su hueco, que se reparte el sitio a partes iguales con el otro…
      expect(huecos[i]).toHaveClass("flex-1", "min-h-0", "min-w-0");
      // …y su tarjeta lo llena entero.
      const tarjeta = within(huecos[i]).getByText(titulo).closest(".rounded-lg") as HTMLElement;
      expect(tarjeta.parentElement).toBe(huecos[i]);
      expect(tarjeta).toHaveClass("h-full");
    });
  });

  it("se recalcula al redimensionar la ventana y al girar la tablet", async () => {
    conLayout(800);
    await montar();
    expect(bloque()).toHaveAttribute("data-altura-fija", "752");

    act(() => {
      altoVentana(711);
      window.dispatchEvent(new Event("resize"));
    });
    expect(bloque()).toHaveAttribute("data-altura-fija", "663");

    act(() => {
      altoVentana(1024);
      window.dispatchEvent(new Event("orientationchange"));
    });
    expect(bloque()).toHaveAttribute("data-altura-fija", "976");
  });

  it("en una ventana muy baja no encoge por debajo del suelo de 480 px y, solo entonces, la página hace scroll", async () => {
    conLayout(500);
    await montar();

    // 500 − 24 − 24 = 452 < 480: se queda en el suelo.
    expect(bloque()).toHaveAttribute("data-altura-fija", "480");
  });

  it("sin medidas de layout (jsdom) se queda como siempre: sin alto fijo, cada widget con su alto natural", async () => {
    await montar();

    expect(bloque()).not.toHaveAttribute("data-altura-fija");
    expect(bloque().style.height).toBe("");
  });

  it("no usa `fixedHeight`: el que hace scroll en el caso extremo es la página, como en el resto de pantallas", async () => {
    conLayout(800);
    await montar();

    // Con `fixedHeight` el <main> sería la caja con scroll y la medida (que cuenta el scroll de la página) se descuadraría.
    expect(h.layout.length).toBeGreaterThan(0);
    expect(h.layout.every((props) => !props.fixedHeight)).toBe(true);
  });
});
