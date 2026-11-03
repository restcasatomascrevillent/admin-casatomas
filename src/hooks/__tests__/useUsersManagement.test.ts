/**
 * Tests de src/hooks/useUsersManagement.ts — permiso de EDICIÓN por sección.
 *
 * Hasta el 2026-10-01 el hook escribía `can_edit: false` a pelo al guardar los
 * permisos de un usuario (setAllPermissions y updateUserPermission): el permiso de
 * edición no se podía dar desde el panel y cualquier guardado borraba el que el
 * dueño hubiera puesto por SQL. Aquí se comprueba lo que llega a la BD.
 *
 * Y el GUARDADO SEGURO (2026-10-01): setAllPermissions borraba TODAS las filas del
 * usuario y reinsertaba solo las ~6 secciones del diálogo, sin transacción. Perdía
 * las secciones que el diálogo no gestiona (gestion_bot, asistente_telefonico…) y,
 * si el insert fallaba tras el borrado, dejaba al usuario sin NINGÚN permiso. Ahora
 * hace primero un upsert y después borra solo lo desmarcado del diálogo.
 *
 * Supabase va mockeado entero (`__mocks__/client.ts` + `doblePermisosUsuario.ts`,
 * que aplica las escrituras a unas filas en memoria y las anota en orden): nada toca
 * producción.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { crearDoblePermisos, type Fila as FilaBd } from "./doblePermisosUsuario";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/hooks/useUserRole", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useUserRole")>();
  return {
    ...real,
    useUserRole: () => ({ role: "admin", isAdmin: true, permissions: [], loading: false }),
  };
});

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useUsersManagement } from "@/hooks/useUsersManagement";
import { permisosParaEditar } from "@/components/usuarios/permisosSecciones";

type Fila = { section_key: string; can_view: boolean; can_edit: boolean };

const USUARIO = "u-camarero";
const OTRO = "u-otro";

let doble: ReturnType<typeof crearDoblePermisos>;

function sembrar(permisos: Fila[], otras: FilaBd[] = []) {
  doble.bd.tablas = {
    user_roles: [{ user_id: USUARIO, role: "staff", created_at: "2026-09-01T10:00:00Z" }],
    user_permissions: [
      ...permisos.map((p) => ({ user_id: USUARIO, updated_at: "2026-09-01T10:00:00Z", ...p })),
      ...otras,
    ],
    super_admins: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  doble = crearDoblePermisos();
  sembrar([]);
  vi.mocked(supabase.from).mockImplementation(((tabla: string) => doble.from(tabla)) as never);
  vi.mocked(supabase.functions.invoke).mockResolvedValue({
    data: {
      users: [{ id: USUARIO, email: "camarero1@staff.local", display_name: "camarero1", created_at: "2026-09-01T10:00:00Z" }],
    },
    error: null,
  } as never);
});

async function montarHook() {
  const hook = renderHook(() => useUsersManagement());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

const COMO_SUPER_ADMIN = { puedeConcederEdicion: true };
const SIN_CONCEDER_EDICION = { puedeConcederEdicion: false };

/** Filas del único upsert a user_permissions (falla si hay más de uno o ninguno). */
const upsertadoEn = (tabla: string) => {
  const llamadas = doble.escriturasEn(tabla).filter((o) => o.tipo === "upsert");
  expect(llamadas).toHaveLength(1);
  return llamadas[0].payload as Array<Fila & { user_id: string }>;
};

const fila = (filas: Array<Fila & { user_id: string }>, clave: string) => filas.find((f) => f.section_key === clave);

/** Lo que tiene guardado el usuario en una sección (`undefined` si no hay fila). */
const enBd = (clave: string, userId = USUARIO) =>
  doble.filasDe("user_permissions", userId).find((f) => f.section_key === clave);

it("un 403 al listar muestra el motivo sin cerrar una sesión válida ni inventar usuarios", async () => {
  vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "No tienes permiso para ver usuarios" }), { status: 403 }) } } as never);
  const { result } = await montarHook();
  expect(result.current.users).toEqual([]);
  expect(result.current.loadError).toBe("No tienes permiso para ver usuarios");
  expect(supabase.auth.signOut).not.toHaveBeenCalled();
});

it("un error de contraseña conserva el mensaje de la función y no anuncia éxito", async () => {
  const { result } = await montarHook();
  vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: null, error: { context: new Response(JSON.stringify({ error: "La nueva contraseña debe ser diferente de la actual" }), { status: 400 }) } } as never);
  let guardado = true;
  await act(async () => { guardado = await result.current.updateUserPassword(USUARIO, "prueba-123"); });
  expect(guardado).toBe(false);
  expect(toast.error).toHaveBeenCalledWith("La nueva contraseña debe ser diferente de la actual");
  expect(toast.success).not.toHaveBeenCalled();
});

describe("useUsersManagement · lectura", () => {
  it("devuelve el can_edit real guardado en la BD (true sigue siendo true)", async () => {
    sembrar([
      { section_key: "reservas", can_view: true, can_edit: true },
      { section_key: "facturas", can_view: true, can_edit: false },
    ]);
    const { result } = await montarHook();

    const usuario = result.current.users.find((u) => u.id === USUARIO)!;
    expect(usuario.permissions).toEqual(
      expect.arrayContaining([
        { section_key: "reservas", can_view: true, can_edit: true },
        { section_key: "facturas", can_view: true, can_edit: false },
      ]),
    );
  });
});

describe("useUsersManagement · setAllPermissions (guardar el diálogo «Permisos»)", () => {
  it("conceder: el payload a user_permissions lleva can_edit = true en esa sección", async () => {
    const { result } = await montarHook();

    await act(() =>
      result.current.setAllPermissions(
        USUARIO,
        [
          { section_key: "reservas", can_view: true, can_edit: true },
          { section_key: "facturas", can_view: true, can_edit: false },
        ],
        COMO_SUPER_ADMIN,
      ),
    );

    const filas = upsertadoEn("user_permissions");
    expect(fila(filas, "reservas")).toMatchObject({ user_id: USUARIO, section_key: "reservas", can_view: true, can_edit: true });
    expect(fila(filas, "facturas")).toMatchObject({ user_id: USUARIO, section_key: "facturas", can_view: true, can_edit: false });
  });

  it("retirar: el payload lleva can_edit = false y conserva «ver»", async () => {
    sembrar([{ section_key: "reservas", can_view: true, can_edit: true }]);
    const { result } = await montarHook();

    await act(() =>
      result.current.setAllPermissions(USUARIO, [{ section_key: "reservas", can_view: true, can_edit: false }], COMO_SUPER_ADMIN),
    );

    expect(fila(upsertadoEn("user_permissions"), "reservas")).toMatchObject({
      user_id: USUARIO,
      section_key: "reservas",
      can_view: true,
      can_edit: false,
    });
    expect(enBd("reservas")).toMatchObject({ can_view: true, can_edit: false });
  });

  it("guardar lo que se leyó no pierde can_edit (ida y vuelta)", async () => {
    sembrar([
      { section_key: "dashboard", can_view: true, can_edit: false },
      { section_key: "reservas", can_view: true, can_edit: true },
    ]);
    const { result } = await montarHook();
    const usuario = result.current.users.find((u) => u.id === USUARIO)!;

    await act(() => result.current.setAllPermissions(USUARIO, usuario.permissions, COMO_SUPER_ADMIN));

    expect(fila(upsertadoEn("user_permissions"), "reservas")?.can_edit).toBe(true);
    expect(enBd("reservas")).toMatchObject({ can_view: true, can_edit: true });
  });

  it("editar implica ver: una fila con can_edit y sin can_view se guarda con las dos", async () => {
    const { result } = await montarHook();

    await act(() =>
      result.current.setAllPermissions(USUARIO, [{ section_key: "reservas", can_view: false, can_edit: true }], COMO_SUPER_ADMIN),
    );

    expect(fila(upsertadoEn("user_permissions"), "reservas")).toMatchObject({ can_view: true, can_edit: true });
  });
});

// ---------------------------------------------------------------------------
// Guardado SEGURO sin transacción en el cliente (2026-10-01)
// ---------------------------------------------------------------------------

/**
 * Como en producción hoy: el usuario tiene filas de secciones del diálogo y también de
 * otras que se gestionan en otro sitio (gestion_bot, asistente_telefonico) o que el
 * diálogo no enseña (usuarios), y una fila «a cero» que dejaba el guardado antiguo.
 */
const GUARDADAS: Fila[] = [
  { section_key: "dashboard", can_view: true, can_edit: false },
  { section_key: "reservas", can_view: true, can_edit: true },
  { section_key: "facturas", can_view: true, can_edit: false },
  { section_key: "marketing", can_view: false, can_edit: false },
  { section_key: "gestion_bot", can_view: true, can_edit: false },
  { section_key: "asistente_telefonico", can_view: true, can_edit: true },
  { section_key: "usuarios", can_view: true, can_edit: false },
];
const NO_GESTIONADAS = ["gestion_bot", "asistente_telefonico", "usuarios"];
/** Fila de OTRO usuario: un guardado de USUARIO no la toca nunca. */
const DE_OTRO: FilaBd = { user_id: OTRO, section_key: "reservas", can_view: true, can_edit: true, updated_at: "2026-09-01T10:00:00Z" };

/**
 * Lo que manda el diálogo (sus 7 secciones con Cheques, `permisosParaEditar`) tras: quitar «Ver» en
 * Facturas, dar «Ver» en Carta y dejar el resto como estaba.
 */
const dialogo = () =>
  permisosParaEditar(GUARDADAS).map((p) => {
    if (p.section_key === "facturas") return { ...p, can_view: false, can_edit: false };
    if (p.section_key === "gestor_carta") return { ...p, can_view: true };
    return p;
  });

describe("useUsersManagement · setAllPermissions guarda sin dejar al usuario con menos permisos", () => {
  beforeEach(() => sembrar(GUARDADAS, [DE_OTRO]));

  it("(1) no borra ni reescribe ninguna fila de una sección que el diálogo no gestiona (ni de otro usuario)", async () => {
    const antes = NO_GESTIONADAS.map((clave) => enBd(clave));
    const { result } = await montarHook();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.setAllPermissions(USUARIO, dialogo(), COMO_SUPER_ADMIN);
    });

    expect(ok).toBe(true);
    expect(NO_GESTIONADAS.map((clave) => enBd(clave))).toEqual(antes);
    expect(enBd("reservas", OTRO)).toEqual(DE_OTRO);
    // Ninguna escritura las nombra: ni el upsert las lleva ni el borrado las abarca.
    for (const op of doble.escriturasEn("user_permissions")) {
      for (const f of op.payload ?? []) expect(NO_GESTIONADAS).not.toContain(f.section_key);
      if (op.tipo === "delete") {
        const enLista = op.filtros.find(([o, columna]) => o === "in" && columna === "section_key");
        expect(enLista, "el borrado va acotado a secciones concretas").toBeDefined();
        for (const clave of enLista![2] as string[]) expect(NO_GESTIONADAS).not.toContain(clave);
      }
    }
  });

  it("(2) el upsert va ANTES que cualquier borrado, por la clave única real, y solo se borra lo desmarcado del diálogo", async () => {
    const { result } = await montarHook();

    await act(() => result.current.setAllPermissions(USUARIO, dialogo(), COMO_SUPER_ADMIN));

    const escrituras = doble.escriturasEn("user_permissions");
    expect(escrituras.map((o) => o.tipo)).toEqual(["upsert", "delete"]);
    expect(escrituras[0].opciones).toEqual({ onConflict: "user_id,section_key" });
    expect(escrituras[0].payload!.map((f) => f.section_key).sort()).toEqual(["dashboard", "gestor_carta", "reservas"]);
    expect(escrituras[1].filtros).toEqual([
      ["eq", "user_id", USUARIO],
      ["in", "section_key", ["gestion_web", "marketing", "cheques", "tienda", "facturas"]],
    ]);
    // Resultado: lo marcado está, lo desmarcado ya no, y la edición de Reservas sigue.
    expect(enBd("reservas")).toMatchObject({ can_view: true, can_edit: true });
    expect(enBd("gestor_carta")).toMatchObject({ can_view: true, can_edit: false });
    expect(enBd("facturas")).toBeUndefined();
    expect(enBd("marketing")).toBeUndefined();
  });

  it("(3) si la BD rechaza el upsert no se borra nada, el usuario conserva TODOS sus permisos y se avisa del error", async () => {
    const antes = doble.filasDe("user_permissions", USUARIO);
    // La BD rechaza (con su código) la escritura de las filas, sea upsert (ahora) o insert (antes).
    const rechazo = { code: "42501", message: 'new row violates row-level security policy for table "user_permissions"' };
    doble.bd.fallos = { upsert: rechazo, insert: rechazo };
    const { result } = await montarHook();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.setAllPermissions(USUARIO, dialogo(), COMO_SUPER_ADMIN);
    });

    expect(ok).toBe(false);
    expect(doble.escriturasEn("user_permissions").some((o) => o.tipo === "delete")).toBe(false);
    expect(doble.filasDe("user_permissions", USUARIO)).toEqual(antes);
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/no se ha cambiado nada/i),
      expect.objectContaining({ description: rechazo.message }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("si el upsert falla SIN código de la BD (se cae la red) no afirma que no ha cambiado nada: puede que se aplicara, y relee la lista", async () => {
    // Error de red de supabase-js: `code` vacío. El upsert pudo llegar y aplicarse.
    doble.bd.fallos = { upsert: { code: "", message: "TypeError: Failed to fetch" } };
    const { result } = await montarHook();
    const lecturasAntes = vi.mocked(supabase.functions.invoke).mock.calls.length;

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.setAllPermissions(USUARIO, dialogo(), COMO_SUPER_ADMIN);
    });

    expect(ok).toBe(false);
    expect(doble.escriturasEn("user_permissions").some((o) => o.tipo === "delete")).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/puede que no se haya guardado/i), expect.anything());
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringMatching(/no se ha cambiado nada/i), expect.anything());
    await waitFor(() => expect(vi.mocked(supabase.functions.invoke).mock.calls.length).toBeGreaterThan(lecturasAntes));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("si falla el borrado de lo desmarcado, sobran permisos (los desmarcados), nunca faltan, y se avisa", async () => {
    doble.bd.fallos = { delete: { message: "connection failure" } };
    const { result } = await montarHook();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.setAllPermissions(USUARIO, dialogo(), COMO_SUPER_ADMIN);
    });

    expect(ok).toBe(false);
    expect(enBd("gestor_carta")).toMatchObject({ can_view: true });
    expect(enBd("reservas")).toMatchObject({ can_view: true, can_edit: true });
    expect(enBd("facturas")).toMatchObject({ can_view: true }); // desmarcada, pero no se ha podido quitar
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/no se han podido quitar/i), expect.anything());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("(4) quien no puede conceder edición no cambia «Puede editar»: ni lo da, ni lo quita, ni borra una fila que lo tenga", async () => {
    const { result } = await montarHook();
    // Lo que llegaría con «Puede editar» tocado (el diálogo lo bloquea a quien no es super
    // admin, pero el hook no se fía): quitarlo en Reservas, darlo en Dashboard y en una
    // sección nueva (Carta).
    const tocado = permisosParaEditar(GUARDADAS).map((p) => {
      if (p.section_key === "reservas") return { ...p, can_edit: false };
      if (p.section_key === "dashboard") return { ...p, can_edit: true };
      if (p.section_key === "gestor_carta") return { ...p, can_view: true, can_edit: true };
      return p;
    });

    await act(() => result.current.setAllPermissions(USUARIO, tocado, SIN_CONCEDER_EDICION));

    for (const f of upsertadoEn("user_permissions")) expect(f).not.toHaveProperty("can_edit");
    expect(enBd("reservas")).toMatchObject({ can_view: true, can_edit: true });
    expect(enBd("dashboard")).toMatchObject({ can_view: true, can_edit: false });
    expect(enBd("gestor_carta")).toMatchObject({ can_view: true, can_edit: false });

    // Quitar «Ver» de una sección con edición la quitaría también: tampoco.
    const sinVerReservas = permisosParaEditar(GUARDADAS).map((p) =>
      p.section_key === "reservas" ? { ...p, can_view: false, can_edit: false } : p,
    );
    await act(() => result.current.setAllPermissions(USUARIO, sinVerReservas, SIN_CONCEDER_EDICION));

    expect(enBd("reservas")).toMatchObject({ can_view: true, can_edit: true });
    const borrado = doble.escriturasEn("user_permissions").filter((o) => o.tipo === "delete").at(-1)!;
    expect(borrado.filtros).toContainEqual(["eq", "can_edit", false]);
  });

  it("secciones ajenas al diálogo que lleguen en `permissions` tampoco se tocan (ni marcadas ni desmarcadas)", async () => {
    const antes = NO_GESTIONADAS.map((clave) => enBd(clave));
    const { result } = await montarHook();
    const conAjenas = [
      ...dialogo(),
      { section_key: "gestion_bot", can_view: false, can_edit: false },
      { section_key: "asistente_telefonico", can_view: true, can_edit: false },
      { section_key: "usuarios", can_view: false, can_edit: false },
      { section_key: "espacios", can_view: true, can_edit: true },
    ];

    await act(() => result.current.setAllPermissions(USUARIO, conAjenas, COMO_SUPER_ADMIN));

    expect(NO_GESTIONADAS.map((clave) => enBd(clave))).toEqual(antes);
    expect(enBd("espacios")).toBeUndefined();
    const ajenas = [...NO_GESTIONADAS, "espacios"];
    for (const op of doble.escriturasEn("user_permissions")) {
      for (const f of op.payload ?? []) expect(ajenas).not.toContain(f.section_key);
      for (const [, columna, valor] of op.filtros) {
        if (columna === "section_key") for (const clave of valor as string[]) expect(ajenas).not.toContain(clave);
      }
    }
  });
});

// Un DELETE que la RLS no deja hacer NO da error: borra 0 filas. Antes eso salía como «Permisos
// actualizados» y el diálogo se cerraba con los permisos intactos (2026-10-01, revisión).
describe("useUsersManagement · setAllPermissions no da por quitado lo que sigue ahí", () => {
  beforeEach(() => sembrar(GUARDADAS, [DE_OTRO]));

  const lecturasDeLaLista = () => vi.mocked(supabase.functions.invoke).mock.calls.length;

  it("el admin que no es super admin desmarca las 6 secciones: la RLS filtra el DELETE (0 filas, sin error) → error, no éxito", async () => {
    doble.bd.borradoFiltradoPorRls = true;
    const antes = doble.filasDe("user_permissions", USUARIO);
    const { result } = await montarHook();
    const lecturasAntes = lecturasDeLaLista();
    const todoDesmarcado = permisosParaEditar(GUARDADAS).map((p) => ({ ...p, can_view: false, can_edit: false }));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.setAllPermissions(USUARIO, todoDesmarcado, SIN_CONCEDER_EDICION);
    });

    expect(ok).toBe(false);
    expect(doble.escriturasEn("user_permissions").map((o) => o.tipo)).toEqual(["delete"]); // nada marcado: no hay upsert
    expect(doble.filasDe("user_permissions", USUARIO)).toEqual(antes); // sigue con «Ver» y «Puede editar»
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/no se han podido quitar algunos permisos/i),
      expect.objectContaining({ description: expect.stringMatching(/Dashboard.*Reservas.*Facturas/) }),
    );
    await waitFor(() => expect(lecturasDeLaLista()).toBeGreaterThan(lecturasAntes));
  });

  it("sin poder conceder edición (p. ej. si falló la consulta a super_admins), quitar «Ver» de una sección con edición no la quita y lo dice", async () => {
    const { result } = await montarHook();
    const sinVerReservas = permisosParaEditar(GUARDADAS).map((p) =>
      p.section_key === "reservas" ? { ...p, can_view: false, can_edit: false } : p,
    );

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.setAllPermissions(USUARIO, sinVerReservas, SIN_CONCEDER_EDICION);
    });

    expect(ok).toBe(false);
    expect(enBd("reservas")).toMatchObject({ can_view: true, can_edit: true });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/no se han podido quitar algunos permisos/i),
      expect.objectContaining({ description: "Siguen activos: Reservas." }),
    );
  });
});

describe("useUsersManagement · updateUserPermission (una sola sección)", () => {
  const upserts = () => doble.escriturasEn("user_permissions").filter((o) => o.tipo === "upsert");

  it("el upsert lleva el can_edit pedido, no false a pelo", async () => {
    const { result } = await montarHook();

    await act(() => result.current.updateUserPermission(USUARIO, "reservas", true, true));

    const llamadas = upserts();
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].payload![0]).toMatchObject({
      user_id: USUARIO,
      section_key: "reservas",
      can_view: true,
      can_edit: true,
    });
    expect(llamadas[0].opciones).toEqual({ onConflict: "user_id,section_key" });
  });

  it("retirar la edición por sección envía can_edit = false", async () => {
    const { result } = await montarHook();

    await act(() => result.current.updateUserPermission(USUARIO, "reservas", true, false));

    expect(upserts()[0].payload![0]).toMatchObject({ section_key: "reservas", can_view: true, can_edit: false });
  });
});

describe("useUsersManagement · usuario nuevo (assignRoleToNewUser)", () => {
  it("los permisos por defecto empiezan sin edición en ninguna sección", async () => {
    const { result } = await montarHook();

    await act(async () => {
      await result.current.assignRoleToNewUser("u-nuevo", "staff");
    });

    const llamada = doble.escriturasEn("user_permissions").find((o) => o.tipo === "upsert")!;
    const filas = llamada.payload as Fila[];
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((f) => f.can_edit === false)).toBe(true);
    expect(filas.find((f) => f.section_key === "dashboard")?.can_view).toBe(true);
  });
});
