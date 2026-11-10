/**
 * Dashboard a la ALTURA DE LA PANTALLA (06/10/2026, regla del dueño para todo el panel: «que no haya scroll
 * vertical: el alto de la página es el alto de la pantalla del dispositivo»).
 *
 * Mismo mecanismo que Hoy, Calendario, «Próximas reservas» y la Newsletter (`useAlturaDisponible`): el bloque del
 * Dashboard mide el alto visible menos su posición y el relleno inferior del <main>, y lo reparte con flex:
 * «Reservas de Hoy» arriba con su alto natural (o hasta abajo si va sola) y los módulos se quedan con el resto.
 * Antes la página usaba `fixedHeight` (el <main> hacía scroll) y a 1280×711 las gráficas se salían 147 px.
 * Módulos desde el 10/11/2026 (dueño): la curva por hora, «Márgenes de precio» (solo con Facturas) y «Avisos»;
 * «Reservas por día» ya no está.
 *
 * Se monta el Dashboard con «Reservas de Hoy» y la curva DE VERDAD (datos de mentira); los dos módulos nuevos, con
 * marcadores (tienen sus propios tests). jsdom no calcula layout: las medidas se
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
  facturas: true,
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
      b.order = () => b;
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: [{ id: "comedor", capacidad_maxima: 150, caracteristicas: { marca: "casa_tomas" } }], error: null }).then(ok, ko);
      return b;
    },
  },
}));
vi.mock("@/components/notificaciones/CentroNotificaciones", () => ({ CentroNotificaciones: () => null }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/usePermisosFacturas", () => ({
  usePermisosFacturas: () => ({ consultar: h.facturas, editar: false, subir: false, cargando: false }),
}));
vi.mock("@/components/dashboard/widgets/MargenesPrecio", () => ({
  MargenesPrecio: () => <div className="rounded-lg h-full">Márgenes de precio</div>,
}));
vi.mock("@/components/dashboard/widgets/AvisosDashboard", () => ({
  AvisosDashboard: () => <div className="rounded-lg h-full">Avisos</div>,
}));
vi.mock("@/hooks/useEdicionReserva", () => ({ useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }) }));

import Dashboard from "@/pages/Dashboard";

const original = { innerHeight: window.innerHeight, innerWidth: window.innerWidth };
function altoVentana(px: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: px });
}
function anchoVentana(px: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: px });
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
  await montarConRetorno();
}
async function montarConRetorno() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const r = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText("Reservas de Hoy");
  return r;
}
const bloque = () => screen.getByTestId("dashboard");

beforeEach(() => {
  h.layout = [];
  h.facturas = true;
  anchoVentana(1280);
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
  anchoVentana(original.innerWidth);
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

  it("lo reparte: «Reservas de Hoy» arriba con su alto natural (hasta abajo si va sola) y los módulos con el resto", async () => {
    conLayout(800);
    await montar();
    const reservas = screen.getByTestId("dashboard-reservas");
    const modulos = screen.getByTestId("dashboard-modulos");

    expect([...bloque().children]).toEqual([reservas, modulos]);
    expect(within(reservas).getByText("Reservas de Hoy")).toBeInTheDocument();
    // Su alto natural (`flex-none`); si fuera el único widget, ocuparía todo (`only:flex-1`).
    expect(reservas).toHaveClass("flex-none", "only:flex-1", "min-h-0");
    // Los módulos se quedan con lo que sobra y pueden encoger: uno encima de otro en el móvil, la curva arriba y
    // los otros dos debajo en la tablet vertical y, desde `lg`, los tres lado a lado.
    expect(modulos).toHaveClass("flex", "flex-1", "min-h-0", "flex-col", "md:flex-row", "md:flex-wrap", "lg:flex-nowrap");
    const huecos = [...modulos.children] as HTMLElement[];
    expect(huecos).toHaveLength(3);
    expect(huecos[0]).toHaveClass("md:basis-full", "lg:basis-0");
    ["Curva de Reservas por Hora", "Márgenes de precio", "Avisos"].forEach((titulo, i) => {
      // Cada módulo en su hueco, que se reparte el sitio con los otros…
      expect(huecos[i]).toHaveClass("flex-1", "min-h-0", "min-w-0");
      // …y su tarjeta lo llena entero.
      const tarjeta = within(huecos[i]).getByText(titulo).closest(".rounded-lg") as HTMLElement;
      expect(tarjeta.parentElement).toBe(huecos[i]);
      expect(tarjeta).toHaveClass("h-full");
    });
    // «Reservas por día» ya no está (10/11/2026, decisión del dueño).
    expect(screen.queryByText("Reservas por Día")).toBeNull();
  });

  it("sin permiso de Facturas no sale «Márgenes de precio» (enseña precios de compra); la curva y los avisos sí", async () => {
    h.facturas = false;
    conLayout(800);
    await montar();
    expect(screen.queryByTestId("modulo-margenes")).toBeNull();
    expect(screen.queryByText("Márgenes de precio")).toBeNull();
    expect(screen.getByTestId("modulo-curva")).toBeInTheDocument();
    expect(screen.getByTestId("modulo-avisos")).toBeInTheDocument();
  });

  it("con los módulos apilados el suelo sube (tablet vertical 820 px, móvil 1100 px) y la página hace scroll", async () => {
    anchoVentana(800);
    conLayout(1024);
    const { unmount } = await montarConRetorno();
    expect(bloque()).toHaveAttribute("data-altura-fija", "976");
    unmount();

    anchoVentana(800);
    conLayout(800);
    const segundo = await montarConRetorno();
    // 800 − 48 = 752 < 820
    expect(bloque()).toHaveAttribute("data-altura-fija", "820");
    segundo.unmount();

    anchoVentana(375);
    conLayout(812);
    await montarConRetorno();
    expect(bloque()).toHaveAttribute("data-altura-fija", "1100");
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
