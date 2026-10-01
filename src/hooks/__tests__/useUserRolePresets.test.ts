/**
 * Tests de src/hooks/useUserRolePresets.ts — los roles preconfigurados guardan
 * también «Puede editar».
 *
 * Hasta el 2026-10-01 el hook normalizaba `can_edit: false` al leer y al escribir
 * las plantillas, así que aplicar un rol preconfigurado a alguien le quitaba la
 * edición. Ahora la plantilla guarda y devuelve el can_edit real (editar implica
 * ver). Las plantillas ya guardadas tienen can_edit = false: nada cambia para ellas.
 *
 * Supabase va mockeado (`__mocks__/client.ts`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { supabase } from "@/integrations/supabase/client";
import { useUserRolePresets, type UserRolePreset } from "@/hooks/useUserRolePresets";

type Fila = { section_key: string; can_view: boolean; can_edit: boolean };

const escrito = { insert: null as unknown, update: null as unknown };

function filaPreset(permissions: unknown) {
  return {
    id: "p-1",
    name: "Sala",
    base_role: "staff",
    permissions,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
  };
}

function builder(listado: unknown[]) {
  const b: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "order", "delete"]) b[metodo] = vi.fn(() => b);
  b.insert = vi.fn((payload: { permissions: unknown }) => {
    escrito.insert = payload;
    return b;
  });
  b.update = vi.fn((payload: { permissions: unknown }) => {
    escrito.update = payload;
    return b;
  });
  // La fila devuelta tras insert/update es lo que se acaba de escribir.
  b.single = vi.fn(async () => {
    const payload = (escrito.update ?? escrito.insert) as { permissions: unknown } | null;
    return { data: filaPreset(payload?.permissions ?? []), error: null };
  });
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
    Promise.resolve({ data: listado, error: null }).then(ok, ko);
  return b;
}

function sembrar(listado: unknown[]) {
  vi.mocked(supabase.from).mockImplementation((() => builder(listado)) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  escrito.insert = null;
  escrito.update = null;
  sembrar([]);
});

async function montarHook() {
  const hook = renderHook(() => useUserRolePresets());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

const de = (filas: Fila[], clave: string) => filas.find((f) => f.section_key === clave);

describe("useUserRolePresets · «Puede editar» en las plantillas", () => {
  it("al leer conserva el can_edit guardado en la plantilla", async () => {
    sembrar([
      filaPreset([
        { section_key: "reservas", can_view: true, can_edit: true },
        { section_key: "facturas", can_view: true, can_edit: false },
      ]),
    ]);
    const { result } = await montarHook();

    const permisos = result.current.presets[0].permissions;
    expect(de(permisos, "reservas")).toEqual({ section_key: "reservas", can_view: true, can_edit: true });
    expect(de(permisos, "facturas")).toEqual({ section_key: "facturas", can_view: true, can_edit: false });
  });

  it("al crear guarda el can_edit pedido (editar implica ver)", async () => {
    const { result } = await montarHook();

    await act(async () => {
      await result.current.createPreset("Sala", "staff", [
        { section_key: "reservas", can_view: false, can_edit: true },
        { section_key: "facturas", can_view: true, can_edit: false },
      ]);
    });

    const permisos = (escrito.insert as { permissions: Fila[] }).permissions;
    expect(de(permisos, "reservas")).toEqual({ section_key: "reservas", can_view: true, can_edit: true });
    expect(de(permisos, "facturas")).toEqual({ section_key: "facturas", can_view: true, can_edit: false });
  });

  it("al actualizar guarda el can_edit pedido y lo devuelve en la plantilla", async () => {
    const { result } = await montarHook();

    const salida: { preset: UserRolePreset | null } = { preset: null };
    await act(async () => {
      salida.preset = await result.current.updatePreset("p-1", "Sala", "staff", [
        { section_key: "reservas", can_view: true, can_edit: true },
      ]);
    });

    const permisos = (escrito.update as { permissions: Fila[] }).permissions;
    expect(de(permisos, "reservas")?.can_edit).toBe(true);
    expect(de(salida.preset!.permissions, "reservas")?.can_edit).toBe(true);
  });
});
