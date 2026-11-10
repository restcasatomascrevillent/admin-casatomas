/**
 * Pantalla Usuarios → «Añadir Usuario» (InvitarUsuario): «Puede editar» al crear.
 *
 * El alta va por la Edge Function `admin-create-user`, que escribe los permisos con
 * la service role y respeta el `can_edit` que le llega. La puede llamar cualquier
 * admin (no solo un super admin), así que la regla se mantiene en el panel: un
 * usuario nuevo empieza SIN edición, y solo un super admin puede dársela al crearlo
 * (igual que solo un super admin puede cambiarla luego en «Permisos», por RLS).
 *
 * Supabase va mockeado (`__mocks__/client.ts`): se mira el `body` que se enviaría.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { UserRolePreset } from "@/hooks/useUserRolePresets";

const h = vi.hoisted(() => ({
  esSuperAdmin: true as boolean,
  presets: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({
  useSuperAdmin: () => ({ isSuperAdmin: h.esSuperAdmin, loading: false }),
}));
vi.mock("@/hooks/useUserRolePresets", () => ({
  useUserRolePresets: () => ({
    presets: h.presets,
    loading: false,
    createPreset: vi.fn(),
    updatePreset: vi.fn(),
    deletePreset: vi.fn(),
  }),
}));

import { supabase } from "@/integrations/supabase/client";
import { InvitarUsuario } from "@/components/usuarios/InvitarUsuario";
import { toast } from "sonner";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

type Fila = { section_key: string; can_view: boolean; can_edit: boolean };

const SALA: UserRolePreset = {
  id: "p-sala",
  name: "Sala",
  base_role: "staff",
  permissions: [
    { section_key: "dashboard", can_view: true, can_edit: false },
    { section_key: "reservas", can_view: true, can_edit: true },
  ],
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.esSuperAdmin = true;
  h.presets = [];
  vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: "x" } }, error: null } as never);
  vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { success: true, userId: "u-nuevo" }, error: null } as never);
});

const interruptor = (nombre: string) => screen.getByRole("switch", { name: nombre });

function rellenarYCrear() {
  fireEvent.change(screen.getByLabelText("Nombre de Usuario"), { target: { value: "camarero2" } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "prueba-123" } });
  fireEvent.click(screen.getByRole("button", { name: /Crear Usuario/ }));
}

async function permisosEnviados() {
  await waitFor(() => expect(supabase.functions.invoke).toHaveBeenCalledWith("admin-create-user", expect.anything()));
  const [, opciones] = vi.mocked(supabase.functions.invoke).mock.calls.find(([nombre]) => nombre === "admin-create-user")!;
  return (opciones as { body: { permissions: Fila[] } }).body.permissions;
}

const de = (filas: Fila[], clave: string) => filas.find((f) => f.section_key === clave);

async function elegirRol(nombre: string) {
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name: nombre }));
}

describe("InvitarUsuario · «Puede editar» al crear", () => {
  it("un usuario nuevo empieza sin edición en ninguna sección", async () => {
    render(<InvitarUsuario />);

    expect(screen.getAllByRole("switch", { name: /^Puede editar / }).every((s) => s.getAttribute("aria-checked") === "false")).toBe(true);
    rellenarYCrear();

    const filas = await permisosEnviados();
    expect(filas.every((f) => f.can_edit === false)).toBe(true);
    expect(de(filas, "dashboard")).toEqual({ section_key: "dashboard", can_view: true, can_edit: false });
  });

  it("un super admin puede darle edición al crearlo y viaja en el payload", async () => {
    render(<InvitarUsuario />);

    fireEvent.click(interruptor("Ver Reservas"));
    fireEvent.click(interruptor("Puede editar Reservas"));
    rellenarYCrear();

    expect(de(await permisosEnviados(), "reservas")).toEqual({ section_key: "reservas", can_view: true, can_edit: true });
  });

  it("«Puede editar» no se activa sin «Ver»", () => {
    render(<InvitarUsuario />);

    expect(interruptor("Puede editar Reservas")).toBeDisabled();
    fireEvent.click(interruptor("Ver Reservas"));
    expect(interruptor("Puede editar Reservas")).toBeEnabled();
  });

  it("quien no es super admin no puede dar edición al crear", async () => {
    h.esSuperAdmin = false;
    render(<InvitarUsuario />);

    fireEvent.click(interruptor("Ver Reservas"));
    expect(interruptor("Puede editar Reservas")).toBeDisabled();
    expect(screen.getByText(/solo un super admin puede conceder o retirar/i)).toBeInTheDocument();
    rellenarYCrear();

    const filas = await permisosEnviados();
    expect(de(filas, "reservas")).toEqual({ section_key: "reservas", can_view: true, can_edit: false });
  });

  it("un rol preconfigurado con edición la aplica si crea un super admin", async () => {
    h.presets = [SALA];
    render(<InvitarUsuario />);

    await elegirRol("Sala");
    expect(interruptor("Puede editar Reservas")).toBeChecked();
    rellenarYCrear();

    expect(de(await permisosEnviados(), "reservas")).toEqual({ section_key: "reservas", can_view: true, can_edit: true });
  });

  it("…pero no si crea quien no es super admin: se queda en «Ver»", async () => {
    h.esSuperAdmin = false;
    h.presets = [SALA];
    render(<InvitarUsuario />);

    await elegirRol("Sala");
    expect(interruptor("Puede editar Reservas")).not.toBeChecked();
    rellenarYCrear();

    expect(de(await permisosEnviados(), "reservas")).toEqual({ section_key: "reservas", can_view: true, can_edit: false });
  });
});

it("explica el alta duplicada y conserva el formulario para corregirlo", async () => {
  vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: null, error: { context: new Response(JSON.stringify({ error: "Este nombre de usuario ya está registrado" }), { status: 409 }) } } as never);
  render(<InvitarUsuario />);
  rellenarYCrear();
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Este nombre de usuario ya está registrado"));
  expect(screen.getByLabelText("Nombre de Usuario")).toHaveValue("camarero2");
  expect(toast.success).not.toHaveBeenCalled();
});

it("un alta normal creada cuyo acceso de superadmin falla muestra solo el aviso real", async () => {
  vi.mocked(supabase.functions.invoke).mockImplementation(async name => name === "admin-create-user"
    ? { data: { success: true, userId: "u-nuevo" }, error: null } as never
    : { data: null, error: { context: new Response(JSON.stringify({ error: "No se pudo conceder el acceso" }), { status: 500 }) } } as never);
  render(<InvitarUsuario allowSuperAdmin />);
  fireEvent.click(screen.getByRole("checkbox", { name: /Crear como Super Admin/ }));
  rellenarYCrear();
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Usuario creado, pero.*No se pudo conceder el acceso/)));
  expect(toast.success).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Nombre de Usuario")).toHaveValue("");
});

describe("InvitarUsuario · tipos de usuario «Reservas» y «Albaranes» (10/11/2026)", () => {
  const conAcceso = (filas: Fila[]) => filas.filter((f) => f.can_view || f.can_edit).map((f) => f.section_key);
  const rolEnviado = () => {
    const [, opciones] = vi.mocked(supabase.functions.invoke).mock.calls.find(([nombre]) => nombre === "admin-create-user")!;
    return (opciones as { body: { role: string } }).body.role;
  };

  it("«Reservas»: crea el usuario con solo «Ver» en Reservas y «Reservas · Crear», rol Staff", async () => {
    render(<InvitarUsuario />);
    await elegirRol("Reservas");
    expect(screen.getByTestId("ayuda-configuracion-acceso")).toHaveTextContent(/ver y crear reservas/);
    expect(interruptor("Puede crear: Reservas · Crear")).toBeChecked();
    expect(interruptor("Ver Dashboard")).not.toBeChecked();
    rellenarYCrear();

    const filas = await permisosEnviados();
    expect(conAcceso(filas)).toEqual(["reservas", "reservas_crear"]);
    expect(filas.every((f) => !f.can_edit)).toBe(true);
    expect(rolEnviado()).toBe("staff");
  });

  it("«Albaranes»: crea el usuario con solo «Facturas · Solo fotos», rol Staff", async () => {
    render(<InvitarUsuario />);
    await elegirRol("Albaranes");
    expect(interruptor("Puede subir fotos: Facturas · Solo fotos (albaranes)")).toBeChecked();
    rellenarYCrear();

    const filas = await permisosEnviados();
    expect(conAcceso(filas)).toEqual(["facturas_albaranes"]);
    expect(rolEnviado()).toBe("staff");
  });

  it("tocar un permiso a mano deja de ser el tipo elegido", async () => {
    render(<InvitarUsuario />);
    await elegirRol("Albaranes");
    fireEvent.click(interruptor("Ver Dashboard"));
    expect(screen.getByRole("combobox")).toHaveTextContent("Configuración manual");
  });
});
