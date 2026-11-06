/**
 * Newsletter con solo «Ver» (decisión del dueño, 06/11/2026): se consultan suscriptores, campañas (el
 * historial de envíos) y estadísticas. No se crea ni se envía nada (la pestaña «Enviar Newsletter»
 * desaparece) y la lista de envío no se actualiza (el botón «Actualizar» desaparece, y tampoco se
 * actualiza sola). Arriba, junto a las pestañas, la etiqueta común «Solo lectura». Con «Editar», o
 * siendo super admin, todo sigue como siempre. Instagram va aparte (/instagram) y no cambia.
 *
 * Se usan el `UserRoleProvider` y el `useCanAccessSection` REALES (solo se simulan Supabase, la
 * sesión y el «¿es super admin?»).
 */
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  permisos: [] as Array<{ section_key: string; can_view: boolean; can_edit: boolean }>,
  superAdmin: false,
  sincronizar: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => ({
      select: () => ({
        eq: () => {
          const resultado = tabla === "user_roles" ? { data: { role: "staff" }, error: null } : { data: h.permisos, error: null };
          return {
            single: async () => resultado,
            then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resultado).then(ok, ko),
          };
        },
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u-1", email: "sala@casatomas.test" }, loading: false }) }));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: h.superAdmin, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/useAlturaDisponible", () => ({ useAlturaDisponible: () => 640 }));
vi.mock("@/components/marketing/CreadorNewsletter", () => ({ CreadorNewsletter: () => <p>Creador de prueba</p> }));
vi.mock("@/components/marketing/EstadisticasNewsletter", () => ({
  EstadisticasNewsletter: ({ historial }: { historial: ReactNode }) => <section>Estadísticas de prueba{historial}</section>,
}));
vi.mock("@/components/marketing/HistorialEnvios", () => ({ HistorialEnvios: () => <p>Historial de prueba</p> }));
// Suscriptores: la lista (solo lectura siempre) y la tarjeta real de la lista de envío.
vi.mock("@/hooks/useNewsletterSuscriptores", () => ({
  useNewsletterSuscriptores: () => ({
    suscriptores: [{ id: "s1", email: "cliente@x.es", nombre: "Cliente", origen_alta: "reserva_web" }],
    totalSuscriptores: 1,
    bajas: [],
    totalBajas: 0,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/useResendMarketing", () => ({
  useEstadoResend: () => ({
    isLoading: false,
    error: null,
    data: {
      success: true,
      canal: "broadcast",
      configurado: { api_key: true, segment_id: "seg-1", cron_secret: true },
      limite_contactos: 1000,
      contactos_resend: 3,
      nivel_cuota: "ok",
      // Nunca actualizada: con «Editar» se actualizaría sola al abrir; con solo «Ver», no.
      ultima_pasada: null,
      ultima_terminada: null,
    },
  }),
  useSincronizarResend: () => ({ mutate: h.sincronizar, isPending: false, variables: undefined }),
}));

import { UserRoleProvider } from "@/hooks/useUserRole";
import Marketing from "../Marketing";

beforeEach(() => {
  h.permisos = [];
  h.superAdmin = false;
  h.sincronizar.mockReset();
  window.history.replaceState(null, "", "/marketing");
});

const SOLO_VER = [{ section_key: "marketing", can_view: true, can_edit: false }];
const EDITAR = [{ section_key: "marketing", can_view: true, can_edit: true }];

async function montar() {
  render(
    <UserRoleProvider>
      <Marketing />
    </UserRoleProvider>,
  );
  // La barra de la página (Suscriptores trae otra, Activos / Dados de baja).
  await screen.findByRole("tab", { name: "Suscriptores" });
}

describe("Newsletter · solo «Ver»", () => {
  it("sin «Enviar Newsletter»: abre en Suscriptores, con la etiqueta «Solo lectura» junto a las pestañas", async () => {
    h.permisos = SOLO_VER;
    await montar();
    await waitFor(() => expect(screen.getByTestId("etiqueta-solo-lectura")).toBeInTheDocument());
    expect(screen.getByTestId("etiqueta-solo-lectura")).toHaveTextContent("Solo lectura");
    expect(screen.queryByRole("tab", { name: /Enviar Newsletter/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Creador de prueba")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Suscriptores" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: "Estadísticas" })).toBeInTheDocument();
    // La etiqueta va en la barra de pestañas de la página.
    const barra = screen.getByRole("tab", { name: "Suscriptores" }).closest("[role=tablist]")!;
    expect(barra.parentElement?.parentElement).toContainElement(screen.getByTestId("etiqueta-solo-lectura"));
  });

  it("los suscriptores y la lista de envío se consultan, pero sin «Actualizar» y sin actualizarse sola", async () => {
    h.permisos = SOLO_VER;
    await montar();
    expect(await screen.findByText("cliente@x.es")).toBeInTheDocument();
    expect(screen.getByText("Lista de envío")).toBeInTheDocument();
    expect(screen.getByText(/3 de 1\.000/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Actualizar/ })).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.sincronizar).not.toHaveBeenCalled();
  });

  it("aunque el enlace pida ?tab=crear, no se puede crear: abre Suscriptores", async () => {
    h.permisos = SOLO_VER;
    window.history.replaceState(null, "", "/marketing?tab=crear");
    await montar();
    await waitFor(() => expect(screen.getByTestId("etiqueta-solo-lectura")).toBeInTheDocument());
    expect(screen.queryByText("Creador de prueba")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Suscriptores" })).toHaveAttribute("data-state", "active");
  });
});

describe.each([
  ["«Editar» en Newsletter", () => { h.permisos = EDITAR; }],
  ["super admin (sin filas de permisos)", () => { h.superAdmin = true; }],
])("Newsletter · %s", (_caso, preparar) => {
  it("sin etiqueta, con «Enviar Newsletter» (la de entrada) y con «Actualizar» la lista de envío", async () => {
    preparar();
    await montar();
    expect(await screen.findByRole("tab", { name: /Enviar Newsletter/ })).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Creador de prueba")).toBeInTheDocument();
    expect(screen.queryByTestId("etiqueta-solo-lectura")).not.toBeInTheDocument();
  });

  it("en Suscriptores, «Actualizar» está y la lista nunca actualizada se actualiza sola", async () => {
    preparar();
    window.history.replaceState(null, "", "/marketing?tab=suscriptores");
    await montar();
    expect(await screen.findByRole("button", { name: /Actualizar lista de envío/ })).toBeInTheDocument();
    await waitFor(() => expect(h.sincronizar).toHaveBeenCalledWith({ automatica: true }));
  });
});
