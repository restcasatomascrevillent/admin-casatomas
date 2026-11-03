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

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ isAdmin: true, loading: false, permissions: [] }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({
  useSuperAdmin: () => ({ isSuperAdmin: true, loading: false }),
}));
vi.mock("@/hooks/useAdminFeatureToggles", () => ({
  useAdminFeatureToggles: () => ({ isEnabled: () => true, loading: false }),
}));
vi.mock("@/components/facturas/IndicadorSubidasFacturas", () => ({
  IndicadorSubidasFacturas: () => null,
}));

import { AppSidebar } from "@/components/AppSidebar";
import { SuperAdminSidebar } from "@/components/SuperAdminSidebar";

beforeEach(() =>
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1440,
  }),
);

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
