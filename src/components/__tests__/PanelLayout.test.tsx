// Marco del panel montado UNA vez (07/11/2026, pregunta del dueño: «¿por qué cuando cambio de sección se recarga
// toda la página y no solo la parte de la derecha?»). Al navegar entre secciones el menú lateral no se vuelve a
// montar y solo cambia el contenido.
import { act, render, screen } from "@testing-library/react";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const montajes = { menu: 0 };
let navegar: ReturnType<typeof useNavigate> | null = null;

vi.mock("@/components/AppSidebar", () => ({
  AppSidebar: () => {
    useEffect(() => {
      montajes.menu += 1;
    }, []);
    navegar = useNavigate();
    return <nav aria-label="Menú lateral">menú</nav>;
  },
}));
vi.mock("@/components/notificaciones/CentroNotificaciones", () => ({
  CentroNotificaciones: () => <button type="button">Notificaciones</button>,
}));
vi.mock("@/components/carta/recorte/PrecargaRecorte", () => ({ PrecargaRecorte: () => null }));
vi.mock("@/components/notificaciones/AvisosEnVivo", () => ({ AvisosEnVivo: () => null }));
vi.mock("@/components/NavAutoCollapse", () => ({ NavAutoCollapse: () => null, defaultSidebarOpen: () => true }));
vi.mock("@/lib/audit-access", () => ({ auditDeniedAccess: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: false, loading: false }) }));
// Interruptores de Control del Panel (ProtectedRoute los mira desde el 14/11/2026): todo activado, sin red.
vi.mock("@/hooks/useAdminFeatureToggles", () => ({ useAdminFeatureToggles: () => ({ isEnabled: () => true, loading: false }) }));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({
    isAdmin: false,
    loading: false,
    permissions: [
      { section_key: "reservas", can_view: true },
      { section_key: "facturas", can_view: true },
    ],
  }),
}));

import { DashboardLayout } from "@/components/DashboardLayout";
import { PanelLayout } from "@/components/PanelLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const Reservas = () => (
  <DashboardLayout sinCabeceraMovil>
    <h1>Página Reservas</h1>
  </DashboardLayout>
);
const Facturas = () => (
  <DashboardLayout>
    <h1>Página Facturas</h1>
  </DashboardLayout>
);
let soltarAyuda: () => void = () => {};
// Una sección «perezosa» como las de App.tsx (lazy + Suspense en la zona de contenido).
const AyudaPerezosa = lazy(
  () =>
    new Promise<{ default: () => JSX.Element }>((resolver) => {
      soltarAyuda = () =>
        resolver({
          default: () => (
            <DashboardLayout>
              <h1>Página Ayuda</h1>
            </DashboardLayout>
          ),
        });
    }),
);

const pagina = (contenido: ReactNode, seccion?: string) => (
  <ProtectedRoute requiredSection={seccion as never}>
    <Suspense fallback={<p>cargando sección</p>}>{contenido}</Suspense>
  </ProtectedRoute>
);

const montar = (inicio = "/reservas") =>
  render(
    <MemoryRouter initialEntries={[inicio]}>
      <Routes>
        <Route
          element={
            <ProtectedRoute requiredSection={[]}>
              <PanelLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/reservas" element={pagina(<Reservas />, "reservas")} />
          <Route path="/facturas" element={pagina(<Facturas />, "facturas")} />
          <Route path="/ayuda" element={pagina(<AyudaPerezosa />)} />
          {/* Sin permiso (no hay «cheques» en los permisos): rebota a la primera sección que sí ve. */}
          <Route path="/cheques" element={pagina(<h1>Página Cheques</h1>, "cheques")} />
        </Route>
        <Route path="/auth" element={<p>acceso</p>} />
      </Routes>
    </MemoryRouter>,
  );

const ancho = (px: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: px });

beforeEach(() => {
  montajes.menu = 0;
  navegar = null;
  ancho(1440);
});

describe("PanelLayout: ruta de layout del panel", () => {
  it("al cambiar de sección el menú se monta una sola vez y solo cambia el contenido", async () => {
    montar();
    expect(screen.getByRole("heading", { name: "Página Reservas" })).toBeInTheDocument();
    expect(montajes.menu).toBe(1);
    const menu = screen.getByRole("navigation", { name: "Menú lateral" });

    await act(async () => navegar!("/facturas"));
    expect(screen.getByRole("heading", { name: "Página Facturas" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Página Reservas" })).toBeNull();

    await act(async () => navegar!("/reservas"));
    expect(screen.getByRole("heading", { name: "Página Reservas" })).toBeInTheDocument();

    expect(montajes.menu).toBe(1);
    // El MISMO nodo del menú: no se ha desmontado y vuelto a montar.
    expect(screen.getByRole("navigation", { name: "Menú lateral" })).toBe(menu);
    // Un solo marco: el <DashboardLayout> de cada página no pinta otro <main>.
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("mientras baja el fichero de una sección, el «cargando» va dentro del contenido y el menú sigue", async () => {
    montar();
    const menu = screen.getByRole("navigation", { name: "Menú lateral" });
    await act(async () => navegar!("/ayuda"));
    expect(screen.getByText("cargando sección")).toBeInTheDocument();
    expect(screen.getByRole("main")).toContainElement(screen.getByText("cargando sección"));
    expect(screen.getByRole("navigation", { name: "Menú lateral" })).toBe(menu);

    await act(async () => soltarAyuda());
    expect(await screen.findByRole("heading", { name: "Página Ayuda" })).toBeInTheDocument();
    expect(montajes.menu).toBe(1);
  });

  it("una sección sin permiso rebota a otra sin desmontar el menú", async () => {
    montar();
    await act(async () => navegar!("/cheques"));
    expect(screen.queryByRole("heading", { name: "Página Cheques" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Página Reservas" })).toBeInTheDocument();
    expect(montajes.menu).toBe(1);
  });

  it("las opciones de la página (`sinCabeceraMovil`) llegan al marco y se quitan al salir", async () => {
    ancho(375);
    montar();
    // Reservas en móvil: sin la barra superior.
    expect(screen.queryByRole("banner")).toBeNull();
    await act(async () => navegar!("/facturas"));
    expect(screen.getByRole("banner")).toBeInTheDocument();
    await act(async () => navegar!("/reservas"));
    expect(screen.queryByRole("banner")).toBeNull();
  });
});
