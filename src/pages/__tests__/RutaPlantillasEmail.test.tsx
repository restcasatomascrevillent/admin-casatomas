/**
 * La ruta vieja /super-admin/plantillas-email (marcadores, enlaces antiguos) lleva a Reservas ›
 * Configuración › Plantillas email (04/11/2026). Se monta el `App` real, con sus rutas; solo se simulan
 * los proveedores (sesión, rol, super admin), las colas de fondo y las páginas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ rutaSuperAdmin: vi.fn() }));
// En `vi.hoisted`: los `vi.mock` de abajo suben por encima de cualquier otra línea del fichero.
const { pasa } = vi.hoisted(() => ({ pasa: ({ children }: { children: ReactNode }) => children }));

vi.mock("@/hooks/useAuth", () => ({ AuthProvider: pasa }));
vi.mock("@/hooks/useUserRole", () => ({ UserRoleProvider: pasa }));
vi.mock("@/hooks/useSuperAdmin", () => ({ SuperAdminProvider: pasa }));
vi.mock("@/components/ProtectedRoute", () => ({ ProtectedRoute: pasa }));
vi.mock("@/components/SuperAdminRoute", () => ({
  SuperAdminRoute: ({ children }: { children: ReactNode }) => {
    h.rutaSuperAdmin();
    return <>{children}</>;
  },
}));
// El marco del panel (menú y cabecera, montado una vez desde el 07/11/2026): aquí solo hace falta el contenido.
vi.mock("@/components/PanelLayout", async () => {
  const { Outlet } = await import("react-router-dom");
  return { PanelLayout: () => <Outlet />, CargandoContenido: () => null };
});
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/carta/potente/AvisoTrabajosVideo", () => ({ AvisoTrabajosVideo: () => null }));
vi.mock("@/components/carta/recorte/GestorRecortes", () => ({ GestorRecortes: () => null }));
vi.mock("@/hooks/useVisualViewportVars", () => ({ useVisualViewportVars: () => {} }));
vi.mock("@/components/facturas/ColaSubidaProvider", () => ({ ColaSubidaProvider: pasa }));
vi.mock("@/components/carta/video/ColaVideosProvider", () => ({ ColaVideosProvider: pasa }));
vi.mock("@/pages/Auth", () => ({ default: () => null }));
vi.mock("@/pages/Reservas", () => ({
  default: function ReservasFalsa() {
    const { pathname, search } = useLocation();
    return <output data-testid="reservas">{pathname + search}</output>;
  },
}));

import App from "@/App";

beforeEach(() => {
  h.rutaSuperAdmin.mockClear();
});

describe("ruta vieja de Plantillas Email", () => {
  it("/super-admin/plantillas-email redirige a Reservas › Configuración › Plantillas email", async () => {
    window.history.pushState({}, "", "/super-admin/plantillas-email");
    render(<App />);

    expect(await screen.findByTestId("reservas")).toHaveTextContent("/reservas?tab=configuracion&sub=plantillas");
    expect(window.location.pathname).toBe("/reservas");
    // Ya no pasa por la barrera del Super Admin: entra quien tenga acceso a Reservas.
    expect(h.rutaSuperAdmin).not.toHaveBeenCalled();
  });
});
