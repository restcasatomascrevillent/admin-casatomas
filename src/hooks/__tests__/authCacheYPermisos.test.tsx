/**
 * CT-REM-FE-01: la caché de TanStack Query se vacía al cerrar sesión y al
 * cambiar de cuenta, ANTES de pintar la nueva sesión.
 * CT-REM-FE-02: un cambio de permisos se aplica sin recargar (TOKEN_REFRESHED
 * o sondeo de revalidación) y la ruta protegida se cierra.
 *
 * Providers REALES; solo se simula el cliente Supabase.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const estado = vi.hoisted(() => ({
  callback: null as null | ((evento: string, sesion: unknown) => void),
  sesionActual: null as null | { access_token: string; user: Record<string, unknown> & { id: string } },
  permisos: [{ section_key: "facturas", can_view: true, can_edit: false }] as {
    section_key: string;
    can_view: boolean;
    can_edit: boolean;
  }[],
}));

vi.mock("sonner");

vi.mock("@/integrations/supabase/client", () => {
  const crearBuilder = (tabla: string) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.single = () => Promise.resolve({ data: { role: "staff" }, error: null });
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: tabla === "user_permissions" ? estado.permisos : [], error: null }).then(ok, ko);
    return b;
  };
  return {
    supabase: {
      rpc: vi.fn().mockResolvedValue({ data: "audit-1", error: null }),
      from: (tabla: string) => crearBuilder(tabla),
      auth: {
        getUser: vi.fn(async () => {
          const s = estado.sesionActual;
          return { data: { user: s ? { ...s.user } : null }, error: null };
        }),
        getSession: vi.fn(async () => ({ data: { session: estado.sesionActual }, error: null })),
        onAuthStateChange: vi.fn((cb: (e: string, s: unknown) => void) => {
          estado.callback = cb;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
        signOut: vi.fn(async () => ({ error: null })),
      },
      functions: { invoke: vi.fn() },
      channel: vi.fn(() => {
        const canal = { on: () => canal, subscribe: () => canal };
        return canal;
      }),
      removeChannel: vi.fn(async () => "ok"),
    },
  };
});

import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { UserRoleProvider } from "@/hooks/useUserRole";
import { SuperAdminProvider } from "@/hooks/useSuperAdmin";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { emitirRevalidacionSesion } from "@/lib/revalidacion-sesion";

const sesion = (id: string) => ({
  access_token: `t-${id}`,
  user: {
    id,
    email: `${id}@example.test`,
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  },
});

const emitir = async (evento: string, s: unknown) => {
  await act(async () => {
    estado.callback?.(evento, s);
    await new Promise((r) => setTimeout(r, 30));
  });
};

/** Pinta lo que la caché contiene bajo ["facturas"]; la query nunca resuelve sola. */
function Datos() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["facturas"],
    queryFn: () => new Promise<string>(() => {}),
    staleTime: Infinity,
  });
  return (
    <div>
      <span data-testid="quien">{user?.id}</span>
      <span data-testid="datos">{q.data ?? "vacio"}</span>
    </div>
  );
}

function montar(qc: QueryClient, ruta = "/facturas") {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[ruta]}>
        <AuthProvider queryClient={qc}>
          <UserRoleProvider>
            <SuperAdminProvider>
              <Routes>
                <Route
                  path="/facturas"
                  element={
                    <ProtectedRoute requiredSection="facturas">
                      <Datos />
                    </ProtectedRoute>
                  }
                />
                <Route path="/dashboard" element={<div>pantalla-dashboard</div>} />
                <Route path="/auth" element={<div>pantalla-auth</div>} />
              </Routes>
            </SuperAdminProvider>
          </UserRoleProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("FE-01: caché fuera al cerrar sesión / cambiar de cuenta", () => {
  beforeEach(() => {
    estado.callback = null;
    estado.sesionActual = null;
    estado.permisos = [{ section_key: "facturas", can_view: true, can_edit: false }];
  });

  it("los datos del usuario A no se ven tras entrar B", async () => {
    const qc = new QueryClient();
    estado.sesionActual = sesion("usuario-a");
    montar(qc);
    await screen.findByTestId("datos");
    act(() => {
      qc.setQueryData(["facturas"], "FACTURAS-DE-A");
    });
    await waitFor(() => expect(screen.getByTestId("datos").textContent).toBe("FACTURAS-DE-A"));

    estado.sesionActual = sesion("usuario-b");
    await emitir("SIGNED_IN", estado.sesionActual);

    await waitFor(() => expect(screen.getByTestId("quien").textContent).toBe("usuario-b"));
    expect(screen.getByTestId("datos").textContent).toBe("vacio");
    expect(qc.getQueryData(["facturas"])).toBeUndefined();
  });

  it("SIGNED_OUT deja la caché vacía", async () => {
    const qc = new QueryClient();
    estado.sesionActual = sesion("usuario-a");
    montar(qc);
    await screen.findByTestId("datos");
    act(() => {
      qc.setQueryData(["facturas"], "FACTURAS-DE-A");
    });
    estado.sesionActual = null;
    await emitir("SIGNED_OUT", null);
    await waitFor(() => expect(screen.getByText("pantalla-auth")).toBeTruthy());
    // Un observador aún montado puede recrear la entrada VACÍA; lo que no puede
    // quedar es ningún dato del usuario anterior.
    expect(qc.getQueryCache().getAll().every((q) => q.state.data === undefined)).toBe(true);
    expect(qc.getQueryData(["facturas"])).toBeUndefined();
  });

  it("un refresco de token del MISMO usuario conserva la caché", async () => {
    const qc = new QueryClient();
    estado.sesionActual = sesion("usuario-a");
    montar(qc);
    await screen.findByTestId("datos");
    act(() => {
      qc.setQueryData(["facturas"], "FACTURAS-DE-A");
    });
    await emitir("TOKEN_REFRESHED", sesion("usuario-a"));
    expect(qc.getQueryData(["facturas"])).toBe("FACTURAS-DE-A");
  });
});

describe("FE-02: cambio de permisos sin recargar", () => {
  beforeEach(() => {
    estado.callback = null;
    estado.sesionActual = sesion("usuario-a");
    estado.permisos = [
      { section_key: "facturas", can_view: true, can_edit: false },
      { section_key: "dashboard", can_view: true, can_edit: false },
    ];
  });

  it("TOKEN_REFRESHED relee permisos y la ruta se cierra", async () => {
    montar(new QueryClient());
    await screen.findByTestId("datos");

    estado.permisos = [{ section_key: "dashboard", can_view: true, can_edit: false }];
    await emitir("TOKEN_REFRESHED", sesion("usuario-a"));

    await waitFor(() => expect(screen.queryByTestId("datos")).toBeNull());
  });

  it("la revalidación periódica (sondeo/foco) también aplica el cambio", async () => {
    montar(new QueryClient());
    await screen.findByTestId("datos");

    estado.permisos = [{ section_key: "dashboard", can_view: true, can_edit: false }];
    await act(async () => {
      emitirRevalidacionSesion();
      await new Promise((r) => setTimeout(r, 30));
    });

    await waitFor(() => expect(screen.queryByTestId("datos")).toBeNull());
  });
});
