/**
 * Pantalla Usuarios → diálogo «Permisos» (ListaUsuarios) con el hook REAL
 * useUsersManagement: se comprueba de punta a punta lo que llega a la BD.
 *
 * Desde el 2026-10-01 un super admin puede conceder y retirar «Puede editar» por
 * sección. Antes el diálogo cargaba `can_edit: false` aunque estuviera guardado a
 * true y el hook lo volvía a escribir a false: guardar los permisos de alguien le
 * quitaba la edición (y con ella, las acciones de servicio del kanban).
 *
 * Supabase va mockeado (`__mocks__/client.ts` + un builder por tabla): nada toca
 * producción. useAuth / useSuperAdmin / useUserRolePresets van mockeados para
 * fijar quién mira la pantalla y qué roles preconfigurados hay.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { UserRolePreset } from "@/hooks/useUserRolePresets";

const h = vi.hoisted(() => ({
  esSuperAdmin: true as boolean,
  presets: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u-yo", email: "dueno@example.com" }, loading: false }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({
  useSuperAdmin: () => ({ isSuperAdmin: h.esSuperAdmin, loading: false }),
}));
vi.mock("@/hooks/useUserRole", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useUserRole")>();
  return {
    ...real,
    useUserRole: () => ({ role: "admin", isAdmin: true, permissions: [], loading: false }),
  };
});
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
import { ListaUsuarios } from "@/components/usuarios/ListaUsuarios";

// Radix Select necesita estos métodos, que jsdom no implementa.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

type Fila = { section_key: string; can_view: boolean; can_edit: boolean };

const CAMARERO = "u-camarero";

/** Permisos guardados del camarero: ve Dashboard, Reservas (con edición) y Facturas (sin edición). */
const PERMISOS_CAMARERO: Fila[] = [
  { section_key: "dashboard", can_view: true, can_edit: false },
  { section_key: "reservas", can_view: true, can_edit: true },
  { section_key: "facturas", can_view: true, can_edit: false },
];

const bd = {
  tablas: {} as Record<string, unknown[]>,
  inserts: [] as { tabla: string; payload: unknown }[],
};

function builder(tabla: string) {
  const b: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "delete", "upsert", "order"]) b[metodo] = vi.fn(() => b);
  b.insert = vi.fn((payload: unknown) => {
    bd.inserts.push({ tabla, payload });
    return b;
  });
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
    Promise.resolve({ data: bd.tablas[tabla] ?? [], error: null }).then(ok, ko);
  return b;
}

function sembrar(permisosCamarero: Fila[]) {
  bd.tablas = {
    user_roles: [
      { user_id: "u-yo", role: "admin", created_at: "2026-01-01T10:00:00Z" },
      { user_id: CAMARERO, role: "staff", created_at: "2026-09-01T10:00:00Z" },
    ],
    user_permissions: permisosCamarero.map((p) => ({ user_id: CAMARERO, ...p })),
    super_admins: [{ user_id: "u-yo" }],
  };
}

const preset = (id: string, name: string, permissions: Fila[]): UserRolePreset => ({
  id,
  name,
  base_role: "staff",
  permissions,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  h.esSuperAdmin = true;
  h.presets = [];
  bd.inserts = [];
  sembrar(PERMISOS_CAMARERO);
  vi.mocked(supabase.from).mockImplementation(((tabla: string) => builder(tabla)) as never);
  vi.mocked(supabase.functions.invoke).mockResolvedValue({
    data: {
      users: [
        { id: "u-yo", email: "dueno@example.com", display_name: "Dueño", created_at: "2026-01-01T10:00:00Z" },
        { id: CAMARERO, email: "camarero1@staff.local", display_name: "camarero1", created_at: "2026-09-01T10:00:00Z" },
      ],
    },
    error: null,
  } as never);
});

async function abrirPermisosDelCamarero() {
  render(<ListaUsuarios />);
  fireEvent.click(await screen.findByRole("button", { name: "Permisos" }));
  return screen.findByRole("dialog");
}

const interruptor = (dialogo: HTMLElement, nombre: string) => within(dialogo).getByRole("switch", { name: nombre });

async function guardar(dialogo: HTMLElement) {
  fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar Permisos" }));
  await waitFor(() => expect(bd.inserts.filter((i) => i.tabla === "user_permissions")).toHaveLength(1));
  return bd.inserts.find((i) => i.tabla === "user_permissions")!.payload as Array<Fila & { user_id: string }>;
}

const fila = (filas: Array<Fila & { user_id: string }>, clave: string) => filas.find((f) => f.section_key === clave);

describe("ListaUsuarios · «Puede editar» por sección", () => {
  it("muestra el estado real guardado: Reservas con edición, Facturas sin ella", async () => {
    const dialogo = await abrirPermisosDelCamarero();

    expect(interruptor(dialogo, "Ver Reservas")).toBeChecked();
    expect(interruptor(dialogo, "Puede editar Reservas")).toBeChecked();
    expect(interruptor(dialogo, "Ver Facturas")).toBeChecked();
    expect(interruptor(dialogo, "Puede editar Facturas")).not.toBeChecked();
    expect(interruptor(dialogo, "Puede editar Facturas")).toBeEnabled();
  });

  it("cada interruptor «Puede editar» explica qué permite editar en esa sección", async () => {
    const dialogo = await abrirPermisosDelCamarero();

    expect(interruptor(dialogo, "Puede editar Reservas")).toHaveAccessibleDescription(/llegadas/i);
  });

  it("guardar sin tocar nada no pierde la edición", async () => {
    const dialogo = await abrirPermisosDelCamarero();

    const filas = await guardar(dialogo);

    expect(fila(filas, "reservas")).toEqual({ user_id: CAMARERO, section_key: "reservas", can_view: true, can_edit: true });
  });

  it("conceder: activar «Puede editar Facturas» y guardar envía can_edit = true", async () => {
    const dialogo = await abrirPermisosDelCamarero();

    fireEvent.click(interruptor(dialogo, "Puede editar Facturas"));
    expect(interruptor(dialogo, "Puede editar Facturas")).toBeChecked();
    const filas = await guardar(dialogo);

    expect(fila(filas, "facturas")).toEqual({ user_id: CAMARERO, section_key: "facturas", can_view: true, can_edit: true });
    expect(fila(filas, "reservas")?.can_edit).toBe(true);
  });

  it("retirar: desactivar «Puede editar Reservas» y guardar envía can_edit = false y conserva «Ver»", async () => {
    const dialogo = await abrirPermisosDelCamarero();

    fireEvent.click(interruptor(dialogo, "Puede editar Reservas"));
    const filas = await guardar(dialogo);

    expect(fila(filas, "reservas")).toEqual({ user_id: CAMARERO, section_key: "reservas", can_view: true, can_edit: false });
  });

  it("dependencia ver→editar: sin «Ver» no se puede editar, y quitar «Ver» quita la edición", async () => {
    const dialogo = await abrirPermisosDelCamarero();

    // Newsletter: sin «Ver», «Puede editar» está bloqueado.
    expect(interruptor(dialogo, "Puede editar Newsletter")).toBeDisabled();
    fireEvent.click(interruptor(dialogo, "Ver Newsletter"));
    expect(interruptor(dialogo, "Puede editar Newsletter")).toBeEnabled();
    expect(interruptor(dialogo, "Puede editar Newsletter")).not.toBeChecked();

    // Reservas: quitar «Ver» apaga y bloquea «Puede editar».
    fireEvent.click(interruptor(dialogo, "Ver Reservas"));
    expect(interruptor(dialogo, "Puede editar Reservas")).not.toBeChecked();
    expect(interruptor(dialogo, "Puede editar Reservas")).toBeDisabled();

    const filas = await guardar(dialogo);
    expect(fila(filas, "reservas")).toMatchObject({ can_view: false, can_edit: false });
    expect(fila(filas, "marketing")).toMatchObject({ can_view: true, can_edit: false });
  });

  it("quien no es super admin ve la edición real pero no puede cambiarla (no se amplía quién concede)", async () => {
    h.esSuperAdmin = false;
    const dialogo = await abrirPermisosDelCamarero();

    expect(interruptor(dialogo, "Puede editar Reservas")).toBeChecked();
    expect(interruptor(dialogo, "Puede editar Reservas")).toBeDisabled();
    expect(interruptor(dialogo, "Puede editar Facturas")).toBeDisabled();
    expect(within(dialogo).getByText(/solo un super admin puede conceder o retirar/i)).toBeInTheDocument();
    // «Ver» sigue como estaba.
    expect(interruptor(dialogo, "Ver Facturas")).toBeEnabled();
  });

  it("la fila de un super admin (también la propia) no tiene «Permisos»: nadie se quita a sí mismo la gestión", async () => {
    render(<ListaUsuarios />);

    expect(await screen.findAllByRole("button", { name: "Permisos" })).toHaveLength(1);
    const filaDueno = screen.getByText("Dueño").closest("tr")!;
    expect(within(filaDueno).queryByRole("button", { name: "Permisos" })).toBeNull();
  });
});

describe("ListaUsuarios · roles preconfigurados y «Puede editar»", () => {
  const SIN_EDICION = preset("p-1", "Sala sin edición", [
    { section_key: "dashboard", can_view: true, can_edit: false },
    { section_key: "reservas", can_view: true, can_edit: false },
    { section_key: "facturas", can_view: true, can_edit: false },
  ]);
  const CON_EDICION = preset("p-2", "Sala", PERMISOS_CAMARERO);

  it("al abrir, el rol preconfigurado que coincide se elige mirando también la edición", async () => {
    h.presets = [SIN_EDICION, CON_EDICION];
    const dialogo = await abrirPermisosDelCamarero();

    expect(within(dialogo).getByRole("combobox")).toHaveTextContent("Sala");
    expect(within(dialogo).getByRole("combobox")).not.toHaveTextContent("Sala sin edición");
  });

  it("aplicar un rol preconfigurado copia también su «Puede editar»", async () => {
    h.presets = [SIN_EDICION, CON_EDICION];
    const dialogo = await abrirPermisosDelCamarero();

    fireEvent.click(within(dialogo).getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Sala sin edición" }));
    expect(interruptor(dialogo, "Puede editar Reservas")).not.toBeChecked();

    fireEvent.click(within(dialogo).getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Sala" }));
    expect(interruptor(dialogo, "Puede editar Reservas")).toBeChecked();

    const filas = await guardar(dialogo);
    expect(fila(filas, "reservas")?.can_edit).toBe(true);
  });
});
