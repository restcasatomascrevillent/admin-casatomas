/**
 * Regresión (03/10/2026): volver a la pestaña/app (p. ej. de la cámara al subir
 * una factura en la tablet) hace que supabase-js emita SIGNED_IN /
 * TOKEN_REFRESHED para el MISMO usuario. AuthProvider guardaba un objeto `user`
 * nuevo en cada evento; UserRoleProvider y SuperAdminProvider dependían de la
 * identidad de ese objeto, ponían loading=true y ProtectedRoute pintaba el
 * spinner DESMONTANDO la página (se perdían formularios y diálogos a medias).
 *
 * Aquí se usan los providers REALES (AuthProvider + UserRoleProvider +
 * SuperAdminProvider + ProtectedRoute) y solo se simula el cliente Supabase.
 * Las consultas de rol/permisos/super_admins se pueden dejar "colgadas" a
 * propósito: si un refresco las relanza, el spinner se queda a la vista.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { useEffect, useState } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

interface SesionFalsa {
  access_token: string;
  user: {
    id: string;
    email: string;
    app_metadata: object;
    user_metadata: object;
    aud: string;
    created_at: string;
  };
}

const estado = vi.hoisted(() => ({
  callback: null as null | ((evento: string, sesion: unknown) => void),
  /** Si es true, las consultas a user_roles / user_permissions / super_admins no resuelven nunca. */
  colgarConsultas: false,
  consultasRol: [] as string[],
  sesionActual: null as null | {
    access_token: string;
    user: Record<string, unknown> & { id: string };
  },
}));

vi.mock("sonner");

vi.mock("@/integrations/supabase/client", () => {
  const respuesta = <T,>(valor: T) =>
    estado.colgarConsultas ? new Promise<never>(() => {}) : Promise.resolve(valor);

  const crearBuilder = (tabla: string) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (columna: string, valor: string) => {
      if (tabla === "user_roles" && columna === "user_id") estado.consultasRol.push(valor);
      return b;
    };
    b.single = () => respuesta({ data: { role: "staff" }, error: null });
    b.maybeSingle = () => respuesta({ data: null, error: null });
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      respuesta({
        data: [{ section_key: "dashboard", can_view: true, can_edit: false }],
        error: null,
      }).then(ok, ko);
    return b;
  };

  return {
    supabase: {
      rpc: vi.fn().mockResolvedValue({ data: "audit-1", error: null }),
      from: (tabla: string) => crearBuilder(tabla),
      auth: {
        // Objeto NUEVO en cada llamada, como hace GoTrue al validar el token.
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
        signUp: vi.fn(),
        signInWithPassword: vi.fn(),
      },
      functions: { invoke: vi.fn() },
      // AuthProvider se suscribe por Realtime a `user_access_status` para
      // cerrar la sesión de un usuario bloqueado (bloqueo de acceso). Sin
      // estos dos métodos el efecto lanzaba y la página protegida no llegaba
      // a montarse en el test.
      channel: vi.fn(() => {
        const canal = { on: () => canal, subscribe: () => canal };
        return canal;
      }),
      removeChannel: vi.fn(async () => "ok"),
    },
  };
});

import { AuthProvider } from "@/hooks/useAuth";
import { UserRoleProvider } from "@/hooks/useUserRole";
import { SuperAdminProvider } from "@/hooks/useSuperAdmin";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const crearSesion = (id: string, token = "token-1"): SesionFalsa => ({
  access_token: token,
  user: {
    id,
    email: `${id}@example.test`,
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
  },
});

let montajes = 0;
let desmontajes = 0;

function Formulario() {
  const [texto, setTexto] = useState("");
  useEffect(() => {
    montajes++;
    return () => {
      desmontajes++;
    };
  }, []);
  return <input aria-label="nota" value={texto} onChange={(e) => setTexto(e.target.value)} />;
}

function App() {
  return (
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AuthProvider>
        <UserRoleProvider>
          <SuperAdminProvider>
            <Routes>
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <Formulario />
                  </ProtectedRoute>
                }
              />
              <Route path="/auth" element={<div>pantalla-auth</div>} />
            </Routes>
          </SuperAdminProvider>
        </UserRoleProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

const hayEspera = () => document.querySelector(".animate-spin") !== null;

async function montarYEscribir() {
  estado.sesionActual = crearSesion("usuario-1");
  render(<App />);
  const input = (await screen.findByLabelText("nota")) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "factura a medias" } });
  expect((screen.getByLabelText("nota") as HTMLInputElement).value).toBe("factura a medias");
  return input;
}

async function emitir(evento: string, sesion: SesionFalsa | null) {
  await act(async () => {
    estado.callback?.(evento, sesion);
    // deja resolver getUser() y los setState encadenados
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe("refrescos de sesión del MISMO usuario no desmontan la página protegida", () => {
  beforeEach(() => {
    montajes = 0;
    desmontajes = 0;
    estado.callback = null;
    estado.colgarConsultas = false;
    estado.consultasRol = [];
    estado.sesionActual = null;
  });

  it.each(["SIGNED_IN", "TOKEN_REFRESHED"])(
    "%s con el mismo user.id: sin spinner, sin remontar y conservando el estado del hijo",
    async (evento) => {
      const inputInicial = await montarYEscribir();
      expect(montajes).toBe(1);
      const consultasIniciales = estado.consultasRol.length;

      // Cualquier consulta de rol/permisos/super_admin que se relance se queda colgada:
      // con el bug el spinner no se iría nunca.
      estado.colgarConsultas = true;
      await emitir(evento, crearSesion("usuario-1", "token-2"));

      expect(hayEspera()).toBe(false);
      const input = screen.getByLabelText("nota") as HTMLInputElement;
      expect(input).toBe(inputInicial); // mismo nodo DOM: no se remontó
      expect(input.value).toBe("factura a medias");
      expect(montajes).toBe(1);
      expect(desmontajes).toBe(0);
      expect(estado.consultasRol.length).toBe(consultasIniciales); // no se vuelve a pedir el rol
    },
  );

  it("varios refrescos seguidos (SIGNED_IN, TOKEN_REFRESHED, SIGNED_IN) tampoco desmontan", async () => {
    await montarYEscribir();
    estado.colgarConsultas = true;
    await emitir("SIGNED_IN", crearSesion("usuario-1", "t2"));
    await emitir("TOKEN_REFRESHED", crearSesion("usuario-1", "t3"));
    await emitir("SIGNED_IN", crearSesion("usuario-1", "t4"));
    expect(hayEspera()).toBe(false);
    expect((screen.getByLabelText("nota") as HTMLInputElement).value).toBe("factura a medias");
    expect(desmontajes).toBe(0);
  });

  it("un cambio REAL de usuario sí recarga roles y permisos (con spinner)", async () => {
    await montarYEscribir();
    estado.colgarConsultas = true;
    estado.sesionActual = crearSesion("usuario-2");
    await emitir("SIGNED_IN", estado.sesionActual as unknown as SesionFalsa);

    expect(hayEspera()).toBe(true);
    expect(screen.queryByLabelText("nota")).toBeNull();
    expect(estado.consultasRol).toContain("usuario-2");
  });

  it("SIGNED_OUT redirige a /auth", async () => {
    await montarYEscribir();
    estado.sesionActual = null;
    await emitir("SIGNED_OUT", null);
    await waitFor(() => expect(screen.getByText("pantalla-auth")).toBeTruthy());
    expect(screen.queryByLabelText("nota")).toBeNull();
  });
});
