/**
 * «Pestaña al iniciar sesión» (11/11/2026) en las rutas: al entrar (raíz, o /dashboard desde el acceso) se abre
 * la pestaña guardada si el usuario la ve; sin elección o sin permiso, todo como siempre (ProtectedRoute incluido).
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  permisos: [] as { section_key: string; can_view: boolean; can_edit: boolean }[],
  superAdmin: false,
  guardada: null as string | null,
  fallaLectura: false,
  lecturas: 0,
}));
vi.mock("@/lib/audit-access", () => ({ auditDeniedAccess: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u-1", email: "camarero@casatomas.test" }, loading: false }),
}));
vi.mock("@/hooks/useUserRole", async (original) => ({
  ...(await original<typeof import("@/hooks/useUserRole")>()),
  useUserRole: () => ({ isAdmin: false, role: "staff", loading: false, verificado: true, permissions: h.permisos }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({
  useSuperAdmin: () => ({ isSuperAdmin: h.superAdmin, loading: false, verificado: true }),
}));
vi.mock("@/hooks/useAdminFeatureToggles", () => ({ useAdminFeatureToggles: () => ({ isEnabled: () => true, loading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => {
          h.lecturas += 1;
          if (tabla !== "user_pestana_inicial") return { data: null, error: null };
          if (h.fallaLectura) return { data: null, error: { code: "42P01", message: "no existe" } };
          return { data: h.guardada ? { ruta: h.guardada } : null, error: null };
        },
      };
      return q;
    },
  },
}));

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AbrirPestanaInicial } from "@/components/AbrirPestanaInicial";
import { ESTADO_INICIO_SESION } from "@/lib/pestanaInicial";

const ver = (...s: string[]) => s.map((section_key) => ({ section_key, can_view: true, can_edit: false }));

function Donde() {
  const l = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="donde">{l.pathname}</output>
      <button onClick={() => navigate("/")}>Ir a la raíz</button>
    </>
  );
}

function montar(inicial: string, state?: unknown) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[{ pathname: inicial, state }]}>
        <Donde />
        <AbrirPestanaInicial />
        <Routes>
          <Route path="/" element={<ProtectedRoute><p>Dashboard</p></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><p>Dashboard</p></ProtectedRoute>} />
          <Route path="/reservas" element={<ProtectedRoute><p>Reservas</p></ProtectedRoute>} />
          <Route path="/facturas" element={<ProtectedRoute><p>Facturas</p></ProtectedRoute>} />
          <Route path="/cheques" element={<ProtectedRoute requiredSection="cheques"><p>Cheques</p></ProtectedRoute>} />
          <Route path="/ayuda" element={<p>Ayuda</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const donde = () => screen.getByTestId("donde").textContent;
/** Deja correr los efectos y la lectura (promesas) sin depender de tiempos. */
const asentar = () => waitFor(() => expect(h.lecturas).toBeGreaterThan(0));

beforeEach(() => {
  h.permisos = ver("dashboard", "reservas", "facturas");
  h.superAdmin = false;
  h.guardada = null;
  h.fallaLectura = false;
  h.lecturas = 0;
});

describe("AbrirPestanaInicial", () => {
  it("al iniciar sesión (/dashboard marcado) abre la pestaña elegida", async () => {
    h.guardada = "/reservas";
    montar("/dashboard", ESTADO_INICIO_SESION);
    await waitFor(() => expect(donde()).toBe("/reservas"));
  });

  it("al entrar en la raíz también", async () => {
    h.guardada = "/facturas";
    montar("/");
    await waitFor(() => expect(donde()).toBe("/facturas"));
  });

  it("sin elección se queda donde siempre", async () => {
    montar("/dashboard", ESTADO_INICIO_SESION);
    await asentar();
    await new Promise((r) => setTimeout(r, 20));
    expect(donde()).toBe("/dashboard");
  });

  it("con una elección que ya no ve, se queda donde siempre", async () => {
    h.guardada = "/cheques";
    montar("/dashboard", ESTADO_INICIO_SESION);
    await asentar();
    await new Promise((r) => setTimeout(r, 20));
    expect(donde()).toBe("/dashboard");
  });

  it("si la lectura falla (p. ej. sin la migración), como siempre", async () => {
    h.guardada = "/reservas";
    h.fallaLectura = true;
    montar("/dashboard", ESTADO_INICIO_SESION);
    await asentar();
    await new Promise((r) => setTimeout(r, 20));
    expect(donde()).toBe("/dashboard");
  });

  it("sin Dashboard: ProtectedRoute lleva a la primera que ve y después se abre la elegida", async () => {
    h.permisos = ver("reservas", "facturas");
    h.guardada = "/facturas";
    montar("/dashboard", ESTADO_INICIO_SESION);
    await waitFor(() => expect(donde()).toBe("/facturas"));
  });

  it("sin Dashboard ni elección, sigue el comportamiento de siempre (primera que ve)", async () => {
    h.permisos = ver("reservas", "facturas");
    montar("/dashboard", ESTADO_INICIO_SESION);
    await waitFor(() => expect(donde()).toBe("/reservas"));
    await new Promise((r) => setTimeout(r, 20));
    expect(donde()).toBe("/reservas");
  });

  it("un /dashboard sin marca (menú, marcador) no es entrada: no se lee ni se mueve", async () => {
    h.guardada = "/reservas";
    montar("/dashboard");
    await new Promise((r) => setTimeout(r, 20));
    expect(donde()).toBe("/dashboard");
    expect(h.lecturas).toBe(0);
  });

  it("navegar entre secciones no la vuelve a abrir; volver a la raíz sí (es entrar)", async () => {
    h.guardada = "/reservas";
    montar("/reservas");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.lecturas).toBe(0);
    fireEvent.click(screen.getByText("Ir a la raíz"));
    await waitFor(() => expect(donde()).toBe("/reservas"));
    expect(h.lecturas).toBe(1);
  });
});
