// La versión y el entorno se ven también en la barra superior mínima de tablet/móvil
// (< 1024 px) del Admin Panel y del Super Admin (petición del dueño, 2026-11-03).
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/AppSidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/SuperAdminSidebar", () => ({ SuperAdminSidebar: () => null }));
vi.mock("@/components/notificaciones/CentroNotificaciones", () => ({
  CentroNotificaciones: () => <button type="button">Notificaciones</button>,
}));
vi.mock("@/components/carta/recorte/PrecargaRecorte", () => ({ PrecargaRecorte: () => null }));
vi.mock("@/components/NavAutoCollapse", () => ({ NavAutoCollapse: () => null, defaultSidebarOpen: () => true }));

import { DashboardLayout } from "@/components/DashboardLayout";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";

const ancho = (px: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: px });
beforeEach(() => ancho(320));

describe.each([
  ["Admin Panel", DashboardLayout],
  ["Super Admin", SuperAdminLayout],
] as const)("barra superior de %s", (_nombre, Layout) => {
  it("a 320 px lleva la versión y el entorno", () => {
    render(
      <MemoryRouter>
        <Layout>
          <p>contenido</p>
        </Layout>
      </MemoryRouter>,
    );
    const barra = screen.getByRole("banner");
    const version = within(barra).getByTestId("version-panel");
    expect(version).toHaveTextContent("Local");
    expect(version.className).toContain("whitespace-nowrap");
    expect(within(barra).getByRole("button", { name: "Abrir menú" })).toBeInTheDocument();
  });

  it("en escritorio no hay barra (la versión va en la cabecera del menú)", () => {
    ancho(1440);
    render(
      <MemoryRouter>
        <Layout>
          <p>contenido</p>
        </Layout>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByTestId("version-panel")).toBeNull();
  });
});

// Reservas › Hoy en móvil (07/11/2026, petición del dueño): sin la barra; el botón de menú lo pone la página.
describe("DashboardLayout con `sinCabeceraMovil`", () => {
  const montar = () =>
    render(
      <MemoryRouter>
        <DashboardLayout sinCabeceraMovil>
          <p>contenido</p>
        </DashboardLayout>
      </MemoryRouter>,
    );

  it("en móvil (375 px) no hay barra y el contenido respeta la zona segura de arriba", () => {
    ancho(375);
    montar();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.getByRole("main").className).toContain("env(safe-area-inset-top)");
  });

  it("en tablet (768 px) la barra sigue", () => {
    ancho(768);
    montar();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main").className).not.toContain("safe-area");
  });
});
