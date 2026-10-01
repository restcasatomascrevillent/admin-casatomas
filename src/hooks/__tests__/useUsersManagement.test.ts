/**
 * Tests de src/hooks/useUsersManagement.ts — permiso de EDICIÓN por sección.
 *
 * Hasta el 2026-10-01 el hook escribía `can_edit: false` a pelo al guardar los
 * permisos de un usuario (setAllPermissions y updateUserPermission): el permiso de
 * edición no se podía dar desde el panel y cualquier guardado borraba el que el
 * dueño hubiera puesto por SQL. Aquí se comprueba el PAYLOAD que llega a la BD.
 *
 * Supabase va mockeado entero (`__mocks__/client.ts` + un builder por tabla que
 * apunta lo que se inserta/borra): nada toca producción.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

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

import { supabase } from "@/integrations/supabase/client";
import { useUsersManagement } from "@/hooks/useUsersManagement";

type Fila = { section_key: string; can_view: boolean; can_edit: boolean };

const USUARIO = "u-camarero";

/** Lo que el mock "tiene" en cada tabla y lo que se le ha escrito. */
const bd = {
  tablas: {} as Record<string, unknown[]>,
  inserts: [] as { tabla: string; payload: unknown }[],
  upserts: [] as { tabla: string; payload: unknown; opciones: unknown }[],
  borrados: [] as { tabla: string; filtro: [string, unknown][] }[],
};

function builder(tabla: string) {
  let borrando: { tabla: string; filtro: [string, unknown][] } | null = null;
  const b: Record<string, unknown> = {};
  b.select = vi.fn(() => b);
  b.eq = vi.fn((col: string, valor: unknown) => {
    borrando?.filtro.push([col, valor]);
    return b;
  });
  b.delete = vi.fn(() => {
    borrando = { tabla, filtro: [] };
    bd.borrados.push(borrando);
    return b;
  });
  b.insert = vi.fn((payload: unknown) => {
    bd.inserts.push({ tabla, payload });
    return b;
  });
  b.upsert = vi.fn((payload: unknown, opciones: unknown) => {
    bd.upserts.push({ tabla, payload, opciones });
    return b;
  });
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
    Promise.resolve({ data: bd.tablas[tabla] ?? [], error: null }).then(ok, ko);
  return b;
}

function sembrar(permisos: Fila[]) {
  bd.tablas = {
    user_roles: [{ user_id: USUARIO, role: "staff", created_at: "2026-09-01T10:00:00Z" }],
    user_permissions: permisos.map((p) => ({ user_id: USUARIO, ...p })),
    super_admins: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  bd.inserts = [];
  bd.upserts = [];
  bd.borrados = [];
  sembrar([]);
  vi.mocked(supabase.from).mockImplementation(((tabla: string) => builder(tabla)) as never);
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

const insertadoEn = (tabla: string) => {
  const llamadas = bd.inserts.filter((i) => i.tabla === tabla);
  expect(llamadas).toHaveLength(1);
  return llamadas[0].payload as Array<Fila & { user_id: string }>;
};

const fila = (filas: Array<Fila & { user_id: string }>, clave: string) => filas.find((f) => f.section_key === clave);

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
      result.current.setAllPermissions(USUARIO, [
        { section_key: "reservas", can_view: true, can_edit: true },
        { section_key: "facturas", can_view: true, can_edit: false },
      ]),
    );

    const filas = insertadoEn("user_permissions");
    expect(fila(filas, "reservas")).toEqual({ user_id: USUARIO, section_key: "reservas", can_view: true, can_edit: true });
    expect(fila(filas, "facturas")).toEqual({ user_id: USUARIO, section_key: "facturas", can_view: true, can_edit: false });
  });

  it("retirar: el payload lleva can_edit = false y conserva «ver»", async () => {
    sembrar([{ section_key: "reservas", can_view: true, can_edit: true }]);
    const { result } = await montarHook();

    await act(() =>
      result.current.setAllPermissions(USUARIO, [{ section_key: "reservas", can_view: true, can_edit: false }]),
    );

    expect(fila(insertadoEn("user_permissions"), "reservas")).toEqual({
      user_id: USUARIO,
      section_key: "reservas",
      can_view: true,
      can_edit: false,
    });
  });

  it("guardar lo que se leyó no pierde can_edit (ida y vuelta)", async () => {
    sembrar([
      { section_key: "dashboard", can_view: true, can_edit: false },
      { section_key: "reservas", can_view: true, can_edit: true },
    ]);
    const { result } = await montarHook();
    const usuario = result.current.users.find((u) => u.id === USUARIO)!;

    await act(() => result.current.setAllPermissions(USUARIO, usuario.permissions));

    expect(fila(insertadoEn("user_permissions"), "reservas")?.can_edit).toBe(true);
  });

  it("editar implica ver: una fila con can_edit y sin can_view se guarda con las dos", async () => {
    const { result } = await montarHook();

    await act(() =>
      result.current.setAllPermissions(USUARIO, [{ section_key: "reservas", can_view: false, can_edit: true }]),
    );

    expect(fila(insertadoEn("user_permissions"), "reservas")).toMatchObject({ can_view: true, can_edit: true });
  });

  it("sigue borrando primero las filas del usuario (mismo flujo que antes)", async () => {
    const { result } = await montarHook();

    await act(() =>
      result.current.setAllPermissions(USUARIO, [{ section_key: "reservas", can_view: true, can_edit: true }]),
    );

    expect(bd.borrados).toEqual([{ tabla: "user_permissions", filtro: [["user_id", USUARIO]] }]);
  });
});

describe("useUsersManagement · updateUserPermission (una sola sección)", () => {
  it("el upsert lleva el can_edit pedido, no false a pelo", async () => {
    const { result } = await montarHook();

    await act(() => result.current.updateUserPermission(USUARIO, "reservas", true, true));

    const llamadas = bd.upserts.filter((u) => u.tabla === "user_permissions");
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].payload).toMatchObject({
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

    expect(bd.upserts[0].payload).toMatchObject({ section_key: "reservas", can_view: true, can_edit: false });
  });
});

describe("useUsersManagement · usuario nuevo (assignRoleToNewUser)", () => {
  it("los permisos por defecto empiezan sin edición en ninguna sección", async () => {
    const { result } = await montarHook();

    await act(async () => {
      await result.current.assignRoleToNewUser("u-nuevo", "staff");
    });

    const llamada = bd.upserts.find((u) => u.tabla === "user_permissions")!;
    const filas = llamada.payload as Fila[];
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((f) => f.can_edit === false)).toBe(true);
    expect(filas.find((f) => f.section_key === "dashboard")?.can_view).toBe(true);
  });
});
