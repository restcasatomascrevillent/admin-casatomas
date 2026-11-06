/**
 * Pantalla Usuarios → «Configurar roles» (ConfigurarRolesModal): los roles
 * preconfigurados llevan también «Puede editar» (2026-10-01).
 *
 * Antes el editor de plantillas forzaba `can_edit: false` al copiar los permisos
 * actuales y en cada cambio. Se comprueba lo que el modal pasa a onCreatePreset /
 * onUpdatePreset (los hooks que escriben en la BD tienen su propio test).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ConfigurarRolesModal } from "@/components/usuarios/ConfigurarRolesModal";
import type { UserRolePreset } from "@/hooks/useUserRolePresets";

type Fila = { section_key: string; can_view: boolean; can_edit: boolean };

const ACTUALES: Fila[] = [
  { section_key: "dashboard", can_view: true, can_edit: false },
  { section_key: "reservas", can_view: true, can_edit: true },
];

const SALA: UserRolePreset = {
  id: "p-sala",
  name: "Sala",
  base_role: "staff",
  permissions: [{ section_key: "reservas", can_view: true, can_edit: true }],
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
};

const onCreatePreset = vi.fn();
const onUpdatePreset = vi.fn();
const onDeletePreset = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  onCreatePreset.mockImplementation(async (name: string) => ({ ...SALA, id: "p-nuevo", name }));
  onUpdatePreset.mockImplementation(async () => SALA);
});

function abrir({ puedeConcederEdicion = true, presets = [] as UserRolePreset[] } = {}) {
  render(
    <ConfigurarRolesModal
      currentPermissions={ACTUALES}
      presets={presets}
      presetsLoading={false}
      onCreatePreset={onCreatePreset}
      onUpdatePreset={onUpdatePreset}
      onDeletePreset={onDeletePreset}
      puedeConcederEdicion={puedeConcederEdicion}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Configurar roles/ }));
  return screen.getByRole("dialog");
}

const de = (filas: Fila[], clave: string) => filas.find((f) => f.section_key === clave);

describe("ConfigurarRolesModal · «Puede editar» en los roles preconfigurados", () => {
  it("el nuevo rol parte de los permisos actuales, edición incluida, y la guarda", async () => {
    const dialogo = abrir();

    expect(within(dialogo).getByRole("switch", { name: "Puede editar Reservas" })).toBeChecked();
    fireEvent.change(within(dialogo).getByLabelText("Nombre del rol"), { target: { value: "Sala" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar rol" }));

    await waitFor(() => expect(onCreatePreset).toHaveBeenCalledTimes(1));
    const [, , permisos] = onCreatePreset.mock.calls[0] as [string, string, Fila[]];
    expect(de(permisos, "reservas")).toEqual({ section_key: "reservas", can_view: true, can_edit: true });
    expect(de(permisos, "facturas")).toEqual({ section_key: "facturas", can_view: false, can_edit: false });
  });

  it("se puede conceder y retirar la edición en la plantilla", async () => {
    const dialogo = abrir();

    fireEvent.click(within(dialogo).getByRole("switch", { name: "Puede editar Reservas" }));
    fireEvent.click(within(dialogo).getByRole("switch", { name: "Ver Facturas" }));
    fireEvent.click(within(dialogo).getByRole("switch", { name: "Puede editar Facturas" }));
    fireEvent.change(within(dialogo).getByLabelText("Nombre del rol"), { target: { value: "Caja" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar rol" }));

    await waitFor(() => expect(onCreatePreset).toHaveBeenCalledTimes(1));
    const [, , permisos] = onCreatePreset.mock.calls[0] as [string, string, Fila[]];
    expect(de(permisos, "reservas")).toEqual({ section_key: "reservas", can_view: true, can_edit: false });
    expect(de(permisos, "facturas")).toEqual({ section_key: "facturas", can_view: true, can_edit: true });
  });

  it("al editar un rol guardado muestra su «Puede editar» y lo conserva al guardar", async () => {
    const dialogo = abrir({ presets: [SALA] });

    fireEvent.click(within(dialogo).getByRole("button", { name: /Editar/ }));
    expect(within(dialogo).getByRole("switch", { name: "Puede editar Reservas" })).toBeChecked();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onUpdatePreset).toHaveBeenCalledTimes(1));
    const [, , , permisos] = onUpdatePreset.mock.calls[0] as [string, string, string, Fila[]];
    expect(de(permisos, "reservas")?.can_edit).toBe(true);
  });

  it("quien no es super admin no puede conceder edición en las plantillas", () => {
    const dialogo = abrir({ puedeConcederEdicion: false });

    expect(within(dialogo).getByRole("switch", { name: "Puede editar Reservas" })).toBeDisabled();
    fireEvent.click(within(dialogo).getByRole("switch", { name: "Ver Facturas" }));
    expect(within(dialogo).getByRole("switch", { name: "Puede editar Facturas" })).toBeDisabled();
  });
});

describe("ConfigurarRolesModal · «Facturas · Subida» (06/11/2026): un solo interruptor", () => {
  it("sale con «Puede subir» (sin «Ver» ni «Puede editar» propios) y se guarda en can_view", async () => {
    const dialogo = abrir();

    const subir = within(dialogo).getByRole("switch", { name: "Puede subir: Facturas · Subida" });
    expect(subir).not.toBeChecked();
    expect(within(dialogo).queryByRole("switch", { name: "Ver Facturas · Subida" })).toBeNull();
    expect(within(dialogo).queryByRole("switch", { name: "Puede editar Facturas · Subida" })).toBeNull();
    expect(within(dialogo).getByText(/^Puede subir: pestaña Cargar/)).toBeInTheDocument();
    fireEvent.click(subir);
    fireEvent.change(within(dialogo).getByLabelText("Nombre del rol"), { target: { value: "Cocina" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar rol" }));

    await waitFor(() => expect(onCreatePreset).toHaveBeenCalledTimes(1));
    const [, , permisos] = onCreatePreset.mock.calls[0] as [string, string, Fila[]];
    // Va por libre: no necesita «Ver» en Facturas.
    expect(de(permisos, "facturas_subida")).toEqual({ section_key: "facturas_subida", can_view: true, can_edit: false });
    expect(de(permisos, "facturas")).toEqual({ section_key: "facturas", can_view: false, can_edit: false });
  });

  it("también lo cambia quien no puede conceder edición (es un permiso de «Ver»)", () => {
    const dialogo = abrir({ puedeConcederEdicion: false });
    expect(within(dialogo).getByRole("switch", { name: "Puede subir: Facturas · Subida" })).toBeEnabled();
  });
});
