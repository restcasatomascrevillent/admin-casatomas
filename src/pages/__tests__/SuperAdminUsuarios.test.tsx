import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: h.invoke } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/SuperAdminLayout", () => ({
  SuperAdminLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/useAlturaDisponible", () => ({ useAlturaDisponible: () => undefined }));
vi.mock("@/components/usuarios/ListaUsuarios", () => ({ ListaUsuarios: () => <p>lista</p> }));
vi.mock("@/components/usuarios/InvitarUsuario", () => ({ InvitarUsuario: () => null }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u-yo", email: "dueno@casatomas.test", user_metadata: { display_name: "Tomás" } } }),
}));

import SuperAdminUsuarios from "@/pages/SuperAdminUsuarios";

describe("Super Admin › Usuarios", () => {
  it("«Cambiar mi contraseña» abre el formulario propio (pide la actual) y se cierra al cambiarla", async () => {
    h.invoke.mockResolvedValue({ data: { success: true }, error: null });
    render(<SuperAdminUsuarios />);
    fireEvent.click(screen.getByRole("button", { name: "Cambiar mi contraseña" }));
    const dialogo = await screen.findByRole("dialog", { name: "Cambiar mi contraseña" });
    expect(within(dialogo).getByText(/La de tu cuenta \(Tomás\)/)).toBeInTheDocument();
    fireEvent.change(within(dialogo).getByLabelText("Contraseña actual", { selector: "input" }), { target: { value: "Actual-123456" } });
    fireEvent.change(within(dialogo).getByLabelText("Nueva contraseña", { selector: "input" }), { target: { value: "Nueva-1234567" } });
    fireEvent.change(within(dialogo).getByLabelText("Repite la nueva contraseña", { selector: "input" }), { target: { value: "Nueva-1234567" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cambiar contraseña" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.invoke).toHaveBeenCalledWith("cambiar-mi-contrasena", { body: { actual: "Actual-123456", nueva: "Nueva-1234567" } });
    expect(h.invoke).not.toHaveBeenCalledWith("admin-update-user-password", expect.anything());
  });

  it("sigue estando «Añadir Usuario»", () => {
    render(<SuperAdminUsuarios />);
    expect(screen.getByRole("button", { name: "Añadir Usuario" })).toBeInTheDocument();
  });
});
