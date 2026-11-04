/**
 * Plantillas email en Reservas › Configuración (04/11/2026): quién puede editarlas.
 *
 * La regla es la del backend, `can_write_section('reservas')` (RLS de `plantillas_email_reserva`,
 * `fn_restaurar_version_plantilla` y POST /emails-reserva/enviar-prueba): super admin, o «Puede editar»
 * en Reservas. Con solo «Ver» se leen sin poder tocarlas. Ser «admin» NO basta: antes el editor
 * aceptaba `isAdmin` y a un admin sin «Puede editar» le ofrecía guardar lo que la base de datos rechazaba.
 *
 * Se usan el `UserRoleProvider` y el `useCanAccessSection` REALES (solo se simulan Supabase, la sesión y
 * el «¿es super admin?»), para probar la regla de verdad y no una copia.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  rol: "staff" as string | null,
  permisos: [] as Array<{ section_key: string; can_view: boolean; can_edit: boolean }>,
  superAdmin: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => ({
      select: () => ({
        eq: () => {
          const resultado =
            tabla === "user_roles"
              ? { data: h.rol ? { role: h.rol } : null, error: null }
              : { data: h.permisos, error: null };
          return {
            single: async () => resultado,
            then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resultado).then(ok, ko),
          };
        },
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u-1", email: "sala@casatomas.test" }, loading: false }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({
  useSuperAdmin: () => ({ isSuperAdmin: h.superAdmin, loading: false }),
}));
// Cada pestaña monta su editor (con consultas a la BD): aquí basta ver qué permiso le llega.
vi.mock("../PlantillaTipoEditor", () => ({
  PlantillaTipoEditor: ({ tipo, puedeEditar }: { tipo: string; puedeEditar: boolean }) => (
    <div data-testid={`editor-${tipo}`} data-puede-editar={String(puedeEditar)} />
  ),
}));

import { UserRoleProvider } from "@/hooks/useUserRole";
import { EditorPlantillasEmail } from "../EditorPlantillasEmail";

async function montar() {
  render(
    <UserRoleProvider>
      <EditorPlantillasEmail />
    </UserRoleProvider>,
  );
  // La primera pestaña (Solicitud recibida) es la que se ve al entrar.
  return screen.findByTestId("editor-solicitud_recibida");
}

beforeEach(() => {
  h.rol = "staff";
  h.permisos = [];
  h.superAdmin = false;
});

describe("EditorPlantillasEmail · permisos de la sección «reservas»", () => {
  it("con «Puede editar» en Reservas se edita (sin aviso de solo lectura), aunque no sea admin", async () => {
    h.rol = "manager";
    h.permisos = [{ section_key: "reservas", can_view: true, can_edit: true }];
    const editor = await montar();

    expect(editor).toHaveAttribute("data-puede-editar", "true");
    expect(screen.queryByText("Solo lectura")).not.toBeInTheDocument();
  });

  it("con solo «Ver» en Reservas se leen pero no se editan, y se explica por qué", async () => {
    h.permisos = [{ section_key: "reservas", can_view: true, can_edit: false }];
    const editor = await montar();

    expect(editor).toHaveAttribute("data-puede-editar", "false");
    expect(screen.getByText("Solo lectura")).toBeInTheDocument();
    expect(screen.getByText(/no tiene permiso de edición en Reservas/)).toBeInTheDocument();
    // Se siguen viendo todas las plantillas.
    expect(screen.getAllByRole("tab")).toHaveLength(6);
  });

  it("ser admin no basta: un admin sin «Puede editar» en Reservas solo las lee (como manda la RLS)", async () => {
    h.rol = "admin";
    h.permisos = [{ section_key: "reservas", can_view: true, can_edit: false }];
    const editor = await montar();

    expect(editor).toHaveAttribute("data-puede-editar", "false");
    expect(screen.getByText("Solo lectura")).toBeInTheDocument();
  });

  it("«Puede editar» de OTRA sección no sirve", async () => {
    h.rol = "admin";
    h.permisos = [
      { section_key: "reservas", can_view: true, can_edit: false },
      { section_key: "cheques", can_view: true, can_edit: true },
    ];
    const editor = await montar();

    expect(editor).toHaveAttribute("data-puede-editar", "false");
  });

  it("el super admin las edita aunque no tenga filas de permisos", async () => {
    h.rol = "admin";
    h.superAdmin = true;
    const editor = await montar();

    expect(editor).toHaveAttribute("data-puede-editar", "true");
    expect(screen.queryByText("Solo lectura")).not.toBeInTheDocument();
  });

  it("enseña en una línea qué se edita, con el número real de correos", async () => {
    await montar();

    const ayuda = screen.getByText(/de los 6 correos de reserva/);
    expect(ayuda).toHaveClass("truncate");
    expect(ayuda).toHaveAttribute("title", expect.stringMatching(/El diseño es fijo/));
  });
});
