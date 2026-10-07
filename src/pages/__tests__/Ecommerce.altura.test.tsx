/**
 * Ecommerce (Super Admin) a la ALTURA DE LA PANTALLA (07/10/2026, regla del dueño para todo el panel: «que no haya
 * scroll vertical: el alto de la página es el alto de la pantalla del dispositivo»).
 *
 * Mismo mecanismo que Dashboard, Newsletter y Facturas (`useAlturaDisponible`): el bloque mide el alto visible menos su
 * posición y el relleno inferior del <main>; la barra de pestañas queda fija y cada pestaña se queda con el resto
 * (las tablas y la rejilla desplazan por dentro). Antes el bloque no tenía alto: Productos medía hasta 18 663 px de
 * scroll de página y la barra «Cobrar» del TPV quedaba bajo el pliegue.
 *
 * jsdom no calcula layout: las medidas se dan a mano (el bloque empieza en y = 24, el relleno superior del <main>) y
 * las secciones se sustituyen por marcadores. Los píxeles reales, con el arnés de capturas.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("@/components/SuperAdminLayout", () => ({
  SuperAdminLayout: ({ children }: { children: ReactNode }) => <main style={{ paddingBottom: 24 }}>{children}</main>,
}));
vi.mock("@/components/ecommerce/tpv/TPVContainer", () => ({ TPVContainer: () => <div>TPV</div> }));
vi.mock("@/components/ecommerce/productos/SeccionProductos", () => ({ SeccionProductos: () => <div>Sección de productos</div> }));
vi.mock("@/components/ecommerce/pedidos/ListaPedidos", () => ({ ListaPedidos: () => <div>Pedidos</div> }));
vi.mock("@/components/ecommerce/stock/TablaStock", () => ({ TablaStock: () => <div>Stock</div> }));
vi.mock("@/components/ecommerce/stock/HistorialMovimientos", () => ({ HistorialMovimientos: () => <div>Historial</div> }));
vi.mock("@/components/ecommerce/analiticas/SeccionAnaliticas", () => ({ SeccionAnaliticas: () => <div>Analíticas</div> }));

import Ecommerce from "@/pages/Ecommerce";

const original = { innerHeight: window.innerHeight };
function altoVentana(px: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: px });
}
/** Layout simulado: el bloque empieza en y = 24 (relleno superior del <main>). */
function conLayout(alto: number) {
  altoVentana(alto);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.dataset.testid === "ecommerce" ? 24 : 0;
    return { top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON: () => ({}) };
  });
}
const bloque = () => screen.getByTestId("ecommerce");

afterEach(() => {
  vi.restoreAllMocks();
  altoVentana(original.innerHeight);
});

describe("Ecommerce · ocupa el alto de la pantalla, sin scroll de página", () => {
  it("el bloque mide justo lo que queda de ventana y se recalcula al redimensionar", () => {
    conLayout(800);
    render(<Ecommerce />);

    // 800 − 24 − 24: termina en el borde inferior del <main>.
    expect(bloque().style.height).toBe("752px");
    expect(bloque()).toHaveClass("flex", "flex-col");

    act(() => {
      altoVentana(711);
      window.dispatchEvent(new Event("resize"));
    });
    expect(bloque().style.height).toBe("663px");
  });

  it("no encoge por debajo del suelo de 420 px (solo entonces la página hace scroll)", () => {
    conLayout(400);
    render(<Ecommerce />);
    expect(bloque().style.height).toBe("420px");
  });

  it("pestañas fijas arriba y cada pestaña con el resto del alto; las ocultas no ocupan sitio", () => {
    conLayout(800);
    render(<Ecommerce />);

    expect(screen.getAllByRole("tablist")[0]).toHaveClass("shrink-0");
    const paneles = document.querySelectorAll('[role="tabpanel"]');
    expect(paneles.length).toBe(6);
    paneles.forEach((panel) => {
      expect(panel).toHaveClass("flex-1", "min-h-0", "data-[state=inactive]:hidden");
    });
    // Productos (activa al entrar) reparte el alto por dentro: filtros fijos y la rejilla con su scroll.
    const productos = screen.getByText("Sección de productos").closest('[role="tabpanel"]');
    expect(productos).toHaveClass("flex", "flex-col");
  });

  it("sin medidas de layout (jsdom) se queda como siempre: sin alto fijo", () => {
    render(<Ecommerce />);
    expect(bloque().style.height).toBe("");
  });
});
