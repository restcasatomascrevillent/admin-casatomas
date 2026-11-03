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
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import type { UserRolePreset } from "@/hooks/useUserRolePresets";
import { crearDoblePermisos } from "@/hooks/__tests__/doblePermisosUsuario";

const h = vi.hoisted(() => ({
  esSuperAdmin: true as boolean,
  presets: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "u-yo", email: "dueno@example.com" },
    loading: false,
  }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({
  useSuperAdmin: () => ({ isSuperAdmin: h.esSuperAdmin, loading: false }),
}));
vi.mock("@/hooks/useUserRole", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useUserRole")>();
  return {
    ...real,
    useUserRole: () => ({
      role: "admin",
      isAdmin: true,
      permissions: [],
      loading: false,
    }),
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
    user_permissions: [...permisosCamarero, ...OTRAS_DEL_CAMARERO].map((p) => ({
      user_id: CAMARERO,
      ...p,
    })),
    super_admins: [{ user_id: "u-yo" }],
  };
}

const preset = (
  id: string,
  name: string,
  permissions: Fila[],
): UserRolePreset => ({
  id,
  name,
  base_role: "staff",
  permissions,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
});

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1024 });
  vi.clearAllMocks();
  h.esSuperAdmin = true;
  h.presets = [];
  doble = crearDoblePermisos();
  sembrar(PERMISOS_CAMARERO);
  vi.mocked(supabase.from).mockImplementation(((tabla: string) =>
    doble.from(tabla)) as never);
  vi.mocked(supabase.functions.invoke).mockResolvedValue({
    data: {
      users: [
        {
          id: "u-yo",
          email: "dueno@example.com",
          display_name: "Dueño",
          created_at: "2026-01-01T10:00:00Z",
          access_blocked: false,
        },
        {
          id: CAMARERO,
          email: "camarero1@staff.local",
          display_name: "camarero1",
          created_at: "2026-09-01T10:00:00Z",
          access_blocked: false,
        },
      ],
    },
    error: null,
  } as never);
});

afterEach(() => {
  window.innerWidth = 1024;
});

async function abrirPermisosDelCamarero() {
  render(<ListaUsuarios canManageSuperAdmins />);
  fireEvent.click(await screen.findByRole("button", { name: "Permisos" }));
  return screen.findByRole("dialog");
}

const interruptor = (dialogo: HTMLElement, nombre: string) =>
  within(dialogo).getByRole("switch", { name: nombre });

describe("ListaUsuarios · información de accesos actualizada", () => {
  it("un admin con permisos limitados muestra sus secciones reales, sin acceso completo", async () => {
    doble.bd.tablas.user_roles.find((f) => f.user_id === CAMARERO)!.role =
      "admin";
    render(<ListaUsuarios canManageSuperAdmins />);
    const fila = (await screen.findByText("camarero1")).closest("tr")!;
    expect(within(fila).queryByText("Administrador")).toBeNull();
    expect(within(fila).queryByText("Acceso completo")).toBeNull();
    expect(within(fila).queryByText("Acceso por permisos")).toBeNull();
    expect(within(fila).queryByText("Gestiona usuarios")).toBeNull();
    expect(within(fila).getByText("3 secciones")).toBeInTheDocument();
    expect(within(fila).getByText("1 con edición")).toBeInTheDocument();
  });

  it("al cambiar los permisos actualiza los contadores y deja de mostrar el preset anterior", async () => {
    h.presets = [preset("p-sala", "Sala", PERMISOS_CAMARERO)];
    render(<ListaUsuarios canManageSuperAdmins />);
    let fila = (await screen.findByText("camarero1")).closest("tr")!;
    expect(within(fila).queryByText("Sala")).toBeNull();
    fireEvent.click(within(fila).getByRole("button", { name: "Permisos" }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(interruptor(dialogo, "Ver Reservas"));
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Guardar Permisos" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fila = screen.getByText("camarero1").closest("tr")!;
    expect(within(fila).queryByText("Sala")).toBeNull();
    expect(within(fila).queryByText("Acceso por permisos")).toBeNull();
    expect(within(fila).getByText("2 secciones")).toBeInTheDocument();
    expect(within(fila).queryByText(/con edición/)).toBeNull();
  });

  it("al aplicar un preset a un admin relee el nuevo rol antes de cerrar el diálogo", async () => {
    doble.bd.tablas.user_roles.find((f) => f.user_id === CAMARERO)!.role =
      "admin";
    h.presets = [preset("p-sala", "Sala", PERMISOS_CAMARERO)];
    render(<ListaUsuarios canManageSuperAdmins />);
    const fila = (await screen.findByText("camarero1")).closest("tr")!;
    fireEvent.click(within(fila).getByRole("button", { name: "Permisos" }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Sala" }));
    fireEvent.click(
      within(dialogo).getByRole("button", { name: "Guardar Permisos" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const actualizada = screen.getByText("camarero1").closest("tr")!;
    expect(doble.filasDe("user_roles", CAMARERO)[0].role).toBe("staff");
    expect(within(actualizada).queryByText("Sala")).toBeNull();
    expect(within(actualizada).queryByText("Gestiona usuarios")).toBeNull();
  });

  it("el acceso completo solo se muestra a los super admins", async () => {
    render(<ListaUsuarios canManageSuperAdmins />);
    const fila = (await screen.findByText("Dueño")).closest("tr")!;
    expect(screen.queryByRole("columnheader", { name: "Rol" })).toBeNull();
    expect(within(fila).getByText("Acceso completo")).toBeInTheDocument();
  });
});

/**
 * Pulsa «Guardar Permisos», espera a que termine y devuelve cómo quedan los permisos del
 * camarero en la BD, sección a sección (sin fila = ni «Ver» ni «Puede editar»).
 */
async function guardar(dialogo: HTMLElement) {
  fireEvent.click(
    within(dialogo).getByRole("button", { name: "Guardar Permisos" }),
  );
  await waitFor(() =>
    expect(
      vi.mocked(toast.success).mock.calls.length +
        vi.mocked(toast.error).mock.calls.length,
    ).toBeGreaterThan(0),
  );
  const filas = doble.filasDe("user_permissions", CAMARERO);
  return (clave: string) => {
    const f = filas.find((x) => x.section_key === clave);
    return {
      user_id: CAMARERO,
      section_key: clave,
      can_view: Boolean(f?.can_view),
      can_edit: Boolean(f?.can_edit),
    };
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

    expect(
      interruptor(dialogo, "Puede editar Reservas"),
    ).toHaveAccessibleDescription(/llegadas/i);
  });

  it("guardar sin tocar nada no pierde la edición", async () => {
    const dialogo = await abrirPermisosDelCamarero();

    const permiso = await guardar(dialogo);

    expect(permiso("reservas")).toEqual({
      user_id: CAMARERO,
      section_key: "reservas",
      can_view: true,
      can_edit: true,
    });
  });

  it("conceder: activar «Puede editar Facturas» y guardar envía can_edit = true", async () => {
    const dialogo = await abrirPermisosDelCamarero();

    fireEvent.click(interruptor(dialogo, "Puede editar Facturas"));
    expect(interruptor(dialogo, "Puede editar Facturas")).toBeChecked();
    const permiso = await guardar(dialogo);

    expect(permiso("facturas")).toEqual({
      user_id: CAMARERO,
      section_key: "facturas",
      can_view: true,
      can_edit: true,
    });
    expect(permiso("reservas").can_edit).toBe(true);
  });

  it("retirar: desactivar «Puede editar Reservas» y guardar envía can_edit = false y conserva «Ver»", async () => {
    const dialogo = await abrirPermisosDelCamarero();

    fireEvent.click(interruptor(dialogo, "Puede editar Reservas"));
    const permiso = await guardar(dialogo);

    expect(permiso("reservas")).toEqual({
      user_id: CAMARERO,
      section_key: "reservas",
      can_view: true,
      can_edit: false,
    });
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
    expect(permiso("reservas")).toMatchObject({
      can_view: false,
      can_edit: false,
    });
    expect(permiso("marketing")).toMatchObject({
      can_view: true,
      can_edit: false,
    });
  });

  it.each([false, true])(
    "el admin panel solo permite consultar, incluso si el visitante es superadmin (%s)",
    async (esSuperAdmin) => {
      h.esSuperAdmin = esSuperAdmin;
      doble.bd.tablas.user_roles.find((f) => f.user_id === CAMARERO)!.role =
        "admin";
      render(<ListaUsuarios />);
      const fila = (await screen.findByText("camarero1")).closest("tr")!;
      expect(within(fila).queryByText("Acceso por permisos")).toBeNull();
      expect(within(fila).queryByText("Gestiona usuarios")).toBeNull();
      expect(within(fila).getByText("3 secciones")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Contraseña" })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Eliminar/ })).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: /Hacer Super Admin|Quitar Super Admin/,
        }),
      ).toBeNull();
      fireEvent.click(
        within(fila).getByRole("button", { name: "Ver permisos" }),
      );
      const dialogo = await screen.findByRole("dialog");
      expect(
        within(dialogo).getByLabelText("Ver Reservas: Sí"),
      ).toHaveTextContent("Sí");
      expect(
        within(dialogo).getByLabelText("Editar Reservas: Sí"),
      ).toHaveTextContent("Sí");
      expect(
        within(dialogo).getByLabelText("Editar Facturas: No"),
      ).toHaveTextContent("No");
      expect(within(dialogo).queryByRole("switch")).toBeNull();
      expect(within(dialogo).queryByRole("combobox")).toBeNull();
      expect(
        within(dialogo).queryByRole("button", {
          name: /Guardar|Configurar roles/,
        }),
      ).toBeNull();
      expect(doble.bd.operaciones).toEqual([]);
    },
  );

  it("la prop de gestión no da privilegios a quien no es superadmin", async () => {
    h.esSuperAdmin = false;
    render(<ListaUsuarios canManageSuperAdmins />);
    await screen.findByText("camarero1");
    expect(screen.queryByRole("button", { name: "Permisos" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Contraseña" })).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Ver permisos" }),
    ).toHaveLength(2);
  });

  it("el visor de un superadmin muestra su acceso completo", async () => {
    render(<ListaUsuarios />);
    const fila = (await screen.findByText("Dueño")).closest("tr")!;
    fireEvent.click(within(fila).getByRole("button", { name: "Ver permisos" }));
    const dialogo = await screen.findByRole("dialog");
    expect(
      within(dialogo).getByLabelText("Editar Facturas: Sí"),
    ).toHaveTextContent("Sí");
    expect(
      within(dialogo).getByText(/acceso completo al panel/),
    ).toBeInTheDocument();
  });

  it("la fila de un super admin (también la propia) no tiene «Permisos»: nadie se quita a sí mismo la gestión", async () => {
    render(<ListaUsuarios canManageSuperAdmins />);

    expect(
      await screen.findAllByRole("button", { name: "Permisos" }),
    ).toHaveLength(1);
    const filaDueno = screen.getByText("Dueño").closest("tr")!;
    expect(
      within(filaDueno).queryByRole("button", { name: "Permisos" }),
    ).toBeNull();
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
    expect(within(dialogo).getByRole("combobox")).not.toHaveTextContent(
      "Sala sin edición",
    );
  });

  it("aplicar un rol preconfigurado copia también su «Puede editar»", async () => {
    h.presets = [SIN_EDICION, CON_EDICION];
    const dialogo = await abrirPermisosDelCamarero();

    fireEvent.click(within(dialogo).getByRole("combobox"));
    fireEvent.click(
      await screen.findByRole("option", { name: "Sala sin edición" }),
    );
    expect(interruptor(dialogo, "Puede editar Reservas")).not.toBeChecked();

    fireEvent.click(within(dialogo).getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Sala" }));
    expect(interruptor(dialogo, "Puede editar Reservas")).toBeChecked();

    const permiso = await guardar(dialogo);
    expect(permiso("reservas").can_edit).toBe(true);
  });

  it("si el guardado falla, el rol del preset NO se escribe (user_roles) y el diálogo sigue abierto", async () => {
    h.presets = [SIN_EDICION, CON_EDICION];
    const rechazo = {
      code: "42501",
      message:
        'new row violates row-level security policy for table "user_permissions"',
    };
    doble.bd.fallos = { upsert: rechazo, insert: rechazo };
    const dialogo = await abrirPermisosDelCamarero();

    fireEvent.click(within(dialogo).getByRole("combobox"));
    fireEvent.click(
      await screen.findByRole("option", { name: "Sala sin edición" }),
    );
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
      .filter((f) =>
        OTRAS_DEL_CAMARERO.some((o) => o.section_key === f.section_key),
      );

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

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/no se ha cambiado nada/i),
      expect.anything(),
    );
    expect(doble.filasDe("user_permissions", CAMARERO)).toEqual(antes);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      interruptor(screen.getByRole("dialog"), "Puede editar Facturas"),
    ).toBeChecked();
  });

  it("si la BD no deja quitar un permiso (DELETE filtrado por la RLS: 0 filas y sin error), avisa y el diálogo sigue abierto", async () => {
    // P. ej. una sesión que ya no es de super admin para la BD. Antes salía «Permisos actualizados».
    doble.bd.borradoFiltradoPorRls = true;
    const dialogo = await abrirPermisosDelCamarero();

    fireEvent.click(interruptor(dialogo, "Ver Facturas"));
    await guardar(dialogo);

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/no se han podido quitar algunos permisos/i),
      expect.anything(),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      doble
        .filasDe("user_permissions", CAMARERO)
        .find((f) => f.section_key === "facturas"),
    ).toMatchObject({ can_view: true });
  });
});

it.each([1280, 390])("bloquea y desbloquea sin borrar la cuenta ni sus permisos a %s px", async (ancho) => {
  window.innerWidth = ancho;
  let blocked = false;
  vi.mocked(supabase.functions.invoke).mockImplementation(
    async (name, options) => {
      if (name === "admin-set-user-access") {
        blocked = (options?.body as { blocked: boolean }).blocked;
        return { data: { success: true }, error: null } as never;
      }
      return {
        data: {
          users: [
            {
              id: "u-yo",
              email: "dueno@example.com",
              display_name: "Dueño",
              access_blocked: false,
            },
            {
              id: CAMARERO,
              email: "camarero1@staff.local",
              display_name: "camarero1",
              access_blocked: blocked,
            },
          ],
        },
        error: null,
      } as never;
    },
  );
  render(<ListaUsuarios canManageSuperAdmins />);
  let fila = (await screen.findByText("camarero1")).closest(ancho < 768 ? "li" : "tr")!;
  fireEvent.click(
    within(fila).getByRole("button", { name: "Bloquear acceso" }),
  );
  const dialogo = await screen.findByRole("dialog");
  expect(
    within(dialogo).getByText(/Se cerrarán las sesiones abiertas/),
  ).toBeInTheDocument();
  fireEvent.click(
    within(dialogo).getByRole("button", { name: "Confirmar bloqueo" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fila = screen.getByText("camarero1").closest(ancho < 768 ? "li" : "tr")!;
  expect(within(fila).getByText("Acceso bloqueado")).toBeInTheDocument();
  expect(doble.bd.operaciones).toEqual([]);
  expect(supabase.functions.invoke).toHaveBeenCalledWith(
    "admin-set-user-access",
    { body: { userId: CAMARERO, blocked: true } },
  );
  fireEvent.click(
    within(fila).getByRole("button", { name: "Desbloquear acceso" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirmar desbloqueo" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fila = screen.getByText("camarero1").closest(ancho < 768 ? "li" : "tr")!;
  expect(within(fila).getByText("3 secciones")).toBeInTheDocument();
  expect(doble.bd.operaciones).toEqual([]);
});

it("la propia cuenta está protegida y el panel normal no ofrece bloqueo", async () => {
  const vista = render(<ListaUsuarios canManageSuperAdmins />);
  const fila = (await screen.findByText("Dueño")).closest("tr")!;
  expect(
    within(fila).getByRole("button", { name: "Bloquear acceso" }),
  ).toBeDisabled();
  vista.unmount();
  render(<ListaUsuarios />);
  await screen.findByText("Dueño");
  expect(screen.queryByRole("button", { name: "Bloquear acceso" })).toBeNull();
});

describe("Usuarios · consulta en teléfono", () => {
  it("muestra tarjetas con los accesos reales y abre permisos sin controles de gestión", async () => {
    window.innerWidth = 390;
    h.presets = [preset("p-sala", "Sala", PERMISOS_CAMARERO)];
    render(<ListaUsuarios />);
    const tarjeta = (await screen.findByText("camarero1")).closest("li")!;
    expect(screen.queryByRole("table")).toBeNull();
    expect(within(tarjeta).queryByText("Sala")).toBeNull();
    expect(within(tarjeta).getByText("3 secciones")).toBeInTheDocument();
    expect(within(tarjeta).getByText("1 con edición")).toBeInTheDocument();
    expect(within(tarjeta).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Ver permisos" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByLabelText("Editar Reservas: Sí")).toHaveTextContent("Sí");
    expect(within(dialogo).getByLabelText("Editar Facturas: No")).toHaveTextContent("No");
    expect(within(dialogo).queryByRole("switch")).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(doble.bd.operaciones).toEqual([]);
  });

  it("busca por nombre sin tildes y por correo, y permite recuperar la lista vacía", async () => {
    window.innerWidth = 320;
    render(<ListaUsuarios />);
    await screen.findByText("camarero1");
    const buscar = screen.getByRole("searchbox", { name: "Buscar usuarios por nombre o correo" });
    fireEvent.change(buscar, { target: { value: "DUENO" } });
    expect(screen.getByText("Dueño")).toBeInTheDocument();
    expect(screen.queryByText("camarero1")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("1 de 2 usuarios");
    fireEvent.change(buscar, { target: { value: "camarero1@staff.local" } });
    expect(screen.getByText("camarero1")).toBeInTheDocument();
    expect(screen.queryByText("Dueño")).toBeNull();
    fireEvent.change(buscar, { target: { value: "nadie@example.com" } });
    expect(screen.getByText(/No hay usuarios que coincidan/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver todos los usuarios" }));
    expect(screen.getByText("Dueño")).toBeInTheDocument();
    expect(screen.getByText("camarero1")).toBeInTheDocument();
    expect(buscar).toHaveValue("");
  });

  it("conserva la consulta sin gestión al cambiar de teléfono a escritorio", async () => {
    window.innerWidth = 390;
    render(<ListaUsuarios />);
    await screen.findByText("camarero1");
    expect(screen.getByRole("list", { name: "Usuarios" })).toBeInTheDocument();
    act(() => {
      window.innerWidth = 1280;
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Usuarios" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Ver permisos" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Contraseña" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bloquear acceso" })).toBeNull();
    expect(doble.bd.operaciones).toEqual([]);
  });

  it("distingue el acceso bloqueado de los permisos que mantiene el usuario", async () => {
    window.innerWidth = 390;
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { users: [{ id: CAMARERO, email: "camarero1@staff.local", display_name: "camarero1", access_blocked: true }] },
      error: null,
    } as never);
    render(<ListaUsuarios />);
    const tarjeta = (await screen.findByText("camarero1")).closest("li")!;
    expect(within(tarjeta).getByText("Acceso bloqueado")).toBeInTheDocument();
    expect(within(tarjeta).getByText("Permisos conservados")).toBeInTheDocument();
    fireEvent.click(within(tarjeta).getByRole("button", { name: "Ver permisos" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/Acceso bloqueado. Se conservan/)).toBeInTheDocument();
    expect(within(dialogo).getByLabelText("Editar Reservas: Sí")).toHaveTextContent("Sí");
    expect(doble.bd.operaciones).toEqual([]);
  });
});

it("en superadmin móvil permite editar permisos desde la tarjeta y mantiene las protecciones propias", async () => {
  window.innerWidth = 320;
  render(<ListaUsuarios canManageSuperAdmins />);
  const tarjeta = (await screen.findByText("camarero1")).closest("li")!;
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByRole("searchbox", { name: "Buscar usuarios por nombre o correo" })).toBeInTheDocument();
  expect(within(tarjeta).getByRole("button", { name: "Contraseña" })).toBeEnabled();
  expect(within(tarjeta).getByRole("button", { name: "Bloquear acceso" })).toBeEnabled();
  fireEvent.click(within(tarjeta).getByRole("button", { name: "Permisos" }));
  const dialogo = await screen.findByRole("dialog");
  fireEvent.click(interruptor(dialogo, "Puede editar Facturas"));
  fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar Permisos" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(within(tarjeta).getByText("2 con edición")).toBeInTheDocument();
  const propia = screen.getByText("Dueño").closest("li")!;
  // Su propia tarjeta va marcada y su contraseña NO se cambia con la función de admin:
  // «Mi contraseña» abre el cambio propio, que pide la actual (2026-11-03).
  expect(within(propia).getByText("Tú")).toBeInTheDocument();
  expect(within(tarjeta).queryByText("Tú")).toBeNull();
  expect(within(propia).queryByRole("button", { name: "Contraseña" })).toBeNull();
  fireEvent.click(within(propia).getByRole("button", { name: "Mi contraseña" }));
  const propio = await screen.findByRole("dialog", { name: "Cambiar mi contraseña" });
  expect(within(propio).getByLabelText("Contraseña actual", { selector: "input" })).toBeInTheDocument();
  fireEvent.click(within(propio).getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(vi.mocked(supabase.functions.invoke).mock.calls.some(([n]) => n === "admin-update-user-password")).toBe(false);
  expect(within(propia).getByRole("button", { name: "Bloquear acceso" })).toBeDisabled();
  const opciones = within(propia).getByText("Más opciones").closest("details")!;
  fireEvent.click(within(opciones).getByText("Más opciones"));
  expect(opciones).toHaveAttribute("open");
  expect(within(opciones).getByRole("button", { name: "Quitar Super Admin" })).toBeDisabled();
  const acciones = within(tarjeta).getByText("Más opciones").closest("details")!;
  fireEvent.click(within(acciones).getByText("Más opciones"));
  expect(within(acciones).getByRole("button", { name: "Hacer Super Admin" })).toBeEnabled();
  expect(within(acciones).getByRole("button", { name: "Eliminar a camarero1" })).toHaveTextContent("Eliminar usuario");
});

it.each([1280, 390])("el cambio de contraseña conserva el diálogo si falla y lo cierra al guardar a %s px", async (ancho) => {
  window.innerWidth = ancho;
  const listado = { users: [{ id: "u-yo", email: "dueno@example.com", display_name: "Dueño", access_blocked: false }, { id: CAMARERO, email: "camarero1@staff.local", display_name: "camarero1", access_blocked: false }] };
  let fallar = true;
  vi.mocked(supabase.functions.invoke).mockImplementation(async name => name === "admin-update-user-password"
    ? fallar ? { data: null, error: { context: new Response(JSON.stringify({ error: "La nueva contraseña debe ser diferente de la actual" }), { status: 400 }) } } as never : { data: { success: true }, error: null } as never
    : { data: listado, error: null } as never);
  render(<ListaUsuarios canManageSuperAdmins />);
  const fila = (await screen.findByText("camarero1")).closest(ancho < 768 ? "li" : "tr")!;
  // Solo la fila propia (tabla o tarjeta) lleva «Tú».
  expect(within(screen.getByText("Dueño").closest(ancho < 768 ? "li" : "tr")!).getByText("Tú")).toBeInTheDocument();
  expect(screen.getAllByText("Tú")).toHaveLength(1);
  fireEvent.click(within(fila).getByRole("button", { name: "Contraseña" }));
  const dialogo = await screen.findByRole("dialog");
  fireEvent.change(within(dialogo).getByLabelText("Nueva contraseña"), { target: { value: "prueba-123" } });
  fireEvent.change(within(dialogo).getByLabelText("Confirmar contraseña"), { target: { value: "prueba-123" } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Actualizar contraseña" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("La nueva contraseña debe ser diferente de la actual"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(within(dialogo).getByLabelText("Nueva contraseña")).toHaveValue("prueba-123");
  fallar = false;
  fireEvent.click(within(dialogo).getByRole("button", { name: "Actualizar contraseña" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(toast.success).toHaveBeenCalledWith("Contraseña actualizada correctamente");
});
