/**
 * «Facturas · Subida» va por libre (dueño, 06/11/2026): con solo ese permiso la
 * entrada «Facturas» sale en el menú y la ruta deja entrar (la página enseña
 * solo Cargar; ver Facturas.permisos.test.tsx). Quien no tiene ni Facturas ni
 * Subida sigue rebotando.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";

const h = vi.hoisted(() => ({
  permisos: [] as { section_key: string; can_view: boolean; can_edit: boolean }[],
}));
vi.mock("@/lib/audit-access", () => ({ auditDeniedAccess: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ signOut: vi.fn(), user: { id: "u-1", email: "cocina@casatomas.test", user_metadata: {} }, loading: false }),
  useUsuarioIdOpcional: () => "u-1",
}));
vi.mock("@/hooks/useUserRole", async (original) => ({
  ...(await original<typeof import("@/hooks/useUserRole")>()),
  useUserRole: () => ({ isAdmin: false, role: "staff", loading: false, permissions: h.permisos }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: false, loading: false }) }));
vi.mock("@/hooks/useAdminFeatureToggles", () => ({ useAdminFeatureToggles: () => ({ isEnabled: () => true, loading: false }) }));
vi.mock("@/components/facturas/IndicadorSubidasFacturas", () => ({ IndicadorSubidasFacturas: () => null }));

import { AppSidebar } from "@/components/AppSidebar";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const SOLO_SUBIDA = [{ section_key: "facturas_subida", can_view: true, can_edit: false }];

function Donde() {
  const l = useLocation();
  return <output data-testid="donde">{l.pathname}</output>;
}

function rutas(inicial: string) {
  return render(
    <MemoryRouter initialEntries={[inicial]}>
      <Donde />
      <Routes>
        <Route path="/facturas" element={<ProtectedRoute><p>Página de Facturas</p></ProtectedRoute>} />
        <Route path="/facturas/ia" element={<ProtectedRoute requiredSection={["facturas", "facturas_subida"]}><p>IA de Facturas</p></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><p>Dashboard</p></ProtectedRoute>} />
        <Route path="/ayuda" element={<p>Ayuda</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  h.permisos = [];
});

describe("«Facturas · Subida» en el menú y en la ruta", () => {
  it("con solo Subida, el menú enseña «Facturas»", () => {
    h.permisos = SOLO_SUBIDA;
    render(
      <MemoryRouter initialEntries={["/facturas"]}>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /Facturas/ })).toHaveAttribute("href", "/facturas");
    expect(screen.queryByRole("link", { name: /Reservas/ })).toBeNull();
  });

  it("sin Facturas ni Subida, no", () => {
    h.permisos = [{ section_key: "dashboard", can_view: true, can_edit: false }];
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: /Facturas/ })).toBeNull();
  });

  it("con solo Subida, /facturas deja entrar (la página decide qué enseña)", () => {
    h.permisos = SOLO_SUBIDA;
    rutas("/facturas");
    expect(screen.getByText("Página de Facturas")).toBeInTheDocument();
  });

  it("con solo Subida, /facturas/ia también entra (la página la lleva a Cargar)", () => {
    h.permisos = SOLO_SUBIDA;
    rutas("/facturas/ia");
    expect(screen.getByText("IA de Facturas")).toBeInTheDocument();
  });

  it("con solo Subida, una ruta sin permiso rebota a Facturas (su primera sección)", async () => {
    h.permisos = SOLO_SUBIDA;
    rutas("/dashboard");
    expect(await screen.findByText("Página de Facturas")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/facturas");
  });

  it("sin Facturas ni Subida, /facturas rebota", async () => {
    h.permisos = [{ section_key: "dashboard", can_view: true, can_edit: false }];
    rutas("/facturas");
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Página de Facturas")).toBeNull();
  });
});
