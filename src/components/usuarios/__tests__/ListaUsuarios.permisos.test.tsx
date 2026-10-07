/**
 * Pantalla Usuarios → diálogo «Permisos» (ListaUsuarios) con el hook REAL
 * useUsersManagement: se comprueba de punta a punta lo que llega a la BD.
 *
 * Desde el 2026-10-01 un super admin puede conceder y retirar «Puede editar» por
 * sección. Antes el diálogo cargaba `can_edit: false` aunque estuviera guardado a
 * true y el hook lo volvía a escribir a false: guardar los permisos de alguien le
 * quitaba la edición (y con ella, las acciones de servicio del kanban).
 *
 * Y el guardado SEGURO (2026-10-01): primero un upsert de lo marcado y después el
 * borrado de lo desmarcado del diálogo, sin tocar las secciones que el diálogo no
 * gestiona; si falla, el diálogo sigue abierto y el usuario no pierde nada.
 *
 * Supabase va mockeado (`__mocks__/client.ts` + `doblePermisosUsuario.ts`, que aplica
 * las escrituras a unas filas en memoria): nada toca producción. useAuth /
 * useSuperAdmin / useUserRolePresets van mockeados para fijar quién mira la
 * pantalla y qué roles preconfigurados hay.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { UserRolePreset } from "@/hooks/useUserRolePresets";
import { crearDoblePermisos } from "@/hooks/__tests__/doblePermisosUsuario";

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

import { toast } from "sonner";
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

/** Secciones que el diálogo NO gestiona y que el camarero tiene (como en producción, «Bot Web»). */
const OTRAS_DEL_CAMARERO: Fila[] = [
  { section_key: "gestion_bot", can_view: true, can_edit: false },
  { section_key: "asistente_telefonico", can_view: true, can_edit: true },
];

let doble: ReturnType<typeof crearDoblePermisos>;

function sembrar(permisosCamarero: Fila[]) {
  doble.bd.tablas = {
    user_roles: [
      { user_id: "u-yo", role: "admin", created_at: "2026-01-01T10:00:00Z" },
      { user_id: CAMARERO, role: "staff", created_at: "2026-09-01T10:00:00Z" },
    ],
    user_permissions: [...permisosCamarero, ...OTRAS_DEL_CAMARERO].map((p) => ({ user_id: CAMARERO, ...p })),
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
  doble = crearDoblePermisos();
  sembrar(PERMISOS_CAMARERO);
  vi.mocked(supabase.from).mockImplementation(((tabla: string) => doble.from(tabla)) as never);
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

describe("ListaUsuarios · información de accesos actualizada", () => {
  it("un admin con permisos limitados muestra sus secciones reales, sin acceso completo", async () => {
    doble.bd.tablas.user_roles.find((f) => f.user_id === CAMARERO)!.role = "admin";
    render(<ListaUsuarios canManageSuperAdmins />);
    const fila = (await screen.findByText("camarero1")).closest("tr")!;
    expect(within(fila).queryByText("Administrador")).toBeNull();
    expect(within(fila).queryByText("Acceso completo")).toBeNull();
    expect(within(fila).getByText("Acceso por permisos")).toBeInTheDocument();
    expect(within(fila).getByText("Gestiona usuarios")).toBeInTheDocument();
    expect(within(fila).getByText("3 secciones")).toBeInTheDocument();
    expect(within(fila).getByText("1 con edición")).toBeInTheDocument();
  });

  it("al cambiar los permisos actualiza los contadores y deja de mostrar el preset anterior", async () => {
    h.presets = [preset("p-sala", "Sala", PERMISOS_CAMARERO)];
    render(<ListaUsuarios />);
    let fila = (await screen.findByText("camarero1")).closest("tr")!;
    expect(within(fila).getByText("Sala")).toBeInTheDocument();
    fireEvent.click(within(fila).getByRole("button", { name: "Permisos" }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(interruptor(dialogo, "Ver Reservas"));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar Permisos" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fila = screen.getByText("camarero1").closest("tr")!;
    expect(within(fila).queryByText("Sala")).toBeNull();
    expect(within(fila).getByText("Acceso por permisos")).toBeInTheDocument();
    expect(within(fila).getByText("2 secciones")).toBeInTheDocument();
    expect(within(fila).queryByText(/con edición/)).toBeNull();
  });

  it("al aplicar un preset a un admin relee el nuevo rol antes de cerrar el diálogo", async () => {
    doble.bd.tablas.user_roles.find((f) => f.user_id === CAMARERO)!.role = "admin";
    h.presets = [preset("p-sala", "Sala", PERMISOS_CAMARERO)];
    render(<ListaUsuarios canManageSuperAdmins />);
    const fila = (await screen.findByText("camarero1")).closest("tr")!;
    fireEvent.click(within(fila).getByRole("button", { name: "Permisos" }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Sala" }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar Permisos" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const actualizada = screen.getByText("camarero1").closest("tr")!;
    expect(doble.filasDe("user_roles", CAMARERO)[0].role).toBe("staff");
    expect(within(actualizada).getByText("Sala")).toBeInTheDocument();
    expect(within(actualizada).queryByText("Gestiona usuarios")).toBeNull();
  });

  it("el acceso completo solo se muestra a los super admins", async () => {
    render(<ListaUsuarios />);
    const fila = (await screen.findByText("Dueño")).closest("tr")!;
    expect(within(fila).getByText("Super Admin")).toBeInTheDocument();
    expect(within(fila).getByText("Acceso completo")).toBeInTheDocument();
  });
});

/**
 * Pulsa «Guardar Permisos», espera a que termine y devuelve cómo quedan los permisos del
 * camarero en la BD, sección a sección (sin fila = ni «Ver» ni «Puede editar»).
 */
async function guardar(dialogo: HTMLElement) {
  fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar Permisos" }));
  await waitFor(() =>
    expect(vi.mocked(toast.success).mock.calls.length + vi.mocked(toast.error).mock.calls.length).toBeGreaterThan(0),
  );
  const filas = doble.filasDe("user_permissions", CAMARERO);
  return (clave: string) => {
    const f = filas.find((x) => x.section_key === clave);
    return { user_id: CAMARERO, section_key: clave, can_view: Boolean(f?.can_view), can_edit: Boolean(f?.can_edit) };
  };
}

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

    const permiso = await guardar(dialogo);

    expect(permiso("reservas")).toEqual({ user_id: CAMARERO, section_key: "reservas", can_view: true, can_edit: true });
  });

  it("conceder: activar «Puede editar Facturas» y guardar envía can_edit = true", async () => {
    const dialogo = await abrirPermisosDelCamarero();

    fireEvent.click(interruptor(dialogo, "Puede editar Facturas"));
    expect(interruptor(dialogo, "Puede editar Facturas")).toBeChecked();
    const permiso = await guardar(dialogo);

    expect(permiso("facturas")).toEqual({ user_id: CAMARERO, section_key: "facturas", can_view: true, can_edit: true });
    expect(permiso("reservas").can_edit).toBe(true);
  });

  it("retirar: desactivar «Puede editar Reservas» y guardar envía can_edit = false y conserva «Ver»", async () => {
    const dialogo = await abrirPermisosDelCamarero();

    fireEvent.click(interruptor(dialogo, "Puede editar Reservas"));
    const permiso = await guardar(dialogo);

    expect(permiso("reservas")).toEqual({ user_id: CAMARERO, section_key: "reservas", can_view: true, can_edit: false });
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

    const permiso = await guardar(dialogo);
    expect(permiso("reservas")).toMatchObject({ can_view: false, can_edit: false });
    expect(permiso("marketing")).toMatchObject({ can_view: true, can_edit: false });
  });

  it("quien no es super admin ve los permisos reales en SOLO LECTURA: ni «Ver», ni «Puede editar», ni rol, ni guardar", async () => {
    // La RLS de user_permissions solo deja escribir a un super admin: cualquier otro guardado
    // no hace nada (2026-10-01, revisión). Antes «Ver» y «Guardar Permisos» seguían activos.
    h.esSuperAdmin = false;
    const dialogo = await abrirPermisosDelCamarero();

    expect(interruptor(dialogo, "Puede editar Reservas")).toBeChecked();
    expect(interruptor(dialogo, "Ver Reservas")).toBeChecked();
    for (const s of within(dialogo).getAllByRole("switch")) expect(s).toBeDisabled();
    expect(within(dialogo).getByRole("combobox")).toBeDisabled();
    const guardarBtn = within(dialogo).getByRole("button", { name: "Guardar Permisos" });
    expect(guardarBtn).toBeDisabled();
    // El motivo, a la vista (y en el envoltorio del botón, que deshabilitado no recibe el ratón).
    expect(within(dialogo).getByText("Solo un super admin puede cambiar permisos.")).toBeInTheDocument();
    expect(guardarBtn.parentElement).toHaveAttribute("title", "Solo un super admin puede cambiar permisos.");

    fireEvent.click(interruptor(dialogo, "Ver Facturas"));
    fireEvent.click(guardarBtn);
    expect(interruptor(dialogo, "Ver Facturas")).toBeChecked();
    expect(doble.bd.operaciones).toEqual([]);
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

    const permiso = await guardar(dialogo);
    expect(permiso("reservas").can_edit).toBe(true);
  });

  it("si el guardado falla, el rol del preset NO se escribe (user_roles) y el diálogo sigue abierto", async () => {
    h.presets = [SIN_EDICION, CON_EDICION];
    const rechazo = { code: "42501", message: 'new row violates row-level security policy for table "user_permissions"' };
    doble.bd.fallos = { upsert: rechazo, insert: rechazo };
    const dialogo = await abrirPermisosDelCamarero();

    fireEvent.click(within(dialogo).getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Sala sin edición" }));
    await guardar(dialogo);

    expect(toast.error).toHaveBeenCalled();
    expect(doble.escriturasEn("user_roles")).toEqual([]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("ListaUsuarios · el guardado no deja a nadie con menos permisos (2026-10-01)", () => {
  /** Las filas del camarero de las secciones que el diálogo no gestiona. */
  const otrasEnBd = () =>
    doble
      .filasDe("user_permissions", CAMARERO)
      .filter((f) => OTRAS_DEL_CAMARERO.some((o) => o.section_key === f.section_key));

  it("guardar no borra ni cambia las secciones que el diálogo no enseña (Bot Web, Asistente telefónico)", async () => {
    const antes = otrasEnBd();
    expect(antes).toHaveLength(2);
    const dialogo = await abrirPermisosDelCamarero();

    fireEvent.click(interruptor(dialogo, "Ver Newsletter"));
    await guardar(dialogo);

    expect(toast.success).toHaveBeenCalledWith("Permisos actualizados");
    expect(otrasEnBd()).toEqual(antes);
  });

  it("si el guardado falla: no se pierde ningún permiso, se avisa y el diálogo sigue abierto con lo elegido", async () => {
    const antes = doble.filasDe("user_permissions", CAMARERO);
    const caida = { code: "08006", message: "connection failure" };
    // Falla la escritura de las filas (upsert ahora; insert en el guardado antiguo).
    doble.bd.fallos = { upsert: caida, insert: caida };
    const dialogo = await abrirPermisosDelCamarero();

    fireEvent.click(interruptor(dialogo, "Puede editar Facturas"));
    await guardar(dialogo);

    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/no se ha cambiado nada/i), expect.anything());
    expect(doble.filasDe("user_permissions", CAMARERO)).toEqual(antes);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(interruptor(screen.getByRole("dialog"), "Puede editar Facturas")).toBeChecked();
  });

  it("si la BD no deja quitar un permiso (DELETE filtrado por la RLS: 0 filas y sin error), avisa y el diálogo sigue abierto", async () => {
    // P. ej. una sesión que ya no es de super admin para la BD. Antes salía «Permisos actualizados».
    doble.bd.borradoFiltradoPorRls = true;
    const dialogo = await abrirPermisosDelCamarero();

    fireEvent.click(interruptor(dialogo, "Ver Facturas"));
    await guardar(dialogo);

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/no se han podido quitar algunos permisos/i), expect.anything());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(doble.filasDe("user_permissions", CAMARERO).find((f) => f.section_key === "facturas")).toMatchObject({ can_view: true });
  });
});
