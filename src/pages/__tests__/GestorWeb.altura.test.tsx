/**
 * Gestor Web a la ALTURA DE LA PANTALLA (07/10/2026, regla del dueño para todo el panel: «que no haya scroll
 * vertical: el alto de la página es el alto de la pantalla del dispositivo»).
 *
 * Mismo mecanismo que Newsletter y Facturas (`useAlturaDisponible`): la página mide el alto visible menos su
 * posición y el relleno inferior del <main>; el subtítulo y la barra de pestañas quedan fijos arriba y la pestaña
 * activa es la región que hace scroll. jsdom no calcula layout: las medidas se dan a mano (la página empieza en
 * y = 24, el relleno superior del <main>) y lo demás se comprueba por estructura. Los píxeles reales, con el arnés
 * de capturas.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// El layout de verdad monta el menú lateral (sesión, permisos…): aquí basta un <main> con su relleno inferior.
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <main style={{ paddingBottom: 24 }}>{children}</main>,
}));
vi.mock("@/hooks/useUserRole", () => ({ useUserRole: () => ({ permissions: [], loading: false }) }));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: true, loading: false }) }));
// Las pestañas de verdad leen la carta, las novedades… de Supabase: aquí solo importa dónde se colocan.
vi.mock("@/components/gestion-web/tabs/TabCarta", () => ({ default: () => <p>Contenido de la carta</p> }));
vi.mock("@/components/gestion-web/tabs/TabNovedades", () => ({ default: () => <p>Contenido de novedades</p> }));
vi.mock("@/components/gestion-web/tabs/TabMenusTapas", () => ({
  TabMenus: () => <p>Contenido de menús</p>,
  TabTapas: () => <p>Contenido de tapas</p>,
}));

import GestorWeb from "@/pages/GestorWeb";

const original = { innerHeight: window.innerHeight };
function altoVentana(px: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: px });
}
/** Layout simulado: la página empieza en y = 24 (relleno superior del <main>). */
function conLayout(alto: number) {
  altoVentana(alto);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 24, bottom: 124, left: 0, right: 100, width: 100, height: 100, x: 0, y: 24, toJSON: () => ({}),
  } as DOMRect);
}

async function montar() {
  render(
    <MemoryRouter initialEntries={["/gestion-web?tab=carta"]}>
      <GestorWeb />
    </MemoryRouter>,
  );
  await screen.findByText("Contenido de la carta");
}
// La raíz de la página: el primer hijo del <main> (el subtítulo va en una fila con el botón «?» de ayuda).
const pagina = () => document.querySelector("main > div") as HTMLElement;
// Por `aria-label` y no por rol: una pestaña oculta (`hidden`) no tiene nombre accesible.
const panel = (nombre: string) => {
  const el = document.querySelector<HTMLElement>(`section[role="tabpanel"][aria-label="${nombre}"]`);
  if (!el) throw new Error(`No está montada la pestaña «${nombre}»`);
  return el;
};

afterEach(() => {
  vi.restoreAllMocks();
  altoVentana(original.innerHeight);
});

describe("Gestor Web · ocupa el alto de la pantalla, sin scroll de página", () => {
  it("la página mide justo lo que queda de ventana y deja fija la barra de pestañas (con la ayuda dentro)", async () => {
    conLayout(800);
    await montar();

    // 800 − 24 − 24: termina en el borde inferior del <main>, sin scroll de página.
    expect(pagina().style.height).toBe("752px");
    expect(pagina()).toHaveClass("flex", "flex-col");
    // Sin franja propia para el botón de ayuda (2026-10-18): vive en las acciones de la
    // barra de pestañas, a la misma altura que en el resto de módulos.
    expect(screen.getByRole("button", { name: /Ayuda/ }).closest(".shrink-0")).not.toBeNull();
    expect(screen.getByRole("tablist").closest(".shrink-0")).not.toBeNull();
  });

  it("la pestaña activa es la región con scroll y las ya visitadas siguen ocultas con `hidden`", async () => {
    conLayout(800);
    await montar();

    expect(panel("Carta")).toHaveClass("flex-1", "min-h-0", "overflow-y-auto");
    // Sin clases de `display`: le ganarían al atributo `hidden` y la pestaña oculta seguiría ocupando sitio.
    expect(panel("Carta").className).not.toMatch(/(^|\s)(flex|block|grid)(\s|$)/);

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Novedades/ }), { button: 0, ctrlKey: false });
    await screen.findByText("Contenido de novedades");

    expect(panel("Novedades")).not.toHaveAttribute("hidden");
    expect(panel("Novedades")).toHaveClass("flex-1", "min-h-0", "overflow-y-auto");
    // La carta se queda montada (no se pierde lo escrito), pero oculta.
    expect(panel("Carta")).toHaveAttribute("hidden");
  });

  it("en una ventana muy baja no encoge por debajo del suelo de 420 px y, solo entonces, la página hace scroll", async () => {
    conLayout(400);
    await montar();

    // 400 − 24 − 24 = 352 < 420: se queda en el suelo.
    expect(pagina().style.height).toBe("420px");
  });

  it("sin medidas de layout (jsdom) se queda como siempre: sin alto fijo", async () => {
    await montar();

    expect(pagina().style.height).toBe("");
  });
});
