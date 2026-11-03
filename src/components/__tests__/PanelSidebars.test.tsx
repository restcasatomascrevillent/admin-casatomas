import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  role: "admin" as string | null,
  isSuperAdmin: true,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ signOut: vi.fn(), user: h.user }),
}));
vi.mock("@/hooks/useUserRole", async (original) => ({
  // SECTIONS y los tipos reales: «Mi cuenta» enseña los permisos por sección.
  ...(await original<typeof import("@/hooks/useUserRole")>()),
  useUserRole: () => ({
    isAdmin: true,
    role: h.role,
    loading: false,
    permissions: [{ section_key: "reservas", can_view: true, can_edit: true }],
  }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({
  useSuperAdmin: () => ({ isSuperAdmin: h.isSuperAdmin, loading: false }),
}));
vi.mock("@/hooks/useAdminFeatureToggles", () => ({
  useAdminFeatureToggles: () => ({ isEnabled: () => true, loading: false }),
}));
vi.mock("@/components/facturas/IndicadorSubidasFacturas", () => ({
  IndicadorSubidasFacturas: () => null,
}));

import { AppSidebar } from "@/components/AppSidebar";
import { SuperAdminSidebar } from "@/components/SuperAdminSidebar";

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1440,
  });
  h.user = {
    id: "u-1",
    email: "laura@casatomas.test",
    user_metadata: { display_name: "Laura Gómez" },
    created_at: "2026-01-15T09:30:00Z",
    last_sign_in_at: "2026-11-03T08:00:00Z",
  };
  h.role = "admin";
  h.isSuperAdmin = true;
  localStorage.clear();
});

describe.each([
  ["admin", AppSidebar, "Reservas"],
  ["superadmin", SuperAdminSidebar, "Auditoría"],
] as const)("navegación %s", (_name, Panel, section) => {
  it("permite recoger y expandir sin perder el nombre accesible de los iconos", () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <Panel />
        </SidebarProvider>
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Recoger menú lateral" }),
    );
    expect(
      screen.getByRole("button", { name: "Expandir menú lateral" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: section })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Expandir menú lateral" }),
    );
    expect(
      screen.getByRole("button", { name: "Recoger menú lateral" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it.each([390, 820])(
    "abre el menú completo a %s px aunque escritorio esté recogido, y lo cierra al navegar",
    async (width) => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
      render(
        <MemoryRouter>
          <SidebarProvider defaultOpen={false}>
            <Panel />
            <SidebarTrigger />
          </SidebarProvider>
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
      const drawer = screen.getByRole("dialog", { name: "Menú de navegación" });
      expect(
        within(drawer).getByRole("link", { name: section }),
      ).toBeInTheDocument();
      expect(
        within(drawer).getByRole("button", { name: "Cerrar menú" }),
      ).toHaveAttribute("aria-expanded", "true");
      fireEvent.click(within(drawer).getByRole("link", { name: section }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(
        screen.getByRole("button", { name: "Abrir menú" }),
      ).toHaveAttribute("aria-expanded", "false");
    },
  );
});

// ───────── Super Admin: orden del menú y grupo «Más módulos» (2026-11-03) ─────────

const MAS_MODULOS = ["Ecommerce", "Asistente Tel.", "Espacios", "Bot Web"];

function renderSuperAdmin(ruta = "/super-admin", { defaultOpen = true } = {}) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <SuperAdminSidebar />
        <SidebarTrigger />
      </SidebarProvider>
    </MemoryRouter>,
  );
}
const botonMasModulos = () => screen.getByTestId("mas-modulos");

describe("menú del Super Admin", () => {
  it("arriba los módulos de uso diario agrupados; abajo del todo, «Más módulos» plegado", () => {
    renderSuperAdmin();
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("aria-label"))).toEqual([
      "Control del Panel", "Usuarios", "Auditoría",
      "Gestor Gasto", "Costes", "Servicios",
      "Tráfico web", "Reseñas Google", "Plantillas Email",
    ]);
    for (const grupo of ["Administración", "Costes", "Web y clientes"]) {
      expect(screen.getByRole("list", { name: grupo })).toBeInTheDocument();
    }
    for (const nombre of MAS_MODULOS) expect(screen.queryByRole("link", { name: nombre })).not.toBeInTheDocument();
    const boton = botonMasModulos();
    expect(boton).toHaveAccessibleName("Más módulos");
    expect(boton).toHaveAttribute("aria-expanded", "false");
    // Después de todos los enlaces de arriba.
    const ultimo = screen.getByRole("link", { name: "Plantillas Email" });
    expect(ultimo.compareDocumentPosition(boton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("se abre y se cierra, y recuerda cómo se dejó", () => {
    const { unmount } = renderSuperAdmin();
    fireEvent.click(botonMasModulos());
    expect(botonMasModulos()).toHaveAttribute("aria-expanded", "true");
    const sub = screen.getByRole("list", { name: "Más módulos" });
    expect(within(sub).getAllByRole("link").map((l) => l.getAttribute("aria-label"))).toEqual(MAS_MODULOS);
    expect(botonMasModulos()).toHaveAttribute("aria-controls", sub.parentElement!.id);
    unmount();

    // Otra visita: sigue abierto.
    const segunda = renderSuperAdmin("/super-admin/costes");
    expect(botonMasModulos()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(botonMasModulos());
    expect(botonMasModulos()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Ecommerce" })).not.toBeInTheDocument();
    segunda.unmount();
    renderSuperAdmin();
    expect(botonMasModulos()).toHaveAttribute("aria-expanded", "false");
  });

  it("al abrirlo a mano, sus enlaces se desplazan a la vista (menú largo)", async () => {
    const desplazar = vi.fn();
    Element.prototype.scrollIntoView = desplazar;
    renderSuperAdmin();
    fireEvent.click(botonMasModulos());
    await waitFor(() => expect(desplazar).toHaveBeenCalledWith(expect.objectContaining({ block: "nearest" })));
    // jsdom no lo tiene: se quita lo que se ha puesto.
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("se abre solo si la página actual es uno de sus módulos", () => {
    localStorage.setItem("superadmin:menu:mas-modulos", "cerrado");
    renderSuperAdmin("/super-admin/espacios");
    expect(botonMasModulos()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Espacios" })).toHaveAttribute("aria-current", "page");
  });

  it("sin almacenamiento (modo privado) funciona igual, plegado", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("bloqueado"); });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("bloqueado"); });
    renderSuperAdmin();
    expect(botonMasModulos()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(botonMasModulos());
    expect(screen.getByRole("link", { name: "Bot Web" })).toBeInTheDocument();
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("con el menú plegado a iconos es un botón que abre un menú con los cuatro (teclado incluido)", async () => {
    renderSuperAdmin("/super-admin/bot-web", { defaultOpen: false });
    const boton = botonMasModulos();
    expect(boton).toHaveAccessibleName("Más módulos");
    expect(boton).toHaveAttribute("aria-haspopup", "menu");
    expect(boton).toHaveAttribute("data-active", "true");
    fireEvent.keyDown(boton, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(MAS_MODULOS);
    expect(within(menu).getByRole("menuitem", { name: "Bot Web" })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("menuitem", { name: "Ecommerce" })).toHaveAttribute("href", "/super-admin/ecommerce");
  });

  it.each([390, 820])("en el panel deslizante (%s px) se despliega dentro del panel", (width) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    renderSuperAdmin("/super-admin", { defaultOpen: false });
    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    const drawer = screen.getByRole("dialog", { name: "Menú de navegación" });
    const boton = within(drawer).getByTestId("mas-modulos");
    expect(boton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(boton);
    expect(within(drawer).getByRole("link", { name: "Asistente Tel." })).toBeInTheDocument();
  });
});

// ───────── Pie del menú: usuario conectado y «Mi cuenta» ─────────

describe.each([
  ["admin", AppSidebar, "Admin"],
  ["superadmin", SuperAdminSidebar, "Super Admin"],
] as const)("pie del menú %s", (_nombre, Panel, rolEsperado) => {
  // Usuario «admin» que no es super admin: en el Admin Panel se ve «Admin»; dentro
  // del Super Admin siempre «Super Admin» (solo entra un super admin).
  beforeEach(() => {
    h.isSuperAdmin = false;
  });
  const renderPanel = (defaultOpen = true) =>
    render(
      <MemoryRouter>
        <SidebarProvider defaultOpen={defaultOpen}>
          <Panel />
        </SidebarProvider>
      </MemoryRouter>,
    );

  it("enseña al usuario con sus iniciales, su nombre y su rol, y mantiene el resto del pie", () => {
    renderPanel();
    const boton = screen.getByTestId("boton-mi-cuenta");
    expect(boton).toHaveAccessibleName(`Mi cuenta: Laura Gómez, ${rolEsperado}`);
    expect(within(boton).getByTestId("avatar-usuario")).toHaveTextContent("LG");
    expect(within(boton).getByText("Laura Gómez")).toBeInTheDocument();
    expect(within(boton).getByText(rolEsperado)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    // La versión ya no va en el pie (2026-11-03): está arriba.
    const pie = boton.closest('[data-sidebar="footer"]')!;
    expect(within(pie as HTMLElement).queryByTestId("version-panel")).toBeNull();
  });

  it("sin nombre guardado usa el email (o el usuario de @staff.local)", () => {
    h.user = { ...h.user, user_metadata: {}, email: "pepe@staff.local" };
    const { unmount } = renderPanel();
    expect(screen.getByTestId("boton-mi-cuenta")).toHaveAccessibleName(expect.stringContaining("Mi cuenta: pepe,"));
    expect(screen.getByTestId("avatar-usuario")).toHaveTextContent("PE");
    unmount();
    h.user = { ...h.user, email: "marta.lopez@casatomas.test" };
    renderPanel();
    expect(screen.getByTestId("boton-mi-cuenta")).toHaveAccessibleName(expect.stringContaining("marta.lopez@casatomas.test"));
    expect(screen.getByTestId("avatar-usuario")).toHaveTextContent("ML");
  });

  it("en modo iconos queda el avatar, con el nombre en el tooltip", async () => {
    renderPanel(false);
    const boton = screen.getByTestId("boton-mi-cuenta");
    expect(within(boton).getByTestId("avatar-usuario")).toBeInTheDocument();
    expect(boton).toHaveAccessibleName(expect.stringContaining("Laura Gómez"));
    fireEvent.focus(boton);
    expect((await screen.findAllByText(`Mi cuenta · Laura Gómez (${rolEsperado})`)).length).toBeGreaterThan(0);
  });

  it("abre «Mi cuenta» con sus datos, sus secciones y el cambio de contraseña", async () => {
    h.isSuperAdmin = _nombre === "superadmin";
    renderPanel();
    fireEvent.click(screen.getByTestId("boton-mi-cuenta"));
    const dialogo = await screen.findByRole("dialog", { name: "Laura Gómez" });
    expect(within(dialogo).getByText("Email").nextSibling).toHaveTextContent("laura@casatomas.test");
    expect(within(dialogo).getByText("Rol").nextSibling).toHaveTextContent(rolEsperado);
    expect(within(dialogo).getByText("Alta en el panel").nextSibling).toHaveTextContent("2026");
    expect(within(dialogo).getByText("Último inicio de sesión")).toBeInTheDocument();
    expect(within(dialogo).getByRole("heading", { name: "Secciones a las que tienes acceso" })).toBeInTheDocument();
    if (_nombre === "admin") {
      // Admin sin super admin: «Reservas» con ver y editar; el resto, no.
      expect(within(dialogo).getByLabelText("Ver Reservas: Sí")).toBeInTheDocument();
      expect(within(dialogo).getByLabelText("Ver Facturas: No")).toBeInTheDocument();
    } else {
      // Super admin: todas las secciones, sin la tabla de Sí/No.
      expect(within(dialogo).getByLabelText("Facturas: ver y editar")).toBeInTheDocument();
      expect(within(dialogo).queryByLabelText("Ver Facturas: Sí")).toBeNull();
    }
    fireEvent.mouseDown(within(dialogo).getByRole("tab", { name: "Contraseña" }));
    expect(await within(dialogo).findByLabelText("Contraseña actual", { selector: "input" })).toBeInTheDocument();
    expect(within(dialogo).getByLabelText("Nueva contraseña", { selector: "input" })).toBeInTheDocument();
  });
});

// ───────── Versión y entorno en la cabecera del menú (2026-11-03) ─────────

describe.each([
  ["admin", AppSidebar, "Admin Panel"],
  ["superadmin", SuperAdminSidebar, "Super Admin"],
] as const)("versión arriba en el menú %s", (_nombre, Panel, titulo) => {
  const renderPanel = (defaultOpen = true) =>
    render(
      <MemoryRouter>
        <SidebarProvider defaultOpen={defaultOpen}>
          <Panel />
          <SidebarTrigger />
        </SidebarProvider>
      </MemoryRouter>,
    );
  const cabecera = () => screen.getByRole("heading", { name: titulo }).closest('[data-sidebar="header"]') as HTMLElement;

  it("expandido: en la cabecera, junto al título, con el entorno; no en el pie", () => {
    renderPanel();
    const version = within(cabecera()).getByTestId("version-panel");
    expect(version).toHaveTextContent("Local");
    expect(version).toHaveAttribute("title", "Local");
    expect(screen.getAllByTestId("version-panel")).toHaveLength(1);
  });

  it("en modo iconos queda un indicador compacto en la cabecera", () => {
    renderPanel(false);
    const version = screen.getByTestId("version-panel");
    expect(version.closest('[data-sidebar="header"]')).not.toBeNull();
    expect(version.closest('[data-sidebar="footer"]')).toBeNull();
    expect(version).toHaveAttribute("data-entorno", "local");
  });

  it("en el panel deslizante (390 px) también está arriba", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    renderPanel(false);
    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    const drawer = screen.getByRole("dialog", { name: "Menú de navegación" });
    expect(within(drawer).getByTestId("version-panel").closest('[data-sidebar="header"]')).not.toBeNull();
  });
});

describe("menú del panel normal", () => {
  it("incluye la pestaña Tienda (sección de permisos «tienda»), entre Cheques y Facturas", () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Tienda" })).toHaveAttribute("href", "/tienda");
    const nombres = screen.getAllByRole("link").map((l) => l.getAttribute("aria-label"));
    expect(nombres.indexOf("Tienda")).toBe(nombres.indexOf("Cheques") + 1);
    expect(nombres.indexOf("Facturas")).toBe(nombres.indexOf("Tienda") + 1);
  });
});
