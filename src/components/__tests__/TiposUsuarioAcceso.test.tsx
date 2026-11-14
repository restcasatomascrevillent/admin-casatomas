/**
 * Tipos de usuario «Reservas» y «Albaranes» (10/11/2026) en el menú y en las rutas: cada uno ve solo su
 * sección y, al entrar (Auth lleva a /dashboard), va directo a ella sin que cuente como acceso denegado.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";

const h = vi.hoisted(() => ({
  permisos: [] as { section_key: string; can_view: boolean; can_edit: boolean }[],
  superAdmin: false,
  auditar: vi.fn(),
}));
vi.mock("@/lib/audit-access", () => ({ auditDeniedAccess: h.auditar }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ signOut: vi.fn(), user: { id: "u-1", email: "movil@casatomas.test", user_metadata: {} }, loading: false }),
  useUsuarioIdOpcional: () => "u-1",
}));
vi.mock("@/hooks/useUserRole", async (original) => ({
  ...(await original<typeof import("@/hooks/useUserRole")>()),
  useUserRole: () => ({ isAdmin: false, role: "staff", loading: false, permissions: h.permisos }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: h.superAdmin, loading: false }) }));
vi.mock("@/hooks/useAdminFeatureToggles", () => ({ useAdminFeatureToggles: () => ({ isEnabled: () => true, loading: false }) }));
vi.mock("@/components/facturas/IndicadorSubidasFacturas", () => ({ IndicadorSubidasFacturas: () => null }));

import { AppSidebar } from "@/components/AppSidebar";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { TIPOS_USUARIO } from "@/components/usuarios/tiposUsuario";

const permisosDe = (id: string) => TIPOS_USUARIO.find((t) => t.id === id)!.permisos;

function Donde() {
  const l = useLocation();
  return <output data-testid="donde">{l.pathname}</output>;
}

function rutas(inicial: string) {
  return render(
    <MemoryRouter initialEntries={[inicial]}>
      <Donde />
      <Routes>
        <Route path="/dashboard" element={<ProtectedRoute><p>Dashboard</p></ProtectedRoute>} />
        <Route path="/reservas" element={<ProtectedRoute><p>Página de Reservas</p></ProtectedRoute>} />
        <Route path="/facturas" element={<ProtectedRoute><p>Página de Facturas</p></ProtectedRoute>} />
        <Route path="/albaranes" element={<ProtectedRoute requiredSection="facturas_albaranes"><p>Subir albaranes</p></ProtectedRoute>} />
        <Route path="/usuarios" element={<ProtectedRoute requiredSection="usuarios"><p>Usuarios</p></ProtectedRoute>} />
        <Route path="/ayuda" element={<p>Ayuda</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function menu() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
  return screen.getAllByRole("link").map((a) => a.getAttribute("href"));
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  h.permisos = [];
  h.superAdmin = false;
  h.auditar.mockClear();
});

describe("tipo «Albaranes»", () => {
  it("el menú enseña solo «Subir albaranes» (y Nueva petición y Ayuda, que son de todos)", () => {
    h.permisos = permisosDe("albaranes");
    expect(menu()).toEqual(["/albaranes", "/peticiones", "/ayuda"]);
  });

  it("al entrar (/dashboard) va directo a /albaranes, sin apuntarlo como acceso denegado", async () => {
    h.permisos = permisosDe("albaranes");
    rutas("/dashboard");
    expect(await screen.findByText("Subir albaranes")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/albaranes");
    expect(h.auditar).not.toHaveBeenCalled();
  });

  it("Facturas y Reservas lo rebotan a /albaranes (y eso sí se apunta)", async () => {
    h.permisos = permisosDe("albaranes");
    rutas("/facturas");
    expect(await screen.findByText("Subir albaranes")).toBeInTheDocument();
    expect(screen.queryByText("Página de Facturas")).toBeNull();
    expect(h.auditar).toHaveBeenCalledWith("/facturas");
  });
});

describe("tipo «Reservas»", () => {
  it("el menú enseña solo Reservas (y Nueva petición y Ayuda, que son de todos)", () => {
    h.permisos = permisosDe("reservas");
    expect(menu()).toEqual(["/reservas", "/peticiones", "/ayuda"]);
  });

  it("al entrar (/dashboard) va directo a /reservas, sin apuntarlo como acceso denegado", async () => {
    h.permisos = permisosDe("reservas");
    rutas("/dashboard");
    expect(await screen.findByText("Página de Reservas")).toBeInTheDocument();
    expect(h.auditar).not.toHaveBeenCalled();
  });

  it("/albaranes no le deja entrar", async () => {
    h.permisos = permisosDe("reservas");
    rutas("/albaranes");
    expect(await screen.findByText("Página de Reservas")).toBeInTheDocument();
    expect(screen.queryByText("Subir albaranes")).toBeNull();
  });
});

describe("«Subir albaranes» en el menú de los demás", () => {
  it("el super admin no la ve en el menú (tiene Cargar en Facturas), aunque puede abrirla", () => {
    h.superAdmin = true;
    expect(menu()).not.toContain("/albaranes");
  });

  it("quien tiene Facturas no la ve", () => {
    h.permisos = [{ section_key: "facturas", can_view: true, can_edit: true }];
    expect(menu()).not.toContain("/albaranes");
  });
});
